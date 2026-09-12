# IMPORT.md — importar y encender los workflows Forense

Dueño: **forense-runtime**. Quien ejecuta esto es el **coordinador**: importar,
crear credenciales y activar son permisos remotos que un worker no tiene.

**Estado honesto:** ninguno de los diez JSON ha sido importado, ejecutado ni
activado. En este worktree no hubo red. Lo verificado por comando es la forma de
los archivos, el contrato de datos entre nodos y que la SQL parsea contra
Postgres 17 con las migraciones 001–003:

| Comando | Resultado |
|---|---|
| `node --test "n8n/tests/*.test.mjs"` | 326 pasan, 0 fallan |
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

**Variables de entorno de la instancia n8n (no van en el JSON):**

| Variable | Para qué | Si falta |
|---|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN` | Debe incluir `crypto`. El Code node «Verificar HMAC» de `FORENSE_resultado_llamada` lleva embebido `integrations/elevenlabs/hmac.mjs`, que usa `createHmac`/`timingSafeEqual`. | El nodo lanza y **todo callback de voz se rechaza**. Es el lado seguro, pero la llamada nunca se marca entregada. Bloqueante para la demo de voz. |
| `FORENSE_ELEVENLABS_WEBHOOK_SECRET` | Secreto con el que ElevenLabs firma el callback. Se lee con `$env` dentro del Code node. | `verificarFirma` devuelve `secreto_no_configurado` y el callback se rechaza (401). |
| Webhook `Webhook resultado` en modo **raw body** | La firma es sobre los BYTES del cuerpo: un JSON reserializado por n8n no reproduce lo firmado. | `'el webhook no entregó el cuerpo crudo'` y 401 permanente, aunque la firma sea buena. |

### 3.3 Dependencias de base de datos (bloqueantes)

Sin esto, los workflows importan pero no corren. `preparar-sql.mjs` los localiza
uno a uno; el resumen:

1. ~~`forense.advance_case_if_ready` con tres argumentos~~ **resuelto**: 005 la
   publica como `(p_caso_id uuid, p_paso text, p_revision_expected int default
   null)` y devuelve `jsonb`. Verificado el 2026-09-12 H5 ejecutándola de verdad
   (`n8n/tests/e2e-camino-worker.mjs`), no sólo con `PREPARE`.
2. **Dos valores nuevos en el check `ck_bitacora_tipo_evento`:** `paso_en_cola` y
   `paso_checkpoint`. Comprobado con un INSERT real contra la base local:
   `ERROR: new row for relation "bitacora" violates check constraint
   "ck_bitacora_tipo_evento"`. Los usan
   `Registrar en_cola` y `Registrar paso guardado`, que existen porque la regla 2
   de CLAUDE.md exige rastro también en la rama que no cierra. Si el coordinador
   prefiere no ampliar el enum, el cambio alternativo es de una línea por nodo
   (`p_tipo => 'razonamiento'` con el evento real en el payload), pero entonces
   la UI no puede distinguir el paso en cola del razonamiento.
3. **Funciones de 004–008.** Estado medido el 2026-09-12 H5 con
   `node n8n/tests/preparar-sql.mjs <base>` sobre una base con 001–008:
   **ok=45, pendiente=28, falla=0** (antes del recableado: ok=42, pendiente=31).
   Para cada nodo que las usa, `CONTRATOS_NODOS` en
   `n8n/runtime/generar-workflows.mjs` declara **qué columnas debe devolver** y
   `FORMA_PENDIENTE` lista los nodos cuya forma sigue sin verificar. Detalle en
   §3.5.

   **Aviso importante sobre `PREPARE`:** analiza tipos, no la forma de la
   salida. Casi todas las funciones de 004–008 devuelven **`jsonb` escalar**, así
   que `SELECT * FROM forense.f(...)` pasa `PREPARE` y publica **una sola
   columna** con el nombre de la función: el nodo siguiente no encuentra
   `$json.caso_id` y el grafo se rompe donde no falló nada. Por eso los nodos del
   camino de investigación proyectan con `jsonb_to_record(...) AS x(col tipo…)`.
   `falla=0` **no** es prueba de cableado; la prueban
   `node n8n/tests/verificar-forma-nodos.mjs <base>` (ejecuta la SQL de cada
   nodo recableado dentro de BEGIN/ROLLBACK y falla si una columna declarada en
   `CONTRATOS_NODOS` vuelve NULL) y `node n8n/tests/e2e-camino-worker.mjs <base>`.

### 3.5 Funciones que faltan en 001–008 (petición a forense-db)

Verificado contra `pg_proc` de una base con 001–008 aplicadas, no supuesto.
Dos grupos distintos:

**(a) Ausentes: escrituras transaccionales que pertenecen a la migración.** El
nodo no puede inlinearlas sin duplicar invariantes (atomicidad, evento de
bitácora, liberación de lease) ni sacar el dictamen determinista de la DB:

| Función pedida | Workflow / nodo | Qué debe devolver (CONTRATOS_NODOS) |
|---|---|---|
| `forense.cerrar_ronda(caso uuid, ronda int, resumen jsonb)` | investigar_cluster / Ronda fin R1 | `senales, familias_evaluables, version_contexto, roles_por_expansion, rfcs_frontera, ruta_material, expansiones_usadas` |
| `forense.aplicar_resolucion_replica(caso uuid, tarea uuid)` | investigar_cluster / Aplicar resolución | `resoluciones` |
| `forense.paquete_auditor_final(caso uuid)` | investigar_cluster / Paquete auditor final | `caso, pistas, evidencia, pendientes, cobertura_completa, presupuesto` (lectura pura: puede quedarse como SELECT del nodo si forense-db prefiere) |
| `forense.guardar_dictamen(caso uuid, dictamen jsonb)` | investigar_cluster / Guardar dictamen | `caso_id, nivel, version` |
| `forense.validar_expediente(caso uuid, version int)` | investigar_cluster / Validar citas | `version, ok, estado_final` |
| `forense.cerrar_caso(caso uuid, estado_final text)` | investigar_cluster / Cerrar caso | `estado_final, duracion_ms` |
| `forense.autores_reintento(caso uuid, motivo text, objetivo jsonb)` | reintento / Seleccionar autores | `autores, puede_expandir, motivo, objetivo` |
| `forense.expandir_cluster_reintento(caso uuid, objetivo jsonb)` | reintento / Expandir para reintento | `autores, expandido, version_contexto, rfcs_nuevos` |
| `forense.crear_tareas_revision(caso uuid, intento int, autores text[], objetivo jsonb)` | reintento / Crear tareas de revisión | `tarea_id, tarea_ids, version_contexto, deadline` |
| `forense.revalidar_caso(caso uuid)` | reintento / Revalidar si cambió evidencia | `limitaciones, evidencia_revalidada` |
| `forense.cerrar_barreras_vencidas(now timestamptz)` | reconciliador / Barreras vencidas | `caso_id, paso, cerradas, limitaciones` |
| `forense.eventos_salida_pendientes(limite int)` | reconciliador / Outbox pendiente | `evento_id, investigacion_id, intentos` |
| `forense.abrir_corrida`, `cargar_o_clonar_snapshot`, `verificar_integridad_corrida`, `estado_corrida` | corrida (4 nodos) | ver `CONTRATOS_NODOS.FORENSE_corrida` |
| `forense.cargar_version_expediente(caso uuid, version int)`, `forense.guardar_propuesta_edicion(...)` | editar_expediente | ver `CONTRATOS_NODOS.FORENSE_editar_expediente` |

**(b) Existen con otro nombre o firma: el recableado es del nodo, no de la DB.**
Queda pendiente en este corte y **no** requiere migración:

| El nodo llama | Existe en la DB como |
|---|---|
| `leer_evento_salida`, `destinatario_aviso`, `omitir_llamada`, `crear_intento_llamada`, `guardar_aceptacion_llamada` | `forense.reclamar_evento_salida(p_owner text, p_segundos int)` + `forense.solicitar_llamada(p_event_id uuid, p_owner text, p_agent_id text)` |
| `reclamar_evento_salida(uuid, text)` | `forense.reclamar_evento_salida(text, int)` — el evento no se pasa, se reclama el siguiente |
| `registrar_callback_llamada` + `actualizar_llamada` | `forense.resultado_llamada(p_llamada, p_estado, p_provider_payload, p_conversation_id, p_call_sid, p_aviso_entregado, p_error)` |
| `clusters_por_prioridad_inyeccion(uuid, uuid)` | `forense.clusters_afectados(p_inyeccion uuid)` → TABLE(cluster_id, score, n_rfcs_afectados, prioridad) |
| `registrar_inyeccion(uuid, uuid, text, text)` | `forense.registrar_inyeccion(p_base uuid, p_payload jsonb, p_origen text, p_idempotency uuid, p_perfil uuid)` |
| «Aplicar» del editor | `forense.aplicar_propuesta(p_propuesta uuid, p_perfil uuid, p_contenido_json jsonb, p_markdown text)` → jsonb con `aplicada, version_resultante, conflicto_version` |

**Bugs de cableado ya corregidos en este corte** (estaban en el JSON, no en la DB):
`crear_caso` recibía cluster y corrida invertidos; `crear_tareas_ronda` pasaba el
intento en la posición de los agentes; `expandir_y_crear_tareas_r2` mandaba jsonb
donde la firma pide `text[]`; `public.forense_validar_evidencia` se llamaba con
dos argumentos y sólo acepta uno.

### 3.5.bis Contrato de entrada de `FORENSE_editar_expediente` (para forense-editor)

El BFF llama al webhook `editar`. Contrato del cuerpo, tal y como lo aplica el
Code node «Validar solicitud» hoy:

| Campo | Obligatorio | Nota |
|---|---|---|
| `caso_id` | sí | |
| `idempotency_key` | sí | Sin ella no hay reintento seguro. |
| `version_base` | sí | Sin ella no se detecta el conflicto de documento. |
| `modo` | no (`propuesta`) | Aceptados HOY: `pregunta`, `propuesta`. |
| `instruccion` | no | Llega como `instruccion_untrusted`: es DATO, nunca system prompt (regla 6, 17 §7). |
| `seleccion`, `directriz_id` | no | |
| `system`, `system_prompt`, `modelo`, `model`, `nivel`, `dictamen`, `telefono` | **rechazados** | El nivel no lo decide el editor ni el LLM (regla 4); el modelo sale de configuración. |

**Quién mintea `propuesta_id` (decisión del coordinador).** El workflow **no**
lo mintea:

- `modo=propuesta` → `forense.guardar_propuesta_edicion(...)` **devuelve** el
  `propuesta_id`. El workflow lo emite en la respuesta; el BFF lo guarda.
- `modo=aplicar` / `modo=revertir` → el `propuesta_id` **lo aporta el BFF** en
  el cuerpo, tomado de la propuesta que el usuario está aceptando.
  `forense.aplicar_propuesta(p_propuesta uuid, p_perfil, p_contenido_json,
  p_markdown)` y `forense.revertir_expediente(p_caso, p_version_objetivo,
  p_version_base, p_idempotency, p_perfil)` lo exigen (010).

> **PENDIENTE H8 (runtime).** Las ramas `aplicar` y `revertir` todavía NO están
> cableadas en `FORENSE_editar_expediente`: «Validar solicitud» rechaza esos
> modos, y el switch sólo enruta `pregunta`/`propuesta`. Las funciones de 010
> existen y tipan (`preparar-sql.mjs` → `falla=0`). Al cablearlas, «Validar
> solicitud» debe exigir `propuesta_id` para `aplicar` (y `version_objetivo`
> para `revertir`) y rechazar la petición sin él: Aplicar es determinista y no
> puede inventar sobre qué propuesta aplica.

### 3.6 Contratos de estado descubiertos al ejecutar

**H8 — forma de `forense.paquete_auditor_final` (010).** La función existe y
tipa, pero NO devuelve la forma que consume `dictaminar()`
(`n8n/runtime/auditor-final.mjs`). El nodo «Paquete auditor final» adapta las
tres diferencias en SQL; si 010 cambia, se borra esa capa, no se duplica:

| `dictaminar()` espera | 010 entrega | Consecuencia sin adaptar |
|---|---|---|
| `caso.n_reintentos` | `presupuesto.n_reintentos` | `Number(undefined)` → `NaN < 2` es `false`: nunca se autorizaría un reintento. |
| `presupuesto.permite_reintento` | `presupuesto.agotado` | Igual: `undefined !== true` → sin reintento. |
| `evidencia[].hecho_validado.monto_centavos` | `evidencia[].monto_centavos` (raíz del ítem) | `dictaminar` **lanza** `Monto validado ausente/inválido para <ref_id>` en cuanto hay evidencia `cfdi` validada. Verificado: las 5 evidencias del e2e son `cfdi` y todas lo disparaban. |

**H8 — `forense.estado_barrera` devuelve un jsonb escalar, no una tabla.** Un
`SELECT * FROM forense.estado_barrera(...)` da UNA columna llamada
`estado_barrera`. El nodo «Barrera reintento» lo hacía así y n8n recibía
`{estado_barrera:{…}}`: el IF siguiente leía `$json.completa` = `undefined` y la
barrera de reintento **nunca cerraba por la rama buena**. Corregido con
`jsonb_to_record`, igual que «Esperar barrera R1». Lo cazó
`n8n/tests/verificar-forma-nodos.mjs`, no `preparar-sql.mjs`: `PREPARE` valida
tipos, no la forma de la salida.

- `forense.tareas_agente.estado` admite `pendiente | ejecutando | completada |
  error | timeout | omitida`. **No** admite `terminado`: ése es el
  `estado_interno` de `forense.ejecuciones_agente`. Un nodo que confunda ambos
  rompe el check, no la lógica.
- Las RPC `public.forense_*` se loggean a sí mismas en `forense.bitacora`
  (`tool_call` + `tool_result`). `forense.tool_ejecuciones` es el ledger de
  runtime y cuelga de una ejecución LLM: con proveedor simulado está vacío y eso
  es correcto, no una pérdida de rastro.
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
   `Retry-After` (17 §6), y el backoff vuelve por `Reservar request` para que
   cada reenvío quede registrado como un `intento_transporte` más. Si alguien
   reconecta el backoff directo al HTTP, el contador se congela y el bucle gira
   hasta el deadline del paso.
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

**Paso 0.b — ensayo sin n8n (recomendado antes de importar).** El camino
completo del worker se puede ejecutar contra Postgres con el proveedor simulado,
sin instancia n8n y sin gastar cuota de Anthropic:

```sh
# Base propia y desechable: NUNCA sobre la base compartida `forense`.
dropdb -U postgres --if-exists forense_rt && createdb -U postgres forense_rt
for f in db/00{1,2,3,4,5,6,7,8,9}_*.sql db/010_*.sql; do
  psql -U postgres -d forense_rt -v ON_ERROR_STOP=1 -q -f "$f"
