# 05 — Esquema de base de datos

Las tablas y utilidades viven en el schema `forense` de un proyecto Supabase dedicado. Las 11 RPC de herramientas se exponen en `public` con permisos restringidos. Postgres 15+.

Convenciones: montos `numeric(14,2)`, fechas `timestamptz`, identificadores de negocio `text`, estructuras variables `jsonb`.

**Contrato de implementación.** Este documento es la especificación de las futuras migraciones, no un archivo SQL listo para ejecutar: los bloques marcados como pseudocódigo requieren implementación y prueba. Las migraciones se aplican una sola vez y en orden; los datasets y fixtures se cargan después con loaders separados.

**Aislamiento por snapshot.** Cada corrida conserva sus propios hechos, incluida la lista SAT utilizada y el ground truth de evaluación. El mismo RFC, CLABE, UUID o ID de movimiento puede existir en varias corridas: su identidad en la base incluye siempre `corrida_id`. Nunca se consulta un hecho por su identificador de negocio sin ese filtro. Una corrida nueva importa o copia un snapshot completo antes de ejecutar pistas; no reutiliza accidentalmente filas de otra corrida ni copia sus resultados.

## 001_schema.sql — Tablas

```sql
create schema if not exists forense;
create extension if not exists pgcrypto;
```

### Control de experimentos

```sql
create table forense.corridas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  dataset       text not null,              -- gen-v1 | ibm-aml-hi-small | ...
  dataset_hash  text not null,              -- hash de los hechos/manifest de entrada, no de los resultados
  fecha_corte   timestamptz not null,       -- fecha de observación fija; ventanas nunca dependen de now()
  corrida_origen_id uuid references forense.corridas(id),
  estado        text not null default 'preparando'
                check (estado in ('preparando','lista','procesando','completada','error')),
  version_prompts text,                     -- hash corto de /n8n/prompts
  version_reglas text,                      -- hash de SQL + dictaminador + configuración de umbrales
  modo          text not null default 'fiscal', -- fiscal | exploratorio_financiero | fixture
  familias_evaluables text[] default '{D,F,R,T,E}',
  inicio        timestamptz default now(),
  fin           timestamptz,
  metricas      jsonb,
  notas         text
);
```

`familias_evaluables` es la degradación honesta: con IBM AML queda en `{F}`.

El loader crea `preparando`, carga hechos y etiquetas, comprueba conteos, claves y hash, y cambia a `lista`. Para comparar prompts, crea otra corrida con `corrida_origen_id`, copia **solo** las tablas de dominio y `ground_truth`, preserva IDs, hash y fecha de corte y termina en `lista`. Pistas, clusters, señales, casos, caché y tareas empiezan vacíos. Si falla la carga, no se habilita la ejecución. El webhook puede usar una corrida `lista` ya cargada o solicitar este clonado; un `INSERT` de metadatos por sí solo no prepara datos.

### Datos del dominio (los llenan los loaders)

