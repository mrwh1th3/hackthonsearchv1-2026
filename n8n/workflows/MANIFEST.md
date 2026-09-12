# MANIFEST de workflows n8n — proyecto Forense

Dueño: **forense-runtime**. Fuentes normativas: `17-runtime-n8n.md` (autoridad de runtime),
`07-n8n-workflows.md` (lógica por workflow), `16-notificaciones-elevenlabs.md` (voz),
`19-ingesta-datasets.md` (ingesta), `21-criterios-juez-e-inyeccion-en-vivo.md` (§3 inyección,
normativo sobre 00–20), `06-rpc-herramientas.md` (herramientas), `03-arquitectura-agentica.md`
(cuotas y despertar).

**Estado real de este archivo:** es el plano nodo por nodo de los **diez** workflows
(153 nodos), todos emitidos por `node n8n/runtime/generar-workflows.mjs`. Ninguno ha sido
importado, ejecutado ni activado: no hubo red en esta sesión. Verificado por comando:
la forma de los JSON, el **contrato de datos entre nodos** y que la SQL **parsea contra
Postgres 17 real** con 001–003 aplicadas (`node n8n/tests/preparar-sql.mjs`, `falla=0`).
Que la instancia acepte los archivos y que los datos fluyan extremo a extremo queda
**pendiente** del smoke del coordinador: el guion está en `n8n/workflows/IMPORT.md`.

---

## 0. Convenciones que aplican a todos los workflows

### 0.1 Reglas duras

| Regla | Origen | Cómo se cumple aquí |
|---|---|---|
| Nada de nodo AI Agent opaco | 17 §5 | El loop es HTTP Request explícito a `/v1/messages` + Code nodes generados. No hay `n8n-nodes-langchain.*` en ningún JSON. |
| Nada de `$fromAI(...)` | 17 §1 y §5 | Los argumentos de herramienta salen de los bloques `tool_use` parseados por código; `p_tarea`, `p_caso` y `p_operacion` los fija el backend. La mención de `$fromAI` en 07 pertenece a la era del nodo AI Agent y queda derogada por 17. |
| Una ejecución = **un** paso acotado | 17 §3 | El worker hace una petición de modelo **o** un lote de herramientas, guarda checkpoint y termina. No hay nodo que espere la investigación completa. |
| Sin secretos en el JSON | 17 §2 | Credenciales referenciadas **por nombre**, sin `id`; sin `x-api-key`, `apikey`, `Authorization` ni service-role literales. Verificado por test. |
| Inactivos al importar | 07 | `"active": false` en todos. Verificado por test. |
| Orden de ejecución v1 | 07 §Concurrencia | `"settings": {"executionOrder": "v1"}` en todos. Verificado por test. |
| Todo paso deja rastro | CLAUDE.md regla 2 | Cada rama del worker termina en un nodo Postgres que escribe `forense.bitacora` —incluida la rama `en_cola`— o en una RPC que se loggea a sí misma (06). Sin evento persistido no hay animación en UI. |
| Nivel máximo `presuncion_alta` | CLAUDE.md regla 7 | El nivel lo calcula el Code node `auditor-final.js` (determinista, generado). El LLM no lo decide. |
| Texto libre no confiable | CLAUDE.md regla 6 | `descripcion`, `razon_social`, `referencia` llegan al modelo con sufijo `_untrusted` desde el envelope de 06; ningún nodo ejecuta instrucciones contenidas en ellos. |

### 0.2 Credenciales (por nombre, nunca por ID)

| Nombre en el JSON | Tipo n8n | Uso | Estado |
|---|---|---|---|
| `Forense Postgres` | `postgres` | SQL de control: `claim_step`, `reserve_request`, `claim_tool`, `save_checkpoint`, `finish_step`, `advance_case_if_ready`, `recover_expired`, bitácora, barreras. Sin locks de sesión entre nodos (07). | **No creada aún** (Postgres local en H0; Supabase forense bloqueado por límite de proyectos free, 21 §5). |
| `Forense Supabase` | `supabaseApi` (predefinida, inyecta `apikey` + `Authorization: Bearer`) | Las once RPC `public.forense_*` de 06 vía `POST /rest/v1/rpc/<nombre>`. Perfil `public`, **nunca** `Content-Profile: forense`. | **No creada aún.** |
| `Anthropic account` | `anthropicApi` | `POST https://api.anthropic.com/v1/messages`. Aporta `x-api-key`; el JSON solo fija `anthropic-version: 2023-06-01`. | **Existe** en el proyecto personal de n8n; el smoke H0 del coordinador la usó con `claude-sonnet-5` y `claude-opus-5` con `tool_use`. Saldo/rate limits sin verificar. |
| `ElevenLabs Forense` | `httpHeaderAuth` (`xi-api-key`) | `POST /v1/convai/twilio/outbound-call` (16 §3). | **No creada.** Cero números salientes en la cuenta (21 §5): la llamada está bloqueada externamente. |

> 07 §Credenciales nombra la credencial del modelo `Anthropic Forense`. **Prevalece `Anthropic account`**,
> que es la que existe en la instancia y la que el smoke usó (21 §5 es normativo sobre 00–20).
> `Anthropic Forense` queda como nombre del fallback si el usuario aporta una credencial con saldo;
> renombrarla en los JSON es un cambio de una línea por nodo.

### 0.3 `typeVersion` por procedencia

Solo se usan estos pares. Cualquier otro exige verificación previa contra la instancia.

| Tipo de nodo | typeVersion | Procedencia |
|---|---|---|
| `n8n-nodes-base.code` | 2 | **Observado** en la instancia (`n8n/reference/instance-typeversions.md`) |
| `n8n-nodes-base.postgres` | 2.7 | **Observado** |
| `n8n-nodes-base.httpRequest` | 4.2 | **Observado** |
| `n8n-nodes-base.respondToWebhook` | 1.5 | **Observado** |
| `n8n-nodes-base.webhook` | 2.1 | **Observado** |
| `n8n-nodes-base.if` | 2.3 | **Observado** |
| `n8n-nodes-base.switch` | 3.4 | **Observado** |
| `n8n-nodes-base.stickyNote` | 1 | **Observado** |
| `n8n-nodes-base.executeWorkflow` | 1.3 | según SDK MCP |
| `n8n-nodes-base.executeWorkflowTrigger` | 1.2 | según SDK MCP |
| `n8n-nodes-base.scheduleTrigger` | 1.3 | según SDK MCP |
| `n8n-nodes-base.set` | 3.5 | según SDK MCP |
| `n8n-nodes-base.errorTrigger` | 1 | según SDK MCP |
| `n8n-nodes-base.wait` | 1.1 | según SDK MCP |

Advertencias que no se pueden saltar:

- La tabla observada es un **piso**, no un techo: un workflow puede estar fijado a un `typeVersion`
  viejo. `launch.config.json.targets.n8n_version` sigue en `null`.
