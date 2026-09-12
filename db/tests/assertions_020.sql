-- =====================================================================
-- Aserciones de db/020_contraste_cluster.sql — el comparable se busca
-- primero DENTRO del cluster (`casos.resultado_por_rfc`) y sólo si ahí no
-- hay se cae al emparejamiento caso-a-caso de 018.
--
-- Los payloads de `resultado_por_rfc` son sintéticos a propósito: sobre
-- datos reales de hoy el camino de cluster devuelve cero filas (medido en
-- `forense_rt`: 388 RFC de cluster, 57 con giro, 32 con giro y solape, pero
-- todos en el MISMO nivel que su caso; los 206 vecinos `sin_hallazgos`
-- tienen cero pistas propias por construcción de `decidirNivel`). El
-- precedente de escribir elementos a mano es `db/seeds/seed_fake.sql:229-231`.
--
-- Cubre: el comparable de cluster GANA cuando también hay uno caso-a-caso;
-- cluster vacío -> entra el respaldo; los dos vacíos -> cero filas; las tres
-- razones por el camino de cluster; la dirección (vecino más grave no
-- cuenta); el solape como intersección y `minItems 1`; aislamiento por
-- corrida; y que ninguna columna arrastre texto del contribuyente.
--
-- Reutiliza los helpers `pruebas.c018_*` de assertions_018.sql (mismo
-- schema `pruebas`, nunca `forense`).
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 0. Helper: escribe `resultado_por_rfc` en un caso ya creado, con la
--    forma que emite n8n/runtime/auditor-final.mjs.
--    Cada RFC se declara como 'rfc|nivel|cobertura(t/f)' y, opcionalmente,
--    ids de evidencia separados por coma tras un segundo '|'.
-- ---------------------------------------------------------------------
create or replace function pruebas.c020_rxr(p_caso uuid, p_especs text[])
returns void language plpgsql as $$
declare s text; partes text[]; arr jsonb := '[]'::jsonb; ids jsonb;
begin
  foreach s in array p_especs loop
    partes := string_to_array(s, '|');
    ids := case when coalesce(partes[4], '') = '' then '[]'::jsonb
                else (select jsonb_agg(x::bigint)
                        from unnest(string_to_array(partes[4], ',')) x) end;
    arr := arr || jsonb_build_array(jsonb_build_object(
      'rfc', partes[1],
      'nivel', partes[2],
      'tipologia', case when partes[2] in ('presuncion','presuncion_alta')
                        then 'carrusel' else null end,
      'evidencia_ids', ids,
      'cobertura_completa', (partes[3] = 't')));
  end loop;
  update forense.casos set resultado_por_rfc = arr where id = p_caso;
end $$;

-- Evidencia mínima y VÁLIDA para poder contar familias por RFC: el runtime
-- sólo mete en `evidencia_ids` la que pasó `valida_tecnica and not refutada
-- and validada` (auditor-final.mjs:20-21), así que se crea igual.
create or replace function pruebas.c020_evidencia(
  p_caso uuid, p_familia text, p_rfcs text[])
returns bigint language plpgsql as $$
declare v bigint; sufijo text := substr(md5(random()::text), 1, 10);
begin
  insert into forense.evidencia (caso_id, idempotency_key, tipo, ref_id, familia,
                                 rfcs_afectados, descripcion, agente, ronda,
                                 valida_tecnica, refutada, validada)
  values (p_caso, 'ev-020-' || sufijo, 'cfdi', 'CFDI:020-' || sufijo, p_familia,
          p_rfcs, 'MARCADOR-UNTRUSTED-018 descripcion de evidencia',
          'especialista_' || lower(p_familia), 1, true, false, true)
  returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 1. El comparable del CLUSTER gana al comparable caso-a-caso.
--    La corrida trae los dos: un vecino del cluster válido y otro caso
--    válido. Debe salir el del cluster, y `explicacion` decirlo.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record; n int; e1 bigint; e1b bigint; e1c bigint;
        e2 bigint; s text;