```sql
create table forense.catalogo_giro_claves (
  version_reglas text not null,
  giro           text not null,
  clave_prod_serv text not null,
  primary key (version_reglas, giro, clave_prod_serv)
);

create table forense.contribuyentes (
  rfc           text not null,
  razon_social  text,
  giro          text,
  tipo_persona  text,                        -- moral | fisica
  fecha_alta    date,
  domicilio     text,
  cp            text,
  representante text,
  email         text,
  telefono      text,
  empleados_declarados int,
  corrida_id    uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, rfc)
);
create index on forense.contribuyentes (corrida_id, giro);

create table forense.cuentas (
  clabe        text not null,
  rfc_titular  text,
  banco        text,
  tipo         text,                         -- moral | fisica | efectivo
  moneda       text,                         -- dato fuente; no asumir MXN en IBM AML
  saldo_inicial numeric(14,2),               -- nullable: sin saldo inicial no hay saldo medio comprobable
  fecha_saldo_inicial timestamptz,
  corrida_id   uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, clabe)
);
create index on forense.cuentas (corrida_id, rfc_titular);

create table forense.cfdi (
  uuid            uuid not null,
  tipo            text,                      -- I ingreso | E egreso | P pago | N nomina
  emisor_rfc      text,
  receptor_rfc    text,
  fecha           timestamptz,
  subtotal        numeric(14,2),
  iva             numeric(14,2),
  total           numeric(14,2),
  moneda          text,
  metodo_pago     text,                      -- PUE | PPD
  forma_pago      text,
  uso_cfdi        text,
  clave_prod_serv text,
  descripcion     text,                      -- UNTRUSTED
  cancelado       boolean default false,
  fecha_cancelacion timestamptz,
  motivo_cancelacion text,
  uuid_sustituye  uuid,
  corrida_id      uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, uuid)
);
create index on forense.cfdi (corrida_id, emisor_rfc, fecha);
create index on forense.cfdi (corrida_id, receptor_rfc, fecha);
create index on forense.cfdi (corrida_id, tipo);

create table forense.complementos_pago (
  uuid_pago  uuid,
  uuid_cfdi  uuid not null,
  fecha      timestamptz,
  monto      numeric(14,2),
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, uuid_pago, uuid_cfdi),
  foreign key (corrida_id, uuid_cfdi) references forense.cfdi(corrida_id, uuid) on delete cascade
);

create table forense.movimientos (
  id             bigint not null,             -- ID estable asignado por loader; se conserva al clonar
  cuenta_origen  text,
  cuenta_destino text,
  fecha          timestamptz,
  monto          numeric(14,2),
  moneda         text,                       -- ciclos y conservación comparan la misma moneda
  tipo           text,                       -- transferencia | efectivo | cheque
  referencia     text,                       -- UNTRUSTED
  corrida_id     uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, id)
);
create index on forense.movimientos (corrida_id, cuenta_origen, fecha);
create index on forense.movimientos (corrida_id, cuenta_destino, fecha);

create table forense.atributos_entidad (
  rfc       text,
  atributo  text,                            -- domicilio | representante | email | telefono | clabe | grupo | contrato_factoraje
  valor     text,
  fuente    text,
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, rfc, atributo, valor)
);
create index on forense.atributos_entidad (corrida_id, atributo, valor);

create table forense.listas_sat (
  rfc                text,
  lista              text,                   -- 69 | 69B | 69B-Bis
  estatus            text,                   -- presunto | definitivo | desvirtuado | sentencia_favorable
  fecha_publicacion  date,
  oficio             text,
  razon_social       text,
  corrida_id         uuid not null references forense.corridas(id) on delete cascade,
  primary key (corrida_id, rfc, lista, estatus, fecha_publicacion)
);

create table forense.ground_truth (
  rfc                 text,
  corrida_id          uuid not null references forense.corridas(id) on delete cascade,
  es_fraude           boolean,
  tipologia           text,
  es_trampa_legitima  boolean default false,
  nota                text,
  primary key (rfc, corrida_id)
);
```

### Capa de detección

```sql
create table forense.pistas (
  id         bigserial primary key,
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  codigo     text,                            -- D1..E1
  familia    text,                            -- D | F | R | T | E
  rfc        text,
  score      numeric,                         -- 0..1
  detalle    jsonb,
  huella     text not null,                   -- hash determinista de código + RFC + IDs/ruta canónica
  estado     text default 'disparada',        -- disparada | no_evaluable; evaluación específica vive en casos
  creado     timestamptz default now(),
  unique (corrida_id, codigo, rfc, huella)
);
create index on forense.pistas (corrida_id, rfc);
create index on forense.pistas (corrida_id, codigo);

create table forense.clusters (
  id           uuid primary key default gen_random_uuid(),
  corrida_id   uuid not null references forense.corridas(id) on delete cascade,
  rfcs         text[],
  rfc_semilla  text,
  n_rfcs       int,
  n_cfdi       int,
  n_movimientos int,
  score        numeric,                        -- prioridad de procesamiento
  expandido    boolean default false,
  version_contexto int not null default 1,
  lease_owner  text,
  lease_expires_at timestamptz,
  huella       text not null,                   -- hash de RFC ordenados + versión de clustering
  rfcs_frontera text[],
  estado       text default 'pendiente',       -- pendiente | ronda1 | ronda2 | auditando | cerrado | error
  creado       timestamptz default now(),
  unique (corrida_id, huella)
);
create index on forense.clusters (corrida_id, score desc);
```

### El pizarrón

```sql
create table forense.senales (
  id          bigserial primary key,
  cluster_id  uuid references forense.clusters(id) on delete cascade,
  caso_id     uuid,
  ronda       int,                             -- 1 exploración | 2 informada; intento distingue reintentos
  intento     int not null default 0,         -- 0 original; 1 y 2 reintentos dirigidos
  version_contexto int not null default 1,
  idempotency_key text unique,
  familia     text,
  agente      text,                            -- documental | financiero | relacional | temporal | externo
  titular     text,                            -- UNA línea
  detalle     jsonb,                           -- el hallazgo completo, se lee bajo demanda
  rfcs        text[],
  ids         text[],                          -- CFDI:uuid, MOV:id, ATR:clave_compuesta, LISTA:clave_compuesta
  frontera    text[],
  confianza   text,                            -- alta | media | baja
  refuta      boolean default false,
  creado      timestamptz default now()
);
create index on forense.senales (cluster_id, ronda);
```