- La referencia del SDK muestra ejemplos con `httpRequest 4.3` y `set 3.4`. **No se copian**: se usan
  4.2 y 3.5 por la regla de arriba.
- Si al importar n8n ofrece migrar un nodo a una versión mayor, se acepta solo tras el smoke y se
  reexporta el JSON.

### 0.4 Forma del archivo exportado

Cada JSON contiene exactamente: `name`, `nodes`, `connections`, `active: false`, `settings`.
Se **omiten** `id`, `versionId`, `meta`, `pinData` y `staticData`: n8n los regenera al importar e
inventarlos colisiona con la regla de no incrustar identificadores. Las claves de `connections`
son **nombres** de nodo (no ids), que es el error clásico al escribir JSON a mano; el test lo
verifica.

Los JSON **no se escriben a mano**: los emite `node n8n/runtime/generar-workflows.mjs`, que lee los
cuerpos de los Code nodes desde `n8n/code/*.js` (a su vez generados desde `n8n/runtime`). Así un
cambio de lógica no deja una copia vieja pegada dentro del workflow.
`node n8n/runtime/generar-workflows.mjs --check` falla si el archivo exportado se separó del
generador, y el test lo ejecuta.

### 0.5 Resolución de IDs después de importar

`executeWorkflow` referencia al subworkflow por ID, que no existe hasta importarlo. En los JSON el
campo va como `workflowId: {"__rl": true, "mode": "list", "value": "PENDIENTE_<NOMBRE>", "cachedResultName": "<NOMBRE>"}`.
Tras importar en el orden de §1 hay que sustituir cada `PENDIENTE_*` por el ID real y dejar
constancia en `reports/handoff/ESTADO.md` (17 §2: «manifest de IDs reales tras importar»).
El test rechaza que un `PENDIENTE_*` se haya sustituido por algo que parezca un secreto, no que se
sustituya.

---

## 1. Orden de importación (17 §2, literal)

1. `FORENSE_ejecutar_agente` — worker de paso
2. `FORENSE_reintento`
3. `FORENSE_editar_expediente`
4. `FORENSE_investigar_cluster`
5. `FORENSE_corrida`
6. `FORENSE_notificar_completada`
7. `FORENSE_resultado_llamada`
8. `FORENSE_reconciliador` y `FORENSE_errores`

`FORENSE_inyectar` es posterior a 17 (viene de 21 §3) y depende de `FORENSE_corrida` e
`FORENSE_investigar_cluster`: se importa **entre 5 y 6**. La tabla con nodos, IDs `PENDIENTE_*` y
variables por resolver está en **`n8n/workflows/IMPORT.md`**, que es el documento que ejecuta el
coordinador. Ningún workflow se activa antes del smoke
(17 §2). Los webhooks quedan en modo test hasta que el smoke pase.

---

## 2. `FORENSE_ejecutar_agente` — worker de paso  *(JSON emitido, 31 nodos)*

Entrada `{tarea_id, execution_id?, owner, motivo?}`. Un paso: **una** petición de
modelo **o** un lote de herramientas; guarda checkpoint y termina (17 §3).
Sustituye al worker con AI Agent de 07.

