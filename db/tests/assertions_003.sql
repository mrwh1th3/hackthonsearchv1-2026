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
  perform pruebas.assert('correr_pistas declara las pistas de la segunda entrega como pendientes',
    jsonb_array_length(r->'pendientes_segunda_entrega') = 7, (r->'pendientes_segunda_entrega')::text);
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
  select count(*) into n_txt
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'forense' and p.proname like 'pista\_%'
     and (p.prosrc ~* '\mdescripcion\M' or p.prosrc ~* '\mrazon_social\M' or p.prosrc ~* '\mreferencia\M');
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
