# IMPORT.md — importar y encender los workflows Forense

Dueño: **forense-runtime**. Quien ejecuta esto es el **coordinador**: importar,
crear credenciales y activar son permisos remotos que un worker no tiene.

**Estado honesto:** ninguno de los diez JSON ha sido importado, ejecutado ni
activado. En este worktree no hubo red. Lo verificado por comando es la forma de
los archivos, el contrato de datos entre nodos y que la SQL parsea contra
Postgres 17 con las migraciones 001–003:

| Comando | Resultado |
|---|---|
| `node --test "n8n/tests/*.test.mjs"` | 317 pasan, 0 fallan |
| `node n8n/runtime/generar-code-nodes.mjs --check` | sin deriva |
| `node n8n/runtime/generar-workflows.mjs --check` | sin deriva |
| `node n8n/tests/preparar-sql.mjs forense_runtime` | `ok=25 pendiente_004_005=48 falla=0` |

`preparar-sql.mjs` hace `PREPARE` de cada consulta (analiza y comprueba tipos sin
ejecutar). `ok` = la función y las columnas existen ya; `pendiente` = la función
la entrega forense-db en 004–008. Reproducirlo:

```bash
createdb forense_runtime
psql -d forense_runtime -f db/001_schema.sql
psql -d forense_runtime -f db/002_views.sql
psql -d forense_runtime -f db/003_pistas.sql
node n8n/tests/preparar-sql.mjs forense_runtime
```

Que n8n acepte los archivos, que los `typeVersion` existan en la instancia y que
los datos fluyan de verdad **no está probado**: eso es el smoke de §5.

---

## 1. Orden de importación (17 §2, literal)

Importar en este orden y **no activar nada** hasta terminar §5. Los webhooks
quedan en modo test hasta que el smoke pase.

| # | Archivo | Nodos | Por qué va aquí |
|---|---|---|---|
| 1 | `FORENSE_ejecutar_agente.json` | 31 | Todos los demás lo referencian. |
| 2 | `FORENSE_reintento.json` | 16 | Lo llama la investigación. |
| 3 | `FORENSE_editar_expediente.json` | 10 | Solo depende del worker. |
| 4 | `FORENSE_investigar_cluster.json` | 38 | Necesita 1 y 2. |
| 5 | `FORENSE_corrida.json` | 16 | Necesita 4. |
| 6 | `FORENSE_inyectar.json` | 13 | 21 §3; necesita 4 y 5. Va **entre 5 y 6** del orden de 17, que es anterior a 21. |
| 7 | `FORENSE_notificar_completada.json` | 10 | La llama 4 al cerrar el caso. |
| 8 | `FORENSE_resultado_llamada.json` | 6 | Callback de 7. |
| 9 | `FORENSE_reconciliador.json` | 8 | Necesita 1 y 7. |
| 10 | `FORENSE_errores.json` | 5 | Error Trigger; no referencia a nadie. |

Total: 153 nodos. Ninguno lleva `id`, `versionId`, `meta`, `pinData` ni
`staticData`: n8n los regenera al importar.

---

## 2. IDs `PENDIENTE_*` a resolver después de importar

`executeWorkflow` referencia al subworkflow por ID, que no existe hasta
importarlo. Tras importar en el orden de §1, sustituir cada valor por el ID real
y **dejar constancia en `reports/handoff/ESTADO.md`** (17 §2: «manifest de IDs
reales tras importar»).