**Convención de cableado (corte 2).** La identidad del claim —`execution_id`,
`fencing_token`, `revision`, `caso_id`, `tarea_id`, `rol`, `paso`,
`paso_pipeline`, `request_id`— se lee siempre de `$('Decidir accion')`, que está
aguas arriba de las tres ramas; la carga de cada paso viaja por `$json` entre
nodos contiguos. Las funciones de 17 §4 devuelven `jsonb` y se abren con
`jsonb_to_record`, de modo que cada nodo publica **columnas con nombre**. Eso es
lo que hace comprobable el contrato entre nodos (§11.15).

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Paso entrante` | `executeWorkflowTrigger` | 1.2 | `inputSource: passthrough` | — |
| 2 | `Reclamar paso` | `postgres` | 2.7 | `jsonb_to_record(forense.claim_step($1::uuid,$2::text))` → `ok, error, fence AS fencing_token, revision, paso, estado_interno, rol, tarea_id, caso_id, corrida_id, checkpoint, deadline_at` | `Forense Postgres` |
| 3 | `¿Claim vigente?` | `if` | 2.3 | boolean `={{ $json.ok }}` | — |
| 4 | `Paso no reclamable` | `code` | 2 | `{estado:'en_cola', motivo, …}`. El slot es de otro owner con lease vigente: **pendiente, no fallido** (17 §3). | — |
| 5 | `Registrar en_cola` | `postgres` | 2.7 | `forense.log(p_caso, p_agente, p_tipo=>'paso_en_cola', …)`. `forense.registrar_evento` **no existe**; el escritor de bitácora es `forense.log` (002). | `Forense Postgres` |
| 6 | `Cargar ejecución` | `postgres` | 2.7 | Eco de la identidad del claim + `artefactos_contexto.contenido AS paquete` + `ronda/intento` de la tarea + `paso_pipeline` del `pasos_pipeline` abierto. | `Forense Postgres` |
| 7 | `Decidir accion` | `code` | 2 | **Generado** (`nodos/decidir-paso.mjs`). Traduce el checkpoint a `{accion, estado_interno DESTINO, estado_tarea, evento, request_id, pending_tool_use_ids, checkpoint}`. El `request_id` es determinista (`execution:paso:motivo`): un reintento de transporte reusa el mismo y no consume cuota. | — |
| 8 | `Ruta del paso` | `switch` | 3.4 | `solicitar_modelo` → 0, `ejecutar_herramienta` → 1, `cerrar` → 2; `fallbackOutput: none`. | — |
| 9 | `Reservar request` | `postgres` | 2.7 | `reserve_request($1::uuid,$2::bigint,$3::text,$4::int,$5::text)` — `request_id` es **text**. **Antes** del HTTP (17 §5.3). | `Forense Postgres` |
| 10 | `Construir cuerpo Messages` | `code` | 2 | **Generado** + **prompts embebidos**: el generador inyecta `CATALOGO_PROMPTS` (bloque común, instrucciones por rol, contrato de salida renderizado desde `contracts`, allowlist por ronda) sellado con `version_prompts` y el sha256 del manifest. El system resultante es **idéntico** al de `n8n/prompts/ensamblar.mjs`, bloque de identidad incluido (test). `ambito_techo='paquete'`. | — |
| 11 | `POST /v1/messages` | `httpRequest` | 4.2 | `jsonBody` desde `$('Construir cuerpo Messages')` (tras el Backoff, `$json` ya no trae el cuerpo); `fullResponse` + `neverError`; `timeout 45000`; `retryOnFail:false` a propósito. | `Anthropic account` |
| 12 | `Clasificar transporte` | `code` | 2 | **Generado**. `ruta` excluyente: `continuar｜reintentar｜desconocido｜error`. | — |
| 13 | `Ruta de transporte` | `switch` | 3.4 | Cuatro salidas; `fallbackOutput: none`. | — |
| 14 | `Backoff` | `wait` | 1.1 | `espera_ms` del clasificador; vuelve a (11). Máximo dos vueltas. | — |
| 15 | `Marcar desconocido` | `postgres` | 2.7 | `llm_solicitudes.error` es **text**; devuelve además `estado_interno='error'` y el patch de checkpoint. | `Forense Postgres` |
| 16 | `Marcar error de request` | `postgres` | 2.7 | Igual, para error permanente o reintentos agotados. | `Forense Postgres` |
| 17 | `Interpretar respuesta` | `code` | 2 | **Generado**. `stop_reason` → evento → **estado interno destino**; guarda el transcript completo (assistant con sus `tool_use`) y la cola con todos los IDs. | — |
| 18 | `Validar salida contra contrato` | `postgres` | 2.7 | `validar_salida_rol` (segundo nivel de 17 §8). **Depende de 004/005.** | `Forense Postgres` |
| 19 | `Completar request` | `postgres` | 2.7 | `estado='completado'`, `usage`, `tokens_in/out` reales del proveedor. | `Forense Postgres` |
| 20 | `Expandir cola de tools` | `code` | 2 | **Generado** (`nodos/expandir-cola-tools.mjs`). Un **ítem por `tool_use`**, en orden, con `p_tarea`/`p_caso`/`p_operacion` fijados por backend y la allowlist del rol comprobada. | — |
| 21 | `Reclamar tool` | `postgres` | 2.7 | `claim_tool(..., forense.args_hash($5::jsonb), $6)`; devuelve `duplicado` (no `nuevo`). El hash lo calcula SQL: un Code node no depende de un módulo de criptografía del host. | `Forense Postgres` |
| 22 | `Llamar RPC forense` | `httpRequest` | 4.2 | Una llamada por ítem, secuencial; argumentos y nombre desde `$('Expandir cola de tools').item`. Sin `Content-Profile`. | `Forense Supabase` |
| 23 | `Registrar resultado tool` | `postgres` | 2.7 | `finish_tool($1::bigint, …)`, no un UPDATE suelto. | `Forense Postgres` |
| 24 | `Armar tool_results` | `code` | 2 | **Generado**. Lee la cola de `$('Expandir cola de tools').all()` y los resultados de `$input.all()`: un `tool_result` por **cada** `tool_use_id`, en orden, errores tipificados incluidos. | — |
| 25 | `Guardar checkpoint` | `postgres` | 2.7 | `save_checkpoint` con CAS + fencing; devuelve `ok, revision` y repite `estado_interno` para el IF siguiente. | `Forense Postgres` |
| 26 | `¿Estado terminal?` | `if` | 2.3 | `['terminado','error','timeout'].includes($json.estado_interno)` | — |
| 27 | `Registrar paso guardado` | `postgres` | 2.7 | **Rama NO terminal.** `forense.log(... 'paso_checkpoint' ...)` antes de redespachar: regla 2 de CLAUDE.md, sin excepción para la rama que continúa. | `Forense Postgres` |
| 28 | `Redespachar paso` | `executeWorkflow` | 1.3 | Se llama a sí mismo, `waitForSubWorkflow:false`. | — |
| 29 | `Finalizar paso` | `postgres` | 2.7 | `finish_step($1::uuid,$2::bigint,$3::int,$4::text,'{}'::jsonb,$5::text)` — recibe el estado **interno** y deriva el de la tarea. | `Forense Postgres` |
| 30 | `Avanzar caso si listo` | `postgres` | 2.7 | `advance_case_if_ready($1::uuid,$2::text,$3::int)` (DECISIONES H3 01:35). | `Forense Postgres` |
| 31 | `Nota worker` | `stickyNote` | 1 | — | — |

Conexiones: 1→2→3; 3(true)→6, 3(false)→4→5; 6→7→8;
8[0]→9→10→11→12→13; 13[continuar]→17→18→19→25; 13[reintentar]→14→11;
13[desconocido]→15→25; 13[error]→16→25; 8[1]→20→21→22→23→24→25; 8[2]→25;
25→26; 26(true)→29→30; 26(false)→27→28.

### 2.1 Por qué la rama de herramientas no se bifurca

En n8n un nodo se ejecuta **una vez por conexión de entrada que le entrega
datos**. El diseño anterior bifurcaba en `¿Tool nueva?` (nueva vs. reentrega) y
volvía a unir en `Armar tool_results`: con varios `tool_use` en la misma
respuesta, ambas ramas pueden traer ítems, el nodo correría dos veces y emitiría
**dos mensajes user incompletos**, que es justo lo que prohíbe 17 §5.5. No hay
nodo Merge disponible: su `typeVersion` no está verificado contra la instancia y
aquí no hay red.

La rama es por tanto lineal, y la idempotencia vive donde 17 §4 y 06 la ponen:

- `claim_tool` tiene unicidad `(request_id, tool_use_id)` y marca `duplicado`;
- la RPC resuelve por `p_operacion = (tarea_id, paso, tool_use_id)` y, en una
  reentrega, **devuelve el resultado registrado sin consumir cuota ni insertar
  señal** (06 §Runtime).

Esa última garantía es una **dependencia declarada**: si 004/005 no la
implementa, una reentrega consume cuota de más. Está en IMPORT.md §3.3.

### 2.2 Qué queda pendiente para que el grafo **corra**

El corte 2 cerró los cinco saltos que esta sección listaba (`checkpoint`
renombrado, identidad propagada, insumos del cuerpo, argumentos de backend y
forma del checkpoint): hoy un test recorre el grafo y exige que cada `$json.campo`
y cada `$('Nodo').first().json.campo` venga de un antecesor que lo publique
(§11.15). Lo que **no** está cerrado:

- Las funciones de 004–008 que el JSON llama (48 referencias). `CONTRATOS_NODOS`
  declara qué columnas debe devolver cada una; `FORMA_PENDIENTE` lista los nodos
  cuya forma no se puede comprobar contra el texto de la consulta.
- `advance_case_if_ready` con tres argumentos: 002 publica hoy la de dos.
- `paso_en_cola` y `paso_checkpoint` en el check de `bitacora`.

Detalle y reproducción en `n8n/workflows/IMPORT.md`.

Familias y herramientas por rol que el nodo (10) mete en `tools` (07 §Worker, 03):
Documental `perfil,facturas,pares`; Financiero `conciliar,seguir_dinero,facturas`;
Relacional `relacionados,ciclos,facturas`; Temporal `perfil,facturas,pares`;
Externo `listas,relacionados`; todos con `escribir_senal` y `registrar_evidencia`
(DECISIONES H3 01:37), y `leer_senal` **solo** en ronda informada (R2/reintento).
Las cuotas (D/F/R 8, T 6, E 4; Auditor 12, Defensor 15) las impone
`n8n/runtime/presupuesto.mjs` y `forense.reservar_tool`, no el modelo.

---

## 3. `FORENSE_investigar_cluster`  *(JSON emitido: `FORENSE_investigar_cluster.json`)*

Dos entradas: subworkflow y webhook autenticado `POST /webhook/forense/investigar`.
Estructura de 07 §2, con la barrera de 17 §3 (conjunto exacto de `tarea_id`).

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Desde corrida` | `executeWorkflowTrigger` | 1.2 (SDK MCP) | `{cluster_id, corrida_id, investigacion_id, idempotency_key}` | — |
| 2 | `Webhook investigar` | `webhook` | 2.1 | `httpMethod: POST`, `path: forense/investigar`, `authentication: headerAuth`, `responseMode: responseNode` (202 diferido, nunca la respuesta inmediata por defecto) | `Forense Webhook` (header auth) |
| 3 | `Normalizar entrada` | `code` | 2 | **Generado** (`nodos/normalizar-investigacion.mjs`). Une ambas entradas; rechaza `system`, `telefono`, `modelo`, `nivel` y similares en el payload (07 §1) y devuelve el texto libre como `valor_untrusted`. | — |
| 4 | `Resolver y reclamar cluster` | `postgres` | 2.7 | `SELECT * FROM forense.reclamar_cluster($1::uuid,$2::uuid,$3::text,$4::text,$5::text)`: resuelve/arma el cluster en el snapshot **y después** reclama con `lease_owner/lease_expires_at`. Ocupado → `en_cola` sin duplicar caso. | `Forense Postgres` |
| 5 | `Responder 202` | `respondToWebhook` | 1.5 | `respondWith: json`, body `{caso_id, cluster_id, corrida_id, estado}`. Solo en la rama del webhook. | — |
| 6 | `Crear caso` | `postgres` | 2.7 | Inserta una vez con `n8n_execution_id`, `intento=0`; eventos `caso_creado`, `cluster_armado`, `pista_cargada`. Idempotente por `idempotency_key`. | `Forense Postgres` |
| 7 | `Contexto ronda 1` | `postgres` | 2.7 | Carga resumen ≤40 RFC y pistas **por familia**; persiste `ronda1`, `ronda_inicio`, artefacto de contexto y `context_hash`. | `Forense Postgres` |
| 8 | `Filtrar familias evaluables` | `code` | 2 | Omite familias no evaluables con `resultado.motivo_omision='no_evaluable'`; R1 **no** recibe señales ajenas (17 §7). | — |
| 9 | `Crear tareas R1` | `postgres` | 2.7 | Inserta `(caso_id, ronda=1, intento=0, agente, version_contexto)` y devuelve el **conjunto exacto** de `tarea_id`. | `Forense Postgres` |
| 10 | `Despachar especialistas` | `executeWorkflow` | 1.3 (SDK MCP) | `workflowId → FORENSE_ejecutar_agente`; `mode: each`; `options.waitForSubWorkflow: false`. Despacha sin esperar (07 §Concurrencia). | — |
| 11 | `Registrar barrera R1` | `postgres` | 2.7 | `INSERT INTO forense.pasos_pipeline (caso_id, paso='ronda1', revision, tareas_esperadas, snapshot_senales, deadline)`. La barrera es el conjunto guardado, no un conteo de filas. | `Forense Postgres` |
| 12 | `Esperar barrera R1` | `postgres` | 2.7 | Poll acotado: `SELECT * FROM forense.estado_barrera($1::uuid,'ronda1')` → `{completa, faltantes, vencida}`. Conexión corta: no hay bucle SQL bloqueante esperando al modelo (17 §2). | `Forense Postgres` |
| 13 | `¿Barrera completa?` | `if` | 2.3 | `={{ $json.completa }}`. Falsa y no vencida → `Espera barrera` (14). Vencida → sigue con limitaciones (error/timeout **no** es ausencia de fraude, 07). | — |
| 14 | `Espera barrera` | `wait` | 1.1 (SDK MCP) | `resume: timeInterval`, 10 s → vuelve a (12). El reconciliador es la red de seguridad real. | — |
| 15 | `Ronda fin R1` | `postgres` | 2.7 | Evento `ronda_fin` con resultados y limitaciones. Cero señales exige resultado explícito. | `Forense Postgres` |
| 16 | `Evaluar frontera y despertar` | `code` | 2 | **Generado** desde `n8n/runtime/nodos/evaluar-frontera.mjs` (tabla de disparo de 03 inlineada, una sola expansión por cluster). Conjunto vacío → salta a auditoría. Un test compara este nodo contra `despertar.mjs` para que no se separen. | — |
| 17 | `¿Hay ronda 2?` | `if` | 2.3 | `={{ $json.despertados.length > 0 }}` | — |
| 18 | `Expandir cluster` | `postgres` | 2.7 | Solo si la frontera lo exige y queda la única cuota: agrega RFC/aristas, recalcula pistas afectadas, `version_contexto += 1`, eventos `despertar`/`ronda_inicio`. | `Forense Postgres` |
| 19 | `Crear tareas R2` | `postgres` | 2.7 | `(ronda=2, intento=0)` **solo** para el conjunto despertado; titulares + IDs + objetivo, sin historial libre de conversación. | `Forense Postgres` |
| 20 | `Despachar R2` | `executeWorkflow` | 1.3 (SDK MCP) | Igual que (10). | — |
| 21 | `Barrera R2` | `postgres` | 2.7 | Igual que (11)–(15) con `paso='ronda2'`. Dos tareas despertadas **no** esperan cinco. | `Forense Postgres` |
| 22 | `Auditoría` | `postgres` + `executeWorkflow` | 2.7 / 1.3 | Persiste `auditando`, crea la **tarea** del Auditor (consume cuota global) y la despacha al worker con `rol='auditor'`, ≤12 herramientas. | `Forense Postgres` |
| 23 | `Validar evidencia propuesta` | `postgres` | 2.7 | `SELECT public.forense_validar_evidencia(...)`: pertenencia, valores y soporte resueltos desde DB. Un ID existente no demuestra la hipótesis. | `Forense Postgres` |
| 24 | `Defensa` | `postgres` + `executeWorkflow` | 2.7 / 1.3 | `defendiendo`; Defensor ≤15 herramientas; inserta argumentos con `evidencia_objetivo_ids`; eventos `defensa_inicio`/`defensa_argumento`. | `Forense Postgres` |
| 25 | `Réplica` | `executeWorkflow` | 1.3 (SDK MCP) | Worker con `rol='replica'`, **sin tools**, una pasada; resuelve por `defensa_id`. No decide nivel. | — |
| 26 | `Aplicar resolución` | `postgres` | 2.7 | Transacción: `casos.evaluacion_pistas[pista_id]` y solo evidencias objetivo; `evidencia.refutada=true`; `validada = valida_tecnica AND NOT refutada`. **Nunca** toca `pistas.estado` global. Evento `replica`. | `Forense Postgres` |
| 27 | `Paquete auditor final` | `postgres` | 2.7 | Construye `{caso, pistas, evidencia, pendientes, cobertura_completa, presupuesto}` desde DB. Entrada preparada por backend, nunca JSON de agente sin validar (07). | `Forense Postgres` |
| 28 | `Auditor Final` | `code` | 2 | **Generado**: contenido literal de `n8n/code/auditor-final.js` (fuente `n8n/runtime/auditor-final.mjs`, región CODE_NODE; `node n8n/runtime/generar-code-nodes.mjs --check` verifica que no hay deriva). Devuelve `{rechazo, nivel, familias, monto_en_riesgo_centavos, regla, limitaciones}`. | — |
| 29 | `¿Rechazo reparable?` | `if` | 2.3 | `={{ $json.rechazo !== null }}` | — |
| 30 | `Claim de reintento` | `postgres` | 2.7 | `UPDATE forense.casos SET n_reintentos = n_reintentos + 1 WHERE id=$1 AND n_reintentos < 2 RETURNING n_reintentos`. Autoriza 1 y 2. Eventos `rechazo_auditor_final`, `reintento_inicio`. | `Forense Postgres` |
| 31 | `Llamar reintento` | `executeWorkflow` | 1.3 (SDK MCP) | `workflowId → FORENSE_reintento`, `options.waitForSubWorkflow: true`; retorna `{reanudar_en, limitaciones}` y **reanuda donde indica** (auditoría/defensa/réplica). No repite preparación ni crea caso. | — |
| 32 | `Guardar dictamen` | `postgres` | 2.7 | Nivel permitido por la evidencia; nunca forzar presunción. Guarda familias, monto deduplicado, `dictamen` con regla y `casos.resultado_por_rfc` (no hereda el nivel a satélites). | `Forense Postgres` |
| 33 | `Redacción` | `postgres` + `executeWorkflow` | 2.7 / 1.3 | `redactando`, `redaccion_inicio`; worker `rol='redactor'` sin tools con hechos validados, límites, defensas y citas permitidas. Incluye las secciones fijas «Trayectoria» y «Cadena de explicación» (21 §2 y §4). | `Forense Postgres` |
| 34 | `Validar citas` | `postgres` | 2.7 | Cada cita resuelve a un ID validado; coincidencia de nivel y monto; cada paso de la cadena cita al menos un ID o declara «sin evidencia». Fallo tras reparación acotada → conserva dictamen y error de expediente. | `Forense Postgres` |
| 35 | `Cerrar caso` | `postgres` | 2.7 | `dictaminado\|error`, `terminado`, `duracion_ms`, herramientas/tokens, libera lease. Presupuesto agotado → parcial con `no_concluyente`. | `Forense Postgres` |
| 36 | `Avisar agregador` | `executeWorkflow` | 1.3 (SDK MCP) | Notifica a `investigaciones` con `investigacion_id`. **Solo el agregador** transiciona a `investigacion_completa` y emite outbox: ni especialista ni redactor ni subcaso marcan el teléfono (07 §24, 16 §1). | — |
| 37 | `Nota barrera` | `stickyNote` | 1 | «La barrera espera el conjunto despachado, no cinco ramas.» | — |

