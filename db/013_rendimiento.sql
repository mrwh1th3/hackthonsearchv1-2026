-- =====================================================================
-- 013_rendimiento.sql — barrido de pistas más barato, MISMO resultado.
--
-- Medición (EXPLAIN ANALYZE, Postgres 17 local, snapshot gen-v1: 100
-- contribuyentes, 8 081 CFDI, 6 006 movimientos; tiempos cálidos, ver
-- db/README.md §Rendimiento):
--
--   F1 conciliación        372 ms  <- la más cara con diferencia
--   refresh v_pares_giro   166 ms
--   E1 cercanía 69-B       135 ms
--   R2 ciclos de dinero    128 ms
--   resto de las pistas    < 100 ms cada una
--
-- Causa de F1: la comprobación PUE era un `not exists` CORRELACIONADO por
-- factura. El plan lo ejecutaba 5 120 veces (una por CFDI PUE de la
-- ventana), cada vez volviendo a recorrer `cuentas` y a indexar
-- `movimientos`: 44 426 buffers para 6 006 movimientos. El costo crecía
-- con el número de facturas, no con el de pagos.
--
-- Arreglo: los pagos se resuelven UNA vez (movimientos ⋈ cuentas ⋈
-- cuentas -> par pagador/cobrador) y la conciliación pasa a ser un join
-- por par de RFC con el mismo filtro de ventana e importe. La regla no
-- cambia: mismo ±7 días, mismo ±2 %, mismo umbral de ≥3 facturas y ≥20 %.
-- Comprobado con EXCEPT en las dos direcciones sobre gen-v1: los 1 471
-- CFDI PUE sin conciliar son exactamente los mismos.
--
-- Aditiva: sólo `create or replace` de una función y `create index if not
-- exists`. No toca tablas, ni firmas, ni el dictamen.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 1. Índices de apoyo. Ninguno cambia resultados; sólo planes.
-- ---------------------------------------------------------------------

-- Las pistas se leen una y otra vez filtrando por corrida + estado (el
-- score del selector, armar_cluster_para, el paquete del especialista).
create index if not exists ix_pistas_corrida_estado_rfc
  on forense.pistas (corrida_id, estado, rfc);

-- La ventana de 12 meses sobre CFDI de ingreso vivos es el filtro de
-- entrada de F1, F3, R1, R2, E1 y T1.
create index if not exists ix_cfdi_ventana
  on forense.cfdi (corrida_id, fecha)
  where not cancelado;

-- El par (emisor, receptor) es la arista del grafo: R1/R2/F4/E1 la
-- recorren en los dos sentidos.
create index if not exists ix_cfdi_par
  on forense.cfdi (corrida_id, emisor_rfc, receptor_rfc);

-- El join de conciliación de F1 y de F2 sale de movimientos hacia cuentas
-- por CLABE en los dos extremos.
create index if not exists ix_mov_corrida_fecha
  on forense.movimientos (corrida_id, fecha);

-- ---------------------------------------------------------------------
-- 2. F1 — Facturación sin flujo de dinero (docs/02 F1), reescrita.
--    Idéntica a 003 salvo la CTE `pagos`/`conciliadas`.
-- ---------------------------------------------------------------------