| Workflow | Nodo | Valor a sustituir | Destino |
|---|---|---|---|
| `FORENSE_ejecutar_agente` | `Redespachar paso` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_reintento` | `Despachar revisión` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_editar_expediente` | `Ejecutar editor` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Despachar especialistas` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Despachar R2` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Ejecutar auditor` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Ejecutar defensor` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Réplica` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Ejecutar redactor` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_investigar_cluster` | `Llamar reintento` | `PENDIENTE_FORENSE_REINTENTO` | FORENSE_reintento |
| `FORENSE_investigar_cluster` | `Avisar agregador` | `PENDIENTE_FORENSE_NOTIFICAR_COMPLETADA` | FORENSE_notificar_completada |
| `FORENSE_corrida` | `Despachar cluster` | `PENDIENTE_FORENSE_INVESTIGAR_CLUSTER` | FORENSE_investigar_cluster |
| `FORENSE_inyectar` | `Despachar afectados` | `PENDIENTE_FORENSE_INVESTIGAR_CLUSTER` | FORENSE_investigar_cluster |
| `FORENSE_reconciliador` | `Redespachar pasos` | `PENDIENTE_FORENSE_EJECUTAR_AGENTE` | FORENSE_ejecutar_agente |
| `FORENSE_reconciliador` | `Reenviar outbox` | `PENDIENTE_FORENSE_NOTIFICAR_COMPLETADA` | FORENSE_notificar_completada |

Un test comprueba que el valor siga siendo `PENDIENTE_FORENSE_*` **y** que nadie
lo sustituya por algo con forma de secreto; sustituirlo por un ID real es
correcto y esperado, pero entonces el JSON del repo y el de la instancia
divergen: el repo conserva los `PENDIENTE_*` y la instancia los IDs.

---

## 3. Variables y credenciales por resolver

### 3.1 Credenciales (por **nombre**, nunca por ID)

| Nombre exacto | Tipo n8n | Usada por | Estado |
|---|---|---|---|
| `Anthropic account` | `anthropicApi` | `POST /v1/messages` del worker | **Existe.** El smoke H0 del coordinador la usó (ejecuciones 283972/283975, `claude-sonnet-5` y `claude-opus-5`). Saldo y rate limits sin medir. |
| `Forense Postgres` | `postgres` | 73 nodos SQL | **Por crear.** Apunta al Postgres de la corrida (Supabase `hackthon2026` o el local). |
| `Forense Supabase` | `supabaseApi` | `Llamar RPC forense` | **Por crear.** Inyecta `apikey` + `Authorization`; el JSON no lleva ninguna de las dos. |
| `Forense Webhook` | `httpHeaderAuth` | los 5 webhooks autenticados | **Por crear.** El BFF envía esa cabecera; sin ella, cualquiera dispara una corrida. |
| `ElevenLabs Forense` | `httpHeaderAuth` (`xi-api-key`) | `POST outbound-call` | **Por crear.** Bloqueada externamente: cero números salientes (21 §5). |

El nombre del modelo es `Anthropic account`, no `Anthropic Forense` (07 usa el
segundo; 21 §5 es normativo sobre 00–20).

### 3.2 Valores a sustituir en el JSON

| Dónde | Valor actual | Qué poner |
|---|---|---|
| `FORENSE_ejecutar_agente` → `Expandir cola de tools`, constante `BASE_REST` | `https://PENDIENTE_SUPABASE_REF.supabase.co/rest/v1` | La URL REST del proyecto Supabase de la corrida. No es un secreto (la clave la aporta la credencial), pero sí es específica del entorno. |
| `POST outbound-call` → cuerpo | lo arma `forense.crear_intento_llamada` | Requiere `ELEVENLABS_AGENT_ID` y `ELEVENLABS_AGENT_PHONE_NUMBER_ID` en la fila de configuración, no en el JSON. |
| `Cada 10 s` (reconciliador) | 10 s | Ajustar tras medir en la instancia (17 §3 lo pide configurable). |

### 3.3 Dependencias de base de datos (bloqueantes)

Sin esto, los workflows importan pero no corren. `preparar-sql.mjs` los localiza
uno a uno; el resumen:

1. **`forense.advance_case_if_ready(caso_id uuid, paso text, revision_expected int)`.**
   En `db/002_views.sql` la función tiene hoy **dos** argumentos. La decisión
   H3 01:35 (DECISIONES.md) le da el `paso` porque la barrera es por paso, y el
   JSON ya la llama con tres. **Hasta que 004/005 la publique con tres
   argumentos, el worker falla al cerrar un paso terminal.**
