#!/usr/bin/env bash
# =====================================================================
# db/tests/cargar_gen.sh — Copia el snapshot gen-v1 desde una base origen
# (por omisión la base local `forense`, en SOLO LECTURA) hacia una base de
# prueba desechable, para poder correr aserciones contra datos reales sin
# tocar la base que usan los demás workers.
#
#   bash db/tests/cargar_gen.sh <base_destino> [corrida_id] [base_origen]
#
# Copia únicamente tablas de dominio + ground_truth. Pistas, clusters,
# señales y casos quedan vacíos: los recalcula `correr_pistas` /
# `armar_clusters` en la base de prueba, que es justo lo que se quiere
# comprobar. La corrida se deja en estado 'lista'.
#
# Sale 0 si copió, 3 si la base origen o la corrida no están disponibles
# (el harness lo trata como "omitido", no como fallo).
# =====================================================================
set -uo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-postgres}"
export PGPORT="${PGPORT:-5432}"
PSQL="$PGBIN/psql"

DESTINO="${1:?uso: cargar_gen.sh <base_destino> [corrida_id] [base_origen]}"
CORRIDA="${2:-3fc52b5a-3e4b-54f4-a714-b3303b6f0347}"
ORIGEN="${3:-${GENDB:-forense}}"

if [ ! -x "$PSQL" ]; then
  echo "  omitido: no encuentro psql en $PGBIN"
  exit 3
fi

existe=$("$PSQL" -d "$ORIGEN" -X -t -A -c \
  "select count(*) from forense.corridas where id = '$CORRIDA'" 2>/dev/null | tr -d ' ')
if [ "${existe:-0}" != "1" ]; then
  echo "  omitido: la corrida $CORRIDA no está en la base '$ORIGEN'"
  exit 3
fi

copiar() { # $1 tabla, $2 columnas, $3 filtro
  local tabla="$1" cols="$2" filtro="$3"
  "$PSQL" -d "$ORIGEN" -X -q -c \
    "\\copy (select $cols from forense.$tabla $filtro) to stdout with (format csv)" \
  | "$PSQL" -d "$DESTINO" -X -q -v ON_ERROR_STOP=1 -c \
    "\\copy forense.$tabla ($cols) from stdin with (format csv)"
  local rc=${PIPESTATUS[1]}
  if [ "$rc" != "0" ]; then
    echo "  FALLA copia de $tabla"
    return 1
  fi
}

FILTRO="where corrida_id = '$CORRIDA'"
fallo=0

copiar corridas \
  "id,nombre,dataset,dataset_hash,fecha_corte,corrida_origen_id,estado,version_prompts,version_reglas,modo,familias_evaluables,inicio,fin,metricas,notas" \
  "where id = '$CORRIDA'" || fallo=1
copiar catalogo_giro_claves "version_reglas,giro,clave_prod_serv" "" || fallo=1
copiar contribuyentes \
  "rfc,razon_social,giro,tipo_persona,fecha_alta,domicilio,cp,representante,email,telefono,empleados_declarados,corrida_id" \
  "$FILTRO" || fallo=1
copiar cuentas \
  "clabe,rfc_titular,banco,tipo,moneda,saldo_inicial,fecha_saldo_inicial,corrida_id" "$FILTRO" || fallo=1
copiar cfdi \
  "uuid,tipo,emisor_rfc,receptor_rfc,fecha,subtotal,iva,total,moneda,metodo_pago,forma_pago,uso_cfdi,clave_prod_serv,descripcion,cancelado,fecha_cancelacion,motivo_cancelacion,uuid_sustituye,corrida_id" \
  "$FILTRO" || fallo=1
copiar complementos_pago "uuid_pago,uuid_cfdi,fecha,monto,corrida_id" "$FILTRO" || fallo=1
copiar movimientos \
  "id,cuenta_origen,cuenta_destino,fecha,monto,moneda,tipo,referencia,corrida_id" "$FILTRO" || fallo=1
copiar atributos_entidad "rfc,atributo,valor,fuente,corrida_id" "$FILTRO" || fallo=1
copiar listas_sat \
  "rfc,lista,estatus,fecha_publicacion,oficio,razon_social,corrida_id" "$FILTRO" || fallo=1
copiar ground_truth "rfc,corrida_id,es_fraude,tipologia,es_trampa_legitima,nota" "$FILTRO" || fallo=1

if [ "$fallo" != "0" ]; then
  exit 1
fi

# La corrida se copia con el estado que tuviera en origen; para las pruebas
# se deja 'lista', que es el único estado desde el que correr_pistas reclama.
"$PSQL" -d "$DESTINO" -X -q -v ON_ERROR_STOP=1 -c \
  "update forense.corridas set estado = 'lista' where id = '$CORRIDA'" >/dev/null || exit 1

"$PSQL" -d "$DESTINO" -X -t -A -c \
  "select '  gen cargado: ' || (select count(*) from forense.contribuyentes where corrida_id='$CORRIDA') || ' contribuyentes, '
       || (select count(*) from forense.cfdi where corrida_id='$CORRIDA') || ' cfdi, '
       || (select count(*) from forense.movimientos where corrida_id='$CORRIDA') || ' movimientos, '
       || (select count(*) from forense.ground_truth where corrida_id='$CORRIDA') || ' etiquetas'"
exit 0
