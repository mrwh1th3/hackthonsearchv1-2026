#!/usr/bin/env bash
# =====================================================================
# db/tests/run.sh — Prueba de 001_schema.sql + 002_views.sql + seed_fake.sql
# sobre una base nueva y desechable.
#
#   bash db/tests/run.sh
#   PGBIN=/ruta/bin DB=forense_test_9 KEEP=1 bash db/tests/run.sh
#
# No toca la base 'forense' ni ningún servicio remoto: crea la base, aplica
# las migraciones, ejecuta las aserciones y borra la base (KEEP=1 la conserva).
# Salida: una línea por aserción y un resumen con exit code 0/1.
# =====================================================================
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-postgres}"
export PGPORT="${PGPORT:-5432}"
PSQL="$PGBIN/psql"
CREATEDB="$PGBIN/createdb"
DROPDB="$PGBIN/dropdb"
DB="${DB:-forense_test_$$}"
KEEP="${KEEP:-0}"
WORKERS="${WORKERS:-4}"

HERE="$(cd "$(dirname "$0")" && pwd)"
DBDIR="$(dirname "$HERE")"
TMP="$(mktemp -d)"
LOG="$TMP/psql.log"
fallos=0

limpiar() {
  if [ "$KEEP" = "1" ]; then
    echo "base conservada: $DB"
  else
    "$DROPDB" --if-exists "$DB" >/dev/null 2>&1
  fi
  rm -rf "$TMP"
}
trap limpiar EXIT

if [ ! -x "$PSQL" ]; then
  echo "no encuentro psql en $PGBIN (usa PGBIN=/ruta/bin)"
  exit 2
fi

aplicar() { # $1 archivo, $2 etiqueta
  if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -q -X -f "$1" >"$LOG" 2>&1; then
    echo "  ok    $2"
  else
    echo "  FALLA $2"
    grep -v '^psql.*NOTICE' "$LOG" | head -20
    fallos=$((fallos + 1))
  fi
}

anotar() { # $1 nombre, $2 ok(true/false), $3 detalle
  "$PSQL" -d "$DB" -q -X -c "select pruebas.assert('$1', $2, '$3')" >/dev/null 2>&1
}

echo "== base de prueba: $DB =="
"$DROPDB" --if-exists "$DB" >/dev/null 2>&1
if ! "$CREATEDB" "$DB" >"$LOG" 2>&1; then
  echo "no pude crear la base $DB"; cat "$LOG"; exit 2
fi

echo "== migraciones =="
aplicar "$DBDIR/001_schema.sql" "001_schema.sql"
aplicar "$DBDIR/002_views.sql"  "002_views.sql"
aplicar "$DBDIR/003_pistas.sql" "003_pistas.sql"
aplicar "$DBDIR/004_clusters.sql" "004_clusters.sql"
aplicar "$DBDIR/005_rpc.sql" "005_rpc.sql"
aplicar "$DBDIR/006_producto_ui.sql" "006_producto_ui.sql"
aplicar "$DBDIR/007_notificaciones_voz.sql" "007_notificaciones_voz.sql"
aplicar "$DBDIR/008_ingesta.sql" "008_ingesta.sql"
aplicar "$DBDIR/009_runtime_eventos.sql" "009_runtime_eventos.sql"
aplicar "$DBDIR/010_runtime_funciones.sql" "010_runtime_funciones.sql"
aplicar "$DBDIR/seeds/seed_fake.sql" "seeds/seed_fake.sql"
aplicar "$DBDIR/seeds/seed_producto.sql" "seeds/seed_producto.sql"
aplicar "$HERE/helpers.sql" "tests/helpers.sql"

"$PSQL" -d "$DB" -q -X -c "create table pruebas.conteo_1 as select * from pruebas.conteos()" >/dev/null 2>&1

