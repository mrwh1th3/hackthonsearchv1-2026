-- =====================================================================
-- Aserciones de db/018_contraste.sql — `forense.v_contraste_caso`.
--
-- Cada escenario vive en su PROPIA corrida sintética (`modo='fixture'`,
-- patrón de assertions_012.sql:55): el fixture de `seed_fake` tiene sus
-- tres casos en TRES giros distintos, así que ahí el contraste no puede
-- disparar nunca, y meter casos en gen-v1 rompería la comparación
-- `v_metricas_corrida` vs `eval/metricas.py` del harness.
--
-- Cubre: la fila correcta con dos casos de la misma corrida; cero filas sin
-- comparable; las tres `razon_tipificada`; la precedencia entre ellas;
-- que el comparable nunca sea de otra corrida (regla 10); que
-- `pistas_solapadas` sea intersección y no unión; que el comparable esté
-- por DEBAJO del caso; que sin solape no haya fila (`minItems: 1` del
-- contrato `product.contraste`); que sin razón tipificable no se invente
-- una; y que ninguna columna de salida arrastre texto del contribuyente
-- (regla 6).
--
-- Los helpers viven en el schema `pruebas`, nunca en `forense`.
-- =====================================================================

set search_path = '';

-- ---------------------------------------------------------------------
-- 0. Helpers de escenario.
-- ---------------------------------------------------------------------

