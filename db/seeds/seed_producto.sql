-- =====================================================================
-- db/seeds/seed_producto.sql — Fixture de PRODUCTO (16 §5): perfil demo,
-- historial de investigaciones, vistas guardadas, notificaciones y
-- actividad. Requiere 006 + 007 aplicadas y db/seeds/seed_fake.sql cargado
-- (usa sus tres casos).
--
-- Se ejecuta A MANO, nunca automáticamente en producción:
--   psql -d forense -f db/seeds/seed_producto.sql
--
-- Reglas del fixture:
--   * El perfil demo NO tiene teléfono y tiene las llamadas desactivadas:
--     así la UI muestra el camino "notificación in-app + llamada omitida"
--     sin que exista ningún número real (16 §7).
--   * CERO filas en forense.llamadas_notificacion. Ninguna llamada, ni
--     simulada: lo que se ve en la UI como "Simulada" se etiqueta ahí.
--   * IDs estables e inserciones idempotentes: reaplicar no duplica.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Perfil demo compartido (no finge identidad individual fuerte)
-- ---------------------------------------------------------------------
insert into forense.perfiles (
  id, nombre, organizacion, correo, telefono_e164, timezone,
  preferencias, llamadas_activadas, permiso_aviso, demo_compartido)
values (
  '00000000-0000-4000-8000-0000000006a1', 'Equipo Forense (demo)',
  'Hackathon Infosys', 'demo@forense.invalid', null, 'America/Monterrey',
  '{"tema":"oscuro","densidad":"comoda"}'::jsonb, false, false, true)
on conflict (id) do update
  set nombre = excluded.nombre,
      organizacion = excluded.organizacion,
      correo = excluded.correo,
      telefono_e164 = null,          -- el fixture nunca guarda un número
      llamadas_activadas = false,
      permiso_aviso = false,
      actualizado = now();

-- ---------------------------------------------------------------------
-- Expedientes del fixture: uno validado (entregable) y uno en borrador
-- ---------------------------------------------------------------------
update forense.expedientes
   set estado_revision = 'validado',
       contenido_json = jsonb_build_object(
         'type', 'doc',
         'content', jsonb_build_array(
           jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', 1),
             'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Expediente de demostración'))),
           jsonb_build_object('type', 'paragraph',
             'content', jsonb_build_array(jsonb_build_object('type', 'text',
               'text', 'Contenido de fixture. No es una investigación real.'))))),
       actualizado = now()
 where caso_id = '00000000-0000-4000-8000-000000000100';

-- ---------------------------------------------------------------------
-- Historial de investigaciones (15 §Historial)
-- ---------------------------------------------------------------------
insert into forense.investigaciones (
  id, perfil_id, modo, corrida_id, caso_id, manifiesto, estado, mensaje,
  idempotency_key, reporte_manifest, version_entregada, creado, completada_at)
values
  ('00000000-0000-4000-8000-0000000006b1', '00000000-0000-4000-8000-0000000006a1',
   'caso', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '{"objetivos":[{"caso_id":"00000000-0000-4000-8000-000000000100"}]}'::jsonb,
   'investigacion_completa', 'Revisar el cluster de ENTIDAD-0',
   'seed-producto-inv-1',
   '[{"caso_id":"00000000-0000-4000-8000-000000000100","version":1,"estado_revision":"validado"}]'::jsonb,
   1, now() - interval '3 hours', now() - interval '2 hours'),

  ('00000000-0000-4000-8000-0000000006b2', '00000000-0000-4000-8000-0000000006a1',
   'caso', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101',
   '{"objetivos":[{"caso_id":"00000000-0000-4000-8000-000000000101"}]}'::jsonb,
   'parcial', 'Despacho contable: confirmar la explicación',
   'seed-producto-inv-2', '[]'::jsonb, null, now() - interval '90 minutes', null),

  ('00000000-0000-4000-8000-0000000006b3', '00000000-0000-4000-8000-0000000006a1',
   'corrida', '00000000-0000-4000-8000-000000000001', null,
   '{"objetivos":[]}'::jsonb, 'investigando', 'Barrido completo del snapshot de demostración',
   'seed-producto-inv-3', '[]'::jsonb, null, now() - interval '20 minutes', null)
on conflict (id) do update
  set estado = excluded.estado, mensaje = excluded.mensaje,
      reporte_manifest = excluded.reporte_manifest,
      version_entregada = excluded.version_entregada,
      completada_at = excluded.completada_at, actualizado = now();

-- ---------------------------------------------------------------------
-- Outbox + notificación de la investigación ya completa.
-- Se insertan explícitamente (el trigger solo actúa en UPDATE de estado)
-- para que el fixture muestre el camino completo sin ejecutar la transición.
-- ---------------------------------------------------------------------
insert into forense.eventos_salida (id, investigacion_id, tipo, estado, intentos, payload)
values ('00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000006b1',
        'investigacion.completa', 'entregado', 1,
        jsonb_build_object('investigacion_id', '00000000-0000-4000-8000-0000000006b1',
                           'modo', 'caso', 'n_reportes', 1, 'fixture', true))
