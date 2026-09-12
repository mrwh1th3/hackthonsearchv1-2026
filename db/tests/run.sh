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
aplicar "$DBDIR/seeds/seed_fake.sql" "seeds/seed_fake.sql"
aplicar "$HERE/helpers.sql" "tests/helpers.sql"

"$PSQL" -d "$DB" -q -X -c "create table pruebas.conteo_1 as select * from pruebas.conteos()" >/dev/null 2>&1

echo "== reaplicación (idempotencia) =="
reaplicar_ok=true
for f in "$DBDIR/001_schema.sql" "$DBDIR/002_views.sql" "$DBDIR/003_pistas.sql" "$DBDIR/seeds/seed_fake.sql"; do
  if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -q -X -f "$f" >"$LOG" 2>&1; then
    echo "  ok    reaplicar $(basename "$f")"
  else
    echo "  FALLA reaplicar $(basename "$f")"
    grep -v '^psql.*NOTICE' "$LOG" | head -20
    reaplicar_ok=false
    fallos=$((fallos + 1))
  fi
done
anotar "reaplicar 001+002+seed no falla" "$reaplicar_ok" "aplicado dos veces sobre la misma base"

echo "== aserciones =="
aplicar "$HERE/assertions.sql" "tests/assertions.sql"
aplicar "$HERE/assertions_003.sql" "tests/assertions_003.sql"

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
