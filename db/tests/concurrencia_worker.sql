-- Worker de concurrencia: 20 incrementos de next_seq, cada uno en su propia
-- transacción (COMMIT dentro del bloque), para que varias sesiones se
-- intercalen de verdad. El identificador del worker es el PID del backend.
do $$
declare i int;
begin
  for i in 1..20 loop
    insert into pruebas.seq_concurrencia (worker, valor)
    values (pg_backend_pid()::text,
            forense.next_seq('00000000-0000-4000-8000-0000000009c2'));
    commit;
  end loop;
end $$;

-- Carrera por el mismo lease de cluster desde sesiones distintas
insert into pruebas.lease_carrera (owner, ok, detalle)
select pg_backend_pid()::text,
       coalesce((r->>'ok')::boolean, false),
       r
  from forense.lease_cluster_adquirir('00000000-0000-4000-8000-0000000009b2',
                                      'carrera-' || pg_backend_pid()::text, 90) as r;
