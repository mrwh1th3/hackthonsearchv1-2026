# 20 — Proveedor de ejecución: API o Claude Code en GitHub Actions

## Confirmado y pendiente

El usuario tiene otro sistema con tabla de solicitudes + GitHub Actions + Claude Code y quiere adaptarlo. Todavía no proporcionó ubicación ni workflow/tabla, por lo que **no fue auditado ni reutilizado**. n8n corresponde a la cuenta `victorinbm2006`; el repo podría llamarse `hackthonmty2026`. MCPs declarados: n8n, Supabase y GitHub; Vercel y ElevenLabs disponibles según usuario. Resolver destinos exactos antes de escribir; el nombre parecido no basta para autorizar un recurso.

La [acción oficial de Anthropic](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md) documenta `claude_code_oauth_token` como alternativa a API key y generación mediante Claude Code para usuarios Pro/Max. Esto permite evaluar la vía propuesta; no demuestra saldo, capacidad de esa cuenta ni idoneidad de un sistema ajeno que no se ha leído. Token solo en Secrets/gestor autorizado, nunca en repo, chat ni payload. No extraer credenciales de navegador ni convertir OAuth en una clave de Messages API.

## Decidir una vez en H0–1

Presupuesto de comprobación: 15–20 min. Leer el sistema existente si se identifica; si no, registrar ausencia. Verificar autenticación oficial, un trabajo trivial, permisos, salida estructurada, latencia y trazabilidad. No activar ambos caminos automáticamente por un timeout.

- `messages_api`: perfil de 17, contador explícito por HTTP y tools. Requiere credencial/saldo API separados; preferible cuando se necesita control preciso por request y baja latencia de despacho.
- `claude_code_actions`: perfil candidato si el sistema existente funciona con autenticación soportada, queue/claims y tools restringidas. Comparte la capacidad disponible de la cuenta de Claude usada por Actions; desarrollo y producto pueden competir por cuota. No sumar cuentas ni inferir uso ilimitado.
- `pending`: mientras se verifica. Contratos/UI/datos avanzan con mocks señalados, no hay investigaciones reales.

El adapter común acepta `{execution_id,context_ref,prompt_hash,role,deadline_at}`; devuelve aceptación con ID de proveedor y persiste eventos/finalización, nunca el teléfono ni secrets. `runtime.provider` y modelo efectivo se guardan por corrida. Cambiar proveedor genera configuración/corrida nueva; no mezclar resultados silenciosamente.

## Circuito recomendado si se elige Actions

1. UI → BFF → n8n guarda solicitud/corrida y tareas en DB, responde 202. La tabla de solicitudes existente se adapta al contrato, no se introduce otra cola sin dueño.
2. n8n dispara `workflow_dispatch` sobre workflow y ref permitidos del repo confirmado, usando credencial de mínimo alcance. Solo IDs opacos/versiones en inputs; nada de prompts como comandos shell.
3. Job verifica destino, versión y permiso; reclama lote de tareas mediante DB/endpoint backend. No hacer un arranque frío de Actions por cada herramienta. El proceso worker del job mantiene un lote acotado y ejecuta tareas con contextos aislados.
4. Cada tarea inicia un proceso Claude Code restringido a las tools RPC de su rol mediante un puente MCP forense. No cargar MCPs personales, código del repo como instrucciones arbitrarias, Bash, Write, navegación ni credenciales de administración dentro del investigador. Configuración/allowlist de tools verificadas por test, no solo por prompt.
5. El puente valida job/tarea/fence, resuelve identidad server-side y llama RPC; registra ledger como 06. Token del job limitado a esas operaciones; no service_role a disposición del modelo. El proceso contenedor puede tener secretos administrativos únicamente fuera del contexto/herramientas del modelo.
6. Salida estructurada se valida y guarda con CAS, callback firmado avisa al dispatcher n8n. Siguientes rondas/defensa se generan desde DB, no por un coordinador LLM que inventa tareas. El mismo job puede reclamar las siguientes tareas autorizadas mientras le quede plazo.
7. Job tiene timeout y límite de lote; al terminar libera leases. Un reconciliador n8n redispara solo si quedan tareas y no hay job saludable. Reinicios recuperan tareas/checkpoints soportados, no vuelven a escribir señales confirmadas. No depender de un cron de GitHub para UI reactiva.

