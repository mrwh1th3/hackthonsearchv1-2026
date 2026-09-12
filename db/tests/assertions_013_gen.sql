-- =====================================================================
-- Equivalencia de db/013_rendimiento.sql sobre datos calculados.
--
-- Lo único que importa de una optimización es que NO cambie el resultado.
-- Aquí se recalcula F1 con la formulación ORIGINAL de 003 (el `not
-- exists` correlacionado, factura por factura) y se compara contra lo que
-- dejó la función reescrita, con EXCEPT en las dos direcciones, sobre las
-- corridas con pistas F1 calculadas (el fixture trae F1 sembrada a mano y
-- queda fuera: no depende de 003–005 ni participa en métricas).
--
-- Va después de assertions_gen.sql porque gen-v1 es la corrida con datos
-- reales; con GEN=0 la comprobación no corre.
-- =====================================================================

set search_path = '';

do $$
declare
  k record; n_dif int; n_tot int; v_corridas int := 0; v_malas text := '';
begin
  for k in select c.id, c.nombre, c.fecha_corte
             from forense.corridas c
            where c.modo <> 'fixture'   -- el fixture trae F1 sembrada a mano
              and exists (select 1 from forense.pistas p
                           where p.corrida_id = c.id and p.codigo = 'F1')
            order by c.inicio loop
    v_corridas := v_corridas + 1;

    with facturas as (
      select f.uuid, f.emisor_rfc, f.receptor_rfc, f.fecha, f.total, f.metodo_pago
        from forense.cfdi f
       where f.corrida_id = k.id and f.tipo = 'I' and not f.cancelado
         and f.fecha > k.fecha_corte - interval '12 months' and f.fecha <= k.fecha_corte
    ),
    -- Formulación original de 003, tal cual: una subconsulta por factura.
    evaluadas as (
      select f.*,
        case
          when f.metodo_pago = 'PUE' then not exists (
            select 1
              from forense.movimientos m
              join forense.cuentas co on co.corrida_id = k.id and co.clabe = m.cuenta_origen
              join forense.cuentas cd on cd.corrida_id = k.id and cd.clabe = m.cuenta_destino
             where m.corrida_id = k.id
               and cd.rfc_titular = f.emisor_rfc
               and co.rfc_titular = f.receptor_rfc
               and m.fecha between f.fecha - interval '7 days' and f.fecha + interval '7 days'
               and abs(m.monto - f.total) <= f.total * 0.02)
          when f.metodo_pago = 'PPD' then (
            f.fecha <= k.fecha_corte - interval '120 days'
            and not exists (select 1 from forense.complementos_pago cp
                             where cp.corrida_id = k.id and cp.uuid_cfdi = f.uuid))
          else false
        end as sin_conciliar
      from facturas f
    ),
    agg as (
      select emisor_rfc as rfc,
             count(*) as n_facturas,
             count(*) filter (where sin_conciliar) as n_sin_conciliar
        from evaluadas group by emisor_rfc
    ),
    esperado as (
      select a.rfc,
             round(least(1.0, 0.4 + 0.6 * (a.n_sin_conciliar::numeric
                   / nullif(a.n_facturas, 0)))::numeric, 6) as score,
             a.n_sin_conciliar
        from agg a
       where a.n_sin_conciliar >= 3
         and a.n_sin_conciliar::numeric / nullif(a.n_facturas, 0) >= 0.20
    ),
    obtenido as (
      select p.rfc, round(p.score, 6) as score,
             (p.detalle->>'n_sin_conciliar')::int as n_sin_conciliar
        from forense.pistas p
       where p.corrida_id = k.id and p.codigo = 'F1'
    ),
    dif as (
      select * from (select * from esperado except select * from obtenido) a
      union all
      select * from (select * from obtenido except select * from esperado) b
    )
    select (select count(*) from dif), (select count(*) from esperado)
      into n_dif, n_tot;

    if n_dif <> 0 then
      v_malas := v_malas || k.nombre || ' (dif=' || n_dif || ' de ' || n_tot || '); ';
    end if;
  end loop;

  -- Con GEN=0 no hay corrida calculada (el fixture queda excluido): la
  -- comprobación se declara omitida, no aprobada por vacío.
  perform pruebas.assert(
    'F1 reescrita da EXACTAMENTE las mismas pistas que la formulación original de 003',
    v_malas = '',
    case when v_corridas = 0
         then 'omitida: sin corrida calculada (GEN=0)'
         else v_malas end);
end $$;

