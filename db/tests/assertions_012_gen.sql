-- =====================================================================
-- QA-004 sobre datos reales: el ensayo de inyección con los paquetes de
-- eval/inyecciones/ sobre CLONES de gen-v1.
--
-- (a) carrusel nuevo   -> cruza el selector de dos familias; los 3 RFC
--                         tienen que terminar en clusters igual.
-- (c) trampa legítima  -> PUEDE cruzar el selector, y de hecho se diseñó
--                         para cruzarlo (eval/inyecciones/README.md §(c):
--                         dispara R1 por domicilio compartido y F1 por
--                         crédito comercial). Ahí es donde se mide la
--                         defensa: el caso entra a investigación y el
--                         sistema tiene que EXPLICARLO y cerrar
--                         `anomalia_explicada`. Exigir que quedara fuera
--                         del selector era medir otra cosa —y contradecía
--                         al propio paquete—. Lo que sí se afirma aquí es
--                         lo que depende de la corrida y del paquete:
--                         (1) cada RFC inyectado termina en un cluster,
--                         (2) el paquete trae los datos que explican la
--                         anomalía (compras reales y salida de dinero a
--                         personas morales) y no se factura a sí mismo,
--                         así que NO da por sí solo evidencia validable
--                         de dos familias sin explicación, y
--                         (3) garantizar el cluster no mueve el selector.
--
-- Se ejecuta después de assertions_gen.sql y se omite en silencio si no
-- hay snapshot gen-v1 o no se cargaron los paquetes.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- (a) Reusa la corrida nueva que dejó assertions_gen.sql.
-- ---------------------------------------------------------------------
do $$
declare
  v_iny uuid; v_nueva uuid; n_cubiertos int; n_creados int;
  rfcs text[] := array['CRR250901AA1','CRR250902BB2','CRR250903CC3'];
begin
  select id, corrida_nueva_id into v_iny, v_nueva from forense.inyecciones
   where idempotency_key = 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid;
  if v_iny is null or v_nueva is null then
    return;  -- sin gen-v1 no hay ensayo (a)
  end if;

  select count(*) filter (where creado) into n_creados
    from forense.asegurar_clusters_inyectados(v_nueva, v_iny);

  select count(*) into n_cubiertos from unnest(rfcs) x
   where exists (select 1 from forense.clusters c
                  where c.corrida_id = v_nueva and x = any(c.rfcs));
  perform pruebas.assert('(a) los 3 RFC del carrusel inyectado terminan en un cluster',
    n_cubiertos = 3, 'cubiertos=' || n_cubiertos || ' garantizados=' || n_creados);

  -- El carrusel SÍ cruza el selector: no debería haber hecho falta
  -- garantizar nada. Si hizo falta, la aserción sigue pasando pero el
  -- detalle lo dice, que es lo que se quiere saber.
  perform pruebas.assert('(a) el carrusel cruza el selector de dos familias por sí solo',
    (select count(*) from forense.score_entidad(v_nueva) s where s.rfc = any(rfcs)) = 3,
    'garantizados por la ruta manual=' || n_creados);
end $$;

-- ---------------------------------------------------------------------
-- (c) Trampa legítima: cluster sí, selector no.
-- ---------------------------------------------------------------------
do $$
declare
  v uuid; pkg jsonb; r jsonb; v_ing uuid; v_iny uuid; v_nueva uuid;
  rfcs text[] := array['TRB190311FF6','TRB200714GG7','TRB180205HH8'];
  n_cubiertos int; n_creados int; n_sel int; n_sel_post int; n_pri int; n_ev int;
  n_compras int; n_salidas int; n_no_moral int; n_internas int;