El [schedule de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule) tiene intervalo mínimo de cinco minutos. Usarlo solo como red de recuperación si conviene; medir arranque de dispatch y runner. No prometer respuesta instantánea.

## Diferencias de control que deben pasar un gate

La CLI hace su propio loop. El checkpoint de Messages de 17 **no** se reutiliza fingiendo que se ve cada petición interna de Claude Code. Persistir IDs de sesión/resultados/eventos que la versión realmente exponga; una sesión reanudable necesita artefactos privados disponibles y comprobación de compatibilidad. No subir logs con datos/secretos como artifacts públicos.

Herramientas y señales siguen teniendo idempotencia DB. Cuota de tools sí se impone en el puente antes de ejecutar. `max-turns` y timeout son guardas de la CLI, no equivalen a 100 requests HTTP. Si no hay observabilidad/enforcement por request, registrar `llm_requests=null` y `budget_enforcement=tools_and_turns`, no inventar cero o 100 cumplidos. **Ese perfil no cumple el límite duro de requests de 03 por sí solo:** obtener aprobación explícita de ese cambio de requisito, o elegir Messages API. No etiquetarlo equivalente sin este gate.

El heartbeat del job puede ejecutarse como proceso externo a Claude Code cada 20–30 s; lease mayor que dos heartbeats y margen. Si se pierde lease, matar/cancelar el proceso y rechazar resultados por fencing. No reasignar mientras el proceso antiguo conserva acceso de escritura. Callback con estado viejo no abre una tarea terminada.

Concurrencia inicial de CI: dos procesos investigadores; aumentar tras medir cuota/memoria hasta el máximo DB autorizado. La cola sigue pendiente si no hay slots. No lanzar un job por especialista sin evaluar la latencia acumulada ni multiplicar workers por cada una de las tres sesiones de desarrollo.

## Workflow, permisos y secretos

El archivo YAML ejecutable se genera **después del inicio** y de conocer el repo/sistema existente. Reutilizar acción oficial fijada a SHA revisado, no forks desconocidos ni tags flotantes sin registrar versión. `contents: read` como base; ampliar solo lo exigido por autenticación y operación verificada. El investigador no necesita escribir código ni comentarios en PR.

Inputs permitidos: job_id/corrida_id y config_version. Ref fija/trusted; prohibir `pull_request_target` ejecutando código de forks con secretos. No interpolar texto de datasets en `run:`. Secretos disponibles únicamente para pasos que los necesitan; debugging con salida completa desactivado. [Seguridad de la acción](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md).

Estado UI separado: `en_cola` → `esperando_runner` (detalle operativo, no nuevo nivel forense) → tarea activa → completada/error/timeout. Mostrar latencia de cola y de modelo por separado. Fallos de autenticación, cuota y runner se reportan sin atribuirlos a ausencia de fraude.

## Checklist de decisión

- [ ] Repo/workflow/tabla existentes leídos; cuenta y proyectos exactos confirmados.
- [ ] Autenticación oficial funciona; límites disponibles para desarrollar y ejecutar comprobados.
- [ ] Trabajo trivial sin datos ni herramientas privilegiadas y tiempo de arranque medido.
- [ ] Allowlist impide shell/archivos/otras tools; puente valida scope y cuotas.
- [ ] Duplicados, crash, lease vencido y callback tardío probados.
- [ ] Requests/coste observables o limitación aceptada explícitamente; no equivalencia falsa con API.
- [ ] Proveedor seleccionado y anotado antes de implementar el loop real.

Fuera de este gate, lo único listo es el plan y los mocks locales. No se generaron tokens ni activaron Actions durante la preparación.