done
# Snapshot gen-v1 en solo lectura desde la base compartida (sale 3 si no está).
bash db/tests/cargar_gen.sh forense_rt

node n8n/tests/preparar-sql.mjs forense_rt           # espera falla=0
node n8n/tests/e2e-camino-worker.mjs forense_rt      # espera eventos>0 y un nivel
node n8n/tests/verificar-forma-nodos.mjs forense_rt  # espera con_problema=0
```

Medido el 2026-09-12 (H8) con 001–010 + `gen-v1`:

| Comando | Resultado |
|---|---|
| `preparar-sql.mjs` | `ok=73 pendiente_004_005=0 falla=0` — con 010 aplicada ya no queda función por publicar. |
| `e2e-camino-worker.mjs` | 46 pasos, **47 eventos** en `forense.bitacora`, 5 443 ms de SQL, nivel `no_concluyente`. El nivel lo decide `n8n/runtime/auditor-final.mjs` y se persiste con `forense.guardar_dictamen` + `forense.cerrar_caso`: el e2e **no** hace `UPDATE` directo, y si `dictaminar()` lanza, falla (no hay fallback que invente niveles). |
| `verificar-forma-nodos.mjs` | `ok=36 con_problema=0 sin_filas=2 omitidos=35` — recorre los diez workflows; lista uno a uno los nodos sin caso declarado en vez de aprobarlos en silencio. |

```sh
```

El tercero se corre **después** del segundo: necesita un caso con tareas de
ronda 1 para atar los parámetros.

Referencia medida el 2026-09-12 H5 sobre un clon de `gen-v1` (regla 10: se clona,
nunca se investiga sobre `gen-v1`): **45 eventos en `forense.bitacora`**
(16 `tool_call` + 16 `tool_result`, 5 señales, `dictamen`, `validacion`,
`auditoria`, `ronda_inicio`×2, `redaccion_inicio/fin`), nivel `presuncion_alta`
con familias D/E/F/R/T, 45 pasos SQL en **49.1 s**, de los cuales **~46 s son
`forense.correr_pistas`** sobre 8081 CFDI: el resto del camino son ~3 s. Ese
reparto es el dato a llevar al gate — el cuello de botella de una corrida nueva
es el cálculo de pistas, no la orquestación. Con `--reusar <corrida_clonada>` el
ensayo se repite en ~1 s.

El script **no** prueba el proveedor real ni la calidad de detección: prueba que
DB → RPC → orquestación → dictamen determinista → expediente están cableados y
dejan rastro.

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
