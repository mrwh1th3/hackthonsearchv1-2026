-- =====================================================================
-- Aserciones de 003_pistas.sql. Corre sobre un CLON del fixture (el fixture
-- queda intacto y con estado 'completada'), así también se ejercita
-- clonar_corrida -> correr_pistas, que es el camino real de una corrida.
-- =====================================================================

-- Corrida de pistas: clon del fixture, queda 'lista'
do $$
declare v uuid;
begin
  select id into v from forense.corridas where nombre = 'pistas: clon del fixture';
  if v is null then
    v := forense.clonar_corrida('00000000-0000-4000-8000-000000000001'::uuid, 'pistas: clon del fixture');
  end if;
  create temp table if not exists t_corrida (id uuid);
  delete from t_corrida;
  insert into t_corrida values (v);
end $$;

-- 1. Una corrida no preparada no se evalúa
do $$
declare r jsonb;
begin
  r := forense.correr_pistas('00000000-0000-4000-8000-000000000001'::uuid);
  perform pruebas.assert('correr_pistas rechaza una corrida no preparada (fixture completada)',
    (r->>'error') = 'corrida no preparada', r::text);
end $$;

-- 2. Barrido completo sobre el clon
do $$
declare v uuid; r jsonb; n1 int; n2 int; r2 jsonb;
begin
  select id into v from t_corrida;
  r := forense.correr_pistas(v);
  perform pruebas.assert('correr_pistas evalúa las 5 familias de la corrida',
    (r ? 'D2') and (r ? 'F1') and (r ? 'F2') and (r ? 'R1') and (r ? 'R2') and (r ? 'T1') and (r ? 'E1'),
    r::text);
  -- Segunda entrega ya implementada: ninguna de las 14 puede faltar del
  -- informe. O trae conteo, o queda declarada en `no_evaluables` con su
  -- motivo (regla: evidencia insuficiente no sube el nivel, se declara).
  perform pruebas.assert('correr_pistas reporta las 14 pistas: con conteo o declaradas no evaluables',
    (select bool_and((r ? c) or (r->'no_evaluables' @> to_jsonb(c)))
       from unnest(array['D1','D2','D3','D4','F1','F2','F3','F4',
                         'R1','R2','R3','T1','T2','E1']) c),
    r::text);
  perform pruebas.assert('las 7 pistas de la segunda entrega están cableadas en correr_pistas',
    (select count(*) from unnest(array['D1','D3','D4','F3','F4','R3','T2']) c
      where (r ? c) or (r->'no_evaluables' @> to_jsonb(c))) = 7, r::text);
  perform pruebas.assert('la corrida queda reclamada en procesando',
    (select estado from forense.corridas where id = v) = 'procesando', '');

  perform pruebas.assert('R2 detecta el ciclo del fixture',
    (r->>'R2')::int >= 3, 'R2=' || (r->>'R2'));
  perform pruebas.assert('R1 detecta el domicilio compartido',
    (r->>'R1')::int >= 3, 'R1=' || (r->>'R1'));
  perform pruebas.assert('E1 detecta el RFC publicado en 69-B',
    (r->>'E1')::int >= 1, 'E1=' || (r->>'E1'));
  perform pruebas.assert('T1 detecta el ciclo de vida corto con silencio',
    (r->>'T1')::int >= 1, 'T1=' || (r->>'T1'));

  -- 3. Dos ejecuciones no duplican resultados
  select count(*) into n1 from forense.pistas where corrida_id = v;
  r2 := forense.correr_pistas(v);
  perform pruebas.assert('una segunda evaluación concurrente queda bloqueada',
    (r2->>'error') = 'corrida no preparada', r2::text);
  r2 := forense.correr_pistas(v, true);
  select count(*) into n2 from forense.pistas where corrida_id = v;
  perform pruebas.assert('reejecutar el barrido no duplica pistas (huella + ON CONFLICT)',
    n1 = n2, 'antes=' || n1 || ' despues=' || n2);
end $$;

-- 4. R2: el ciclo se cuenta una sola vez pese a las rotaciones
do $$
declare v uuid; n_claves int; n_filas int;
begin
  select id into v from t_corrida;
  select count(distinct huella), count(*) into n_claves, n_filas
    from forense.pistas where corrida_id = v and codigo = 'R2';
  perform pruebas.assert('R2 normaliza la rotación del ciclo (una fila por RFC miembro, un solo hallazgo)',
    n_filas >= 3 and n_claves = n_filas, 'filas=' || n_filas || ' huellas=' || n_claves);

  perform pruebas.assert('R2 cita los UUID de la ruta',
    (select jsonb_array_length(detalle->'uuids') from forense.pistas
      where corrida_id = v and codigo = 'R2' limit 1) = 3, '');
end $$;

