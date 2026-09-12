#!/usr/bin/env bash
# =====================================================================
# tests/integration/preparar-db.sh — base propia de QA (forense_qa).
#
#   bash tests/integration/preparar-db.sh                  # 001-009 + semillas
#   DATOS=clon bash tests/integration/preparar-db.sh       # 001-009 + datos de 'forense'
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

# Aplica un .sql si existe. Las migraciones que aún no ha entregado forense-db
# (009 en la oleada 2) se anuncian como ausentes y no cuentan como fallo: el
# banco tiene que poder correr contra el HEAD de hoy y contra el de mañana.
aplicar() { # $1 = ruta relativa a RAIZ, $2 = 'obligatoria'|'condicional'
  local rel="$1" modo="${2:-obligatoria}"
  if [ ! -f "$RAIZ/$rel" ]; then
    if [ "$modo" = "condicional" ]; then
      echo "  ausente $rel (pendiente de su dueño; no bloquea)"
    else
      echo "  FALTA  $rel (obligatoria en este HEAD)"; fallos=$((fallos+1))
    fi
    return
  fi
  if "$PSQL" -d "$DB" -v ON_ERROR_STOP=1 -X -q -f "$RAIZ/$rel" >"$TMP/log" 2>&1; then
    echo "  ok    $rel"
  else
    echo "  FALLA $rel"; grep -v NOTICE "$TMP/log" | head -20; fallos=$((fallos+1))
  fi
}

for f in 001_schema 002_views 003_pistas 004_clusters 005_rpc \
         006_producto_ui 007_notificaciones_voz 008_ingesta; do
  aplicar "db/$f.sql" obligatoria
done
# 009: la entrega forense-db en paralelo (oleada 2). Condicional a propósito.
aplicar "db/009_editor.sql" condicional
for f in "$RAIZ"/db/009_*.sql; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  [ "$base" = "009_editor.sql" ] && continue
  aplicar "db/$base" condicional
done

# ---------------------------------------------------------------------
# Datos. Dos modos:
#   DATOS=seed   (por omisión) → seed_fake.sql + seed_producto.sql
#   DATOS=clon   → copia los DATOS de la base compartida 'forense' (fixture +
#                 gen-v1) con pg_dump --data-only. La base compartida se LEE,
#                 nunca se altera. Excluyentes: clonar y sembrar a la vez da
#                 conflictos de PK sobre las mismas filas del fixture.
# ---------------------------------------------------------------------
DATOS="${DATOS:-seed}"
DB_ORIGEN="${DB_ORIGEN:-forense}"
if [ "$DATOS" = "clon" ]; then
  echo "== datos: clon de $DB_ORIGEN (solo lectura del origen) =="
  # Las tablas de configuración las siembran las propias migraciones; volcarlas
  # otra vez sólo produce choques de PK sobre filas idénticas.
  if "$PGBIN/pg_dump" -d "$DB_ORIGEN" -n forense --data-only -Fc \
       --exclude-table-data=forense.config_presupuesto \
       --exclude-table-data=forense.limites_agente \
       --exclude-table-data=forense.slots_runtime \
       -f "$TMP/datos.dump" 2>"$TMP/log"; then
    if "$PGBIN/pg_restore" --data-only --disable-triggers --no-owner \
         -d "$DB" "$TMP/datos.dump" >"$TMP/log" 2>&1; then
      echo "  ok    datos de $DB_ORIGEN (fixture + gen-v1)"
    else
      echo "  FALLA pg_restore"; grep -vi "^pg_restore: *processing" "$TMP/log" | head -20; fallos=$((fallos+1))
    fi
  else
    echo "  FALLA pg_dump de $DB_ORIGEN"; head -10 "$TMP/log"; fallos=$((fallos+1))
  fi
else
  echo "== datos: semillas =="
  aplicar "db/seeds/seed_fake.sql" obligatoria
fi

# seed_producto.sql (perfiles, investigaciones, propuestas) exige 006+007 y es
# independiente del origen de los datos de dominio: hace falta en los dos modos.
aplicar "db/seeds/seed_producto.sql" condicional

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