begin
  v_c := pruebas.c018_corrida('020 cluster gana');
  -- Caso investigado: presuncion_alta, 3 familias, pistas F1 y R1.
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-1', 'construccion', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  -- Vecino del cluster: mismo giro, con pistas propias que solapan.
  perform pruebas.c018_caso(v_c, 'P020:VECINO-1', 'construccion', null,
                            '{}', true, '{F1,R1}');
  -- Otro caso, también comparable por el camino de 018.
  perform pruebas.c018_caso(v_c, 'P020:OTROCASO-1', 'construccion', 'presuncion',
                            '{F}', true, '{F1}');
  -- Evidencia: el principal sostiene 3 familias, el vecino 1.
  e1 := pruebas.c020_evidencia(v_caso, 'D', array['P020:ALTA-1']);
  e1b := pruebas.c020_evidencia(v_caso, 'F', array['P020:ALTA-1']);
  e1c := pruebas.c020_evidencia(v_caso, 'R', array['P020:ALTA-1']);
  e2 := pruebas.c020_evidencia(v_caso, 'F', array['P020:VECINO-1']);
  -- Los tres ids del principal viajan en SU elemento: las familias de
  -- referencia salen de `evidencia_ids`, no de `familias_confirmadas`.
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-1|presuncion_alta|t|' || e1::text || ',' || e1b::text || ',' || e1c::text,
    'P020:VECINO-1|presuncion|t|' || e2::text]);

  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: con comparable de cluster y de caso devuelve una sola fila',
    n = 1, 'filas=' || n);

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: el comparable del CLUSTER gana al caso-a-caso',
    r.rfc_comparable = 'P020:VECINO-1', coalesce(r.rfc_comparable, 'sin fila'));
  perform pruebas.assert('020: explicacion declara la procedencia del comparable',
    r.explicacion like '%del mismo cluster%', left(coalesce(r.explicacion, 'null'), 200));
  perform pruebas.assert('020: resultado_comparable es el nivel POR RFC del vecino',
    r.resultado_comparable = 'presuncion', coalesce(r.resultado_comparable, 'null'));
  perform pruebas.assert('020: pistas_solapadas del camino de cluster es la intersección',
    r.pistas_solapadas = array['F1','R1'], coalesce(r.pistas_solapadas::text, 'null'));
  perform pruebas.assert('020: razon_tipificada = familia_faltante por las familias del elemento',
    r.razon_tipificada = 'familia_faltante', coalesce(r.razon_tipificada, 'null'));
  perform pruebas.assert('020: familia_faltante cuenta las familias de evidencia_ids (1 vs 3)',
    r.explicacion like '%1 familia frente a 3%', left(coalesce(r.explicacion, 'null'), 200));

  s := coalesce(r.caso_id::text, '') || coalesce(r.rfc_comparable, '')
    || coalesce(r.giro_compartido, '') || coalesce(r.pistas_solapadas::text, '')
    || coalesce(r.resultado_comparable, '') || coalesce(r.razon_tipificada, '')
    || coalesce(r.explicacion, '');
  perform pruebas.assert('020: ninguna columna arrastra texto del contribuyente (regla 6)',
    s not like '%MARCADOR-UNTRUSTED-018%', left(s, 200));
  perform pruebas.assert('020: ninguna columna dice "definitivo" (regla 7)',
    s not ilike '%definitiv%', left(s, 200));
  perform pruebas.assert('020: explicacion cabe en el maxLength 600 del contrato',
    length(r.explicacion) between 1 and 600, 'largo=' || length(coalesce(r.explicacion, '')));
end $$;

-- ---------------------------------------------------------------------
-- 2. cobertura_insuficiente por RFC: el elemento trae cobertura false.
--    Manda sobre las otras dos razones (orden de auditor-final.mjs:55-62).
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record; e1 bigint; e2 bigint;
begin
  v_c := pruebas.c018_corrida('020 cobertura por rfc');
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-2', 'transporte', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P020:VECINO-2', 'transporte', null,
                            '{}', true, '{F1,R1}');
  e1 := pruebas.c020_evidencia(v_caso, 'D', array['P020:ALTA-2']);
  e2 := pruebas.c020_evidencia(v_caso, 'F', array['P020:VECINO-2']);
  -- El vecino queda en no_concluyente con cobertura false: las tres razones
  -- podrían aplicar (también tiene menos familias) y debe ganar la cobertura.
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-2|presuncion_alta|t|' || e1::text,
    'P020:VECINO-2|no_concluyente|f|' || e2::text]);

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: cobertura_insuficiente sale del cobertura_completa del elemento',
    r.razon_tipificada = 'cobertura_insuficiente', coalesce(r.razon_tipificada, 'sin fila'));
  perform pruebas.assert('020: en el camino de cluster la cobertura no cita un conteo que no existe',
    r.explicacion like '%su cobertura quedó incompleta:%', left(coalesce(r.explicacion, 'null'), 200));
end $$;

