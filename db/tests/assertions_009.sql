-- Aserciones de db/009_runtime_eventos.sql.
-- Se aplican sobre la misma base de prueba que el resto: no tocan 'forense'.
set search_path = '';

do $$
declare
  v_caso uuid;
  v_corrida uuid;
  v_ok boolean;
  n int;
  v_def text;
begin
  select id into v_corrida from forense.corridas order by id limit 1;
  select id into v_caso from forense.casos order by id limit 1;

  -- 1. Los dos tipos nuevos del runtime se aceptan.
  begin
    insert into forense.bitacora (caso_id, corrida_id, seq, tipo_evento, payload)
    values (v_caso, v_corrida, forense.next_seq(v_caso), 'paso_en_cola',
            jsonb_build_object('resumen','prueba 009'));
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pruebas.assert('bitacora acepta tipo_evento=paso_en_cola (contracts 1.2.1)', v_ok, '');

  begin
    insert into forense.bitacora (caso_id, corrida_id, seq, tipo_evento, payload)
    values (v_caso, v_corrida, forense.next_seq(v_caso), 'paso_checkpoint',
            jsonb_build_object('resumen','prueba 009'));
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pruebas.assert('bitacora acepta tipo_evento=paso_checkpoint (contracts 1.2.1)', v_ok, '');

  -- 2. Sigue siendo un catálogo cerrado: 009 amplía, no abre.
  begin
    insert into forense.bitacora (caso_id, corrida_id, seq, tipo_evento, payload)
    values (v_caso, v_corrida, forense.next_seq(v_caso), 'paso_inventado', '{}'::jsonb);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pruebas.assert('tras 009 el check sigue rechazando un tipo_evento fuera del catálogo',
    v_ok, '');

  -- 3. 009 es aditiva: conserva los 29 valores previos y suma 2.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'ck_bitacora_tipo_evento';
  perform pruebas.assert('009 conserva el catálogo previo de tipo_evento',
    v_def like '%corrida_cargada%' and v_def like '%inyeccion%'
      and v_def like '%presupuesto_agotado%' and v_def like '%dictamen%'
      and v_def like '%paso_en_cola%' and v_def like '%paso_checkpoint%',
    'def=' || coalesce(left(v_def, 60), 'null'));

  select count(*) into n
    from regexp_matches(v_def, '''([a-z_]+)''', 'g');
  perform pruebas.assert('el catálogo de tipo_evento tiene los 31 valores de contracts 1.2.1',
    n = 31, 'valores=' || n);

  -- 4. Catálogo de giros: 009 lo deja en la base, no en un seed manual.
  select count(*) into n from forense.catalogo_giro_claves where version_reglas = 'pistas-1';
  perform pruebas.assert('009 carga el catálogo ClaveProdServ de la versión de reglas vigente',
    n >= 30, 'claves pistas-1=' || n);

  select count(distinct giro) into n
    from forense.catalogo_giro_claves where version_reglas = 'pistas-1';
  perform pruebas.assert('el catálogo cubre todos los giros de generator/giros.py',
    n >= 8, 'giros=' || n);

  -- 5. Reaplicar 009 no duplica (la PK + ON CONFLICT lo garantizan).
  select count(*) into n from (
    select version_reglas, giro, clave_prod_serv
      from forense.catalogo_giro_claves
     group by 1,2,3 having count(*) > 1) d;
  perform pruebas.assert('el catálogo de giros no tiene filas duplicadas', n = 0, 'dups=' || n);
end $$;