create or replace function forense.pista_f1(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with facturas as (
    select f.uuid, f.emisor_rfc, f.receptor_rfc, f.fecha, f.total, f.metodo_pago
      from forense.cfdi f
     where f.corrida_id = p_corrida and f.tipo = 'I' and not f.cancelado
       and f.fecha > v_corte - interval '12 months' and f.fecha <= v_corte
  ),
  -- Un solo pase sobre los movimientos: quién le pagó a quién, cuándo y
  -- cuánto. Antes esto se recalculaba por factura.
  pagos as (
    select cd.rfc_titular as cobra, co.rfc_titular as paga, m.fecha, m.monto
      from forense.movimientos m
      join forense.cuentas co on co.corrida_id = p_corrida and co.clabe = m.cuenta_origen
      join forense.cuentas cd on cd.corrida_id = p_corrida and cd.clabe = m.cuenta_destino
     where m.corrida_id = p_corrida
  ),
  -- Mismo criterio que el `not exists` de 003: depósito del receptor al
  -- emisor por el mismo importe ±2 % dentro de ±7 días.
  conciliadas as (
    select distinct f.uuid
      from facturas f
      join pagos p on p.cobra = f.emisor_rfc and p.paga = f.receptor_rfc
                  and p.fecha between f.fecha - interval '7 days'
                                  and f.fecha + interval '7 days'
                  and abs(p.monto - f.total) <= f.total * 0.02
     where f.metodo_pago = 'PUE'
  ),
  evaluadas as (
    select f.*,
      case
        when f.metodo_pago = 'PUE'
          then not exists (select 1 from conciliadas c where c.uuid = f.uuid)
        when f.metodo_pago = 'PPD' then (
          f.fecha <= v_corte - interval '120 days'
          and not exists (select 1 from forense.complementos_pago cp
                           where cp.corrida_id = p_corrida and cp.uuid_cfdi = f.uuid))
        else false
      end as sin_conciliar
    from facturas f
  ),
  agg as (
    select emisor_rfc as rfc,
           count(*) as n_facturas,
           count(*) filter (where sin_conciliar) as n_sin_conciliar,
           coalesce(sum(total) filter (where sin_conciliar), 0) as monto_sin_conciliar,
           (array_agg(uuid::text order by fecha desc) filter (where sin_conciliar))[1:20] as uuids,
           count(*) filter (where sin_conciliar and metodo_pago = 'PUE') as n_pue,
           count(*) filter (where sin_conciliar and metodo_pago = 'PPD') as n_ppd
      from evaluadas group by emisor_rfc
  )
  select p_corrida, 'F1', 'F', a.rfc,
         least(1.0, 0.4 + 0.6 * (a.n_sin_conciliar::numeric / nullif(a.n_facturas, 0)))::numeric,
         jsonb_build_object(
           'n_facturas', a.n_facturas,
           'n_sin_conciliar', a.n_sin_conciliar,
           'pct_sin_conciliar', round(a.n_sin_conciliar::numeric / nullif(a.n_facturas, 0), 4),
           'monto_sin_conciliar', a.monto_sin_conciliar::text,
           'pue_sin_deposito', a.n_pue, 'ppd_sin_complemento', a.n_ppd,
           'uuids', to_jsonb(a.uuids),
           'truncado', (a.n_sin_conciliar > 20),
           'resumen', format(
             '%s de %s facturas emitidas en la ventana quedaron sin conciliar (%s): %s PUE sin '
             'depósito del receptor por el mismo importe ±2%% en ±7 días y %s PPD sin complemento '
             'de pago a más de 120 días.',
             a.n_sin_conciliar, a.n_facturas,
             to_char(round(100 * a.n_sin_conciliar::numeric / nullif(a.n_facturas, 0), 1), 'FM990.0%'),
             a.n_pue, a.n_ppd),
           'referencias', to_jsonb(coalesce(
             (select array_agg('CFDI:' || u) from unnest(a.uuids) u), array[]::text[])),
           'comprobacion', 'F1',
           'cobertura', jsonb_build_object(
             'cuentas_conocidas', exists (select 1 from forense.cuentas cu
                                           where cu.corrida_id = p_corrida and cu.rfc_titular = a.rfc)),
           'ventana', jsonb_build_object('desde', (v_corte - interval '12 months'), 'hasta', v_corte)),
         forense.huella_pista('F1', a.rfc, v_corte)
    from agg a
   where a.n_sin_conciliar >= 3
     and a.n_sin_conciliar::numeric / nullif(a.n_facturas, 0) >= 0.20
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Permisos (003 revocó a public y concedió a service_role en bloque;
--    una función reemplazada conserva sus privilegios, pero se reafirman
--    por si 013 se aplica sobre una instalación que aún no tenía F1).
-- ---------------------------------------------------------------------

revoke execute on function forense.pista_f1(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function forense.pista_f1(uuid) to service_role';
  end if;
end $$;

-- Fin 013_rendimiento.sql