-- ---------------------------------------------------------------------
-- 3. defensa_aceptada por RFC: la pista descartada es DEL VECINO.
--    Una pista descartada de OTRO RFC del cluster no le sirve.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record; e1 bigint; e2 bigint; v_pista bigint;
begin
  v_c := pruebas.c018_corrida('020 defensa por rfc');
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-3', 'manufactura', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P020:VECINO-3', 'manufactura', null,
                            '{}', true, '{F1,R1}');
  e1 := pruebas.c020_evidencia(v_caso, 'D', array['P020:ALTA-3']);
  e2 := pruebas.c020_evidencia(v_caso, 'F', array['P020:VECINO-3']);
  -- Mismas familias que la referencia para que `familia_faltante` NO aplique
  -- y se vea la razón de la defensa.
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-3|presuncion_alta|t|' || e1::text,
    'P020:VECINO-3|no_concluyente|t|' || e2::text]);
  update forense.casos set familias_confirmadas = '{F}' where id = v_caso;

  -- La réplica descarta una pista DEL VECINO (017: clave = ID de pista).
  select p.id into v_pista from forense.pistas p
   where p.corrida_id = v_c and p.rfc = 'P020:VECINO-3' order by p.id limit 1;
  update forense.casos
     set evaluacion_pistas = jsonb_build_object(
           v_pista::text, jsonb_build_object('resultado','descartada','defensa_id',1))
   where id = v_caso;

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: defensa_aceptada mira las pistas DEL vecino, no las del caso',
    r.razon_tipificada = 'defensa_aceptada', coalesce(r.razon_tipificada, 'sin fila'));
  perform pruebas.assert('020: defensa_aceptada cita descartadas sobre evaluadas de ese RFC',
    r.explicacion like '%descartó 1 de 1 pistas evaluadas%',
    left(coalesce(r.explicacion, 'null'), 200));

  -- Ahora la descartada es de un TERCER RFC del cluster: el vecino deja de
  -- tener defensa aceptada y, con las familias igualadas, no hay razón.
  select p.id into v_pista from forense.pistas p
   where p.corrida_id = v_c and p.rfc = 'P020:ALTA-3' order by p.id limit 1;
  update forense.casos
     set evaluacion_pistas = jsonb_build_object(
           v_pista::text, jsonb_build_object('resultado','descartada','defensa_id',1))
   where id = v_caso;
  perform pruebas.assert('020: una pista descartada de otro RFC no exonera al vecino',
    not exists (select 1 from forense.v_contraste_caso(v_caso)
                 where razon_tipificada = 'defensa_aceptada'),
    'la razón no puede venir de una pista ajena');
end $$;