-- 5. E1: contrato de campos que consume score_entidad, y trampa desvirtuado
do $$
declare v uuid; n int;
begin
  select id into v from t_corrida;
  perform pruebas.assert('E1 publica estatus y saltos (contrato de score_entidad en docs/06)',
    (select bool_and((detalle ? 'estatus') and (detalle ? 'saltos'))
       from forense.pistas where corrida_id = v and codigo = 'E1'), '');

  -- una entidad desvirtuada no se marca
  insert into forense.listas_sat (corrida_id, rfc, lista, estatus, fecha_publicacion, oficio, razon_social)
  values (v, 'DEMO:ENTIDAD-2', '69B', 'desvirtuado', '2025-06-01', 'DEMO-DESV', 'Ferretería Demo Dos SA de CV')
  on conflict do nothing;
  perform forense.pista_e1(v);
  select count(*) into n from forense.pistas
   where corrida_id = v and codigo = 'E1' and rfc = 'DEMO:ENTIDAD-2' and estado = 'disparada';
  perform pruebas.assert('E1 no marca a un RFC con estatus desvirtuado (trampa legítima)', n = 0, 'n=' || n);
end $$;

-- 6. Regla de dos familias en la entrada
do $$
declare v uuid; n int; n_despacho int;
begin
  select id into v from t_corrida;
  select count(*) into n from forense.score_entidad(v);
  perform pruebas.assert('score_entidad devuelve candidatos con dos familias', n >= 1, 'n=' || n);

  select count(*) into n_despacho from forense.score_entidad(v) s where s.rfc = 'DEMO:ENTIDAD-1';
  perform pruebas.assert('el despacho contable (solo R1) NO entra por el selector automático',
    n_despacho = 0, 'docs/04: entra por /investigar explícito, no por dos familias');

  perform pruebas.assert('R1 publica el discriminador de facturación interna del grupo',
    (select bool_and((detalle ? 'se_facturan_entre_si') and (detalle ? 'pct_monto_interno'))
       from forense.pistas where corrida_id = v and codigo = 'R1'), '');
end $$;

-- 7. Degradación honesta: familias no evaluables
do $$
declare v uuid; r jsonb; n_ne int; n_disp int;
begin
  v := forense.clonar_corrida('00000000-0000-4000-8000-000000000001'::uuid, 'pistas: solo familia F');
  update forense.corridas set familias_evaluables = '{F}' where id = v;
  r := forense.correr_pistas(v);
  select count(*) into n_ne from forense.pistas
   where corrida_id = v and estado = 'no_evaluable';
  select count(*) into n_disp from forense.pistas
   where corrida_id = v and estado = 'disparada' and familia <> 'F';
  perform pruebas.assert('con familias_evaluables={F} el resto queda no_evaluable con motivo',
    n_ne > 0 and n_disp = 0, 'no_evaluables=' || n_ne || ' disparadas_no_F=' || n_disp);
  perform pruebas.assert('las pistas no evaluables llevan motivo para mostrarlas tachadas',
    (select bool_and(detalle ? 'motivo') from forense.pistas
      where corrida_id = v and estado = 'no_evaluable'), '');
  delete from forense.corridas where id = v;
end $$;

