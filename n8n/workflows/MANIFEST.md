# MANIFEST de workflows n8n — proyecto Forense

Dueño: **forense-runtime**. Fuentes normativas: `17-runtime-n8n.md` (autoridad de runtime),
`07-n8n-workflows.md` (lógica por workflow), `16-notificaciones-elevenlabs.md` (voz),
`19-ingesta-datasets.md` (ingesta), `21-criterios-juez-e-inyeccion-en-vivo.md` (§3 inyección,
normativo sobre 00–20), `06-rpc-herramientas.md` (herramientas), `03-arquitectura-agentica.md`
(cuotas y despertar).

**Estado real de este archivo:** es el plano nodo por nodo. Ninguno de estos workflows ha sido
importado, ejecutado ni activado: no hubo red en esta sesión. Lo único verificado aquí por comando
es la forma de los JSON emitidos (`n8n/tests/workflows.test.mjs`). Que la instancia los acepte
queda **pendiente** hasta el smoke del coordinador.

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
`FORENSE_investigar_cluster`: se importa **entre 5 y 6**. Ningún workflow se activa antes del smoke
(17 §2). Los webhooks quedan en modo test hasta que el smoke pase.

---

## 2. `FORENSE_ejecutar_agente` — worker de paso  *(JSON emitido: `FORENSE_ejecutar_agente.json`)*

Entrada `{tarea_id, execution_id?, owner, motivo?}`. Un paso: **una** petición de modelo **o** un
lote de herramientas; guarda checkpoint y termina (17 §3). Sustituye al worker con AI Agent de 07.