-- ---------------------------------------------------------------------
-- 4. Dirección y solape en el camino de cluster.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int; e1 bigint;
begin
  v_c := pruebas.c018_corrida('020 direccion cluster');
  v_caso := pruebas.c018_caso(v_c, 'P020:MEDIO-4', 'restaurante', 'presuncion',
                              '{F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P020:MASALTO-4', 'restaurante', null,
                            '{}', true, '{F1,R1}');
  e1 := pruebas.c020_evidencia(v_caso, 'F', array['P020:MEDIO-4']);
  perform pruebas.c020_rxr(v_caso, array[
    'P020:MEDIO-4|presuncion|t|' || e1::text,
    'P020:MASALTO-4|presuncion_alta|f|']);
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: un vecino de cluster MÁS grave no es comparable',
    n = 0, 'filas=' || n);

  -- Mismo vecino, ahora menos grave pero SIN pistas propias: es el caso real
  -- de los `sin_hallazgos` del cluster (cero pistas => cero solape) y el
  -- contrato exige `pistas_solapadas` con minItems 1.
  v_c := pruebas.c018_corrida('020 sin solape cluster');
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-5', 'tecnologia', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P020:MUDO-5', 'tecnologia', null, '{}', true, '{}');
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-5|presuncion_alta|t|',
    'P020:MUDO-5|sin_hallazgos|t|']);
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: un vecino sin pistas propias no puede solapar y no da fila',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 5. El respaldo caso-a-caso sigue vivo cuando el cluster no da nada.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record; n int;
begin
  v_c := pruebas.c018_corrida('020 respaldo');
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-6', 'comercializadora', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P020:OTROCASO-6', 'comercializadora', 'anomalia_explicada',
                            '{}', true, '{F1,R1}', true);
  -- resultado_por_rfc con un solo elemento (el principal): el cluster no
  -- ofrece vecino, así que tiene que entrar el camino de 018.
  perform pruebas.c020_rxr(v_caso, array['P020:ALTA-6|presuncion_alta|t|']);

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: sin vecino de cluster entra el respaldo caso-a-caso',
    r.rfc_comparable = 'P020:OTROCASO-6', coalesce(r.rfc_comparable, 'sin fila'));
  perform pruebas.assert('020: el respaldo declara su procedencia en explicacion',
    r.explicacion like '%de otro caso de la misma corrida%',
    left(coalesce(r.explicacion, 'null'), 200));
  perform pruebas.assert('020: el respaldo conserva la razon de 018',
    r.razon_tipificada = 'defensa_aceptada', coalesce(r.razon_tipificada, 'null'));

  -- Y con resultado_por_rfc vacía (corrida anterior a a708225) también.
  update forense.casos set resultado_por_rfc = '[]'::jsonb where id = v_caso;
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: con resultado_por_rfc vacía el respaldo sigue respondiendo',
    n = 1, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 6. Los dos caminos vacíos: cero filas, sin inventar.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('020 nada');
  v_caso := pruebas.c018_caso(v_c, 'P020:SOLO-7', 'ferreteria', 'presuncion',
                              '{F,R}', true, '{F1,R1}');
  perform pruebas.c020_rxr(v_caso, array['P020:SOLO-7|presuncion|t|']);
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: sin comparable en ninguno de los dos caminos, cero filas',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 7. Regla 10 en el camino de cluster: el elemento puede nombrar un RFC
--    que sólo existe en OTRA corrida; no puede convertirse en comparable.
-- ---------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; v_caso uuid; n int; e1 bigint;
begin
  v_a := pruebas.c018_corrida('020 aislada A');
  v_b := pruebas.c018_corrida('020 aislada B');
  v_caso := pruebas.c018_caso(v_a, 'P020:ALTA-8', 'marketing', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  -- El RFC del vecino vive en la corrida B, con giro y pistas que encajarían.
  perform pruebas.c018_caso(v_b, 'P020:AJENO-8', 'marketing', 'presuncion',
                            '{F}', true, '{F1,R1}');
  e1 := pruebas.c020_evidencia(v_caso, 'D', array['P020:ALTA-8']);
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-8|presuncion_alta|t|' || e1::text,
    'P020:AJENO-8|presuncion|t|']);
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: un RFC de otra corrida nombrado en resultado_por_rfc no es comparable (regla 10)',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 8. Giro distinto dentro del cluster: no hay eje de comparación.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int; e1 bigint;
begin
  v_c := pruebas.c018_corrida('020 otro giro cluster');
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-9', 'construccion', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P020:VECINO-9', 'papeleria', null, '{}', true, '{F1,R1}');
  e1 := pruebas.c020_evidencia(v_caso, 'D', array['P020:ALTA-9']);
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-9|presuncion_alta|t|' || e1::text,
    'P020:VECINO-9|no_concluyente|f|']);
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: un vecino de cluster de otro giro no es comparable',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 9. Estabilidad y "más cercano" dentro del cluster.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; a text; b text; e1 bigint;
begin
  v_c := pruebas.c018_corrida('020 cercania cluster');
  v_caso := pruebas.c018_caso(v_c, 'P020:ALTA-10', 'consultoria', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1,T1}');
  perform pruebas.c018_caso(v_c, 'P020:LEJOS-10', 'consultoria', null, '{}', true, '{F1}');
  perform pruebas.c018_caso(v_c, 'P020:CERCA-10', 'consultoria', null, '{}', true, '{F1,R1,T1}');
  e1 := pruebas.c020_evidencia(v_caso, 'D', array['P020:ALTA-10']);
  perform pruebas.c020_rxr(v_caso, array[
    'P020:ALTA-10|presuncion_alta|t|' || e1::text,
    'P020:LEJOS-10|no_concluyente|f|',
    'P020:CERCA-10|no_concluyente|f|']);

  select rfc_comparable || '|' || cardinality(pistas_solapadas)::text into a
    from forense.v_contraste_caso(v_caso);
  select rfc_comparable || '|' || cardinality(pistas_solapadas)::text into b
    from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('020: dentro del cluster gana el que comparte más pistas, de forma estable',
    a = b and a = 'P020:CERCA-10|3', coalesce(a, 'sin fila') || ' / ' || coalesce(b, 'sin fila'));
end $$;

-- ---------------------------------------------------------------------
-- 10. La firma y los permisos no cambiaron respecto a 018.
-- ---------------------------------------------------------------------
do $$
declare
  esperado text := 'TABLE(caso_id uuid, rfc_comparable text, giro_compartido text, '
                || 'pistas_solapadas text[], resultado_comparable text, '
                || 'razon_tipificada text, explicacion text)';
  v_res text; v_args text; v_prov text;
begin
  select pg_get_function_result(p.oid), pg_get_function_arguments(p.oid),
         case when p.prosecdef then 'definer' else 'invoker' end
    into v_res, v_args, v_prov
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'forense' and p.proname = 'v_contraste_caso';
  perform pruebas.assert('020: la firma sigue siendo (p_caso uuid) — la webapp ya está cableada',
    v_args = 'p_caso uuid', coalesce(v_args, 'NO EXISTE'));
  perform pruebas.assert('020: siguen siendo las 7 columnas del contrato product.contraste',
    v_res = esperado, coalesce(v_res, 'NO EXISTE'));
  perform pruebas.assert('020: sigue siendo security invoker',
    v_prov = 'invoker', coalesce(v_prov, 'NO EXISTE'));
  perform pruebas.assert('020: PUBLIC sigue sin poder ejecutarla',
    not has_function_privilege('public', 'forense.v_contraste_caso(uuid)', 'execute'),
    'proacl sin =X para PUBLIC');
end $$;

-- Fin assertions_020.sql
