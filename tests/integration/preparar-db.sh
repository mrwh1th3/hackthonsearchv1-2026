#!/usr/bin/env bash
# =====================================================================
# tests/integration/preparar-db.sh — base propia de QA (forense_qa).
#
#   bash tests/integration/preparar-db.sh
#   DB=forense_qa PGBIN=/otra/ruta/bin bash tests/integration/preparar-db.sh
#
# Dueño: forense-qa. NO toca la base compartida 'forense' ni ningún servicio
# remoto. Crea (si faltan) los roles anon/authenticated/service_role NOLOGIN
# para que los bloques `if exists (select 1 from pg_roles ...)` de 001_schema
# ejerciten de verdad los GRANT; sin ellos el grant se salta en silencio y una
# prueba de RLS no distingue "la policy funciona" de "falta el grant".
#
# AVISO 1: los roles son globales del cluster. Tras correr esto, reaplicar
# 001_schema.sql sobre CUALQUIER base del cluster local (incluida 'forense')
# también ejecutará su bloque de grants. Ninguno tiene LOGIN, así que nadie
# puede conectarse como ellos: sólo un superusuario puede `set role`.
#
# AVISO 2: `service_role` se crea con BYPASSRLS **porque así lo crea Supabase**.
# Sin ese atributo no escribe ni una fila: las migraciones habilitan RLS en las
# 29 tablas y sólo crean policies de SELECT, así que toda escritura del pipeline
# depende de saltarse RLS (superusuario o BYPASSRLS). Emularlo con un rol sin
# BYPASSRLS mediría una diferencia del banco de pruebas, no del sistema.
# anon y authenticated se crean planos: NOLOGIN y sin BYPASSRLS.
# =====================================================================
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-postgres}"
export PGPORT="${PGPORT:-5432}"
PSQL="$PGBIN/psql"
CREATEDB="$PGBIN/createdb"
DROPDB="$PGBIN/dropdb"
DB="${DB:-forense_qa}"
RECREAR="${RECREAR:-1}"

HERE="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -x "$PSQL" ]; then
  echo "no encuentro psql en $PGBIN (usa PGBIN=/ruta/bin)" >&2
  exit 2
fi

echo "== roles del cluster (NOLOGIN, sin BYPASSRLS) =="
cat >"$TMP/roles.sql" <<'SQL'
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
      raise notice 'rol creado: % (nologin, sin bypassrls)', r;
    else
      raise notice 'rol ya existia: %', r;
    end if;
  end loop;
  -- service_role: BYPASSRLS para replicar Supabase (ver AVISO 2 de la cabecera).
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
    raise notice 'rol creado: service_role (nologin, bypassrls como en Supabase)';
  elsif not (select rolbypassrls from pg_roles where rolname = 'service_role') then
    alter role service_role bypassrls;
    raise notice 'service_role ya existia sin bypassrls; se le anade para replicar Supabase';
  else
    raise notice 'rol ya existia: service_role';
  end if;
end $$;
SQL
"$PSQL" -d postgres -v ON_ERROR_STOP=1 -X -q -f "$TMP/roles.sql" || exit 2

if [ "$RECREAR" = "1" ]; then
  echo "== base $DB (recreada) =="
  "$DROPDB" --if-exists "$DB" >/dev/null 2>&1
  "$CREATEDB" "$DB" || exit 2
else
  echo "== base $DB (reutilizada) =="
fi

echo "== migraciones =="
fallos=0
for f in 001_schema.sql 002_views.sql 003_pistas.sql; do
  if [ ! -f "$RAIZ/db/$f" ]; then
    echo "  omitida $f (no existe en este HEAD)"
    continue
  fi
  if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -X -q -f "$RAIZ/db/$f" >"$TMP/log" 2>&1; then
    echo "  ok    db/$f"
  else
    echo "  FALLA db/$f"; grep -v NOTICE "$TMP/log" | head -20; fallos=$((fallos+1))
  fi
done
# 004/005 aún no existen en este HEAD; se aplican solas cuando lleguen.
for f in 004_clusters.sql 005_rpc.sql; do
  if [ -f "$RAIZ/db/$f" ]; then
    if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -X -q -f "$RAIZ/db/$f" >"$TMP/log" 2>&1; then
      echo "  ok    db/$f"
    else
      echo "  FALLA db/$f"; grep -v NOTICE "$TMP/log" | head -20; fallos=$((fallos+1))
    fi
  else
    echo "  ausente db/$f (pendiente de forense-db)"
  fi
done

if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -X -q -f "$RAIZ/db/seeds/seed_fake.sql" >"$TMP/log" 2>&1; then
  echo "  ok    db/seeds/seed_fake.sql"
else
  echo "  FALLA db/seeds/seed_fake.sql"; grep -v NOTICE "$TMP/log" | head -20; fallos=$((fallos+1))
fi

echo "== comprobación de grants (si esto sale vacío, las pruebas de RLS no valen) =="
cat >"$TMP/grants.sql" <<'SQL'
select count(*) || ' grants select a anon sobre forense.*'
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'forense' and privilege_type = 'SELECT';
select case when has_schema_privilege('anon','forense','usage')
            then 'anon tiene usage sobre el schema forense'
            else 'FALTA usage de anon sobre forense' end;
SQL
"$PSQL" -d "$DB" -X -t -A -f "$TMP/grants.sql"

echo
if [ "$fallos" != "0" ]; then
  echo "RESULTADO: FALLA ($fallos migraciones con error)"
  exit 1
fi
echo "RESULTADO: OK — base $DB lista"
exit 0