---

## 4. `FORENSE_reintento`

Entrada `{caso_id, intento, motivo, objetivo}` tras el claim del padre. `intento` solo 1 o 2; **no**
incrementa otra vez. Retorna al padre; no invoca recursivamente investigación.

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Entrada reintento` | `executeWorkflowTrigger` | 1.2 (SDK MCP) | `{caso_id, intento, motivo, objetivo}` | — |
| 2 | `Validar intento` | `code` | 2 | Rechaza `intento ∉ {1,2}` y objetivo vacío. No incrementa contadores. | — |
| 3 | `Cargar caso vigente` | `postgres` | 2.7 | Caso, historial, `version_contexto` vigente, presupuesto restante. Conserva caso/historial (17 §3). | `Forense Postgres` |
| 4 | `Ruta por motivo` | `switch` | 3.4 | `evidencia_insuficiente` \| `cadena_incompleta` \| `defensa_no_considerada` \| `evidencia_invalida` \| `contradiccion`; `fallbackOutput: none`. | — |
| 5 | `Seleccionar autores` | `code` | 2 | Por motivo (07 §3): especialistas con comprobación pendiente en familia evaluable; Financiero/Relacional con ruta concreta; Defensor con trampa/evidencias objetivo; autor de la evidencia inválida; autores en contradicción con ambos hechos. **No** «todos los faltantes por defecto». | — |
| 6 | `¿Queda cuota de expansión?` | `if` | 2.3 | Solo para `cadena_incompleta`; si se consumió, registra el límite y sigue sin expandir. | — |
| 7 | `Crear tareas de revisión` | `postgres` | 2.7 | `(ronda=2, intento=1\|2, version_contexto vigente)`; señales nuevas enlazadas a las previas, historia preservada. | `Forense Postgres` |
| 8 | `Despachar revisión` | `executeWorkflow` | 1.3 (SDK MCP) | `FORENSE_ejecutar_agente`, `mode: each`, sin esperar. | — |
| 9 | `Barrera reintento` | `postgres` + `if` + `wait` | 2.7 / 2.3 / 1.1 | Mismo patrón que §3 (11)–(15) con `paso='reintento'`. | `Forense Postgres` |
| 10 | `Revalidar si cambió evidencia` | `postgres` | 2.7 | Repite validaciones/defensas aplicables antes del dictamen. | `Forense Postgres` |
| 11 | `Retornar al padre` | `code` | 2 | `{reanudar_en: 'auditoria'\|'defensa'\|'replica', limitaciones}`. | — |

---

## 5. `FORENSE_editar_expediente`

Webhook servidor `POST /webhook/forense/editar`. El BFF normaliza propietario, IDs y selección
(15). Presupuesto propio por operación: máximo 3 requests, deadline 90 s (17 §6).

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Webhook editar` | `webhook` | 2.1 | `POST`, `path: forense/editar`, `authentication: headerAuth`, `responseMode: responseNode` | `Forense Webhook` |
| 2 | `Validar solicitud` | `code` | 2 | Contrato `editor.solicitud`: `{caso_id, instruccion, seleccion?, version_base, directriz_id?, modo: pregunta\|propuesta, idempotency_key}`. El texto del documento es **dato**, no system prompt. | — |
| 3 | `Cargar versión base` | `postgres` | 2.7 | Versión base, evidencia/argumentos verificados, dictamen; persiste el mensaje de usuario. | `Forense Postgres` |
| 4 | `Abrir operación editor` | `postgres` | 2.7 | `INSERT INTO forense.ejecuciones_agente (editor_operacion_id, rol='editor', deadline_at=now()+90s)`; XOR con `tarea_id`; unicidad por operación (varias ediciones del mismo caso). | `Forense Postgres` |
| 5 | `Ejecutar editor` | `executeWorkflow` | 1.3 (SDK MCP) | `FORENSE_ejecutar_agente` con `rol='editor'`, sin tools, `waitForSubWorkflow: true`. | — |
| 6 | `Validar propuesta` | `code` | 2 | No introduce IDs ajenos, montos distintos ni cambio de nivel; verifica `seleccion.hash` contra `version_base`. Documento cambiado → conflicto conservando el borrador. | — |
| 7 | `Ruta por modo` | `switch` | 3.4 | `respuesta` (pregunta: solo chat) \| `fragmento` \| `documento`. | — |
| 8 | `Guardar propuesta` | `postgres` | 2.7 | `INSERT INTO forense.propuestas_edicion (patch, diff, citas)` → `propuesta_id`. **Todavía no cambia el expediente**: Aplicar es operación determinista del BFF. | `Forense Postgres` |
| 9 | `Responder` | `respondToWebhook` | 1.5 | `{modo, mensaje, propuesta_id?}`. Ninguna edición reactiva una notificación de fin ya emitida. | — |