### Casos y trazabilidad

```sql
create table forense.casos (
  id              uuid primary key default gen_random_uuid(),
  corrida_id      uuid not null references forense.corridas(id) on delete cascade,
  cluster_id      uuid references forense.clusters(id),
  rfc_principal   text,
  rfcs_satelite   text[],
  origen          text,                        -- pipeline | rfc | uuid | pista
  origen_valor    text,
  estado          text default 'en_cola',
  -- en_cola | ronda1 | ronda2 | auditando | defendiendo | replicando | validando | dictaminando | redactando | dictaminado | reintento | error
  nivel           text,                        -- sin_hallazgos | anomalia_explicada | no_concluyente | presuncion | presuncion_alta
  tipologia       text,
  hipotesis       text,
  familias_confirmadas text[],
  evaluacion_pistas jsonb not null default '{}'::jsonb, -- por pista_id: estado, evidencia_ids, motivo
  resultado_por_rfc jsonb not null default '[]'::jsonb, -- rfc, nivel, tipologia, evidencia_ids, cobertura_completa
  monto_en_riesgo numeric(14,2),
  cobertura_completa boolean not null default false,
  pendientes      jsonb default '[]'::jsonb, -- comprobaciones pendientes tipificadas
  conflictos      jsonb default '[]'::jsonb,
  n_reintentos    int default 0,
  motivo_reintento text,
  presupuesto_agotado boolean default false,
  n8n_execution_id text,
  tool_calls      int default 0,
  bitacora_seq    int not null default 0,     -- contador atómico; no max(seq)+1
  tokens_total    int,
  duracion_ms     int,
  creado          timestamptz default now(),
  terminado       timestamptz
);
create index on forense.casos (corrida_id, nivel);
create index on forense.casos (cluster_id);

create table forense.tareas_agente (
  id                 uuid primary key default gen_random_uuid(),
  caso_id            uuid not null references forense.casos(id) on delete cascade,
  corrida_id         uuid not null references forense.corridas(id) on delete cascade,
  cluster_id         uuid not null references forense.clusters(id) on delete cascade,
  agente             text not null,
  ronda              int not null,
  intento            int not null default 0,
  version_contexto   int not null default 1,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente','ejecutando','completada','error','timeout','omitida')),
  idempotency_key     text not null unique,
  n8n_execution_id    text,
  lease_owner        text,
  lease_expires_at   timestamptz,
  iniciado           timestamptz,
  terminado          timestamptz,
  resultado          jsonb,
  error              text,
  unique (caso_id, ronda, intento, agente, version_contexto)
);
create index on forense.tareas_agente (caso_id, ronda, intento, version_contexto, estado);

create table forense.bitacora (
  id          bigserial primary key,
  corrida_id  uuid not null references forense.corridas(id) on delete cascade,
  caso_id     uuid references forense.casos(id) on delete cascade,
  cluster_id  uuid,
  seq         int,
  ronda       int,
  intento     int default 0,
  tarea_id    uuid references forense.tareas_agente(id),
  ts          timestamptz default now(),
  agente      text,
  tipo_evento text,
  payload     jsonb,
  duracion_ms int,
  tokens_in   int,
  tokens_out  int,
  modelo      text
);
create unique index on forense.bitacora (caso_id, seq);
create index on forense.bitacora (cluster_id, ts);
create index on forense.bitacora (corrida_id, id);
```

**`tipo_evento` — enum fijo.** La UI renderiza uno distinto por tipo:

```
caso_creado, cluster_armado, pista_cargada, ronda_inicio, ronda_fin,
razonamiento, tool_call, tool_result, senal_escrita, senal_leida,
despertar, frontera_detectada, cluster_expandido,
auditoria, defensa_inicio, defensa_argumento, replica,
validacion, evidencia_descartada, dictamen,
rechazo_auditor_final, reintento_inicio,
redaccion_inicio, redaccion_fin, edicion,
error, presupuesto_agotado
```

