-- =====================================================================
-- QA-004 sobre datos reales: el ensayo de inyección con los paquetes de
-- eval/inyecciones/ sobre CLONES de gen-v1.
--
-- (a) carrusel nuevo   -> cruza el selector de dos familias; los 3 RFC
--                         tienen que terminar en clusters igual.
-- (c) trampa legítima  -> NO cruza el selector (y no debe cruzarlo: es
--                         una trampa). Aun así el juez subió el paquete y
--                         espera respuesta: tiene que existir un cluster
--                         por RFC inyectado. Lo que NO cambia es el
--                         selector: el RFC sigue fuera de
--                         score_entidad. Ahí está la diferencia entre
--                         "garantizamos investigación" y "bajamos el
--                         umbral", que es la alternativa que se rechazó.
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
  n_cubiertos int; n_creados int; n_sel int; n_pri int; n_ev int;
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

  -- El selector NO marca la trampa. Esto es lo correcto y se afirma antes
  -- de garantizar nada: si algún día la marcara, el FPR de eval subiría y
  -- esta aserción es la que avisa.
  select count(*) into n_sel from forense.score_entidad(v_nueva) s where s.rfc = any(rfcs);
  perform pruebas.assert('(c) el selector de dos familias NO marca la trampa legítima',
    n_sel = 0, 'marcados=' || n_sel);

  select count(*) filter (where creado), count(*) into n_creados, n_pri
    from forense.asegurar_clusters_inyectados(v_nueva, v_iny);
  select count(*) into n_cubiertos from unnest(rfcs) x
   where exists (select 1 from forense.clusters c
                  where c.corrida_id = v_nueva and x = any(c.rfcs));
  perform pruebas.assert('(c) cada RFC de la trampa inyectada termina en un cluster igual',
    n_cubiertos = 3, 'cubiertos=' || n_cubiertos || ' garantizados=' || n_creados ||
    ' filas=' || n_pri);

  -- ...y garantizar el cluster NO relajó el selector: el umbral de dos
  -- familias sigue intacto sobre la corrida nueva.
  select count(*) into n_sel from forense.score_entidad(v_nueva) s where s.rfc = any(rfcs);
  perform pruebas.assert('(c) garantizar el cluster no mete a la trampa en el selector',
    n_sel = 0, 'marcados despues=' || n_sel);

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