echo "== reaplicación (idempotencia) =="
reaplicar_ok=true
for f in "$DBDIR/001_schema.sql" "$DBDIR/002_views.sql" "$DBDIR/003_pistas.sql" \
         "$DBDIR/004_clusters.sql" "$DBDIR/005_rpc.sql" "$DBDIR/006_producto_ui.sql" \
         "$DBDIR/007_notificaciones_voz.sql" "$DBDIR/008_ingesta.sql" \
         "$DBDIR/009_runtime_eventos.sql" "$DBDIR/010_runtime_funciones.sql" \
         "$DBDIR/seeds/seed_fake.sql" "$DBDIR/seeds/seed_producto.sql"; do
  if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -q -X -f "$f" >"$LOG" 2>&1; then
    echo "  ok    reaplicar $(basename "$f")"
  else
    echo "  FALLA reaplicar $(basename "$f")"
    grep -v '^psql.*NOTICE' "$LOG" | head -20
    reaplicar_ok=false
    fallos=$((fallos + 1))
  fi
done
anotar "reaplicar migraciones y seed no falla" "$reaplicar_ok" "aplicado dos veces sobre la misma base"

echo "== aserciones =="
aplicar "$HERE/assertions.sql" "tests/assertions.sql"
aplicar "$HERE/assertions_003.sql" "tests/assertions_003.sql"
aplicar "$HERE/assertions_004.sql" "tests/assertions_004.sql"
aplicar "$HERE/assertions_005.sql" "tests/assertions_005.sql"
aplicar "$HERE/assertions_006_007.sql" "tests/assertions_006_007.sql"
aplicar "$HERE/assertions_008.sql" "tests/assertions_008.sql"
aplicar "$HERE/assertions_009.sql" "tests/assertions_009.sql"
aplicar "$HERE/assertions_010.sql" "tests/assertions_010.sql"

echo "== paquetes de inyección (eval/inyecciones) =="
bash "$HERE/cargar_paquetes.sh" "$DB" || fallos=$((fallos + 1))

echo "== snapshot gen-v1 (opcional: GEN=0 lo omite) =="
GEN="${GEN:-auto}"
if [ "$GEN" = "0" ]; then
  echo "  omitido por GEN=0"
else
  if bash "$HERE/cargar_gen.sh" "$DB"; then
    aplicar "$HERE/assertions_gen.sql" "tests/assertions_gen.sql"
  else
    rc=$?
    if [ "$rc" = "3" ] && [ "$GEN" != "1" ]; then
      echo "  sin snapshot gen-v1 disponible: aserciones de datos reales omitidas"
    else
      echo "  FALLA carga de gen-v1"
      fallos=$((fallos + 1))
    fi
  fi
fi

echo "== eval/metricas.py sobre el snapshot cargado =="
RAIZ_EVAL="$(dirname "$DBDIR")"
if command -v python3 >/dev/null 2>&1 \
   && "$PSQL" -d "$DB" -X -t -A -c "select 1 from forense.corridas where nombre='gen-v1'" | grep -q 1; then
  if PSQL="$PSQL" python3 "$RAIZ_EVAL/eval/metricas.py" --corrida gen-v1 --db "$DB" --json \
       > "$TMP/metricas.json" 2>"$LOG"; then
    fpr=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['carril_datos']['selector_dos_familias']['fpr_trampas']['fpr'])" "$TMP/metricas.json")
    rec=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['carril_datos']['selector_dos_familias']['recall_conservador'])" "$TMP/metricas.json")
    base_fpr=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['carril_datos']['baseline_dos_pistas']['fpr_trampas']['fpr'])" "$TMP/metricas.json")
    echo "  selector dos familias: FPR trampas=$fpr recall conservador=$rec (baseline dos pistas FPR=$base_fpr)"
    anotar "eval/metricas.py corre sobre gen-v1 y devuelve el bloque del carril de datos" true \
      "fpr=$fpr recall=$rec"
    anotar "el selector de dos familias cumple la meta de FPR sobre trampas (<=0.15)" \
      "$(python3 -c "print(str(float('$fpr') <= 0.15).lower())")" "fpr=$fpr"
    anotar "el selector de dos familias no marca mas trampas que el baseline de dos pistas" \
      "$(python3 -c "print(str(float('$fpr') <= float('$base_fpr')).lower())")" \
      "selector=$fpr baseline=$base_fpr"
    if PSQL="$PSQL" python3 "$RAIZ_EVAL/eval/comparar_corridas.py" --base gen-v1 --nueva gen-v1 \
         --db "$DB" >/dev/null 2>>"$LOG"; then
      anotar "eval/comparar_corridas.py compara dos corridas sin mezclarlas" true ""
    else
      anotar "eval/comparar_corridas.py compara dos corridas sin mezclarlas" false "ver log"
      fallos=$((fallos + 1))
    fi
  else
    echo "  FALLA eval/metricas.py"
    head -10 "$LOG"
    anotar "eval/metricas.py corre sobre gen-v1 y devuelve el bloque del carril de datos" false "ver log"
    fallos=$((fallos + 1))
  fi