create or replace function pruebas.c018_corrida(p_etq text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into forense.corridas (nombre, dataset, dataset_hash, fecha_corte, estado, modo)
  values ('contraste 018: ' || p_etq || ' ' || substr(md5(random()::text), 1, 8),
          'sintetico-018', md5(p_etq || random()::text), now(), 'lista', 'fixture')
  returning id into v;
  return v;
end $$;

-- Un caso dictaminado con su contribuyente y sus pistas disparadas.
-- `p_nivel` null = caso todavía sin dictamen.
-- Las pistas se insertan VÁLIDAS contra el contrato entities.pista
-- (score en [0,1], resumen no vacío, referencias del espacio de nombres):
-- `db/tests/contrato_pistas.mjs` valida TODA la tabla al final del harness,
-- sin filtro por corrida.
create or replace function pruebas.c018_caso(
  p_corrida uuid, p_rfc text, p_giro text, p_nivel text,
  p_familias text[] default '{}', p_cobertura boolean default true,
  p_codigos text[] default '{}', p_descartada boolean default false,
  p_pendientes jsonb default '[]'::jsonb)
returns uuid language plpgsql as $$
declare
  v_caso uuid; v_pista bigint; v_primera bigint := null; cod text;
  sufijo text := substr(md5(random()::text), 1, 10);
begin
  insert into forense.contribuyentes (rfc, razon_social, giro, tipo_persona,
                                      fecha_alta, domicilio, corrida_id)
  values (p_rfc, 'MARCADOR-UNTRUSTED-018 razon social escrita por el contribuyente',
          p_giro, 'moral', current_date - 400,
          'MARCADOR-UNTRUSTED-018 domicilio', p_corrida)
  on conflict (corrida_id, rfc) do nothing;

  foreach cod in array coalesce(p_codigos, '{}'::text[]) loop
    insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
    values (p_corrida, cod, left(cod, 1), p_rfc, 0.55,
            jsonb_build_object(
              'resumen', 'MARCADOR-UNTRUSTED-018 resumen sintetico de la pista',
              'referencias', jsonb_build_array('ATR:domicilio:' || sufijo)),
            'h-018-' || sufijo || '-' || cod)
    returning id into v_pista;
    if v_primera is null then v_primera := v_pista; end if;
  end loop;

  insert into forense.casos (corrida_id, rfc_principal, origen, estado, nivel,
                             familias_confirmadas, cobertura_completa,
                             pendientes, bitacora_seq)
  values (p_corrida, p_rfc, 'pipeline',
          case when p_nivel is null then 'en_cola' else 'dictaminado' end,
          p_nivel, coalesce(p_familias, '{}'::text[]), p_cobertura,
          coalesce(p_pendientes, '[]'::jsonb), 0)
  returning id into v_caso;

  if p_descartada and v_primera is not null then
    update forense.casos
       set evaluacion_pistas = jsonb_build_object(
             v_primera::text,
             jsonb_build_object('resultado', 'descartada',
                                'defensa_id', 1, 'trampa_codigo', 'T-018'))
     where id = v_caso;
  end if;

  return v_caso;
end $$;

-- ---------------------------------------------------------------------
-- 1. Forma: las siete columnas del contrato product.contraste y del tipo
--    ContrasteCaso de la UI, con esos nombres y en ese orden.
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

  perform pruebas.assert('018: v_contraste_caso existe con la firma (p_caso uuid)',
    v_args = 'p_caso uuid', coalesce(v_args, 'NO EXISTE'));
  perform pruebas.assert('018: devuelve las 7 columnas del contrato product.contraste',
    v_res = esperado, coalesce(v_res, 'NO EXISTE'));
  -- Imita a la hermana que la webapp ya lee (v_trayectoria_rfc, 002:804):
  -- security invoker; las tres tablas que lee son `publicas` en 001.
  perform pruebas.assert('018: es security invoker como v_trayectoria_rfc',
    v_prov = 'invoker', coalesce(v_prov, 'NO EXISTE'));
  perform pruebas.assert('018: PUBLIC no puede ejecutarla (002 §9 / 016 §4)',
    not has_function_privilege('public', 'forense.v_contraste_caso(uuid)', 'execute'),
    'proacl sin =X para PUBLIC');
end $$;

-- ---------------------------------------------------------------------
-- 2. Camino feliz + defensa_aceptada + regla 6.
--    Dos casos de la MISMA corrida, mismo giro, resultado distinto.
-- ---------------------------------------------------------------------
do $$
declare
  v_c uuid; v_caso uuid; v_comp uuid; r record; n int; s text;
begin
  v_c := pruebas.c018_corrida('feliz');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-1', 'construccion', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  v_comp := pruebas.c018_caso(v_c, 'P018:BAJA-1', 'construccion', 'anomalia_explicada',
                              '{}', true, '{F1,R1}', true);

  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: un caso con comparable devuelve exactamente una fila',
    n = 1, 'filas=' || n);

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: caso_id es el caso consultado',
    r.caso_id = v_caso, coalesce(r.caso_id::text, 'null'));
  perform pruebas.assert('018: rfc_comparable es el vecino del mismo giro',
    r.rfc_comparable = 'P018:BAJA-1', coalesce(r.rfc_comparable, 'null'));
  perform pruebas.assert('018: giro_compartido es el giro que comparten',
    r.giro_compartido = 'construccion', coalesce(r.giro_compartido, 'null'));
  perform pruebas.assert('018: pistas_solapadas trae los códigos comunes ordenados',
    r.pistas_solapadas = array['F1','R1'],
    coalesce(r.pistas_solapadas::text, 'null'));
  perform pruebas.assert('018: resultado_comparable es el nivel del comparable',
    r.resultado_comparable = 'anomalia_explicada', coalesce(r.resultado_comparable, 'null'));
  perform pruebas.assert('018: razon_tipificada = defensa_aceptada cuando hay pista descartada',
    r.razon_tipificada = 'defensa_aceptada', coalesce(r.razon_tipificada, 'null'));
  perform pruebas.assert('018: explicacion cita el RFC, los códigos y los dos niveles',
    r.explicacion like '%P018:BAJA-1%' and r.explicacion like '%F1, R1%'
      and r.explicacion like '%anomalia_explicada%' and r.explicacion like '%presuncion_alta%',
    left(coalesce(r.explicacion, 'null'), 200));
  perform pruebas.assert('018: explicacion cabe en el maxLength 600 del contrato',
    length(r.explicacion) between 1 and 600, 'largo=' || length(coalesce(r.explicacion, '')));

  -- Regla 6: razon_social, domicilio y el resumen de la pista llevan un
  -- marcador; ninguna columna de salida puede arrastrarlo. La función no
  -- lee cfdi ni movimientos, así que `descripcion` y `referencia` no
  -- tienen por dónde entrar.
  s := coalesce(r.caso_id::text, '') || coalesce(r.rfc_comparable, '')
    || coalesce(r.giro_compartido, '') || coalesce(r.pistas_solapadas::text, '')
    || coalesce(r.resultado_comparable, '') || coalesce(r.razon_tipificada, '')
    || coalesce(r.explicacion, '');
  perform pruebas.assert('018: ninguna columna de salida contiene texto del contribuyente (regla 6)',
    s not like '%MARCADOR-UNTRUSTED-018%', left(s, 200));
  perform pruebas.assert('018: ninguna columna de salida dice "definitivo" (regla 7)',
    s not ilike '%definitiv%', left(s, 200));
end $$;

-- ---------------------------------------------------------------------
-- 3. familia_faltante: el comparable confirmó menos familias.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record;
begin
  v_c := pruebas.c018_corrida('familias');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-2', 'transporte', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-2', 'transporte', 'presuncion',
                            '{F}', true, '{F1}');

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: razon_tipificada = familia_faltante con menos familias confirmadas',
    r.razon_tipificada = 'familia_faltante', coalesce(r.razon_tipificada, 'sin fila'));
  perform pruebas.assert('018: familia_faltante cita los dos conteos de familias',
    r.explicacion like '%1 familias frente a 3%', left(coalesce(r.explicacion, 'null'), 200));