| # | Nodo | Tipo | typeV | Parámetros clave | Credencial |
|---|---|---|---|---|---|
| 1 | `Paso entrante` | `executeWorkflowTrigger` | 1.2 (SDK MCP) | `inputSource: passthrough` | — |
| 2 | `Reclamar paso` | `postgres` | 2.7 | `operation: executeQuery`; `SELECT * FROM forense.claim_step($1::uuid, $2::text)`; `queryReplacement` = `execution_id`, `owner`; `options.queryBatching: single` | `Forense Postgres` |
| 3 | `¿Claim vigente?` | `if` | 2.3 | boolean `={{ $json.ok }}` es true | — |
| 4 | `Paso no reclamable` | `code` | 2 | Devuelve `{estado:'en_cola', motivo}`. Rama falsa de (3): el slot es de otro owner con lease vigente; **pendiente, no fallido** (17 §3). | — |
| 4b | `Registrar en_cola` | `postgres` | 2.7 | `SELECT forense.registrar_evento($1::uuid, 'paso_en_cola', $2::jsonb)`. Sin evento persistido no hay progreso visible (regla 2 de CLAUDE.md; 21 §3.3): la rama `en_cola` también deja rastro. | `Forense Postgres` |
| 5 | `Cargar ejecución` | `postgres` | 2.7 | `SELECT e.*, a.contenido AS contexto, t.caso_id, t.agente, t.ronda, t.intento FROM forense.ejecuciones_agente e JOIN forense.artefactos_contexto a ON a.hash = e.context_hash LEFT JOIN forense.tareas_agente t ON t.id = e.tarea_id WHERE e.id = $1::uuid` | `Forense Postgres` |
| 6 | `Decidir accion` | `code` | 2 | **Generado** desde `n8n/runtime/nodos/decidir-paso.mjs`. Lee `estado_interno`, `deadline_at`, `reparaciones_json` y cola pendiente → `{accion, motivo_request, evento}`. No inventa estados. | — |
| 7 | `Ruta del paso` | `switch` | 3.4 | `rules.values` sobre `={{ $json.accion }}`: `solicitar_modelo` → salida 0; `ejecutar_herramienta` → 1; `cerrar` → 2. `fallbackOutput: none` (un valor no previsto no avanza en silencio). | — |
| 8 | `Reservar request` | `postgres` | 2.7 | `SELECT * FROM forense.reserve_request($1::uuid,$2::bigint,$3::uuid)`. **Antes** del HTTP (17 §5.3). | `Forense Postgres` |
| 9 | `Construir cuerpo Messages` | `code` | 2 | **Generado** (`nodos/construir-cuerpo.mjs`). Falla si falta el modelo o si un `tool_use` quedó sin su `tool_result`. `{model, max_tokens, temperature:0, system, messages, tools}`. `model` se resuelve de configuración de cuenta, nunca del prompt del usuario (17 §5.3). En reparación: `tools` ausente. | — |
| 10 | `POST /v1/messages` | `httpRequest` | 4.2 | `method: POST`; `url: https://api.anthropic.com/v1/messages`; `authentication: predefinedCredentialType`, `nodeCredentialType: anthropicApi`; header único `anthropic-version: 2023-06-01`; `sendBody: true`, `specifyBody: json`, `jsonBody: ={{ JSON.stringify($json.cuerpo) }}`; `options.timeout: 45000`; `options.response.fullResponse: true`, `neverError: true` (429/5xx llegan como dato al clasificador, no como fallo de nodo); `retryOnFail: false` **a propósito** — el reintento propio honra `Retry-After` (17 §6). | `Anthropic account` |
| 11 | `Clasificar transporte` | `code` | 2 | **Generado** (`nodos/clasificar-transporte.mjs`). `{clase: ok\|reintentable\|ambiguo\|error, ruta, espera_ms, intento, reintentar}`. `ruta` es **excluyente** para el switch: `continuar` \| `reintentar` \| `desconocido` \| `error`. Timeout ambiguo → `desconocido`, **no** se reintenta (17 §6). | — |
| 12 | `Ruta de transporte` | `switch` | 3.4 | Cuatro salidas sobre `={{ $json.ruta }}`; `fallbackOutput: none`. El Code node decide, el switch solo enruta: una respuesta correcta no puede caer además en la rama de «desconocido». | — |
| 13 | `Backoff` | `wait` | 1.1 (SDK MCP) | `resume: timeInterval`, `amount: ={{ $json.espera_ms }}`, `unit: ms`. Vuelve a (10). Máximo dos vueltas; **no** es reintento forense. | — |
| 14 | `Marcar desconocido` | `postgres` | 2.7 | `UPDATE forense.llm_solicitudes SET estado='desconocido', error=$2::jsonb WHERE request_id=$1::uuid`. Puede haber coste externo sin respuesta: no se anuncia exactly-once (17 §6). | `Forense Postgres` |
| 14b | `Marcar error de request` | `postgres` | 2.7 | `UPDATE ... SET estado='error', error=$2::jsonb`. Error permanente del proveedor o reintentos de transporte agotados: el paso cierra en error y no reintenta por su cuenta. | `Forense Postgres` |
| 15 | `Interpretar respuesta` | `code` | 2 | **Generado** (`nodos/interpretar-respuesta.mjs`). Clasifica `stop_reason` → `tool_use` \| `end_turn` \| `max_tokens` \| `refusal` \| `stop_desconocido`, extrae bloques assistant y cola de `tool_use` con sus IDs, y calcula el evento de la máquina. No ejecuta herramientas mencionadas en texto (17 §5.6). **Límite declarado:** un Code node no puede cargar el validador de `contracts/`, así que comprueba estructura por rol y marca `requiere_validacion_contrato: true`; la validación autoritativa la hace el backend. | — |
| 15b | `Validar salida contra contrato` | `postgres` | 2.7 | `SELECT * FROM forense.validar_salida_rol($1::uuid, $2::text, $3::jsonb)`. **Segundo nivel de 17 §8**: schema del rol, IDs, unidades y sustento, en backend. Sin este nodo, un `salida_estructura_ok` del Code node llegaría al checkpoint como si fuera salida válida. **Depende de forense-db.** | `Forense Postgres` |
| 16 | `Completar request` | `postgres` | 2.7 | `UPDATE forense.llm_solicitudes SET estado='completado', provider_request_id=$2, usage=$3::jsonb, modelo=$4, duracion_ms=$5 WHERE request_id=$1::uuid` | `Forense Postgres` |
| 17 | `Reclamar tool` | `postgres` | 2.7 | `SELECT * FROM forense.claim_tool($1::uuid,$2::bigint,$3::uuid,$4::text,$5::text)` (execution, fence, request, tool_use_id, args_hash). Unicidad `(request_id, tool_use_id)`: la reentrega devuelve el registro previo. | `Forense Postgres` |
| 18 | `¿Tool nueva?` | `if` | 2.3 | `={{ $json.nuevo }}` es true. Falsa → (19). | — |
| 19 | `Reentrega registrada` | `code` | 2 | Devuelve el resultado ya guardado. **No** consume cuota ni repite mutación (17 §6). | — |
| 20 | `Llamar RPC forense` | `httpRequest` | 4.2 | `POST ={{ $json.base_rest }}/rpc/{{ $json.nombre }}`; `authentication: predefinedCredentialType`, `nodeCredentialType: supabaseApi`; `jsonBody` = argumentos validados + `p_operacion`, `p_tarea`, `p_caso` fijados por backend; **sin** `Content-Profile` (wrappers `public.forense_*`, 07); `options.timeout: 20000`, `neverError: true`. | `Forense Supabase` |
| 21 | `Registrar resultado tool` | `postgres` | 2.7 | `UPDATE forense.tool_ejecuciones SET estado=$2, resultado=$3::jsonb, duracion_ms=$4 WHERE request_id=$5::uuid AND tool_use_id=$6::text`. La RPC ya escribió evidencia/bitácora una sola vez (17 §4). | `Forense Postgres` |
| 22 | `Armar tool_results` | `code` | 2 | **Generado** (`nodos/armar-tool-results.mjs`). Un `tool_result` por **cada** `tool_use_id`, en orden, incluidos errores tipificados, sin texto ordinario antes (17 §5.5). | — |
| 23 | `Guardar checkpoint` | `postgres` | 2.7 | `SELECT * FROM forense.save_checkpoint($1::uuid,$2::bigint,$3::int,$4::jsonb)`. CAS sobre `(caso_id,paso,revision)` + fencing. Un proceso con lease vencido no puede escribir. | `Forense Postgres` |
| 24 | `¿Estado terminal?` | `if` | 2.3 | `={{ ['terminado','error','timeout'].includes($json.estado_interno) }}` | — |
| 25 | `Redespachar paso` | `executeWorkflow` | 1.3 (SDK MCP) | Se llama a sí mismo con `{tarea_id, execution_id, owner}`; `options.waitForSubWorkflow: false` (dispatcher inmediato al guardar checkpoint, 17 §3). Cota: el `deadline_at` del paso y el presupuesto; no es un bucle libre. | — |
| 26 | `Finalizar paso` | `postgres` | 2.7 | `SELECT * FROM forense.finish_step($1::uuid,$2::bigint,$3::text,$4::jsonb)` → tarea `completada\|error\|timeout\|omitida`, libera slot y lease, escribe bitácora. | `Forense Postgres` |
| 27 | `Avanzar caso si listo` | `postgres` | 2.7 | `SELECT * FROM forense.advance_case_if_ready($1::uuid,$2::int)`. Es quien cierra la barrera; **no** un Merge de cinco ramas. | `Forense Postgres` |
| 28 | `Nota worker` | `stickyNote` | 1 | Recuerda: un paso = un request **o** un lote de tools; sin `$fromAI`; sin AI Agent. | — |