---

## 6. `FORENSE_corrida`

Webhook autenticado `POST /webhook/forense/corrida`. `dataset` selecciona un origen autorizado,
nunca una URL arbitraria.

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Webhook corrida` | `webhook` | 2.1 | `POST`, `path: forense/corrida`, `authentication: headerAuth`, `responseMode: responseNode` | `Forense Webhook` |
| 2 | `Validar e idempotencia` | `postgres` | 2.7 | Reutiliza corrida `lista` con la misma `idempotency_key` o crea `preparando`. Una corrida vacía no se investiga. | `Forense Postgres` |
| 3 | `Responder 202` | `respondToWebhook` | 1.5 | `{corrida_id, estado}` para seguimiento por UI. | — |
| 4 | `Cargar o clonar snapshot` | `postgres` | 2.7 | Snapshot **completo**; `corrida_origen_id` clona. | `Forense Postgres` |
| 5 | `Verificar integridad` | `postgres` | 2.7 | Conteos, `dataset_hash`, `fecha_corte`, `familias_evaluables` → `lista`; fallo → `error` con causa. | `Forense Postgres` |
| 6 | `Correr pistas` | `postgres` | 2.7 | `SELECT forense.correr_pistas($1::uuid)` con la corrida aún `lista`: la función hace el claim atómico a `procesando`. n8n **no** anticipa el cambio de estado. | `Forense Postgres` |
| 7 | `Armar clusters` | `postgres` | 2.7 | `SELECT forense.armar_clusters($1::uuid)` | `Forense Postgres` |
| 8 | `Clusters por score` | `postgres` | 2.7 | Orden por score; devuelve la cola completa. | `Forense Postgres` |
| 9 | `Despachar hasta 4` | `code` + `executeWorkflow` | 2 / 1.3 (SDK MCP) | Máximo 4 clusters activos; repone slots al terminar; conserva la cola restante si se acaba el tiempo. Input `{cluster_id, corrida_id, investigacion_id, idempotency_key}`. | — |
| 10 | `Esperar y reconciliar` | `postgres` + `if` + `wait` | 2.7 / 2.3 / 1.1 | Espera los clusters admitidos; reconcilia errores/timeouts y leases. **No** cierra la corrida al terminar de despachar. | `Forense Postgres` |
| 11 | `Métricas` | `postgres` | 2.7 | `SELECT forense.v_metricas_corrida($1::uuid)` — pese al prefijo `v_`, el contrato de 05/10 es una **función** `RETURNS jsonb` con parámetro `p_corrida uuid`. | `Forense Postgres` |
| 12 | `Cerrar corrida` | `postgres` | 2.7 | `fin`, métricas, `completada` con conteos completados/en cola/error y cobertura; `error` si falla antes de resultados utilizables. | `Forense Postgres` |

---

## 7. `FORENSE_inyectar` — inyección en vivo (21 §3)

**Una inyección nunca muta un snapshot existente.** Crea una corrida nueva
(`corrida_origen_id = base`), clona, añade filas, recalcula y despacha **primero** los clusters con
RFC inyectados.

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Webhook inyectar` | `webhook` | 2.1 | `POST`, `path: forense/inyectar`, `authentication: headerAuth`, `responseMode: responseNode`. Body `{corrida_base_id, ingesta_id, idempotency_key, prioridad:'inyectados'}` (21 §3.1). | `Forense Webhook` |
| 2 | `Registrar inyección` | `postgres` | 2.7 | `INSERT INTO forense.inyecciones (... estado='recibida', origen, hash_payload)`; evento `bitacora.tipo_evento='inyeccion'`. | `Forense Postgres` |
| 3 | `Responder 202` | `respondToWebhook` | 1.5 | `{inyeccion_id, estado}` → la UI abre `/inyecciones/[id]`. | — |
| 4 | `Validar filas` | `postgres` | 2.7 | Validación determinista de 19: claves, FK contra snapshot base **más** filas nuevas, moneda, fechas ≤ `fecha_corte` (si una supera, la corrida nueva adopta la fecha máxima inyectada y lo declara), duplicados por UUID = rechazo con motivo, sin etiquetas. → `validada` \| `rechazada`. | `Forense Postgres` |
| 5 | `¿Validada?` | `if` | 2.3 | Falsa → `Cerrar rechazada` con `diagnostico`. | — |
| 6 | `Clonar corrida` | `postgres` | 2.7 | `SELECT forense.clonar_corrida_con_inyeccion($1::uuid,$2::uuid)` → `corrida_nueva_id`. Transacción única; `dataset_hash` nuevo; corrida queda `lista`. Estado `snapshot_creado`. | `Forense Postgres` |
| 7 | `Recalcular pistas y clusters` | `postgres` | 2.7 | `correr_pistas` + `armar_clusters` sobre la corrida nueva → `pistas_recalculadas`. | `Forense Postgres` |
| 8 | `Priorizar afectados` | `code` | 2 | Ordena clusters que contienen `rfcs_afectados` primero; el resto queda `en_cola` (regla 10 intacta). | — |
| 9 | `Despachar afectados` | `executeWorkflow` | 1.3 (SDK MCP) | `FORENSE_investigar_cluster`, `mode: each`, sin esperar → estado `investigando`. | — |
| 10 | `Despachar resto` | `executeWorkflow` | 1.3 (SDK MCP) | Tras los afectados, hasta el límite de 4 activos. | — |
| 11 | `Cerrar inyección` | `postgres` | 2.7 | `completada` con `terminado`; latencia recibida→dictamen para ESTADO.md (21 §3.4). | `Forense Postgres` |

