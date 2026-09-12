do $$
declare n_total int; n_distintos int; v_max int; n_workers int; n_ok int; n_carrera int;
begin
  select count(*), count(distinct valor), coalesce(max(valor),0), count(distinct worker)
    into n_total, n_distintos, v_max, n_workers
    from pruebas.seq_concurrencia;

  perform pruebas.assert('next_seq: varias sesiones concurrentes participaron',
    n_workers >= 2, 'workers=' || n_workers);
  perform pruebas.assert('next_seq es atómico: ningún valor repetido bajo concurrencia',
    n_total > 0 and n_distintos = n_total, 'total=' || n_total || ' distintos=' || n_distintos);
  perform pruebas.assert('next_seq no deja huecos: max = número de llamadas',
    v_max = n_total, 'max=' || v_max || ' total=' || n_total);

  select count(*) filter (where ok), count(*) into n_ok, n_carrera from pruebas.lease_carrera;
  perform pruebas.assert('dos dueños concurrentes reclaman el mismo lease y solo uno gana',
    n_carrera >= 2 and n_ok = 1, 'intentos=' || n_carrera || ' ganadores=' || n_ok);
end $$;
