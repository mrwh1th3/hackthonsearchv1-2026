-- =====================================================================
-- 003_pistas.sql — Motor de pistas, primera entrega (docs/02 §Prioridad):
--   D2, F1, F2, R1, R2, E1, T1
-- Segunda entrega pendiente: D1, D3, D4, F3, F4, R3, T2.
--
-- Reglas que se mantienen en todas las pistas:
--   * Umbrales RELATIVOS a pares del mismo giro (forense.v_pares_giro).
--   * Ventana cerrada en corridas.fecha_corte; jamás now().
--   * huella determinista + ON CONFLICT: dos ejecuciones no duplican.
--   * Una pista no afirma fraude; afirma "aquí hay algo que explicar".
--   * El texto libre (descripcion/razon_social/referencia) no sostiene
--     ninguna pista: no se usa en ninguna regla de este archivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

-- Huella canónica para pistas por entidad: no depende de montos calculados,
-- así un refresh de agregados entre corridas no cambia la identidad.
create or replace function forense.huella_pista(p_codigo text, p_rfc text, p_corte timestamptz,
                                                p_extra text default '')
returns text language sql immutable set search_path = '' as $$
  select md5(p_codigo || '|' || p_rfc || '|' || to_char(p_corte at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
             || '|' || coalesce(p_extra, ''))
$$;

-- Rotación canónica de un ciclo: empieza en el RFC lexicográficamente menor
-- para que A→B→C→A y B→C→A→B sean el mismo hallazgo.
create or replace function forense.ciclo_canonico(p_ruta text[])
returns text[] language plpgsql immutable set search_path = '' as $$
declare n int; i int; imin int := 1; v text[] := '{}';
begin
  n := coalesce(array_length(p_ruta, 1), 0);
  if n <= 1 then return p_ruta; end if;
  -- la ruta de un ciclo repite el origen al final: se ignora el último
  n := n - 1;
  for i in 1..n loop
    if p_ruta[i] < p_ruta[imin] then imin := i; end if;
  end loop;
  for i in 0..(n-1) loop
    v := v || p_ruta[((imin - 1 + i) % n) + 1];
  end loop;
  return v || v[1];
end $$;

create or replace function forense.marcar_no_evaluable(p_corrida uuid, p_codigos text[], p_motivo text default 'familia no evaluable en este dataset')
returns int language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;
  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella, estado)
  select p_corrida, c.codigo, left(c.codigo, 1), e.rfc, 0,
         jsonb_build_object('motivo', p_motivo, 'no_evaluable', true,
                            'resumen', 'Pista no evaluable con los datos de esta corrida: ' || p_motivo,
                            'referencias', '[]'::jsonb),
         forense.huella_pista('NE:' || c.codigo, e.rfc, v_corte),
         'no_evaluable'
    from unnest(p_codigos) as c(codigo)
    cross join (select rfc from forense.contribuyentes where corrida_id = p_corrida) e
  on conflict (corrida_id, codigo, rfc, huella) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- D2 — Capacidad operativa