**Dependencia de contratos:** este worktree tiene `contracts` v1.0.0. El coordinador publicó 1.1.0
en `main` con `product.inyectar` / `product.inyeccion`. Al integrar hay que reconciliar el body del
webhook y el registro de estados contra esos schemas; los nombres de campo usados aquí salen de la
prosa de 21 §3, no de un schema validado.

---

## 8. `FORENSE_notificar_completada` (16 §2)

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Webhook investigación completa` | `webhook` | 2.1 | `POST`, `path: forense/investigacion-completa`, `authentication: headerAuth`; lo dispara un Database Webhook sobre INSERT de `eventos_salida`. | `Forense Webhook` |
| 2 | `Releer evento desde DB` | `postgres` | 2.7 | **No** confía en el payload: relee evento y estado. Un teléfono en el payload se ignora. | `Forense Postgres` |
| 3 | `Reclamar evento` | `postgres` | 2.7 | Claim atómico con lease; unicidad `(investigacion_id, tipo_evento)`. Cinco entregas del webhook no generan cinco llamadas. | `Forense Postgres` |
| 4 | `Resolver destinatario` | `postgres` | 2.7 | Perfil propietario, teléfono E.164, preferencia de llamadas vigente y permiso guardado. | `Forense Postgres` |
| 5 | `¿Puede llamar?` | `if` | 2.3 | Sin teléfono/preferencia → (6). | — |
| 6 | `Omitir con motivo` | `postgres` | 2.7 | `omitida` + motivo; el aviso in-app se mantiene. | `Forense Postgres` |
| 7 | `Crear intento de llamada` | `postgres` | 2.7 | Congela destinatario y configuración; reclama `solicitando` **antes** del POST. | `Forense Postgres` |
| 8 | `POST outbound-call` | `httpRequest` | 4.2 | `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call`; `authentication: genericCredentialType`, `genericAuthType: httpHeaderAuth`; body de 16 §3 con `dynamic_variables` normalizadas. **Nunca** RFC, montos, sospechas ni reporte. `neverError: true`. | `ElevenLabs Forense` |
| 9 | `Guardar aceptación` | `postgres` | 2.7 | Comprueba `success`; guarda `conversation_id`/`callSid`. HTTP 200 = solicitud aceptada, **no** que alguien contestó. Timeout tras enviar → `resultado_desconocido`, sin redial ciego. | `Forense Postgres` |

Bloqueo externo conocido (21 §5): la cuenta ElevenLabs tiene **cero números salientes**. Este
workflow se entrega con adaptador y pruebas sin llamada real.

---

## 9. `FORENSE_resultado_llamada` (16 §3)

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Webhook resultado` | `webhook` | 2.1 | `POST`, `path: forense/elevenlabs-resultado`, `options.rawBody: true` (la HMAC se verifica sobre el cuerpo **crudo**). | — |
| 2 | `Verificar HMAC` | `code` | 2 | Firma sobre cuerpo crudo + ventana temporal. Firma inválida → 401 sin escribir. | — |
| 3 | `Deduplicar` | `postgres` | 2.7 | Por evento/identidad del proveedor; correlación por `conversation_id`/`callSid`. Un callback que llega antes de guardar el POST se **conserva** para conciliación posterior. | `Forense Postgres` |
| 4 | `Actualizar llamada` | `postgres` | 2.7 | Mapea solo hechos recibidos a `pendiente\|solicitando\|aceptada\|en_curso\|finalizada\|fallida\|sin_respuesta\|omitida\|resultado_desconocido`. `aviso_entregado` solo si el análisis lo respalda. El fallo de voz **no** revierte la investigación ni borra el reporte. | `Forense Postgres` |
| 5 | `Responder 200` | `respondToWebhook` | 1.5 | Acuse mínimo, sin datos del caso. | — |

