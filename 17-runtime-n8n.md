# 17 — Runtime n8n: contrato de construcción y recuperación

Decisión vigente: n8n orquesta y Postgres conserva estado. El perfil API aquí detallado usa Anthropic Messages por pasos explícitos; la alternativa Claude Code/Actions del usuario se decide mediante el gate de20 antes de implementar. Se sustituye el nodo AI Agent opaco de07, no los cinco especialistas, herramientas, rondas ni defensas. Los JSON importables de workflows deben generarse y probarse contra la versión instalada; este documento no los presenta como ya desplegados.

## 1. Separación de responsabilidades

- Agentes de desarrollo: Claude Code, archivos `.claude/agents`, lectura del repositorio, construcción y tests. No son los investigadores.
- Agentes de producto: D/F/R/T/E, Auditor, Defensor, Réplica, Redactor y Editor. Solo reciben un paquete de contexto y herramientas permitidas, no acceso al repositorio, shell, internet, claves ni MCP.
- Código determinista: selección SQL, permisos, presupuesto, turnos, barreras, validación de hechos/citas, clasificación, versionado y finalización.
- Notificador ElevenLabs: circuito separado de 16; no obtiene conclusiones ni expediente.

## 2. Infra mínima y despliegue

Usar inicialmente la instancia n8n dedicada al proyecto existente, con HTTP Request, Code, Postgres, Webhook, Respond to Webhook, Execute Sub-workflow y Schedule Trigger. No añadir Redis/queue mode durante el arranque salvo que ya estén operativos o un benchmark lo exija. Las conexiones DB de control son cortas; no alojar un bucle SQL bloqueante esperando al modelo.

Arranque exige registrar versión n8n y tipos de nodos exportados, CPU/RAM, modo de ejecución y recursos disponibles. El límite propio de DB controla ocho pasos de tareas activos y cuatro clusters; un límite de n8n no sustituye ese control. La evaluación de carga prueba solape de dos tareas y luego ocho, memoria y rate limits. Los orquestadores no retienen slots de LLM mientras esperan.

Archivos a construir: `n8n/workflows/*.json`, `n8n/runtime/*.mjs`, `n8n/prompts/*.md`, `n8n/tests/`; contratos compartidos en `contracts/`. Code nodes se generan desde funciones puras probadas, no ocho copias editadas a mano. Exportar con credenciales referenciadas por nombre/ID, sin secretos; manifest de IDs reales tras importar. Ningún workflow se activa antes del smoke.

Orden de importación: worker de paso → reintento → editor → investigación → corrida → notificador → callback de voz → reconciliador/error técnico. Resolver IDs de subworkflows después de importar y antes de activar. Se conservan seis flujos funcionales; reconciliación, worker y errores son soporte técnico.

## 3. Máquina persistida, no ejecución monolítica

El webhook valida/authentica, guarda una solicitud idempotente y responde 202 con IDs. Un dispatcher avanza la máquina desde DB. Cada ejecución realiza **un paso acotado** y termina; no mantiene abierto un request de navegador durante toda la investigación.

Estado de caso conserva 05/07. Estado interno de ejecución: `preparar_contexto → solicitar_modelo → ejecutar_herramienta → solicitar_modelo → validar_salida → terminado`. `reparar_json`, `espera_reintento`, `error` y `timeout` son ramas explícitas. Estado interno vive en checkpoint, no requiere inventar estados nuevos para `casos`.

La ronda guarda el conjunto exacto de `tarea_id` despachados y su snapshot de señales. Barrera = todos esos IDs terminales; no cuenta filas indiscriminadas ni depende del orden de llegada. Transición CAS sobre `(caso_id,paso,revision)` impide que dos callbacks disparen dos auditores. Ausencia de despertados avanza una sola vez. Reintento 1/2 conserva caso, historial y versión de contexto.

Dispatcher inmediato al guardar un checkpoint; reconciliador periódico cada 10 s como recuperación, configurable y validado en la instancia. No hacer polling LLM. Tareas pendientes sin slot quedan pendientes, no fallidas. Cancelación detiene próximos pasos; resultados tardíos no reabren el caso.

## 4. Tablas y funciones que faltaban en el esquema de control