end $$;

-- ---------------------------------------------------------------------
-- 4. cobertura_insuficiente: mismas familias, sin defensa, cobertura false.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record;
begin
  v_c := pruebas.c018_corrida('cobertura');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-3', 'manufactura', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-3', 'manufactura', 'no_concluyente',
                            '{D,F,R}', false, '{F1,R1}', false,
                            jsonb_build_array('falta bancario de un satélite'));

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: razon_tipificada = cobertura_insuficiente con cobertura_completa=false',
    r.razon_tipificada = 'cobertura_insuficiente', coalesce(r.razon_tipificada, 'sin fila'));
  perform pruebas.assert('018: cobertura_insuficiente cuenta las limitaciones abiertas, no las cita',
    r.explicacion like '%(1 limitaciones abiertas)%'
      and r.explicacion not like '%satélite%', left(coalesce(r.explicacion, 'null'), 200));
end $$;

-- ---------------------------------------------------------------------
-- 5. Precedencia: si aplican las tres, manda la que CAUSÓ el nivel
--    (auditor-final.mjs:50-55) -> cobertura_insuficiente.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record;
begin
  v_c := pruebas.c018_corrida('precedencia');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-4', 'consultoria', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  -- El comparable cumple las tres: cobertura false, pista descartada y
  -- menos familias.
  perform pruebas.c018_caso(v_c, 'P018:BAJA-4', 'consultoria', 'no_concluyente',
                            '{}', false, '{F1,R1}', true,
                            jsonb_build_array('limitacion'));

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: con las tres razones aplicables gana cobertura_insuficiente',
    r.razon_tipificada = 'cobertura_insuficiente', coalesce(r.razon_tipificada, 'sin fila'));
end $$;

-- ---------------------------------------------------------------------
-- 6. Cero filas: un solo caso en la corrida.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('solitario');
  v_caso := pruebas.c018_caso(v_c, 'P018:SOLO-1', 'ferreteria', 'presuncion',
                              '{F,R}', true, '{F1,R1}');
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: corrida con un solo caso devuelve cero filas',
    n = 0, 'filas=' || n);

  -- Y un caso que no existe tampoco produce fila de relleno.
  select count(*) into n from forense.v_contraste_caso(gen_random_uuid());
  perform pruebas.assert('018: un caso inexistente devuelve cero filas, no un error envuelto',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 7. Dirección: el comparable está por DEBAJO. Un vecino MÁS grave no es
--    contraste (sus tres razones tipificadas describen al exonerado).
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('direccion');
  v_caso := pruebas.c018_caso(v_c, 'P018:MEDIO-1', 'restaurante', 'presuncion',
                              '{F,R}', true, '{F1,R1}');
  -- Vecino más grave, con cobertura false: si la dirección no se
  -- respetara, se etiquetaría como cobertura_insuficiente.
  perform pruebas.c018_caso(v_c, 'P018:MASALTO-1', 'restaurante', 'presuncion_alta',
                            '{D,F,R}', false, '{F1,R1}', false,
                            jsonb_build_array('limitacion'));
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: un vecino con nivel MÁS grave no es comparable',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 8. Sin solape de pistas no hay fila (contrato: pistas_solapadas minItems 1).
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('sin solape');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-5', 'tecnologia', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-5', 'tecnologia', 'no_concluyente',
                            '{}', false, '{T1,D2}', true,
                            jsonb_build_array('limitacion'));
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: sin una sola pista en común no hay contraste',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 9. Intersección, no unión.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record;
begin
  v_c := pruebas.c018_corrida('interseccion');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-6', 'comercializadora', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-6', 'comercializadora', 'anomalia_explicada',
                            '{}', true, '{R1,T1,D2}', true);

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: pistas_solapadas es la intersección (R1), no la unión',
    r.pistas_solapadas = array['R1'], coalesce(r.pistas_solapadas::text, 'sin fila'));
  perform pruebas.assert('018: pistas_solapadas no incluye las pistas exclusivas de cada lado',
    not (r.pistas_solapadas @> array['F1']) and not (r.pistas_solapadas @> array['T1'])
      and not (r.pistas_solapadas @> array['D2']),
    coalesce(r.pistas_solapadas::text, 'sin fila'));
end $$;

