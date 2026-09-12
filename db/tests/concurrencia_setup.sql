-- Caso desechable para medir next_seq bajo concurrencia (no es el del fixture:
-- así el máximo esperado es exactamente N*M).
insert into forense.casos (id, corrida_id, cluster_id, rfc_principal, estado)
values ('00000000-0000-4000-8000-0000000009c2','00000000-0000-4000-8000-0000000009a1',
        '00000000-0000-4000-8000-0000000009b1','PRUEBA:SEQ','en_cola')
on conflict (id) do nothing;

update forense.casos set bitacora_seq = 0 where id = '00000000-0000-4000-8000-0000000009c2';
truncate pruebas.seq_concurrencia;

-- Cluster desechable para la carrera de leases
insert into forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado)
values ('00000000-0000-4000-8000-0000000009b2','00000000-0000-4000-8000-0000000009a1',
        '{PRUEBA:2}','PRUEBA:2',1,1.0,'prueba-cluster-carrera','pendiente')
on conflict (id) do nothing;

update forense.clusters set lease_owner = null, lease_expires_at = null
 where id = '00000000-0000-4000-8000-0000000009b2';

create table if not exists pruebas.lease_carrera (owner text, ok boolean, detalle jsonb);
truncate pruebas.lease_carrera;
