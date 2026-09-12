#!/usr/bin/env bash
# Carga los paquetes de eval/inyecciones a pruebas.paquetes de la base de
# prueba, para que las aserciones usen los MISMOS archivos que el ensayo del
# demo y no una copia inline que puede separarse de ellos.
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-postgres}"
export PGPORT="${PGPORT:-5432}"
PSQL="$PGBIN/psql"

DB="${1:?uso: cargar_paquetes.sh <base>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(dirname "$(dirname "$HERE")")"

"$PSQL" -d "$DB" -X -q -v ON_ERROR_STOP=1 -c \
  "create schema if not exists pruebas;
   create table if not exists pruebas.paquetes (nombre text primary key, payload jsonb);
   truncate pruebas.paquetes;" || exit 1

for p in a-carrusel-nuevo b-retorno-efos-existente c-trampa-comercializadora; do
  ARCHIVO="$RAIZ/eval/inyecciones/$p.json"
  [ -f "$ARCHIVO" ] || { echo "  falta $ARCHIVO"; exit 1; }
  CONTENIDO="$(cat "$ARCHIVO")"
  "$PSQL" -d "$DB" -X -q -v ON_ERROR_STOP=1 -c \
    "insert into pruebas.paquetes (nombre, payload) values ('$p', \$paquete\$$CONTENIDO\$paquete\$::jsonb)" \
    || { echo "  FALLA al cargar $p"; exit 1; }
done

"$PSQL" -d "$DB" -X -t -A -c \
  "select '  paquetes de inyección cargados: ' || count(*) from pruebas.paquetes"