else
  echo "  omitido: sin python3 o sin snapshot gen-v1"
fi

echo "== contrato de pistas (contracts/entities.pista) =="
RAIZ="$(dirname "$DBDIR")"
if command -v node >/dev/null 2>&1 && [ -d "$RAIZ/contracts/node_modules" ]; then
  "$PSQL" -d "$DB" -X -t -A -c "
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id::text, 'corrida_id', p.corrida_id, 'codigo', p.codigo, 'familia', p.familia,
      'rfc', p.rfc, 'score', p.score::float8, 'estado', p.estado,
      'resumen', p.detalle->>'resumen', 'referencias', p.detalle->'referencias')), '[]'::jsonb)
      from forense.pistas p" > "$TMP/pistas.json" 2>"$LOG"
  if node "$HERE/contrato_pistas.mjs" "$TMP/pistas.json" "$RAIZ/contracts/index.mjs"; then
    anotar "las pistas se proyectan al contrato entities.pista v1" true "validado con ajv"
  else
    anotar "las pistas se proyectan al contrato entities.pista v1" false "ver salida de ajv"
    fallos=$((fallos + 1))
  fi

  "$PSQL" -d "$DB" -X -t -A -c "
    select coalesce(jsonb_agg(jsonb_build_object('tool', tool, 'envelope', envelope)), '[]'::jsonb)
      from pruebas.envelopes" > "$TMP/envelopes.json" 2>"$LOG"
  if node "$HERE/contrato_envelope.mjs" "$TMP/envelopes.json" "$RAIZ/contracts/index.mjs"; then
    anotar "cada RPC de 005 devuelve el envelope de tools.envelope v1" true "validado con ajv"
  else
    anotar "cada RPC de 005 devuelve el envelope de tools.envelope v1" false "ver salida de ajv"
    fallos=$((fallos + 1))
  fi
else
  echo "  omitido: falta node o contracts/node_modules (npm ci --prefix contracts --ignore-scripts)"
fi

echo "== concurrencia ($WORKERS sesiones) =="
aplicar "$HERE/concurrencia_setup.sql" "tests/concurrencia_setup.sql"
pids=()
for i in $(seq 1 "$WORKERS"); do
  "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -q -X -f "$HERE/concurrencia_worker.sql" >"$TMP/w$i.log" 2>&1 &
  pids+=($!)
done
worker_ok=true
for p in "${pids[@]}"; do
  wait "$p" || worker_ok=false
done
if [ "$worker_ok" != "true" ]; then
  echo "  aviso: algún worker de concurrencia terminó con error"
  head -5 "$TMP"/w*.log
fi
aplicar "$HERE/concurrencia_check.sql" "tests/concurrencia_check.sql"

echo
echo "== resultados =="
"$PSQL" -d "$DB" -X -t -A -F '  ' -c \
  "select case when ok then '  PASA' else '  FALLA' end, nombre,
          case when ok then '' else '<- ' || coalesce(detalle,'') end
     from pruebas.resultado order by id"

total=$("$PSQL" -d "$DB" -X -t -A -c "select count(*) from pruebas.resultado" | tr -d ' ')
malas=$("$PSQL" -d "$DB" -X -t -A -c "select count(*) from pruebas.resultado where not ok" | tr -d ' ')

echo
echo "aserciones: $total | fallidas: $malas | errores de aplicación: $fallos"
if [ "${malas:-1}" != "0" ] || [ "$fallos" != "0" ]; then
  echo "RESULTADO: FALLA"
  exit 1
fi
echo "RESULTADO: OK"
exit 0