---

## 10. `FORENSE_reconciliador` y `FORENSE_errores` (soporte técnico)

### 10.1 `FORENSE_reconciliador`

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Cada 10 s` | `scheduleTrigger` | 1.3 (SDK MCP) | `interval: seconds`, `secondsInterval: 10`. Configurable y a validar en la instancia (17 §3). Es **recuperación**, no el camino normal: el dispatcher es inmediato al guardar checkpoint. | — |
| 2 | `Slots vencidos` | `postgres` | 2.7 | `SELECT * FROM forense.recover_expired(now())`: leases vencidos, tareas huérfanas, pasos sin avance. Incrementa `fencing_token` al reasignar. | `Forense Postgres` |
| 3 | `Redespachar pasos` | `executeWorkflow` | 1.3 (SDK MCP) | `FORENSE_ejecutar_agente` para los pasos recuperables; sin esperar. | — |
| 4 | `Barreras vencidas` | `postgres` | 2.7 | Cierra barreras con deadline vencido marcando limitaciones; `advance_case_if_ready`. | `Forense Postgres` |
| 5 | `Outbox pendiente` | `postgres` + `executeWorkflow` | 2.7 / 1.3 | Reenvía eventos de `eventos_salida` no entregados (16 §2). Backoff de outbox **no** equivale a repetir una llamada aceptada. | `Forense Postgres` |

### 10.2 `FORENSE_errores`

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Error Trigger` | `errorTrigger` | 1 (SDK MCP) | Entrada de **otra ejecución**, no un catch de la rama normal (07). No corre en pruebas manuales de n8n: se prueba con webhook automático y fallo controlado. | — |
| 2 | `Resolver por execution.id` | `postgres` | 2.7 | Localiza caso/tarea por `n8n_execution_id` persistido. | `Forense Postgres` |
| 3 | `¿Propietario vigente?` | `if` | 2.3 | Comprueba owner/fence antes de escribir: un proceso viejo no cierra un caso ajeno. | — |
| 4 | `Registrar y liberar` | `postgres` | 2.7 | Causa en bitácora, tarea a `error`, libera slot/lease. Una tarea fallida **pasa por la barrera** para conservar los resultados de las demás. | `Forense Postgres` |

---

## 11. Verificación mecánica

Todo esto corre con `node --test "n8n/tests/*.test.mjs"` (**317 pasan, 0 fallan**).

`n8n/tests/workflows.test.mjs` comprueba, para **cada** archivo de `n8n/workflows/*.json`:

