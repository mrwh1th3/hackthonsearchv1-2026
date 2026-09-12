-- =====================================================================
-- El bloqueante del juez: latencia de la inyección en vivo.
--
-- Un clon recién creado (el camino de la inyección: se clona la corrida,
-- se corre el barrido, se arman clusters) tenía las estadísticas
-- rancias: el planeador estimaba ~1 fila para la corrida nueva y
-- `pista_f1` se atascaba. Medido en este worktree ANTES de 014:
-- `correr_pistas` sobre un clon de gen-v1 NO terminó en 300 s
-- (statement_timeout, dentro de pista_f1). Con 014 el mismo barrido
-- corre en ~1,5 s incluyendo el ANALYZE.
--
-- Aquí se mide de verdad, sobre el clon del snapshot real, y se exige
-- que termine por debajo del techo de demo (5 s).
--
-- Va después de assertions_gen.sql / assertions_012_gen.sql: reusa la
-- corrida con el paquete (a) inyectado si existe.
-- =====================================================================

set search_path = '';

do $$
declare
  v_base uuid; v_clon uuid; v_ms int; v_dur int; v_origen text;
  v_techo int := 5000; t0 timestamptz;
begin
  -- Preferimos el clon con el paquete (a) inyectado (es el caso del
  -- juez: sube un paquete y espera respuesta); si no está, gen-v1.
  select i.corrida_nueva_id into v_base from forense.inyecciones i
   where i.idempotency_key = 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid;
  v_origen := 'clon de la corrida con el paquete (a)';
  if v_base is null then
    select k.id into v_base from forense.corridas k where k.nombre = 'gen-v1';
    v_origen := 'clon de gen-v1 (sin paquete (a) disponible)';
  end if;
  if v_base is null then
    perform pruebas.omitir(
      'correr_pistas sobre un clon recién creado termina por debajo del techo de demo',
      'sin snapshot gen-v1 ni corrida con el paquete (a)');
    return;
  end if;

  t0 := clock_timestamp();
  v_clon := forense.clonar_corrida(v_base, 'test-014-latencia-' || substr(md5(random()::text), 1, 6));
  v_ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;

  t0 := clock_timestamp();
  v_dur := (forense.correr_pistas(v_clon)->>'duracion_ms')::int;
  v_dur := coalesce(v_dur, (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  perform pruebas.assert(
    'correr_pistas sobre un clon recién creado termina por debajo del techo de demo (5 s)',
    v_dur < v_techo,
    v_origen || ': clonar=' || v_ms || ' ms, barrido=' || v_dur || ' ms (techo ' || v_techo || ' ms)');

  -- Y el barrido dejó rastro de haber analizado (regla 2): es lo que
  -- explica el número de arriba.
  perform pruebas.assert(
    'el barrido del clon deja el evento de estadísticas analizadas',
    (select count(*) from forense.bitacora b
      where b.corrida_id = v_clon and b.tipo_evento = 'corrida_cargada'
        and b.payload->>'evento_real' = 'estadisticas_analizadas') >= 2,
    'uno por clonar_corrida y otro por correr_pistas');
end $$;
