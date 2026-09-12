-- =====================================================================
-- db/009_runtime_eventos.sql — Ajustes que pide el runtime de n8n (17)
-- sobre 001–008, que ya están aplicadas al proyecto remoto.
--
-- ADITIVA: no borra ni redefine nada de 001–008 salvo el CHECK de
-- `bitacora.tipo_evento`, que se vuelve a declarar completo (Postgres no
-- sabe ampliar un CHECK in situ) conservando el catálogo anterior.
--
-- 1. `paso_en_cola` y `paso_checkpoint` — los emiten los nodos
--    «Registrar en_cola» y «Registrar paso guardado» de
--    FORENSE_ejecutar_agente. Sin ellos el worker no puede dejar rastro
--    de un paso encolado ni de un checkpoint guardado, y por la regla 2
--    un paso sin evento en `forense.bitacora` no existió. Los dos
--    valores vienen del contrato product.schema.json v1.2.1
--    (bitacora.tipo_evento), no de una decisión local.
--
-- 2. Catálogo ClaveProdServ por giro. Estaba en `db/seeds/`, que no se
--    aplica al remoto, y la pista D1 se degrada a `no_evaluable` sin él:
--    la corrección de una pista no puede depender de un seed manual
--    (verificado ≠ fixture). Aquí va versionado por `version_reglas`,
--    no por corrida, que es como lo consulta forense.hay_catalogo_giros.
--
-- Idempotente: reaplicable sobre una base ya migrada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo de tipos de evento (contracts v1.2.1)
-- ---------------------------------------------------------------------

alter table forense.bitacora drop constraint if exists ck_bitacora_tipo_evento;
alter table forense.bitacora add constraint ck_bitacora_tipo_evento check (
  tipo_evento is null or tipo_evento in (
    'caso_creado','cluster_armado','pista_cargada','ronda_inicio','ronda_fin',
    'razonamiento','tool_call','tool_result','senal_escrita','senal_leida',
    'despertar','frontera_detectada','cluster_expandido',
    'auditoria','defensa_inicio','defensa_argumento','replica',
    'validacion','evidencia_descartada','dictamen',
    'rechazo_auditor_final','reintento_inicio',
    'redaccion_inicio','redaccion_fin','edicion',
    'error','presupuesto_agotado',
    'inyeccion','corrida_cargada',
    'paso_en_cola','paso_checkpoint'
  )
);

-- ---------------------------------------------------------------------
-- 2. Catálogo ClaveProdServ por giro para la versión de reglas vigente.
--    Fuente: generator/giros.py. La clave primaria es
--    (version_reglas, giro, clave_prod_serv): el ON CONFLICT lo hace
--    reaplicable y no pisa catálogos de otras versiones de reglas.
-- ---------------------------------------------------------------------

insert into forense.catalogo_giro_claves (version_reglas, giro, clave_prod_serv)
select v.version_reglas, c.giro, c.clave
  from (values ('pistas-1')) as v(version_reglas)
  cross join (values
  ('comercializadora','31162800'),
  ('comercializadora','43211500'),
  ('comercializadora','43211900'),
  ('comercializadora','44103100'),
  ('construccion','72102900'),
  ('construccion','72141100'),
  ('construccion','72151500'),
  ('consultoria','80101500'),
  ('consultoria','80101600'),
  ('consultoria','80101700'),
  ('despacho_contable','80121600'),
  ('despacho_contable','84111500'),
  ('despacho_contable','84111600'),
  ('manufactura','23153000'),
  ('manufactura','25174800'),
  ('manufactura','31162800'),
  ('marketing','82101500'),
  ('marketing','82101600'),
  ('marketing','82121500'),
  ('restaurante','90101500'),
  ('restaurante','90101600'),
  ('restaurante','90151800'),
  ('servicios_personal','80111500'),
  ('servicios_personal','80111600'),
  ('servicios_personal','80111700'),
  ('tecnologia','43232700'),
  ('tecnologia','81111500'),
  ('tecnologia','81111800'),
  ('transporte','78101700'),
  ('transporte','78101800'),
  ('transporte','78141500')
) as c(giro, clave)
on conflict (version_reglas, giro, clave_prod_serv) do nothing;

-- Corridas ya cargadas con otra `version_reglas` (por ejemplo un snapshot
-- clonado antes de esta migración) heredan el mismo catálogo: sin esto D1
-- quedaría `no_evaluable` en corridas viejas por un detalle de versionado.
insert into forense.catalogo_giro_claves (version_reglas, giro, clave_prod_serv)
select r.version_reglas, c.giro, c.clave_prod_serv
  from (select distinct version_reglas from forense.corridas
         where version_reglas is not null and version_reglas <> 'pistas-1') r
  cross join (select giro, clave_prod_serv from forense.catalogo_giro_claves
               where version_reglas = 'pistas-1') c
on conflict (version_reglas, giro, clave_prod_serv) do nothing;
