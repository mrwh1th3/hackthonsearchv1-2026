-- =====================================================================
-- Aserciones de db/013_rendimiento.sql que no dependen de datos.
-- La equivalencia de F1 vive en assertions_013_gen.sql.
-- =====================================================================

set search_path = '';

-- Los índices de apoyo existen (si el nombre cambia, el plan medido en
-- db/README.md deja de ser el que corre).
do $$
declare falta text := '';
begin
  foreach falta in array array['ix_pistas_corrida_estado_rfc','ix_cfdi_ventana',
                               'ix_cfdi_par','ix_mov_corrida_fecha'] loop
    if not exists (select 1 from pg_indexes where schemaname = 'forense' and indexname = falta) then
      perform pruebas.assert('013 crea el índice ' || falta, false, 'no existe');
    else
      perform pruebas.assert('013 crea el índice ' || falta, true, '');
    end if;
  end loop;
end $$;