-- Facturación 12m > p50 del giro Y (nómina 0 o ratio < p10) Y compras < p10
-- Trampa: subcontratación real verificable (hay CFDI de compra de servicios)
-- ---------------------------------------------------------------------
create or replace function forense.pista_d2(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  select p_corrida, 'D2', 'D', a.rfc,
         least(1.0, 0.6
               + case when a.nomina_12m = 0 then 0.2 else 0 end
               + case when a.facturacion_12m > g.fact_p90 then 0.2 else 0 end)::numeric,
         jsonb_build_object(
           'facturacion_12m', a.facturacion_12m::text,
           'nomina_12m', a.nomina_12m::text,
           'compras_12m', a.compras_12m::text,
           'ratio_nomina', a.ratio_nomina,
           'empleados_declarados', c.empleados_declarados,
           'giro', a.giro,
           'pares', jsonb_build_object('n_pares', g.n_pares, 'fact_p50', g.fact_p50,
                                       'fact_p90', g.fact_p90, 'nomina_p10', g.nomina_p10,
                                       'compras_p10', g.compras_p10),
           'muestra_pequena', (g.n_pares < 3),
           'resumen', format(
             'Facturó %s en los 12 meses al corte, por encima de la mediana de su giro (%s), '
             'con nómina de %s y compras por %s, debajo del p10 de sus %s pares de %s.',
             a.facturacion_12m, round(g.fact_p50::numeric, 2), a.nomina_12m, a.compras_12m,
             g.n_pares, a.giro),
           'referencias', to_jsonb(array[
             'PAR:' || regexp_replace(coalesce(a.giro, 'sin_giro'), '\s+', '_', 'g')]),
           'comprobacion', 'D2',
           'ventana', jsonb_build_object('desde', (v_corte - interval '12 months'), 'hasta', v_corte)),
         forense.huella_pista('D2', a.rfc, v_corte)
    from forense.v_agregado_rfc a
    join forense.v_pares_giro g on g.corrida_id = a.corrida_id and g.giro = a.giro
    join forense.contribuyentes c on c.corrida_id = a.corrida_id and c.rfc = a.rfc
   where a.corrida_id = p_corrida
     and a.facturacion_12m > g.fact_p50
     and (a.nomina_12m = 0 or (a.ratio_nomina is not null and g.nomina_p10 is not null
                               and a.ratio_nomina < g.nomina_p10))
     and a.compras_12m < g.compras_p10
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- F1 — Conciliación CFDI ↔ banco
-- PUE sin movimiento entrante ±7 días y ±2% desde cuenta del receptor;
-- PPD sin complemento de pago a más de 120 días.
-- Trampa: crédito comercial del giro o factoraje con contrato.
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
  evaluadas as (
    select f.*,
      case
        when f.metodo_pago = 'PUE' then not exists (
          select 1
            from forense.movimientos m
            join forense.cuentas co on co.corrida_id = p_corrida and co.clabe = m.cuenta_origen
            join forense.cuentas cd on cd.corrida_id = p_corrida and cd.clabe = m.cuenta_destino
           where m.corrida_id = p_corrida
             and cd.rfc_titular = f.emisor_rfc
             and co.rfc_titular = f.receptor_rfc
             and m.fecha between f.fecha - interval '7 days' and f.fecha + interval '7 days'
             and abs(m.monto - f.total) <= f.total * 0.02)
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
-- F2 — Pass-through
-- Ventana mensual: salidas/entradas ≥ 0.9, saldo medio < 5% de entradas y
-- > 50% de salidas a personas físicas o efectivo.
-- Trampa: comercializadora de margen delgado con compras reales (el dinero
-- sale a personas morales, no físicas).
-- ---------------------------------------------------------------------
create or replace function forense.pista_f2(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with ctas as (
    select rfc_titular as rfc, clabe, saldo_inicial
      from forense.cuentas
     where corrida_id = p_corrida and rfc_titular is not null
  ),
  mov as (
    select c.rfc, date_trunc('month', m.fecha) as mes,
           sum(m.monto) filter (where m.cuenta_destino = c.clabe) as entradas,
           sum(m.monto) filter (where m.cuenta_origen = c.clabe) as salidas,
           sum(m.monto) filter (where m.cuenta_origen = c.clabe
                                  and (m.tipo = 'efectivo'
                                       or exists (select 1 from forense.cuentas d
                                                   where d.corrida_id = p_corrida
                                                     and d.clabe = m.cuenta_destino
                                                     and d.tipo = 'fisica'))) as salidas_fisico
      from ctas c
      join forense.movimientos m
        on m.corrida_id = p_corrida
       and (m.cuenta_origen = c.clabe or m.cuenta_destino = c.clabe)
       and m.fecha > v_corte - interval '12 months' and m.fecha <= v_corte
     group by c.rfc, date_trunc('month', m.fecha)
  ),
  eval as (
    select m.rfc, m.mes,
           coalesce(m.entradas, 0) as entradas,
           coalesce(m.salidas, 0) as salidas,
           coalesce(m.salidas_fisico, 0) as salidas_fisico,
           (select sum(coalesce(c2.saldo_inicial, 0)) from ctas c2 where c2.rfc = m.rfc) as saldo_ini,
           (select bool_and(c2.saldo_inicial is not null) from ctas c2 where c2.rfc = m.rfc) as saldo_evaluable
      from mov m
     where coalesce(m.entradas, 0) > 0
  ),
  marcados as (
    select e.*,
           e.salidas / nullif(e.entradas, 0) as ratio,
           e.salidas_fisico / nullif(e.salidas, 0) as pct_fisico,
           -- proxy de saldo medio del mes: saldo inicial + neto del mes
           (coalesce(e.saldo_ini, 0) + e.entradas - e.salidas) as saldo_fin
      from eval e
  ),
  disparos as (
    select m.*, row_number() over (partition by rfc order by ratio desc, entradas desc) as rn
      from marcados m
     where m.ratio >= 0.9
       and m.pct_fisico > 0.5
       and (m.saldo_evaluable is not true
            or abs(m.saldo_fin) < m.entradas * 0.05)
  )
  select p_corrida, 'F2', 'F', d.rfc,
         case when d.saldo_evaluable then 0.85 else 0.70 end::numeric,
         jsonb_build_object(
           'mes', to_char(d.mes, 'YYYY-MM'),
           'entradas', d.entradas::text,
           'salidas', d.salidas::text,
           'ratio_salidas_entradas', round(d.ratio, 4),
           'pct_salidas_a_fisicas_o_efectivo', round(d.pct_fisico, 4),
           'saldo_fin_mes', d.saldo_fin::text,
           'resumen', format(
             'En %s entraron %s y salieron %s (%s de lo que entró); el %s de la salida fue a '
             'personas físicas o efectivo y el saldo de fin de mes quedó en %s.',
             to_char(d.mes, 'YYYY-MM'), d.entradas, d.salidas,
             to_char(round(100 * d.ratio, 1), 'FM990.0%'),
             to_char(round(100 * d.pct_fisico, 1), 'FM990.0%'), d.saldo_fin),
           'referencias', (select coalesce(jsonb_agg('MOV:' || mv.id), '[]'::jsonb) from (
              select m.id from forense.movimientos m
                join forense.cuentas cu on cu.corrida_id = p_corrida and cu.clabe = m.cuenta_origen
               where m.corrida_id = p_corrida and cu.rfc_titular = d.rfc
                 and date_trunc('month', m.fecha) = d.mes
               order by m.monto desc, m.id limit 20) mv),
           'comprobacion', 'F2',
           'cobertura', jsonb_build_object(
             'saldo_evaluable', coalesce(d.saldo_evaluable, false),
             'motivo', case when coalesce(d.saldo_evaluable, false) then null
                            else 'sin saldo inicial: la parte de saldo medio queda no evaluable' end),
           'ventana', jsonb_build_object('desde', (v_corte - interval '12 months'), 'hasta', v_corte)),
         forense.huella_pista('F2', d.rfc, v_corte)
    from disparos d
   where d.rn = 1
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- R1 — Atributos compartidos (≥3 RFC)
-- Trampa: despacho contable o coworking: comparten domicilio pero NO se
-- facturan entre sí. El dato 'se_facturan_entre_si' se calcula, no se supone.
-- ---------------------------------------------------------------------
create or replace function forense.pista_r1(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with grupos as (
    select a.atributo, a.valor, array_agg(distinct a.rfc order by a.rfc) as rfcs
      from forense.atributos_entidad a
     where a.corrida_id = p_corrida
       and a.atributo in ('domicilio','representante','email','telefono','clabe')
       and a.valor is not null and a.valor <> ''
     group by a.atributo, a.valor
    having count(distinct a.rfc) >= 3
  ),
  medidos as (
    select g.*,
      (select count(*) from forense.cfdi f
        where f.corrida_id = p_corrida and f.tipo = 'I' and not f.cancelado
          and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
          and f.emisor_rfc = any(g.rfcs) and f.receptor_rfc = any(g.rfcs)) as n_cfdi_internos,
      -- discriminador medible entre despacho/coworking y cluster de
      -- prestanombres: qué proporción del monto facturado por el grupo se
      -- queda dentro del grupo. No es un juicio, es un dato.
      (select coalesce(sum(f.total), 0) from forense.cfdi f
        where f.corrida_id = p_corrida and f.tipo = 'I' and not f.cancelado
          and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
          and f.emisor_rfc = any(g.rfcs) and f.receptor_rfc = any(g.rfcs)) as monto_interno,
      (select coalesce(sum(f.total), 0) from forense.cfdi f
        where f.corrida_id = p_corrida and f.tipo = 'I' and not f.cancelado
          and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
          and f.emisor_rfc = any(g.rfcs)) as monto_total_grupo,
      (select count(*) from forense.movimientos m
        join forense.cuentas co on co.corrida_id = p_corrida and co.clabe = m.cuenta_origen
        join forense.cuentas cd on cd.corrida_id = p_corrida and cd.clabe = m.cuenta_destino
        where m.corrida_id = p_corrida and m.fecha <= v_corte
          and co.rfc_titular = any(g.rfcs) and cd.rfc_titular = any(g.rfcs)) as n_mov_internos
      from grupos g
  )
  select p_corrida, 'R1', 'R', r.rfc,
         least(1.0, 0.35
               + case when m.n_cfdi_internos > 0 then 0.35 else 0 end
               + case when m.n_mov_internos > 0 then 0.15 else 0 end
               + least(0.15, (array_length(m.rfcs, 1) - 3) * 0.03))::numeric,
         jsonb_build_object(
           'atributo', m.atributo,
           'valor', m.valor,
           'rfcs', to_jsonb(m.rfcs),
           'n_rfcs', array_length(m.rfcs, 1),
           'se_facturan_entre_si', (m.n_cfdi_internos > 0),
           'n_cfdi_internos', m.n_cfdi_internos,
           'monto_interno', m.monto_interno::text,
           'pct_monto_interno', round(m.monto_interno / nullif(m.monto_total_grupo, 0), 4),
           'hay_flujo_de_dinero_interno', (m.n_mov_internos > 0),
           'resumen', format(
             'Comparte %s con otros %s RFC. Entre los miembros del grupo hay %s facturas por %s '
             '(%s del monto que factura el grupo) y %s movimientos internos.',
             m.atributo, array_length(m.rfcs, 1) - 1, m.n_cfdi_internos, m.monto_interno,
             to_char(round(100 * m.monto_interno / nullif(m.monto_total_grupo, 0), 1), 'FM990.0%'),
             m.n_mov_internos),
           -- El valor del atributo lo escribe el contribuyente: se cita su
           -- huella md5, no el texto, y así el identificador no arrastra texto
           -- libre ni espacios.
           'referencias', to_jsonb(array['ATR:' || m.atributo || ':' || md5(m.valor)]),
           'comprobacion', 'R1'),
         forense.huella_pista('R1', r.rfc, v_corte, m.atributo || '|' || m.valor)
    from medidos m
    cross join lateral unnest(m.rfcs) as r(rfc)
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- R2 — Ciclos y cadenas de facturas
-- Ciclo ≤5 saltos, montos ±15%, ventana ≤30 días; o cadena ≥4 saltos con
-- decremento de 3–10% por salto. Rotación canónica para no contar dos veces
-- el mismo ciclo. Los hubs (más de p_max_grado contrapartes) se excluyen del
-- recorrido y se declara la limitación.
-- ---------------------------------------------------------------------
create or replace function forense.pista_r2(p_corrida uuid, p_max_grado int default 40)
returns int language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with recursive hubs as (
    select emisor_rfc as rfc
      from forense.cfdi
     where corrida_id = p_corrida and tipo = 'I' and not cancelado
       and fecha <= v_corte and fecha > v_corte - interval '12 months'
     group by emisor_rfc
    having count(distinct receptor_rfc) > p_max_grado
  ),
  f as (
    select emisor_rfc, receptor_rfc, uuid, total, fecha
      from forense.cfdi
     where corrida_id = p_corrida and tipo = 'I' and not cancelado
       and fecha <= v_corte and fecha > v_corte - interval '12 months'
       and emisor_rfc is not null and receptor_rfc is not null
       and emisor_rfc <> receptor_rfc
       and emisor_rfc not in (select rfc from hubs)
       and receptor_rfc not in (select rfc from hubs)
  ),
  camino as (
    select emisor_rfc as origen, receptor_rfc as actual,
           array[emisor_rfc, receptor_rfc] as ruta, array[uuid] as uuids,
           total as monto_ini, total as monto_act,
           fecha as f_ini, fecha as f_act, 1 as saltos, true as dec_ok
      from f
    union all
    select c.origen, f.receptor_rfc,
           c.ruta || f.receptor_rfc, c.uuids || f.uuid,
           c.monto_ini, f.total, c.f_ini, f.fecha, c.saltos + 1,
           c.dec_ok and f.total between c.monto_act * 0.90 and c.monto_act * 0.97
      from camino c
      join f on f.emisor_rfc = c.actual
     where c.saltos < 5
       and c.actual <> c.origen
       and not (f.receptor_rfc = any(c.ruta[2:]))
       and f.fecha >= c.f_act
       and f.fecha <= c.f_ini + interval '30 days'
       and abs(f.total - c.monto_act) / nullif(c.monto_act, 0) <= 0.15
  ),
  hallazgos as (
    select case when actual = origen then 'ciclo' else 'cadena' end as tipo,
           origen, ruta, uuids, monto_ini, monto_act, f_ini, f_act, saltos, dec_ok,
           case when actual = origen then forense.ciclo_canonico(ruta) else ruta end as ruta_canonica
      from camino
     where (actual = origen and saltos >= 3)
        or (saltos >= 4 and dec_ok)
  ),
  dedup as (
    select distinct on (tipo, md5(array_to_string(ruta_canonica, '>')))
           h.*, md5(array_to_string(h.ruta_canonica, '>')) as clave
      from hallazgos h
     order by tipo, md5(array_to_string(ruta_canonica, '>')), saltos, f_ini
  )
  select p_corrida, 'R2', 'R', r.rfc,
         least(1.0, d.saltos / 4.0)::numeric,
         jsonb_build_object(
           'tipo', d.tipo,
           'ruta', to_jsonb(d.ruta_canonica),
           'uuids', to_jsonb(d.uuids),
           'monto_ini', d.monto_ini::text,
           'monto_fin', d.monto_act::text,
           'conservado', round(d.monto_act / nullif(d.monto_ini, 0), 4),
           'dias', extract(day from d.f_act - d.f_ini),
           'saltos', d.saltos,
           'decremento_por_salto_3_10', d.dec_ok,
           'resumen', format(
             '%s de %s saltos entre %s RFC en %s días: sale %s y llega %s, %s del monto inicial%s.',
             d.tipo, d.saltos, array_length(d.ruta_canonica, 1) - 1,
             extract(day from d.f_act - d.f_ini), d.monto_ini, d.monto_act,
             to_char(round(100 * d.monto_act / nullif(d.monto_ini, 0), 1), 'FM990.0%'),
             case when d.dec_ok then ', con decremento constante por salto' else '' end),
           'referencias', to_jsonb(coalesce(
               (select array_agg('CFDI:' || u) from unnest(d.uuids) u), array[]::text[])
             -- El espacio de nombres de referencias del contrato v1 no tiene
             -- prefijo para cadenas: el hallazgo de ruta viaja bajo CICLO con
             -- su tipo dentro. Si el contrato añade CADENA, esto se ajusta.
             || array['CICLO:' || d.tipo || ':' || d.clave]),
           'comprobacion', 'R2',
           'cobertura', jsonb_build_object(
             'hubs_excluidos', (select count(*) from hubs),
             'max_grado', p_max_grado,
             'profundidad_max', 5)),
         forense.huella_pista('R2', r.rfc, v_corte, d.tipo || '|' || d.clave)
    from dedup d
    -- Una fila por miembro del hallazgo. En un ciclo la ruta repite el origen
    -- al final y ese duplicado se descarta; en una cadena el último nodo es un
    -- miembro distinto y también recibe su pista.
    cross join lateral unnest(
      case when d.tipo = 'ciclo'
           then d.ruta_canonica[1:array_length(d.ruta_canonica, 1) - 1]
           else d.ruta_canonica end) as r(rfc)
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- E1 — Listas del SAT
-- RFC en 69-B (cualquier estatus salvo desvirtuado/sentencia favorable) o
-- contraparte a ≤2 saltos con estatus definitivo. Solo publicaciones con
-- fecha ≤ fecha_corte.
-- 'definitivo' aquí es el estatus del listado del SAT, no un nivel de salida
-- del sistema (el nivel máximo del sistema es presuncion_alta).
-- Trampa: estatus desvirtuado o sentencia favorable: no se marca.
-- ---------------------------------------------------------------------
create or replace function forense.pista_e1(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with publicadas as (
    select l.rfc, l.lista, l.estatus, l.fecha_publicacion, l.oficio
      from forense.listas_sat l
     where l.corrida_id = p_corrida
       and l.fecha_publicacion <= v_corte::date
       and l.lista like '69%'
  ),
  vigentes as (  -- último estatus publicado por RFC
    select distinct on (rfc) rfc, lista, estatus, fecha_publicacion, oficio
      from publicadas order by rfc, fecha_publicacion desc
  ),
  aristas as (
    select distinct emisor_rfc as a, receptor_rfc as b
      from forense.cfdi
     where corrida_id = p_corrida and tipo = 'I' and not cancelado
       and fecha <= v_corte and fecha > v_corte - interval '12 months'
       and emisor_rfc is not null and receptor_rfc is not null
  ),
  vecinos1 as (
    select c.rfc, v.rfc as contraparte, 1 as saltos
      from forense.contribuyentes c
      join aristas ar on ar.a = c.rfc or ar.b = c.rfc
      join vigentes v on v.rfc = case when ar.a = c.rfc then ar.b else ar.a end
     where c.corrida_id = p_corrida and v.estatus = 'definitivo' and v.rfc <> c.rfc
  ),
  vecinos2 as (
    select c.rfc, v.rfc as contraparte, 2 as saltos
      from forense.contribuyentes c
      join aristas a1 on a1.a = c.rfc or a1.b = c.rfc
      join aristas a2 on a2.a = case when a1.a = c.rfc then a1.b else a1.a end
                      or a2.b = case when a1.a = c.rfc then a1.b else a1.a end
      join vigentes v on v.rfc = case
                                   when a2.a = case when a1.a = c.rfc then a1.b else a1.a end
                                   then a2.b else a2.a end
     where c.corrida_id = p_corrida and v.estatus = 'definitivo'
       and v.rfc <> c.rfc
       and v.rfc <> case when a1.a = c.rfc then a1.b else a1.a end
  ),
  vecinos as (
    select distinct on (rfc, contraparte) rfc, contraparte, saltos
      from (select * from vecinos1 union all select * from vecinos2) x
     order by rfc, contraparte, saltos
  ),
  propios as (
    select v.rfc, null::text as contraparte, 0 as saltos, v.lista, v.estatus,
           v.fecha_publicacion, v.oficio
      from vigentes v
      join forense.contribuyentes c on c.corrida_id = p_corrida and c.rfc = v.rfc
     where v.estatus not in ('desvirtuado','sentencia_favorable')
  ),
  cercanos as (
    select ve.rfc, ve.contraparte, ve.saltos, vg.lista, vg.estatus,
           vg.fecha_publicacion, vg.oficio
      from vecinos ve join vigentes vg on vg.rfc = ve.contraparte
     where not exists (select 1 from propios p where p.rfc = ve.rfc)
  ),
  todos as (
    select distinct on (rfc) * from (select * from propios union all select * from cercanos) t
     order by rfc, saltos
  )
  select p_corrida, 'E1', 'E', t.rfc,
         case when t.saltos = 0 and t.estatus = 'definitivo' then 1.0
              when t.saltos = 0 then 0.8
              when t.saltos = 1 then 0.6
              else 0.4 end::numeric,
         jsonb_build_object(
           'estatus', t.estatus,
           'saltos', t.saltos,
           'lista', t.lista,
           'contraparte', t.contraparte,
           'fecha_publicacion', t.fecha_publicacion,
           'oficio', t.oficio,
           'operaciones_posteriores_a_publicacion', (
             select count(*) from forense.cfdi f
              where f.corrida_id = p_corrida and not f.cancelado
                and f.fecha > t.fecha_publicacion::timestamptz and f.fecha <= v_corte
                and (f.emisor_rfc = coalesce(t.contraparte, t.rfc)
                     or f.receptor_rfc = coalesce(t.contraparte, t.rfc))
                and (f.emisor_rfc = t.rfc or f.receptor_rfc = t.rfc)),
           'resumen', case when t.saltos = 0 then format(
               'El RFC aparece en el listado %s del SAT con estatus "%s" desde el %s (oficio %s); '
               'después de esa publicación siguió operando en %s CFDI.',
               t.lista, t.estatus, t.fecha_publicacion, coalesce(t.oficio, 'sin oficio'),
               (select count(*) from forense.cfdi f
                 where f.corrida_id = p_corrida and not f.cancelado
                   and f.fecha > t.fecha_publicacion::timestamptz and f.fecha <= v_corte
                   and (f.emisor_rfc = t.rfc or f.receptor_rfc = t.rfc)))
             else format(
               'Opera a %s salto(s) de %s, publicado en el listado del SAT con estatus "%s" el %s.',
               t.saltos, t.contraparte, t.estatus, t.fecha_publicacion) end,
           'referencias', to_jsonb(array[
             'LISTA:' || coalesce(t.contraparte, t.rfc) || ':' || t.estatus
             || ':' || t.fecha_publicacion::text]),
           'comprobacion', 'E1'),
         forense.huella_pista('E1', t.rfc, v_corte,
                              coalesce(t.contraparte, '') || '|' || t.estatus || '|' || t.fecha_publicacion::text)
    from todos t
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- T1 — Ciclo de vida
-- Alta < 12 meses antes del corte, pico trimestral > 60% del total y
-- silencio ≥ 2 meses después.
-- Trampa: startup en crecimiento o empresa de proyecto único (la nómina
-- crece o existe); el dato de nómina va en el detalle para que el
-- especialista pueda refutarla.
-- ---------------------------------------------------------------------
create or replace function forense.pista_t1(p_corrida uuid) returns int
language plpgsql set search_path = '' as $$
declare n int; v_corte timestamptz;
begin
  select fecha_corte into v_corte from forense.corridas where id = p_corrida;

  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  with nuevos as (
    select c.rfc, c.fecha_alta, c.giro
      from forense.contribuyentes c
     where c.corrida_id = p_corrida
       and c.fecha_alta is not null
       and c.fecha_alta > (v_corte - interval '12 months')::date
  ),
  meses as (
    select n.rfc, date_trunc('month', f.fecha) as mes,
           sum(f.total) as monto, count(*) as n_cfdi
      from nuevos n
      join forense.cfdi f on f.corrida_id = p_corrida and f.emisor_rfc = n.rfc
       and f.tipo = 'I' and not f.cancelado
       and f.fecha <= v_corte and f.fecha > v_corte - interval '12 months'
     group by n.rfc, date_trunc('month', f.fecha)
  ),
  totales as (
    select rfc, sum(monto) as total, max(mes) as ultimo_mes, min(mes) as primer_mes
      from meses group by rfc
  ),
  trimestres as (
    select m.rfc, m.mes as mes_ini,
           sum(m2.monto) as monto_trim
      from meses m
      join meses m2 on m2.rfc = m.rfc
       and m2.mes >= m.mes and m2.mes < m.mes + interval '3 months'
     group by m.rfc, m.mes
  ),
  pico as (
    select distinct on (rfc) rfc, mes_ini, monto_trim
      from trimestres order by rfc, monto_trim desc, mes_ini
  ),
  eval as (
    select t.rfc, t.total, t.ultimo_mes, t.primer_mes, p.mes_ini as pico_trimestre, p.monto_trim,
           round(p.monto_trim / nullif(t.total, 0), 4) as pct_pico,
           (extract(year from age(date_trunc('month', v_corte), t.ultimo_mes)) * 12
            + extract(month from age(date_trunc('month', v_corte), t.ultimo_mes)))::int as meses_silencio,
           (select coalesce(sum(f.total), 0) from forense.cfdi f
             where f.corrida_id = p_corrida and f.emisor_rfc = t.rfc and f.tipo = 'N'
               and not f.cancelado and f.fecha <= v_corte
               and f.fecha > v_corte - interval '12 months') as nomina_12m
      from totales t join pico p on p.rfc = t.rfc
  )
  select p_corrida, 'T1', 'T', e.rfc,
         least(1.0, 0.5 + (e.pct_pico - 0.6) + case when e.nomina_12m = 0 then 0.2 else 0 end)::numeric,
         jsonb_build_object(
           'fecha_alta', (select fecha_alta from nuevos x where x.rfc = e.rfc),
           'primer_mes', to_char(e.primer_mes, 'YYYY-MM'),
           'pico_trimestre', to_char(e.pico_trimestre, 'YYYY-MM'),
           'pct_en_pico', e.pct_pico,
           'facturacion_12m', e.total::text,
           'ultimo_mes_con_cfdi', to_char(e.ultimo_mes, 'YYYY-MM'),
           'meses_silencio', e.meses_silencio,
           'nomina_12m', e.nomina_12m::text,
           'resumen', format(
             'Dado de alta el %s; el %s de su facturación de 12 meses se concentra en el trimestre '
             'que arranca en %s y lleva %s meses sin emitir CFDI (nómina de 12 meses: %s).',
             (select fecha_alta from nuevos x where x.rfc = e.rfc),
             to_char(round(100 * e.pct_pico, 1), 'FM990.0%'),
             to_char(e.pico_trimestre, 'YYYY-MM'), e.meses_silencio, e.nomina_12m),
           'referencias', (select coalesce(jsonb_agg('CFDI:' || fx.uuid), '[]'::jsonb) from (
              select f.uuid from forense.cfdi f
               where f.corrida_id = p_corrida and f.emisor_rfc = e.rfc and f.tipo = 'I'
                 and not f.cancelado
                 and f.fecha >= e.pico_trimestre
                 and f.fecha < e.pico_trimestre + interval '3 months'
               order by f.total desc, f.uuid limit 20) fx),
           'comprobacion', 'T1',
           'ventana', jsonb_build_object('desde', (v_corte - interval '12 months'), 'hasta', v_corte)),
         forense.huella_pista('T1', e.rfc, v_corte)
    from eval e
   where e.pct_pico > 0.60
     and e.meses_silencio >= 2
  on conflict (corrida_id, codigo, rfc, huella) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Selección de candidatos (docs/06): la regla de dos familias aplicada
-- en la entrada. Un RFC con tres pistas de la misma familia no entra.
-- ---------------------------------------------------------------------
create or replace function forense.score_entidad(p_corrida uuid)
returns table (rfc text, score numeric, familias text[])
language sql stable set search_path = '' as $$
  select rfc, sum(score) as score, array_agg(distinct familia order by familia) as familias
    from forense.pistas
   where corrida_id = p_corrida and estado = 'disparada'
   group by rfc
  having count(distinct familia) >= 2
      or bool_or(codigo = 'E1' and (detalle->>'estatus') = 'definitivo'
                 and (detalle->>'saltos')::int = 0)
   order by 2 desc
$$;

-- ---------------------------------------------------------------------
-- Orquestador. Reclama la corrida atómicamente (lista -> procesando) y
-- no admite otra evaluación concurrente. Refresca pares una sola vez.
-- p_reejecutar permite repetir el barrido sobre una corrida ya reclamada:
-- las huellas deterministas garantizan que no se dupliquen resultados.
-- ---------------------------------------------------------------------
create or replace function forense.correr_pistas(p_corrida uuid, p_reejecutar boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare
  fam text[]; r jsonb := '{}'::jsonb; v_estado text; t0 timestamptz := clock_timestamp();
  pendientes text[] := array['D1','D3','D4','F3','F4','R3','T2'];
begin
  update forense.corridas
     set estado = 'procesando'
   where id = p_corrida
     and (estado = 'lista' or (p_reejecutar and estado = 'procesando'))
  returning familias_evaluables into fam;

  if not found then
    select estado into v_estado from forense.corridas where id = p_corrida;
    return jsonb_build_object('error', 'corrida no preparada', 'estado', v_estado);
  end if;

  refresh materialized view forense.v_pares_giro;   -- una vez por carga, antes del fan-out

  if 'D' = any(fam) then
    r := r || jsonb_build_object('D2', forense.pista_d2(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['D2']);
  end if;

  if 'F' = any(fam) then
    r := r || jsonb_build_object('F1', forense.pista_f1(p_corrida),
                                 'F2', forense.pista_f2(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['F1','F2']);
  end if;

  if 'R' = any(fam) then
    r := r || jsonb_build_object('R1', forense.pista_r1(p_corrida),
                                 'R2', forense.pista_r2(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['R1','R2']);
  end if;

  if 'T' = any(fam) then
    r := r || jsonb_build_object('T1', forense.pista_t1(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['T1']);
  end if;

  if 'E' = any(fam) then
    r := r || jsonb_build_object('E1', forense.pista_e1(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['E1']);
  end if;

  r := r || jsonb_build_object(
    'familias_evaluables', to_jsonb(fam),
    'pendientes_segunda_entrega', to_jsonb(pendientes),
    'candidatos_dos_familias', (select count(*) from forense.score_entidad(p_corrida)),
    'duracion_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  perform forense.log(null, 'sistema', 'pista_cargada',
    jsonb_build_object('evento_real', 'correr_pistas', 'resultado', r),
    (extract(epoch from clock_timestamp() - t0) * 1000)::int,
    null, null, null, null, null, null, p_corrida);

  return r;
end $$;

-- ---------------------------------------------------------------------
-- Permisos: nada de esto lo llama el LLM.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema forense from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema forense to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function forense.v_grafo(uuid,text,integer) to anon';
    execute 'grant execute on function forense.v_trayectoria_rfc(uuid,text) to anon';
    execute 'grant execute on function forense.v_metricas_corrida(uuid) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function forense.v_grafo(uuid,text,integer) to authenticated';
    execute 'grant execute on function forense.v_trayectoria_rfc(uuid,text) to authenticated';
    execute 'grant execute on function forense.v_metricas_corrida(uuid) to authenticated';
  end if;
end $$;

-- Fin 003_pistas.sql