```sql
create table forense.evidencia (
  id              bigserial primary key,
  caso_id         uuid references forense.casos(id) on delete cascade,
  idempotency_key  text unique,
  tipo            text,                        -- cfdi | movimiento | atributo | lista | ciclo | nomina | par
  ref_id          text,
  monto           numeric(14,2),
  pista_id        bigint references forense.pistas(id),
  pista_codigo    text,
  familia         text,
  rfcs_afectados   text[],                     -- atribución explícita; no culpa por pertenecer al cluster
  descripcion     text,
  agente          text,
  ronda           int,
  intento         int not null default 0,
  valida_tecnica  boolean,                     -- existencia + pertenencia + concordancia con datos fuente
  refutada        boolean not null default false, -- decisión de defensa; no se borra al validar IDs
  validada        boolean,                     -- derivada: valida_tecnica AND NOT refutada; null = pendiente
  hecho_validado  jsonb,                       -- valores recalculados por SQL y fuente exacta
  motivo_descartada text
);
create index on forense.evidencia (caso_id, validada);

create table forense.defensas (
  id            bigserial primary key,
  caso_id       uuid references forense.casos(id) on delete cascade,
  idempotency_key text unique,
  trampa_codigo text,                          -- despacho_contable | margen_delgado | grupo_corporativo | ...
  pista_objetivo text,
  argumento     text,
  ids           text[],
  herramientas_usadas jsonb,
  evidencia_objetivo_ids bigint[],           -- refutación exacta; no todas las filas de un código global
  resultado     text,                          -- refuta | parcial | no_refuta
  respuesta_investigador text,                 -- de la Réplica
  aceptado      boolean
);

create table forense.expedientes (
  id        bigserial primary key,
  caso_id   uuid references forense.casos(id) on delete cascade,
  idempotency_key text unique,
  version   int,
  markdown  text,
  autor     text,                              -- agente | humano
  creado    timestamptz default now()
);
create unique index on forense.expedientes (caso_id, version);

create table forense.expediente_chat (
  id                bigserial primary key,
  caso_id           uuid references forense.casos(id) on delete cascade,
  rol               text,                      -- user | agente
  mensaje           text,
  seleccion         text,
  version_resultante int,
  creado            timestamptz default now()
);

create table forense.tool_cache (
  corrida_id uuid not null references forense.corridas(id) on delete cascade,
  cluster_id uuid not null references forense.clusters(id) on delete cascade,
  version_contexto int not null,
  herramienta text,
  args_hash  text,
  resultado  jsonb,
  creado     timestamptz default now(),
  primary key (corrida_id, cluster_id, version_contexto, herramienta, args_hash)
);
```

**Contratos de integridad pendientes al materializar el DDL:** usar claves foráneas compuestas donde un registro enlaza hechos del snapshot; comprobar que caso, cluster y tarea pertenecen a la misma corrida; incluir la corrida en todos los joins. Registrar contrapartes externas como entidades/cuentas de datos incompletos, sin inventar RFC reales. `ground_truth` nunca entra en consultas del agente.

`catalogo_giro_claves` se carga desde `generator/giros.py` y queda versionado con `version_reglas`, para que D1 no dependa de un catálogo ausente en SQL. F2 solo calcula saldo medio si hay saldo inicial y movimientos con cobertura suficiente; los loaders conservan la moneda original y no suman ni comparan monedas diferentes sin una conversión documentada. La variante financiera registra qué partes de F2 son evaluables según sus columnas reales.

**Estado por caso.** `pistas` conserva el disparo determinista original. Confirmaciones y refutaciones se guardan en `casos.evaluacion_pistas`, indexadas por `pista_id`, para que la defensa de un caso no cambie otro cluster que comparte RFC. `resultado_por_rfc` atribuye un nivel y evidencia propios a cada RFC evaluado; el nivel del principal no se copia a los satélites. El backend lo construye usando `evidencia.rfcs_afectados` validada y el dictaminador; las métricas de §10 leen esa salida, no infieren culpabilidad por pertenencia al cluster.

**IDs compuestos.** `ATR:rfc/atributo` o `LISTA:rfc` son abreviaciones de presentación, nunca identificadores suficientes para validar. La referencia persistida utiliza un array JSON canónico con la clave completa: atributo `[rfc, atributo, valor]`; lista `[rfc, lista, estatus, fecha_publicacion]`; el backend añade la `corrida_id` del caso. No concatenar campos sin escape. Cada enlace de evidencia resuelve esa clave exacta.

El caché incluye corrida y versión de contexto. `dataset_hash` se valida al preparar la corrida y es inmutable: no necesita repetirse en la PK porque `corrida_id` ya lo determina. Un cambio de hechos crea otra corrida/hash; una expansión incrementa `version_contexto`.