2. **Dos valores nuevos en el check `ck_bitacora_tipo_evento`:** `paso_en_cola` y
   `paso_checkpoint`. Comprobado contra la base local: no están. Los usan
   `Registrar en_cola` y `Registrar paso guardado`, que existen porque la regla 2
   de CLAUDE.md exige rastro también en la rama que no cierra. Si el coordinador
   prefiere no ampliar el enum, el cambio alternativo es de una línea por nodo
   (`p_tipo => 'razonamiento'` con el evento real en el payload), pero entonces
   la UI no puede distinguir el paso en cola del razonamiento.
3. **Funciones de 004–008** que el JSON llama y todavía no existen (48
   ocurrencias). Para cada nodo que las usa, la tabla `CONTRATOS_NODOS` de
   `n8n/runtime/generar-workflows.mjs` declara **qué columnas debe devolver**;
   `FORMA_PENDIENTE` lista esos nodos explícitamente. Esa tabla es la
   especificación: si la función devuelve otra forma, el grafo se rompe en el
   nodo siguiente, no en el que falla.
4. **Idempotencia por `p_operacion`** en los wrappers `public.forense_*` (06
   §Runtime). La rama de herramientas del worker es lineal a propósito: llama a
   la RPC para cada `tool_use_id`, incluidas las reentregas, y confía en que
   `p_operacion = (tarea_id, paso, tool_use_id)` devuelva el resultado registrado
   **sin volver a consumir cuota ni insertar señal**. Si 004/005 no implementa
   esa idempotencia, una reentrega consume cuota de más.

### 3.4 Versión de n8n y `typeVersion`

`launch.config.json` fija la instancia en **2.33.7**. Los pares
(tipo, `typeVersion`) usados son los del MANIFEST §0.3. Si al importar n8n ofrece
migrar un nodo a una versión mayor, **no aceptar antes del smoke**: aceptar y
reexportar después, y regenerar con `node n8n/runtime/generar-workflows.mjs`
para que el repo no se separe de la instancia.

---

## 4. Antes de encender: cinco comprobaciones de un minuto

1. Los diez workflows aparecen **inactivos**.
2. Ningún nodo muestra credencial en rojo (todas creadas y asignadas por nombre).
3. En `FORENSE_ejecutar_agente`, el nodo `POST /v1/messages` tiene
   «Retry on Fail» **apagado**: el reintento lo hace el propio grafo respetando
   `Retry-After` (17 §6).
4. Los webhooks responden por nodo (202 diferido), no con la respuesta inmediata.
5. `Cada 10 s` del reconciliador sigue **inactivo**: encenderlo antes del smoke
   redespacha pasos de una máquina que aún no existe.

---

## 5. Smoke del coordinador (lo ejecuta él, no este worktree)

Es la prueba remota autorizada de 17 §9: **una herramienta real, una
investigación completa, dos workers simultáneos, luego cuatro clusters**.
Registrar p50/p95, requests, tokens, límite efectivo y errores en
`reports/handoff/ESTADO.md`. Un dibujo de workflow no acredita rendimiento.

### Paso 0 — datos y migraciones

- Migraciones 001–005 aplicadas (008 si se va a probar inyección).
- Una corrida `lista` con datos: la local `gen-v1`
  (`3fc52b5a-3e4b-54f4-a714-b3303b6f0347`, 140 pistas) sirve de referencia.
- `select forense.correr_pistas(<corrida>)` ya ejecutado o se ejecutará desde
  `FORENSE_corrida`.

### Paso 1 — una herramienta real

Ejecutar `FORENSE_ejecutar_agente` a mano con una ejecución sembrada en
`ejecuciones_agente` cuyo checkpoint traiga un `tool_use` pendiente.

**Qué mirar, en este orden:**

| Comprobación | Dónde | Qué significa si falla |
|---|---|---|
| `claim_step` devolvió `ok=true` y un `fence` | nodo `Reclamar paso` | La ejecución no existe, está cancelada o su lease es de otro. |
| Hay **una fila por herramienta** en `tool_ejecuciones` | SQL | La cola no se expandió: se está procesando solo el primer `tool_use`. |
| `forense.bitacora` tiene el `tool_call` de la RPC | SQL | La RPC no se autologueó: sin rastro, ese paso no existió (regla 2). |
| `Armar tool_results` emitió **un** `tool_result` por `tool_use_id` | salida del nodo | Un `tool_result` de menos rompe el protocolo al reanudar (17 §5.5). |
| `save_checkpoint` devolvió `ok=true` | nodo `Guardar checkpoint` | Fence vencido o conflicto de revisión: otro proceso mandó. |