Conexiones (tal como salen del generador): 1→2→3; 3(true)→5, 3(false)→4→4b; 5→6→7;
7[0]→8→9→10→11→12; 12[continuar]→15→15b→16→23; 12[reintentar]→13→10; 12[desconocido]→14→23;
12[error]→14b→23; 7[1]→17→18; 18(true)→20→21→22→23, 18(false)→19→22; 7[2]→23;
23→24; 24(true)→26→27; 24(false)→25.

### 2.1 Qué falta para que este grafo **corra**, no solo para que importe

El JSON es estructuralmente válido y pasa el test de forma; **no está cableado
extremo a extremo**. Los tests prueban cada Code node contra entradas construidas
a mano y el workflow contra su topología: nadie comprueba todavía que lo que un
nodo emite sea lo que el siguiente espera. Saltos pendientes de conciliar, uno
por uno:

| Nodo | Espera | Lo que hoy llega | Falta |
|---|---|---|---|
| `Decidir accion` | `x.checkpoint` | `Cargar ejecución` devuelve la columna `checkpoint_json` | renombrar en el SELECT o en un Set previo |
| `Reservar request` | `execution_id`, `fencing_token`, `request_id` | la salida de `Decidir accion`, que no los arrastra | propagar la identidad del claim por la cadena |
| `Construir cuerpo Messages` | `modelo`, `max_tokens`, `system_bloques`, `herramientas`, `mensajes` | nada del grafo los produce todavía | un SELECT de prompts/definiciones (depende de forense-prompts y forense-db) |
| `Llamar RPC forense` | `base_rest`, `nombre`, `argumentos_backend` | la cola de `tool_use` sin resolver a argumentos de backend | nodo que fije `p_tarea`/`p_caso`/`p_operacion` desde el claim |
| `Guardar checkpoint` | `checkpoint`, `revision`, `fencing_token` | cada rama trae su propia forma | normalizar la forma del checkpoint antes del guardado |

Esto se cablea cuando existan las tablas y funciones de 17 §4 y los prompts
versionados: cablearlo antes obligaría a inventar nombres de columna que otro
dueño va a fijar. **Hasta entonces, el worker importa pero no ejecuta una
investigación.**