-- ---------------------------------------------------------------------
-- 10. Regla 10: el comparable nunca sale de otra corrida.
--     La segunda corrida trae un comparable PERFECTO (mismo giro, mismos
--     códigos, nivel menor, cobertura false) y aun así no aparece.
-- ---------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; v_caso uuid; n int; v_otro uuid;
begin
  v_a := pruebas.c018_corrida('aislada A');
  v_b := pruebas.c018_corrida('aislada B');
  v_caso := pruebas.c018_caso(v_a, 'P018:ALTA-7', 'marketing', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  v_otro := pruebas.c018_caso(v_b, 'P018:BAJA-7', 'marketing', 'anomalia_explicada',
                              '{}', true, '{F1,R1}', true);

  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: un comparable de OTRA corrida no se usa (regla 10)',
    n = 0, 'filas=' || n);

  -- Y el mismo comparable, consultado desde su propia corrida, tampoco
  -- toma al caso de la corrida A como vecino.
  select count(*) into n from forense.v_contraste_caso(v_otro);
  perform pruebas.assert('018: la corrida vecina tampoco ve casos de la corrida A',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 11. Giro distinto: no hay eje de comparación.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('otro giro');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-8', 'construccion', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-8', 'papeleria', 'no_concluyente',
                            '{}', false, '{F1,R1}', true,
                            jsonb_build_array('limitacion'));
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: sin giro compartido no hay contraste',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 12. Sin razón tipificable no se inventa una (regla 4).
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('sin razon');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-9', 'despacho_contable', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  -- Nivel menor, mismo giro, solape real... pero cobertura completa, sin
  -- pistas descartadas y con MÁS familias confirmadas: ninguna de las tres
  -- razones del contrato aplica.
  perform pruebas.c018_caso(v_c, 'P018:BAJA-9', 'despacho_contable', 'presuncion',
                            '{D,F,R,E}', true, '{F1,R1}');
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: sin razón tipificable devuelve cero filas en vez de inventarla',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 13. Un caso sin dictamen todavía no tiene contraste.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; n int;
begin
  v_c := pruebas.c018_corrida('sin dictamen');
  v_caso := pruebas.c018_caso(v_c, 'P018:PEND-1', 'servicios_personal', null,
                              '{}', false, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-10', 'servicios_personal', 'anomalia_explicada',
                            '{}', true, '{F1,R1}', true);
  select count(*) into n from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: un caso sin nivel (no dictaminado) devuelve cero filas',
    n = 0, 'filas=' || n);
end $$;

-- ---------------------------------------------------------------------
-- 14. "El más cercano": gana el que comparte MÁS pistas; a igualdad, el
--     más exonerado.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; r record;
begin
  v_c := pruebas.c018_corrida('cercania');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-11', 'comercializadora', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1,T1}');
  -- Comparte 1 pista.
  perform pruebas.c018_caso(v_c, 'P018:LEJOS-11', 'comercializadora', 'anomalia_explicada',
                            '{}', true, '{F1}', true);
  -- Comparte 3.
  perform pruebas.c018_caso(v_c, 'P018:CERCA-11', 'comercializadora', 'presuncion',
                            '{F}', true, '{F1,R1,T1}');

  select * into r from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: el comparable elegido es el que comparte más pistas',
    r.rfc_comparable = 'P018:CERCA-11' and cardinality(r.pistas_solapadas) = 3,
    coalesce(r.rfc_comparable, 'sin fila') || ' ' || coalesce(r.pistas_solapadas::text, ''));
end $$;

-- ---------------------------------------------------------------------
-- 15. Estabilidad: dos llamadas seguidas devuelven la misma fila.
-- ---------------------------------------------------------------------
do $$
declare v_c uuid; v_caso uuid; a text; b text;
begin
  v_c := pruebas.c018_corrida('estabilidad');
  v_caso := pruebas.c018_caso(v_c, 'P018:ALTA-12', 'tecnologia', 'presuncion_alta',
                              '{D,F,R}', true, '{F1,R1}');
  -- Dos comparables empatados en solape: el desempate por nivel y RFC
  -- tiene que ser determinista.
  perform pruebas.c018_caso(v_c, 'P018:BAJA-12A', 'tecnologia', 'presuncion',
                            '{F}', true, '{F1,R1}');
  perform pruebas.c018_caso(v_c, 'P018:BAJA-12B', 'tecnologia', 'anomalia_explicada',
                            '{}', true, '{F1,R1}', true);

  select rfc_comparable || '|' || razon_tipificada into a from forense.v_contraste_caso(v_caso);
  select rfc_comparable || '|' || razon_tipificada into b from forense.v_contraste_caso(v_caso);
  perform pruebas.assert('018: la fila es estable entre llamadas y gana el más exonerado',
    a = b and a = 'P018:BAJA-12B|defensa_aceptada', coalesce(a, 'sin fila') || ' / ' || coalesce(b, 'sin fila'));
end $$;

-- Fin assertions_018.sql