-- 8. Higiene: las pistas no dependen de texto libre ni de ground_truth
do $$
declare n_txt int; n_gt int;
begin
  -- Se mira el CÓDIGO, no los comentarios: un comentario que menciona una
  -- columna no la lee, y un guardia que confunde prosa con lectura acaba
  -- ignorándose. Lo que no puede aparecer es la columna dentro de una consulta.
  select count(*) into n_txt
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'forense' and p.proname like 'pista\_%'
     and (regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\mdescripcion\M'
       or regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\mrazon_social\M'
       or regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\mreferencia\M');
  perform pruebas.assert('ninguna pista usa texto libre (descripcion/razon_social/referencia)',
    n_txt = 0, 'funciones=' || n_txt);

  select count(*) into n_gt
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'forense' and (p.proname like 'pista\_%' or p.proname = 'correr_pistas'
                                     or p.proname = 'score_entidad')
     and p.prosrc ilike '%ground_truth%';
  perform pruebas.assert('ninguna pista ni el selector tocan ground_truth', n_gt = 0, 'funciones=' || n_gt);
end $$;

-- 9. Rastro en bitácora
do $$
declare v uuid; n int;
begin
  select id into v from t_corrida;
  select count(*) into n from forense.bitacora
   where corrida_id = v and tipo_evento = 'pista_cargada'
     and payload->>'evento_real' = 'correr_pistas';
  perform pruebas.assert('correr_pistas deja rastro en bitácora (regla 2)', n >= 1, 'n=' || n);
end $$;

-- 10. R2: en una CADENA todos los eslabones reciben la pista.
--     En un ciclo la ruta repite el origen al final y ese duplicado se
--     descarta; en una cadena el último nodo es un miembro distinto y si se
--     descarta, el final de la cadena (justo el que recibe el dinero) queda
--     sin pista. Se prueba con una cadena propia, sin tocar el fixture.
do $$
declare v uuid; n_miembros int; n_ultimo int;
begin
  v := forense.clonar_corrida('00000000-0000-4000-8000-000000000001'::uuid,
                              'pistas: cadena de 4 saltos');
  insert into forense.contribuyentes (corrida_id, rfc, razon_social, giro, fecha_alta)
  select v, 'DEMO:CAD-' || i, 'Eslabón ' || i, 'construccion', date '2019-01-15'
    from generate_series(1, 5) as g(i)
  on conflict do nothing;

  insert into forense.cfdi (corrida_id, uuid, tipo, emisor_rfc, receptor_rfc, fecha,
                            subtotal, iva, total, moneda, metodo_pago, cancelado)
  select v,
         ('00000000-0000-4000-b000-00000000000' || i)::uuid, 'I',
         'DEMO:CAD-' || i, 'DEMO:CAD-' || (i + 1),
         (date '2025-09-02' + ((i - 1) * 5))::timestamptz,
         round((1000000 * power(0.94, i - 1)) / 1.16, 2),
         round((1000000 * power(0.94, i - 1)) - (1000000 * power(0.94, i - 1)) / 1.16, 2),
         round((1000000 * power(0.94, i - 1))::numeric, 2),
         'MXN', 'PUE', false
    from generate_series(1, 4) as g(i);

  perform forense.pista_r2(v);

  select count(distinct rfc) into n_miembros from forense.pistas
   where corrida_id = v and codigo = 'R2' and detalle->>'tipo' = 'cadena'
     and rfc like 'DEMO:CAD-%';
  select count(*) into n_ultimo from forense.pistas
   where corrida_id = v and codigo = 'R2' and detalle->>'tipo' = 'cadena'
     and rfc = 'DEMO:CAD-5';

  perform pruebas.assert('R2 marca a los cinco eslabones de una cadena de 4 saltos',
    n_miembros = 5, 'miembros=' || n_miembros);
  perform pruebas.assert('R2 no deja fuera al último eslabón de la cadena',
    n_ultimo >= 1, 'el nodo que recibe el dinero también es miembro del hallazgo');

  delete from forense.corridas where id = v;
end $$;

-- 11. Contrato de pista (contracts/schemas/entities.schema.json, entities.pista).
--     005 proyectará cada fila como {id, corrida_id, codigo, familia, rfc, score,
--     estado, resumen, referencias}. Si 003 no guarda 'resumen' y 'referencias',
--     005 tendría que inventarlos. Estas aserciones replican en SQL las
--     restricciones del schema para que una pista nueva no se salte el contrato.
do $$
declare v uuid; n int;
begin
  select id into v from t_corrida;

  select count(*) into n from forense.pistas
   where corrida_id = v and coalesce(btrim(detalle->>'resumen'), '') = '';
  perform pruebas.assert('toda pista trae resumen no vacío (contrato entities.pista)',
    n = 0, 'sin resumen=' || n);

  select count(*) into n from forense.pistas
   where corrida_id = v and length(detalle->>'resumen') > 1200;
  perform pruebas.assert('el resumen cabe en el máximo del contrato (1200)', n = 0, 'largos=' || n);

  select count(*) into n from forense.pistas
   where corrida_id = v and jsonb_typeof(detalle->'referencias') is distinct from 'array';
  perform pruebas.assert('toda pista trae referencias como arreglo', n = 0, 'sin arreglo=' || n);

  select count(*) into n from forense.pistas p,
       lateral jsonb_array_elements_text(p.detalle->'referencias') r
   where p.corrida_id = v and r !~ '^(CFDI|MOV|ATR|LISTA|CICLO|PAR):[^[:space:]]+$';
  perform pruebas.assert('cada referencia usa el espacio de nombres del contrato',
    n = 0, 'fuera de patrón=' || n);

  select count(*) into n from forense.pistas
   where corrida_id = v and jsonb_array_length(detalle->'referencias') > 40;
  perform pruebas.assert('ninguna pista cita más de 40 referencias (tope del contrato)',
    n = 0, 'excedidas=' || n);

  select count(*) into n from forense.pistas
   where corrida_id = v and (score < 0 or score > 1);
  perform pruebas.assert('score dentro de [0,1] como exige el contrato', n = 0, 'fuera=' || n);

  -- el resumen es texto que redacta el código, no texto del contribuyente
  select count(*) into n from forense.pistas p
   where p.corrida_id = v
     and exists (select 1 from forense.cfdi f
                  where f.corrida_id = v and f.descripcion is not null
                    and length(f.descripcion) > 12
                    and position(f.descripcion in (p.detalle->>'resumen')) > 0);
  perform pruebas.assert('ningún resumen copia texto libre del contribuyente', n = 0, 'copias=' || n);
end $$;