begin
  if not exists (select 1 from pg_tables where schemaname = 'pruebas' and tablename = 'paquetes') then
    return;
  end if;
  select payload into pkg from pruebas.paquetes where nombre = 'c-trampa-comercializadora';
  select id into v from forense.corridas where dataset = 'gen-v1' order by inicio limit 1;
  if pkg is null or v is null then
    return;
  end if;

  r := forense.registrar_inyeccion(v, pkg, 'ensayo', (pkg->>'idempotency_key')::uuid);
  if not coalesce((r->>'ok')::boolean, false) then
    perform pruebas.assert('(c) el paquete de la trampa se registra sobre gen-v1', false, r::text);
    return;
  end if;
  v_ing := (r->>'ingesta_id')::uuid;
  v_iny := (r->>'inyeccion_id')::uuid;

  r := forense.validar_inyeccion(v_ing);
  perform pruebas.assert('(c) el paquete de la trampa pasa la validación determinista',
    (r->>'ok')::boolean and (r->>'estado') = 'validada', r::text);
  if (r->>'estado') is distinct from 'validada' then
    return;
  end if;

  v_nueva := forense.clonar_corrida_con_inyeccion(v, v_ing);
  perform pruebas.assert('(c) la inyección de la trampa crea corrida nueva, no muta gen-v1',
    v_nueva is not null
    and not exists (select 1 from forense.contribuyentes
                     where corrida_id = v and rfc = any(rfcs)), '');

  perform forense.correr_pistas(v_nueva);
  perform forense.armar_clusters(v_nueva);

  -- Se registra CUÁNTOS RFC de la trampa cruzan el selector, sin exigir
  -- un valor: el paquete está hecho para cruzarlo (R1 + F1). Lo que se
  -- afirma es que el paquete trae con qué explicarlo; el falso positivo,
  -- si lo hay, lo mide eval/metricas.py sobre el DICTAMEN, no aquí.
  select count(*) into n_sel from forense.score_entidad(v_nueva) s where s.rfc = any(rfcs);

  -- (c1) Compras reales: CFDI de entrada emitidos por proveedores de la
  -- corrida base. Sin ellas el paquete sería un carrusel disfrazado y la
  -- trampa no sería una trampa legítima.
  select count(*) into n_compras from forense.cfdi f
   where f.corrida_id = v_nueva and f.tipo = 'I' and not f.cancelado
     and f.receptor_rfc = any(rfcs) and not (f.emisor_rfc = any(rfcs));
  perform pruebas.assert('(c) el paquete de la trampa trae compras reales a proveedores de la base',
    n_compras >= 3, 'cfdi de compra=' || n_compras);

  -- (c2) El dinero sale a personas MORALES, y todas identificadas: el
  -- conteo de salidas hacia un titular que no es moral tiene que ser 0
  -- *y* tiene que haber salidas (si la CLABE destino no existiera, el
  -- `not exists` daría 0 por vacío y la aserción pasaría sin medir nada).
  select count(*) filter (where k.tipo_persona = 'moral'),
         count(*) filter (where k.tipo_persona is distinct from 'moral')
    into n_salidas, n_no_moral
    from forense.movimientos m
    join forense.cuentas co on co.corrida_id = v_nueva and co.clabe = m.cuenta_origen
    left join forense.cuentas cd on cd.corrida_id = v_nueva and cd.clabe = m.cuenta_destino
    left join forense.contribuyentes k on k.corrida_id = v_nueva and k.rfc = cd.rfc_titular
   where m.corrida_id = v_nueva and co.rfc_titular = any(rfcs);
  perform pruebas.assert('(c) el dinero de la trampa sale a personas morales identificadas',
    n_salidas >= 3 and n_no_moral = 0,
    'salidas a morales=' || n_salidas || ' salidas sin moral identificada=' || n_no_moral);

  -- (c3) No se facturan entre sí: es el discriminador que separa
  -- "comparten domicilio" de "cluster de facturación".
  select count(*) into n_internas from forense.cfdi f
   where f.corrida_id = v_nueva and f.emisor_rfc = any(rfcs) and f.receptor_rfc = any(rfcs);
  perform pruebas.assert('(c) la trampa no se factura a sí misma (no es un carrusel)',
    n_internas = 0, 'cfdi internas=' || n_internas);

  select count(*) filter (where creado), count(*) into n_creados, n_pri
    from forense.asegurar_clusters_inyectados(v_nueva, v_iny);
  select count(*) into n_cubiertos from unnest(rfcs) x
   where exists (select 1 from forense.clusters c
                  where c.corrida_id = v_nueva and x = any(c.rfcs));
  perform pruebas.assert('(c) cada RFC de la trampa inyectada termina en un cluster igual',
    n_cubiertos = 3, 'cubiertos=' || n_cubiertos || ' garantizados=' || n_creados ||
    ' filas=' || n_pri || ' marcados por el selector=' || n_sel);

  -- ...y garantizar el cluster NO tocó el selector: el umbral de dos
  -- familias sigue dando exactamente lo mismo sobre la corrida nueva.
  -- Esa es la diferencia entre "garantizamos investigación" y "bajamos el
  -- umbral", que es la alternativa que se rechazó.
  select count(*) into n_sel_post from forense.score_entidad(v_nueva) s where s.rfc = any(rfcs);
  perform pruebas.assert('(c) garantizar el cluster no cambia el selector de dos familias',
    n_sel_post = n_sel, 'antes=' || n_sel || ' despues=' || n_sel_post);

  select count(*) into n_ev from forense.bitacora b
   where b.corrida_id = v_nueva and b.tipo_evento = 'inyeccion'
     and b.payload->>'evento_real' = 'cluster_garantizado'
     and b.payload->>'inyeccion_id' = v_iny::text;
  perform pruebas.assert('(c) cada cluster garantizado de la trampa deja evento (regla 2)',
    n_ev = n_creados, 'eventos=' || n_ev || ' creados=' || n_creados);

  -- La cola de la inyección devuelve primero los garantizados.
  perform pruebas.assert('(c) clusters_por_prioridad_inyeccion abre con un cluster afectado',
    (select p.afectado from forense.clusters_por_prioridad_inyeccion(v_nueva, v_iny) p limit 1),
    'la primera fila de la cola no contiene RFC inyectados');
end $$;