En una instalación nueva, incorporar estas extensiones a 001 y sus helpers a 002, antes de 003–005; no son herramientas del modelo. Las dependencias de tablas se crean después de `casos`/`tareas_agente`. Si alguna migración ya fue aplicada, NO reescribirla: generar siguiente migración aditiva después de la última aplicada y documentar ese número.

- `ejecuciones_agente`: id, tarea_id nullable, editor_operacion_id nullable, rol, estado_interno, paso, revision, checkpoint_json, context_hash, prompt_hash, model_id, deadline_at. XOR tarea/editor; una operación del editor tiene presupuesto propio. Índices de unicidad adecuados a cada identidad.
- `artefactos_contexto`: id/hash, schema_version, corrida/caso/tarea, snapshot, contenido JSON privado, bytes/tokens medidos, truncamientos, creado. Inmutables por ejecución; no contienen ground truth ni secretos.
- `llm_solicitudes`: request_id, ejecucion_id, paso, intento_transporte, estado reservado/enviado/completado/desconocido/error, provider_request_id, usage, duración, modelo, error. Cada HTTP nuevo es un intento registrado, aunque sea reparación o retry.
- `tool_ejecuciones`: ejecucion_id, request_id, tool_use_id, nombre, args_hash, estado, resultado/ref, duración. Unicidad request_id/tool_use_id; idempotencia de la mutación deriva de esta clave. Las RPC registran evidencia/bitácora una sola vez.
- `pasos_pipeline`: caso_id, paso, revision, tareas_esperadas, snapshot_senales, estado, deadline. Unicidad caso/paso/intento/contexto. Conservar revisiones y auditoría.
- `slots_runtime`: recurso, slot, owner, lease_expires_at, fencing_token. Claim en transacción; incrementar token al reasignar. Cada write comprueba token/owner vigentes.

Firmas internas a congelar en `contracts/runtime`: `claim_step(execution_id,owner)`, `reserve_request(execution_id,fence,request_id)`, `claim_tool(execution_id,fence,request_id,tool_use_id,args_hash)`, `save_checkpoint(execution_id,fence,revision_expected,patch)`, `finish_step(...)`, `advance_case_if_ready(caso_id,revision_expected)`, `recover_expired(now)`. El orden de locks es fijo: caso → ejecución → cuota/slot. Las funciones reciben contexto backend y no aceptan un rol elegido por LLM.

Deadline de request HTTP propuesto 45 s y lease 90 s: un paso procesa una petición de modelo **o una herramienta**, guarda y libera. Ajustar después del smoke; lease siempre mayor que timeout + margen de persistencia. Un proceso viejo con lease expirado no puede guardar gracias al fencing token. Evitar depender de un heartbeat que no puede correr mientras el nodo está bloqueado.

## 5. Loop de Messages API (solo si se elige este proveedor)

1. Reclamar paso/slot; verificar deadline, cancelación, contexto y estado actual.
2. Preparar `system` con bloque común + rol + contrato de salida. Preparar `messages` desde checkpoint; tools del rol en allowlist, JSON Schema sin campos de identidad.
3. Reservar request en DB **antes** del HTTP. `POST https://api.anthropic.com/v1/messages`, headers `x-api-key` y `anthropic-version` según versión API probada; el secreto vive en credencial n8n. `model` se resuelve desde configuración de cuenta, nunca desde el prompt del usuario.
4. Persistir respuesta completa necesaria para continuar el protocolo, IDs y usage reales. Contenido de razonamiento, si la API lo exige para continuar, se conserva solo en almacenamiento backend privado y no se muestra como bitácora ni explicación al usuario.
5. `stop_reason=tool_use`: guardar bloques assistant y cola de herramientas con sus IDs. Ejecutar cada herramienta autorizada con ledger. Reunir un `tool_result` para cada `tool_use_id`, incluidos errores tipificados; enviarlos como siguiente mensaje user siguiendo el protocolo. No añadir texto ordinario antes de esos resultados ni perder asociaciones al reanudar.
6. `end_turn`: parsear/validar salida según rol. No ejecutar herramientas mencionadas en texto. No confiar en JSON válido para validar IDs, permisos o hechos.
7. `max_tokens`: salida incompleta; no persistir como informe válido. Una reparación acotada si hay presupuesto, o resultado incompleto/error visible. Refusal y razones nuevas se manejan explícitamente; no caer en bucle infinito.
8. JSON inválido: una reparación sin herramientas, con errores de schema y salida anterior acotada; también consume request. Si falla, conservar diagnóstico y terminar sin inventar un resultado vacío exitoso.

