#!/usr/bin/env bash
# =====================================================================
# loaders/tests/run.sh — prueba de los adaptadores externos SIN RED.
#
#   PGBIN=/opt/homebrew/opt/postgresql@17/bin bash loaders/tests/run.sh
#
# Crea una base desechable, aplica 001+002+003 (lo mínimo que necesitan
# listas_sat / movimientos / cuentas / contribuyentes / bitacora y
# marcar_no_evaluable), y corre load_69b.py y load_ibm_aml.py contra las
# muestras chicas de `loaders/samples/`. Ninguna descarga: las muestras
# están en el repo y son sintéticas.
#
# Comprueba, para cada adaptador:
#   1. carga correcta y promoción a 'lista';
#   2. rechazo con MENSAJE que nombra la columna faltante;
#   3. idempotencia: dos cargas del mismo archivo no duplican filas;
#   4. familias no evaluables DECLARADAS, no ausentes;
#   5. rastro en forense.bitacora (regla 2).
# =====================================================================
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-postgres}"
export PGPORT="${PGPORT:-5432}"
PSQL="$PGBIN/psql"
DB="${DB:-loaders_test_$$}"
KEEP="${KEEP:-0}"

HERE="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(dirname "$(dirname "$HERE")")"
TMP="$(mktemp -d)"
LOG="$TMP/log"
fallos=0
pasadas=0

limpiar() {
  if [ "$KEEP" = "1" ]; then echo "base conservada: $DB";
  else "$PGBIN/dropdb" --if-exists --force "$DB" >/dev/null 2>&1; fi
  rm -rf "$TMP"
}
trap limpiar EXIT

ok()   { pasadas=$((pasadas + 1)); echo "  PASA  $1${2:+  ($2)}"; }
mal()  { fallos=$((fallos + 1));   echo "  FALLA $1${2:+  ($2)}"; }
chk()  { if [ "$2" = "$3" ]; then ok "$1" "$2"; else mal "$1" "esperaba $3, obtuve $2"; fi; }
q()    { "$PSQL" -d "$DB" -X -t -A -c "$1" 2>/dev/null | tr -d ' '; }

if [ ! -x "$PSQL" ]; then echo "no encuentro psql en $PGBIN (usa PGBIN=/ruta/bin)"; exit 2; fi

echo "== base de prueba: $DB =="
"$PGBIN/dropdb" --if-exists "$DB" >/dev/null 2>&1
"$PGBIN/createdb" "$DB" >"$LOG" 2>&1 || { echo "no pude crear $DB"; cat "$LOG"; exit 2; }
for f in 001_schema 002_views 003_pistas; do
  "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -q -X -f "$RAIZ/db/$f.sql" >"$LOG" 2>&1 \
    || { echo "FALLA aplicar db/$f.sql"; tail -5 "$LOG"; exit 2; }
done
echo "  migraciones 001+002+003 aplicadas"

# ---------------------------------------------------------------------
echo "== load_69b.py =="
python3 "$RAIZ/loaders/load_69b.py" --in "$RAIZ/loaders/samples/69b_muestra.csv" \
  --db "$DB" --fecha-corte 2026-01-31 --saltar 1 --pgbin "$PGBIN" >"$TMP/69b1" 2>&1
if [ $? -ne 0 ]; then mal "load_69b carga la muestra"; tail -5 "$TMP/69b1"; else
  ok "load_69b carga la muestra"; fi

chk "load_69b: 7 publicaciones válidas en listas_sat" \
  "$(q "select count(*) from forense.listas_sat l join forense.corridas k on k.id=l.corrida_id where k.dataset='69b-sat'")" 7
chk "load_69b: la corrida queda 'lista' (regla 10)" \
  "$(q "select estado from forense.corridas where dataset='69b-sat'")" lista
chk "load_69b: sólo la familia E es evaluable" \
  "$(q "select familias_evaluables::text from forense.corridas where dataset='69b-sat'")" "{E}"
chk "load_69b: rechaza las 2 filas malas con código" \
  "$(grep -c 'rechazo fila' "$TMP/69b1")" 2
chk "load_69b: conserva los dos estatus del mismo RFC (historial)" \
  "$(q "select count(*) from forense.listas_sat where rfc='FFF060606FF6'")" 2
chk "load_69b: deja rastro en bitácora (regla 2)" \
  "$(q "select count(*) from forense.bitacora where payload->>'evento_real'='load_69b'")" 1

python3 "$RAIZ/loaders/load_69b.py" --in "$RAIZ/loaders/samples/69b_muestra.csv" \
  --db "$DB" --fecha-corte 2026-01-31 --saltar 1 --pgbin "$PGBIN" >"$TMP/69b2" 2>&1
chk "load_69b: cargar dos veces NO duplica (idempotente)" \
  "$(q "select count(*) from forense.listas_sat l join forense.corridas k on k.id=l.corrida_id where k.dataset='69b-sat'")" 7
chk "load_69b: la segunda carga no crea otra corrida" \
  "$(q "select count(*) from forense.corridas where dataset='69b-sat'")" 1

# Falta una columna obligatoria: el mensaje tiene que NOMBRARLA.
printf 'RFC,Fecha de publicacion\nAAA010101AAA,2025-03-15\n' > "$TMP/sin_estatus.csv"
python3 "$RAIZ/loaders/load_69b.py" --in "$TMP/sin_estatus.csv" --db "$DB" \
  --fecha-corte 2026-01-31 --pgbin "$PGBIN" >"$TMP/err69b" 2>&1
if grep -q 'falta la columna' "$TMP/err69b" && grep -qE 'estatus|razon_social' "$TMP/err69b"; then
  ok "load_69b: el error nombra la columna que falta"