**Lease persistente.** La adquisición actualiza atómicamente el cluster cuando el lease está libre, vencido o pertenece al mismo dueño, y devuelve si ganó. Solo el dueño puede renovar/liberar; una tarea larga renueva antes del vencimiento. Los workers reclaman `tareas_agente` con la misma regla. El coordinador persiste el conjunto esperado antes del fan-out y la barrera consulta sus estados terminales. No se mantienen advisory locks de sesión entre nodos de n8n: pueden usar conexiones distintas.

### Realtime

```sql
alter publication supabase_realtime add table
  forense.casos, forense.bitacora, forense.senales,
  forense.clusters, forense.expedientes, forense.pistas;
```

### RLS

```sql
-- lectura pública (es demo), escritura solo service_role
alter table forense.casos enable row level security;
create policy lectura on forense.casos for select using (true);
-- repetir para cada tabla; ninguna policy de insert/update/delete:
-- service_role bypassea RLS, el frontend con anon key solo lee.
```

`ground_truth` es legible por el frontend (la vista de Estadísticas la necesita), pero **las RPC del agente no la exponen jamás**. Esa separación es lo que hace válidas las métricas.

Al implementar, aplicar RLS a **todas** las tablas de la demo; la política SELECT requiere además los `GRANT USAGE ON SCHEMA forense` y `GRANT SELECT` correspondientes. Exponer `forense` para las lecturas PostgREST del frontend y usar `.schema('forense')`. Las vistas de lectura usan `security_invoker = true`. Toda función `SECURITY DEFINER` fija `search_path` y usa nombres calificados; revocar `EXECUTE` de `PUBLIC`, `anon` y `authenticated` en mutadores y herramientas, y concederlo solo a `service_role`. RLS no impide llamar una función privilegiada que conserve permisos públicos. Las funciones de lectura para UI se conceden expresamente por separado.

## 002_views.sql — Utilidades compartidas y vistas

Primero definir `next_seq`, `log`, reserva atómica de presupuesto, adquisición/renovación/liberación de leases y helpers de caché; después las vistas. Así `003_pistas` y `004_clusters` pueden dejar bitácora sin depender de `005_rpc`. El logger descrito en §06 pertenece a **002**, aunque se explique junto a las herramientas.

```sql
create or replace function forense.next_seq(p_caso uuid) returns int
language sql set search_path = '' as $$
  update forense.casos
     set bitacora_seq = bitacora_seq + 1
   where id = p_caso
   returning bitacora_seq
$$;
```

El `UPDATE` serializa la asignación por caso; `log` inserta el evento en la misma transacción. Para eventos previos al caso, usar `caso_id=NULL`, pasar `p_corrida` explícitamente y ordenar por `bitacora.id`. `bitacora.corrida_id` permite que `/corridas/[id]/raw` incluya también carga, pistas y clustering previos a los agentes. El presupuesto reserva y registra una llamada en una única operación atómica; no consultar un contador y registrar después en dos operaciones concurrentes.

```sql
-- Lista de casos enriquecida
create view forense.v_casos_lista with (security_invoker = true) as
select k.*, c.razon_social, c.giro,
       (select count(*) from forense.evidencia e where e.caso_id = k.id and e.validada) as n_evidencia,
       (select count(*) from forense.defensas d where d.caso_id = k.id and d.resultado <> 'no_refuta') as n_defensas,
       cl.n_rfcs as cluster_tamano
from forense.casos k
left join forense.contribuyentes c on c.rfc = k.rfc_principal and c.corrida_id = k.corrida_id
left join forense.clusters cl on cl.id = k.cluster_id;

```

**Pseudocódigo de agregados: completar antes de ejecutar `002_views.sql`.** Los percentiles se calculan por corrida y ventana cerrada en `fecha_corte`; el agregado interno devuelve facturación, compras, nómina, tasa de cancelación y clientes por RFC. Excluir cancelados según métrica, conservar ceros con LEFT JOIN y publicar `n_pares` para reconocer giros con poca muestra.