**Prueba de doble entrega (gate de 17 §9):** volver a ejecutar el mismo paso con
el mismo `request_id`. Debe aparecer `duplicado=true` en `Reclamar tool`, **no**
una segunda señal ni una segunda fila de evidencia, y el consumo de cuota de la
tarea no debe subir.

### Paso 2 — una investigación completa

`POST /webhook/forense/investigar` con `{corrida_id, cluster_id,
idempotency_key}` y la cabecera de `Forense Webhook`.

- La respuesta debe ser **202 con `caso_id`**, no el resultado: la investigación
  sigue en background.
- La barrera de ronda 1 espera **el conjunto exacto** de `tarea_id` creados. Si
  se crearon tres tareas, no se esperan cinco.
- Repetir la misma `idempotency_key` **no** crea un segundo caso.
- El caso cierra en `dictaminado` o en `error`; nunca en `definitivo` (regla 7)
  y como máximo en `presuncion_alta`.
- Con cero hallazgos el caso también termina, con resultado explícito.
- El expediente lleva las secciones **Trayectoria** y **Cadena de explicación**
  (21 §2 y §4).

### Paso 3 — dos workers simultáneos

Lanzar dos ejecuciones del worker sobre la **misma** `execution_id`.

- Una obtiene el claim; la otra devuelve `en_cola` y escribe `paso_en_cola` en
  bitácora. **Pendiente, no fallida** (17 §3).
- El `fence_token` sube solo cuando el lease cambia de dueño.
- Un proceso con fence viejo que intenta `save_checkpoint` recibe
  `lease_vencido` y **no** escribe.

### Paso 4 — cuatro clusters

`POST /webhook/forense/corrida`. Comprobar:

- Como mucho **cuatro** clusters activos; el resto queda en cola y se repone al
  terminar cada uno.
- Ocho pasos de tarea activos como máximo (límite de DB, no de n8n).
- Terminar de despachar **no** cierra la corrida: la cierra `Cerrar corrida` tras
  reconciliar.

### Paso 5 — medición

Con las ejecuciones de los pasos 2 y 4:

```sql
select percentile_disc(0.5) within group (order by duracion_ms)  as p50_ms,
       percentile_disc(0.95) within group (order by duracion_ms) as p95_ms,
       count(*) as n
  from forense.llm_solicitudes where estado = 'completado';

select count(*) filter (where estado = 'completado') as completados,
       count(*) filter (where estado = 'error')      as errores,
       count(*) filter (where estado = 'desconocido') as ambiguos,
       sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out
  from forense.llm_solicitudes;

select estado, count(*) from forense.casos group by estado;
```

Anotar además el **límite efectivo** observado (¿se llegó a 4 clusters y 8 pasos,
o la cuenta de Anthropic frenó antes con 429?). Si aparecen `desconocido`, son
requests con posible coste externo sin respuesta: se cuentan y se declaran, no se
descartan (17 §6).

### Paso 6 — inyección en vivo (21 §3.5, gate propio)

Solo con `008` aplicado. `POST /webhook/forense/inyectar` con el paquete (a) de
`eval/inyecciones/`.

- La corrida base **no cambia**: mismo `dataset_hash`, mismas pistas.
- La corrida nueva tiene `corrida_origen_id` = base y `dataset_hash` distinto.
- Los clusters con RFC inyectados se despachan **primero**.
- Cada transición deja evento con `tipo_evento='inyeccion'`: sin evento
  persistido, `/inyecciones/[id]` no puede animar nada.
- Medir la latencia recibida→dictamen y anotarla en ESTADO.md.

### Qué hacer si algo falla

No «arreglar» el JSON en la UI de n8n: corregir la fuente
(`n8n/runtime/generar-workflows.mjs` o el nodo en `n8n/runtime/nodos/`),
regenerar y reimportar. Un cambio hecho solo en la instancia se pierde en la
siguiente exportación y deja el repo mintiendo.