1. Parsea y tiene `name`, `nodes`, `connections`, `active`, `settings`.
2. `active === false` y `settings.executionOrder === 'v1'`.
3. Nombres de nodo únicos y no vacíos.
4. Toda clave de `connections` es el **nombre** de un nodo existente (no un id).
5. Todo destino `connections[*].main[i][j].node` existe y trae `type: 'main'` e `index` entero.
6. Todo par `(type, typeVersion)` está en la tabla de §0.3.
7. Ninguna credencial trae `id`; todas traen `name` de la tabla de §0.2.
8. No aparece `n8n-nodes-langchain` ni `$fromAI` en ningún parámetro.
9. Barrido de secretos: `sk-ant`, `service_role`, `eyJ` (JWT), y ningún valor literal en cabeceras
   `x-api-key` / `apikey` / `Authorization`.
10. `pinData` y `staticData` ausentes o vacíos.
11. En `FORENSE_ejecutar_agente`: `Reservar request` alcanza a `POST /v1/messages` por el grafo,
    y no al revés (17 §5.3, reservar antes del HTTP).
12. En `FORENSE_investigar_cluster`: el cuerpo del Code node `Auditor Final` es **idéntico** al
    archivo generado `n8n/code/auditor-final.js`.
13. Las cuatro rutas de transporte son excluyentes y cada una lleva a un solo destino, con
    `fallbackOutput: none`.
14. Toda rama del worker llega a `Guardar checkpoint` antes de cerrar, y el cierre pasa por
    `Finalizar paso` → `Avanzar caso si listo`.

`n8n/tests/contratos-nodos.test.mjs` (corte 2) añade el contrato **entre** nodos:

15. Para los **diez** workflows: cada `$json.campo` lo publica un antecesor inmediato, y cada
    `$('Nodo').first().json.campo` apunta a un nodo que existe, **es antecesor** y publica ese
    campo. Los nodos de paso (`if`/`switch`/`wait`/`respondToWebhook`) reenvían los campos de su
    antecesor en vez de publicar los suyos.
16. `CONTRATOS_NODOS` cubre exactamente los nodos que publican datos, y lo declarado aparece en la
    fuente del nodo (texto de la consulta o cuerpo del Code node). Los nodos con `SELECT * FROM f()`
    sobre funciones de 004–008 se listan en `FORMA_PENDIENTE`: no se aprueban en silencio.
17. La rama de herramientas es **lineal** (una sola entrada por nodo hasta `Armar tool_results`):
    ver §2.1.
18. La rama NO terminal pasa por `Registrar paso guardado` antes de redespachar (regla 2).
19. `advance_case_if_ready` se llama con tres argumentos, y ninguna función de 17 §4 con su firma
    vieja (`reserve_request` con `::uuid`, `finish_step` con cuatro, `registrar_evento`, UPDATE
    suelto sobre `tool_ejecuciones`).

`n8n/tests/prompts-embebidos.test.mjs` cubre el system que viaja dentro del JSON:

20. El JSON lleva `version_prompts` y el sha256 del manifest de `n8n/prompts/`.
21. El system embebido es **idéntico** al que produce `n8n/prompts/ensamblar.mjs` para los seis
    roles con fixture de contexto en `contracts/fixtures/valid/`, y su parte fija coincide para los
    diez roles.
22. Un `.md` de prompts modificado sin regenerar el manifest **hace fallar la generación** (se
    comprueba sobre una copia en tmp; `n8n/prompts/` es de otro dueño y no se toca).
23. Los roles sin herramientas no reciben la clave `tools`, y el techo de caracteres se aplica al
    **paquete**, no al system (`ambito_techo='paquete'`).

`n8n/tests/preparar-sql.mjs` (fuera de `node --test`: necesita una base local) hace `PREPARE` de las
73 consultas contra Postgres 17 con 001–003 aplicadas: **`ok=25 pendiente_004_005=48 falla=0`**.
`PREPARE` analiza y comprueba tipos sin ejecutar nada. Así se encontraron y corrigieron tres
defectos reales que ningún test de forma veía: `forense.registrar_evento` no existe,
`pasos_pipeline.snapshot_senales` es `bigint[]` (y `estado` no admite `'esperando'`), y
`forense.casos` no tiene `version_contexto` ni `expansiones_usadas` —están en `clusters`—.

Lo que **nada** de esto prueba: que n8n importe el archivo, que los `typeVersion` existan en la
instancia, que las funciones de 004–008 existan o devuelvan la forma declarada, ni un solo byte de
conectividad. Eso es el smoke del coordinador: `n8n/workflows/IMPORT.md` §5.

---

## 12. Dependencias abiertas (para el coordinador)

El detalle accionable, con comandos y tablas, está en **`n8n/workflows/IMPORT.md`**. Resumen:

- **`forense.advance_case_if_ready(caso_id, paso, revision_expected)`**: DECISIONES H3 01:35 le da
  el `paso`, el JSON y `dispatcher.mjs` ya la llaman con tres argumentos, y `db/002_views.sql`
  publica hoy la de dos. **Bloquea el cierre de cualquier paso terminal.**
- **Dos valores en el check `ck_bitacora_tipo_evento`**: `paso_en_cola` y `paso_checkpoint`
  (comprobado contra la base local: no están). Los exige la regla 2 para la rama en cola y la rama
  que continúa. Alternativa de una línea por nodo si el coordinador prefiere no ampliar el enum,
  a costa de que la UI no distinga esos eventos del `razonamiento`.
- **Funciones de 004–008** que el JSON llama (48 referencias, listadas por `preparar-sql.mjs`).
  Para cada nodo, `CONTRATOS_NODOS` declara las **columnas que debe devolver**: ésa es la
  especificación que la migración tiene que cumplir.
- **Idempotencia por `p_operacion`** en los wrappers `public.forense_*` (06 §Runtime): la rama de
  herramientas es lineal y depende de que una reentrega devuelva el resultado registrado sin
  consumir cuota (§2.1).
- **`008_ingesta.sql`** con `forense.inyecciones`, `forense.clonar_corrida_con_inyeccion` y
  `tipo_evento='inyeccion'` (21 §3.2; el enum ya lo trae en 001).
- **Credenciales**: crear `Forense Postgres`, `Forense Supabase`, `Forense Webhook` y
  `ElevenLabs Forense`; la del modelo se llama `Anthropic account`.
- **`BASE_REST`**: sustituir `https://PENDIENTE_SUPABASE_REF.supabase.co/rest/v1` en el Code node
  `Expandir cola de tools` por la URL REST del proyecto de la corrida.
- **Versión de n8n**: `launch.config.json` dice 2.33.7; los `typeVersion` marcados «según SDK MCP»
  siguen sin observarse en esta instancia. Si alguno no existe, se ajusta el JSON y se reexporta.
- **IDs de subworkflow**: sustituir los quince `PENDIENTE_*` tras importar, en el orden de §1.
- **Adaptador de voz**: `integrations/elevenlabs` (forense-voice) todavía no existe.
  `n8n/runtime/voz-adaptador.mjs` deja la interfaz y un stub marcado; sin verificador HMAC, el
  workflow de callback **rechaza** en vez de aceptar sin firma.