No usar herramientas de servidor, web search ni code execution del proveedor en este runtime. Así todas las acciones de investigación pasan por las once RPC. Llamadas paralelas sugeridas por el modelo se ejecutan secuencialmente dentro de la tarea inicialmente; el paralelismo útil es entre especialistas y clusters.

## 6. Presupuestos con reserva real

Conservar 120 herramientas y 100 requests LLM por caso y cuotas por rol de 03. Contar también caché hit como invocación de herramienta a efectos de límite, registrándolo sin simular latencia/consulta nueva. Reservar antes de ejecutar, no sumar al final de un nodo AI Agent.

Separar bolsas: investigación y cierre. Propuesta inicial: 27 herramientas reservadas para Auditor/Defensor (12/15); 34 requests para cierre (Auditor 13, Defensor 16, Réplica 2, Redactor 3). Es una distribución inicial para probar, no consumo garantizado. La bolsa de cierre solo se libera a su rol/etapa; al repetir auditoría/defensa se necesita saldo real restante. Una reparación también pertenece a esa bolsa. Nunca conceder 100 requests nuevos al entrar en reintento.

El editor: presupuesto separado por operación, máximo 3 requests (respuesta/propuesta + reparación acotada), deadline propuesto 90 s. Voz usa presupuesto/configuración separados. Tokens y coste desconocidos quedan null; requests reservados, enviados, completados y ambiguos se distinguen. Registrar versión de precios y modelo efectivo antes de mostrar coste.

429/5xx: backoff con jitter y `Retry-After`, hasta dos reintentos de transporte dentro del deadline y cuotas. No equivale a reintento forense. Timeout ambiguo: puede haber coste externo aunque falte respuesta; marcarlo y no anunciar exactly-once del proveedor. Repetir un paso no repite una mutación SQL cuyo ledger ya terminó. Voz mantiene la política más estricta de no redial ciego de 16.

## 7. Paquetes de contexto por rol

**Asignación inicial de modelos del producto, distinta de los builders:** Sonnet para D/T/E, Redactor, Editor y mapper; Opus para F/R, Auditor, Defensor y Réplica. Es una propuesta high-end para medir, no una afirmación de latencia/coste de la cuenta. En API resolver IDs soportados antes de ejecutar; en Claude Code usar alias solo tras comprobar disponibilidad. No degradar silenciosamente por cuota ni cambiar modelo dentro de una corrida de evaluación. Clasificador/Validador siguen sin LLM. Si las pruebas justifican otra asignación, versionarla y comparar.

Envelope obligatorio: `schema_version,execution_id,tarea_id,caso_id,corrida_id,cluster_id,ronda,intento,version_contexto,dataset_hash,fecha_corte,familias_evaluables,prompt_hash,directriz_id,directriz_version,objetivo,limites,cobertura,datos`. Identidad/fechas/cuotas las impone backend. Contexto inmutable por paso; expansión crea nueva versión y snapshot.

- Especialista R1: resumen de cluster ≤40 RFC, pistas de su familia, cobertura y objetivo. Ninguna señal ajena; también filtrar resultados de `perfil` y prohibir `leer_senal` en backend.
- Especialista R2/reintento: lo anterior + titulares del snapshot de barrera + IDs y objetivo concreto de despertar. No historial libre de conversación entre agentes. Detalles por `leer_senal` dentro de ACL.
- Auditor: señales vigentes y IDs, mapa resumido, contradicciones y objetivos de cobertura; evidencia se obtiene por herramientas. No cargar todas las facturas.
- Defensor: hipótesis candidata, evidencia verificada, trampas aplicables y cobertura; todavía no tratar el dictamen como conclusión consumada.
- Réplica: evidencia verificada y argumentos identificados; sin tools. Resuelve por defensa_id y fuentes dadas. No decide nivel ni genera nueva evidencia.
- Redactor: dictamen determinista, hechos validados, límites, defensas y citas permitidas. No señales libres ni razonamiento privado.
- Editor: versión base, selección por bloques/hash, pregunta/directriz y paquete de citas del documento. Texto del documento es dato, no system prompt.