on conflict (investigacion_id, tipo) do update
  set estado = excluded.estado, payload = excluded.payload, actualizado = now();

insert into forense.notificaciones (id, perfil_id, event_id, tipo, recurso, titulo, cuerpo, leida_at)
values ('00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000006a1',
        '00000000-0000-4000-8000-0000000007c1', 'investigacion.completa',
        '/investigaciones/00000000-0000-4000-8000-0000000006b1',
        'Tu investigación terminó',
        'El reporte del caso DEMO:ENTIDAD-0 ya está disponible en el historial.', null)
on conflict (perfil_id, event_id, tipo) do update
  set titulo = excluded.titulo, cuerpo = excluded.cuerpo;

insert into forense.notificaciones (id, perfil_id, event_id, tipo, recurso, titulo, cuerpo, leida_at)
values ('00000000-0000-4000-8000-0000000007d2', '00000000-0000-4000-8000-0000000006a1',
        null, 'llamada.omitida', '/perfil',
        'Aviso por llamada omitido',
        'El perfil de demostración no tiene teléfono configurado ni llamadas activadas.',
        now() - interval '100 minutes')
on conflict (id) do nothing;

-- Ninguna llamada: el fixture no marca teléfonos (16 §7).
delete from forense.llamadas_notificacion
 where event_id = '00000000-0000-4000-8000-0000000007c1';

-- ---------------------------------------------------------------------
-- Vistas guardadas y actividad
-- ---------------------------------------------------------------------
insert into forense.vistas_guardadas (id, perfil_id, nombre, ruta, filtros, visualizacion)
values
  ('00000000-0000-4000-8000-0000000006e1', '00000000-0000-4000-8000-0000000006a1',
   'Presunción alta del snapshot demo', '/casos',
   '{"nivel":["presuncion","presuncion_alta"],"corrida":"00000000-0000-4000-8000-000000000001"}'::jsonb,
   '{"orden":"score_desc","columnas":["rfc","nivel","tipologia","monto_en_riesgo"]}'::jsonb),
  ('00000000-0000-4000-8000-0000000006e2', '00000000-0000-4000-8000-0000000006a1',
   'Trampas legítimas', '/entidades',
   '{"solo_trampas":true}'::jsonb,
   '{"orden":"rfc","columnas":["rfc","giro","pistas"]}'::jsonb)
on conflict (id) do update
  set filtros = excluded.filtros, visualizacion = excluded.visualizacion, actualizado = now();

insert into forense.propuestas_edicion (
  id, caso_id, perfil_id, version_base, seleccion, mensaje, modo, patch, diff, citas,
  estado, request_id, creado)
values ('00000000-0000-4000-8000-0000000006f1', '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-0000000006a1', 1,
        'El cluster comparte domicilio.',
        'Agrega el número de facturas internas a esa frase.', 'propuesta',
        '{"type":"doc","content":[]}'::jsonb,
        '{"antes":"El cluster comparte domicilio.","despues":"El cluster comparte domicilio y se factura entre sí en 3 CFDI."}'::jsonb,
        '["CFDI:00000000-0000-4000-9000-000000000001"]'::jsonb,
        'propuesta', 'seed-producto-req-1', now() - interval '80 minutes')
on conflict (id) do nothing;

insert into forense.actividad_producto (perfil_id, investigacion_id, caso_id, request_id, evento, metadata, creado)
select '00000000-0000-4000-8000-0000000006a1'::uuid, v.inv::uuid, v.caso::uuid, v.req, v.evento,
       v.meta::jsonb, now() - (v.hace || ' minutes')::interval
  from (values
    ('00000000-0000-4000-8000-0000000006b1','00000000-0000-4000-8000-000000000100','seed-producto-req-0','investigacion_solicitada','{"modo":"caso"}','185'),
    ('00000000-0000-4000-8000-0000000006b1','00000000-0000-4000-8000-000000000100',null,'investigacion_completa','{"fixture":true}','120'),
    ('00000000-0000-4000-8000-0000000006b1','00000000-0000-4000-8000-000000000100','seed-producto-req-1','reporte_propuesto','{"propuesta_id":"00000000-0000-4000-8000-0000000006f1"}','80'),
    (null,'00000000-0000-4000-8000-000000000100',null,'reporte_exportado','{"formato":"pdf"}','60')
  ) as v(inv, caso, req, evento, meta, hace)
 where not exists (
   select 1 from forense.actividad_producto a
    where a.perfil_id = '00000000-0000-4000-8000-0000000006a1'
      and a.evento = v.evento
      and a.request_id is not distinct from v.req);

commit;

-- Comprobación rápida tras aplicar:
--   select count(*) from forense.llamadas_notificacion;  -- debe ser 0
--   select estado, count(*) from forense.investigaciones group by 1;