Dos divergencias más que conviene no «arreglar» a ciegas:

- `advance_case_if_ready`: 17 §4 la congela como `(caso_id, revision_expected)` y
  así se llama en el JSON, pero la barrera es **por paso**, así que la
  implementación en memoria de `dispatcher.mjs` necesita además `paso`. La firma
  no es de este worker: el coordinador y forense-db deciden cuál queda.
- El estado de error por `max_tokens` se alcanza por dos vocabularios: en proceso
  (`loop.mjs`) con el evento `max_tokens_agotado`, y en n8n vía
  `reparar_json` → guardia de presupuesto en `decidir-paso`. Es la misma regla de
  17 §7; unificar uno sin el otro rompe la prueba del contrario.

Familias y herramientas por rol que el nodo (9) mete en `tools` (07 §Worker, 03):
Documental `perfil,facturas,pares`; Financiero `conciliar,seguir_dinero,facturas`;
Relacional `relacionados,ciclos,facturas`; Temporal `perfil,facturas,pares`;
Externo `listas,relacionados`; todos con `escribir_senal`, y `leer_senal` **solo** en ronda
informada (R2/reintento). Las cuotas (D/F/R 8, T 6, E 4; Auditor 12, Defensor 15) las impone
`n8n/runtime/presupuesto.mjs`, no el modelo.

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

## 11. Verificación mecánica de los JSON

`n8n/tests/workflows.test.mjs` (se ejecuta en la misma corrida que el resto:
`node --test "n8n/tests/*.test.mjs"`) comprueba para **cada** archivo de `n8n/workflows/*.json`:

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
11. En `FORENSE_ejecutar_agente`: el nodo `Reservar request` alcanza a `POST /v1/messages` por el
    grafo, y no al revés (17 §5.3, reservar antes del HTTP).
12. En `FORENSE_investigar_cluster`: el cuerpo del Code node `Auditor Final` es **idéntico** al
    archivo generado `n8n/code/auditor-final.js` (sin deriva respecto de `n8n/runtime/auditor-final.mjs`).
13. Las cuatro rutas de transporte son excluyentes y cada una lleva a un solo destino (una respuesta
    correcta no puede caer además en la rama de «desconocido»), con `fallbackOutput: none`.
14. Toda rama del worker llega a `Guardar checkpoint` antes de cerrar, y el cierre pasa por
    `Finalizar paso` → `Avanzar caso si listo`.

Lo que el test **no** prueba: que n8n importe el archivo, que los `typeVersion` existan en la
instancia, que la SQL referenciada exista, que los datos fluyan de un nodo al siguiente (§2.1), ni
nada de conectividad. Eso es el smoke del coordinador.

---

## 12. Dependencias abiertas (para el coordinador)

- **Migraciones de control (17 §4), propiedad de forense-db:** `ejecuciones_agente`,
  `artefactos_contexto`, `llm_solicitudes`, `tool_ejecuciones`, `pasos_pipeline`, `slots_runtime`,
  y las funciones `claim_step`, `reserve_request`, `claim_tool`, `save_checkpoint`, `finish_step`,
  `advance_case_if_ready`, `recover_expired`. Todo el SQL citado en este manifiesto los asume.
  Además: `forense.reclamar_cluster`, `forense.estado_barrera`, `forense.registrar_evento`,
  `forense.validar_salida_rol` (segundo nivel de validación de 17 §8) y el enlace
  `ejecuciones_agente.context_hash → artefactos_contexto.hash` (confirmar nombre de columna).
- **Firma de `advance_case_if_ready`**: 17 §4 la congela con dos argumentos y la barrera es por
  paso. Decidir si lleva `paso` y alinear JSON y `dispatcher.mjs` (hoy divergen, §2.1).
- **`008_ingesta.sql`** con `forense.inyecciones`, `forense.clonar_corrida_con_inyeccion` y
  `tipo_evento='inyeccion'` en el enum de 05 (21 §3.2).
- **Credenciales**: crear `Forense Postgres`, `Forense Supabase`, `Forense Webhook` y
  `ElevenLabs Forense` en la instancia; confirmar que la del modelo se llama `Anthropic account`.
- **Versión de n8n**: `targets.n8n_version` sigue en `null`. Confirmarla antes de importar; si algún
  `typeVersion` de §0.3 no existe, se ajusta el JSON y se reexporta.
- **IDs de subworkflow**: sustituir los `PENDIENTE_*` tras importar, en el orden de §1.
- **contracts 1.1.0**: reconciliar `FORENSE_inyectar` con `product.inyectar` / `product.inyeccion`.