Presupuestos iniciales de entrada: 8k tokens por especialista, 16k Auditor/Defensor, 16k Réplica, 24k Redactor/Editor; medir con contador compatible con modelo. Son techos de ingeniería configurables, no tamaños reales del dataset. Respuestas de herramientas: hasta 4k caracteres útiles por página más envelope; devolver `has_more,next_cursor,coverage`, nunca cortar JSON a mitad. Si se alcanza techo, detener con limitación o construir otro paquete acotado conservando IDs; no quitar silenciosamente contradicciones ni defensa.

Los límites de caracteres del paquete inicial de08 se aplican además de estos techos del transcript completo: 12k caracteres especialista/24k Auditor-Defensor. No son conversiones exactas caracteres↔tokens. El adapter unifica la clave backend `p_operacion` de06 con el ledger request_id/tool_use_id; un retry de transporte conserva operación y no vuelve a consumir cuota de tool, mientras una nueva consulta sí.

No compactar la conversación borrando pares tool_use/tool_result. Acotar desde la entrada, cantidad de turnos y páginas; guardar artefactos completos en DB. Si el contexto completo requerido excede el techo, terminar parcial o pasar a tarea sucesora con referencias explícitas; no fingir que el agente leyó todo.

## 8. Prompts y validación

08 es la fuente de contenido por rol. Materializar bloque común y archivos por rol; manifest con SHA-256 de contenido, schemas, herramientas y política. `version_prompts` cambia si cambia cualquiera. No adjuntar los 19 documentos a cada llamada: son instrucciones para construir, no contexto del investigador.

Añadir a cada rol: objetivo, datos disponibles, tools permitidas, pasos de verificación, obligación de buscar contradatos, cuándo parar, formato final estricto y ejemplo pequeño. Ejemplos sintéticos separados del dataset/semilla reservada. Directrices del usuario se ubican como tarea subordinada a las reglas, nunca en lugar del bloque común.

Validación tiene dos niveles: estructura/IDs/unidades comprobables en código y sustento de afirmaciones tipificadas mediante reglas/SQL. Un ID existente no prueba una frase. Narrativa no verificable se etiqueta como interpretación o se rechaza; no prometer un validador determinista que demuestra cualquier afirmación en lenguaje natural. Mantener Defensor, Réplica y revisión humana del reporte.

## 9. Pruebas que desbloquean la integración

Antes de remoto, un proveedor simulado reproduce: tool_use → resultado → end_turn, dos tools en una respuesta, cursor, JSON inválido, refusal, max_tokens, 429, timeout y doble entrega. Cada simulación está marcada y no entra a métricas del producto.

Gates: sin fuga de señales R1; no acceso a otra corrida; reserva de cierre intacta; mismo tool_use no duplica señal; fence viejo rechazado; crash tras DB commit recupera resultado; barrera de dos tareas no espera cinco; cero hallazgos termina; parser fallido no produce caso limpio; edición no cambia dictamen; callback de voz no duplica aviso.

Prueba remota autorizada: una herramienta real, una investigación completa, dos workers simultáneos, luego cuatro clusters. Registrar p50/p95, requests, tokens, límite efectivo y errores; no inferir rendimiento de dibujos de workflows. El mock no acredita conectividad ni detección.

## 10. Fuentes técnicas

- [Anthropic: definición de tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) y [manejo de llamadas](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls): protocolo; validar en el smoke del modelo elegido.
- [Modelos y API de capacidades](https://platform.claude.com/docs/en/models/overview): resolver IDs disponibles en la cuenta. No asumir que un ID antiguo o el alias de Claude Code equivale al modelo de API.
- Los enlaces y versión n8n de 07 deben comprobarse con la instancia. Algunas rutas históricas de hosting consultadas devolvieron 404; no certificar queue mode ni parámetros de nodos a partir de una copia no oficial.