```sql
-- Percentiles por giro
create materialized view forense.v_pares_giro as
select corrida_id, giro,
  count(*) as n_pares,
  percentile_cont(0.1) within group (order by facturacion_12m) as fact_p10,
  percentile_cont(0.5) within group (order by facturacion_12m) as fact_p50,
  percentile_cont(0.9) within group (order by facturacion_12m) as fact_p90,
  percentile_cont(0.1) within group (order by ratio_nomina)   as nomina_p10,
  percentile_cont(0.5) within group (order by ratio_nomina)   as nomina_p50,
  percentile_cont(0.1) within group (order by compras_12m)   as compras_p10,
  percentile_cont(0.9) within group (order by tasa_cancelacion) as cancel_p90,
  percentile_cont(0.5) within group (order by n_clientes)     as clientes_p50
from ( /* agregado por rfc: facturacion_12m, compras_12m, ratio_nomina, tasa_cancelacion, n_clientes */ ) t
group by corrida_id, giro;

-- Grafo para la UI: nodos y aristas hasta N saltos desde un RFC
create or replace function forense.v_grafo(p_corrida uuid, p_rfc text, p_prof int default 2)
returns jsonb language plpgsql as $$ /* nodos: contribuyentes + cuentas;
   aristas: facturas agregadas por par (monto, conteo) y movimientos agregados por par de cuentas;
   marca nodos frontera y nodos en 69-B */ $$;

-- Métricas de una corrida contra ground truth
create or replace function forense.v_metricas_corrida(p_corrida uuid)
returns jsonb language plpgsql as $$ /* ver docs/10-evaluacion.md */ $$;
```

## Orden de migraciones

```
001_schema.sql      tablas, índices, realtime, RLS
002_views.sql       utilidades compartidas, leases/presupuesto, vistas y agregados
003_pistas.sql      las 14 funciones pista_* + correr_pistas
004_clusters.sql    armar_clusters + expandir_cluster
005_rpc.sql         11 herramientas forense_* + validación/despertar/frontera
006_producto_ui.sql perfiles, investigaciones, vistas guardadas, propuestas, actividad y contenido TipTap
007_notificaciones_voz.sql outbox, notificaciones, llamadas y transición de investigación completa
008_ingesta.sql      ingestas, archivos, mapping, staging y rechazos privados (19)

FUERA DE MIGRACIONES:
db/seeds/seed_fake.sql   3 casos completos de fixture para construir la UI sin pipeline
db/seeds/seed_producto.sql perfil demo, vistas y notificaciones simuladas; requiere 006+007
```

`db/seeds/seed_fake.sql` se ejecuta manualmente tras **001 + 002**; no espera a 003–005 y no se aplica automáticamente en producción. Crea una corrida identificada como fixture, con IDs estables e inserciones idempotentes: un caso `presuncion_alta` con 20 eventos de bitácora en dos rondas, cinco señales, tres defensas y un expediente; otro `anomalia_explicada` (despacho contable); y otro `sin_hallazgos`. No se mezcla con métricas de corridas reales. Con eso la UI completa avanza mientras se implementan datos, reglas y agentes.

**Puertas de verificación:** después de 001+002, el frontend lee el fixture y recibe Realtime; después de 003, dos ejecuciones de pistas no duplican resultados; después de 004, los clusters son estables y dos workers no ganan el mismo lease; después de 005, una RPC solo lee la corrida del caso y una evidencia refutada permanece excluida. Para comparación, clonar el mismo dataset en dos corridas, cambiar un prompt y comprobar que RFC/UUID coinciden sin colisiones y que los resultados anteriores siguen intactos.

## Extensión de producto: 006 y 007

**Control runtime de 17:** añadir tablas de checkpoints, requests, operaciones de herramientas, barreras y slots con fencing a 001 después de sus dependencias; helpers transaccionales en002. Este dossier no es una migración ya aplicada. Si existe una instalación con migraciones aplicadas, generar una aditiva siguiente sin reescribir historia. 008 incorpora el importador asistido; fixture y loader canónicos no esperan al mapper.

Contratos de campos, permisos y estados en `16-notificaciones-elevenlabs.md`; UI en §15. Son migraciones aditivas, no se renumeran 001–005. `investigaciones.estado='investigacion_completa'` es estado de entrega del producto; `casos.estado/nivel` y `corridas.estado` mantienen su significado técnico. Transición y evento outbox son atómicos; reportes parciales no activan la llamada de fin.

Tablas nuevas con perfil/teléfono/propuestas/outbox no heredan SELECT público. El BFF valida sesión y propietario; la UI solo obtiene teléfonos enmascarados fuera de su propio perfil. Realtime usa alcance de propietario o notificaciones ya filtradas por servidor. `expedientes` añade JSON TipTap y `estado_revision`; la entrega exige una versión validada, mientras el autoguardado puede conservar borradores. Propuestas no alteran versiones hasta Aplicar.