else mal "load_69b: el error no nombra la columna" "$(head -2 "$TMP/err69b" | tr '\n' ' ')"; fi

# Sin --fecha-corte no se carga nada (el corte no sale del reloj).
python3 "$RAIZ/loaders/load_69b.py" --in "$RAIZ/loaders/samples/69b_muestra.csv" \
  --db "$DB" --saltar 1 --pgbin "$PGBIN" >"$TMP/err69c" 2>&1
if grep -q 'fecha-corte' "$TMP/err69c"; then ok "load_69b: exige --fecha-corte (regla 10)";
else mal "load_69b: aceptó cargar sin fecha de corte"; fi

# ---------------------------------------------------------------------
echo "== load_ibm_aml.py =="
if [ ! -f "$RAIZ/loaders/load_ibm_aml.py" ]; then
  echo "  OMITIDO: loaders/load_ibm_aml.py todavía no existe"
else
python3 "$RAIZ/loaders/load_ibm_aml.py" --in "$RAIZ/loaders/samples/ibm_aml_muestra.csv" \
  --db "$DB" --fecha-corte 2026-01-31 --pgbin "$PGBIN" >"$TMP/ibm1" 2>&1
if [ $? -ne 0 ]; then mal "load_ibm_aml carga la muestra"; tail -8 "$TMP/ibm1"; else
  ok "load_ibm_aml carga la muestra"; fi

chk "load_ibm_aml: la corrida queda 'lista'" \
  "$(q "select estado from forense.corridas where dataset='ibm-aml-hi-small'")" lista
chk "load_ibm_aml: modo exploratorio_financiero (no fiscal)" \
  "$(q "select modo from forense.corridas where dataset='ibm-aml-hi-small'")" exploratorio_financiero
chk "load_ibm_aml: sólo la familia F es evaluable" \
  "$(q "select familias_evaluables::text from forense.corridas where dataset='ibm-aml-hi-small'")" "{F}"
chk "load_ibm_aml: entidades técnicas IBM:<banco>:<cuenta>, sin RFC inventado" \
  "$(q "select count(*) from forense.contribuyentes c join forense.corridas k on k.id=c.corrida_id where k.dataset='ibm-aml-hi-small' and c.rfc not like 'IBM:%'")" 0
chk "load_ibm_aml: giro y fecha_alta quedan NULL, no cero ni inventados" \
  "$(q "select count(*) from forense.contribuyentes c join forense.corridas k on k.id=c.corrida_id where k.dataset='ibm-aml-hi-small' and (c.giro is not null or c.fecha_alta is not null)")" 0
chk "load_ibm_aml: ground_truth vacío (la etiqueta es por transacción)" \
  "$(q "select count(*) from forense.ground_truth g join forense.corridas k on k.id=g.corrida_id where k.dataset='ibm-aml-hi-small'")" 0
chk "load_ibm_aml: F1/F3 y D/R/T/E DECLARADAS no evaluables" \
  "$(q "select count(distinct codigo) from forense.pistas p join forense.corridas k on k.id=p.corrida_id where k.dataset='ibm-aml-hi-small' and p.estado='no_evaluable'")" 12
chk "load_ibm_aml: F4 NO queda marcada como no evaluable (es la habilitada)" \
  "$(q "select count(*) from forense.pistas p join forense.corridas k on k.id=p.corrida_id where k.dataset='ibm-aml-hi-small' and p.codigo='F4' and p.estado='no_evaluable'")" 0
chk "load_ibm_aml: deja rastro en bitácora (regla 2)" \
  "$(q "select count(*) from forense.bitacora where payload->>'evento_real'='load_ibm_aml'")" 1

n_mov1="$(q "select count(*) from forense.movimientos m join forense.corridas k on k.id=m.corrida_id where k.dataset='ibm-aml-hi-small'")"
python3 "$RAIZ/loaders/load_ibm_aml.py" --in "$RAIZ/loaders/samples/ibm_aml_muestra.csv" \
  --db "$DB" --fecha-corte 2026-01-31 --pgbin "$PGBIN" >"$TMP/ibm2" 2>&1
chk "load_ibm_aml: cargar dos veces NO duplica (idempotente)" \
  "$(q "select count(*) from forense.movimientos m join forense.corridas k on k.id=m.corrida_id where k.dataset='ibm-aml-hi-small'")" "$n_mov1"

printf 'Timestamp,From Bank,Account,Amount Received\n2025-01-02 10:00,001,ACC1,100\n' > "$TMP/ibm_malo.csv"
python3 "$RAIZ/loaders/load_ibm_aml.py" --in "$TMP/ibm_malo.csv" --db "$DB" \
  --fecha-corte 2026-01-31 --pgbin "$PGBIN" >"$TMP/erribm" 2>&1
if grep -q 'falta la columna' "$TMP/erribm"; then
  ok "load_ibm_aml: el error nombra la columna que falta"
else mal "load_ibm_aml: el error no nombra la columna" "$(head -2 "$TMP/erribm" | tr '\n' ' ')"; fi

# El artefacto de etiquetas es de evaluación: fuera de la base.
etq="$RAIZ/eval/input_labels_$(q "select dataset_hash from forense.corridas where dataset='ibm-aml-hi-small'").csv"
if [ -f "$etq" ]; then ok "load_ibm_aml: las etiquetas van a eval/, no a la base" "$(basename "$etq")";
else mal "load_ibm_aml: no encuentro el artefacto de etiquetas en eval/" "$etq"; fi
fi

echo
echo "aserciones: $((pasadas + fallos)) | fallidas: $fallos"
if [ "$fallos" = "0" ]; then echo "RESULTADO: OK"; exit 0; else echo "RESULTADO: FALLA"; exit 1; fi
