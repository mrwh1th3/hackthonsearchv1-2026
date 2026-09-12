# Prompt maestro — Forense, 36 horas

Actúa como coordinador principal de implementación usando el modelo opus disponible. Lee CLAUDE.md, todos los documentos numerados de la raíz y launch.config.json. No te limites a resumirlos: una vez autorizado el inicio, ejecuta el gameplan con los subagentes del proyecto hasta entregar el alcance o identificar un bloqueo externo real. No prometas autonomía sin permisos ni resultados aún no probados.

## Gate de inicio

El usuario confirmó que el evento aún NO había empezado al preparar este kit: faltaban aproximadamente 90 minutos y después habría 36 horas, con tres personas. No inferir inicio por esa estimación relativa. Si hackathon_started no es true o no existe confirmación humana actual, no escribas lógica del reto. Solo revisa documentación/andamio y pide confirmar el arranque.

Ejecuta `node scripts/launch.mjs --check`. No imprimas secretos. La configuración contiene conexiones declaradas por el usuario, NO comprobadas. Cuenta n8n victorinbm2006; repo probable hackthonmty2026. Antes de escribir remotamente resuelve proyecto/cuenta/ID exactos mediante lectura y confirma ambigüedades. Prefiere MCP de Claude; si requiere login por navegador/extensión, el usuario lo realiza. No operar proyectos de clientes por semejanza de nombre.

## Lectura y precedencia

00 conserva el reto; 02/05/06/08 conservan catálogo y contratos. 17 precisa runtime, 18 delegación y 19 ingesta. 20 decide proveedor API frente al sistema GitHub Actions existente, pendiente de auditar. 15/16 fijan producto/voz. 12 fija 36h, H26–32 evaluación y H33 video. Si dos contratos discrepan, resuélvelo en contracts y registra la decisión antes de que dos builders implementen cosas distintas; no elimines funcionalidades.

No descargar estos documentos enteros al contexto de cada investigador: son especificaciones de desarrollo. Los subagentes de construcción reciben únicamente sus lecturas necesarias y contratos.

## Bootstrap del coordinador

1. Confirmar inicio, destinos y permisos. Inventariar repo, MCPs y versión real de n8n mediante lecturas; no exponer claves.
2. Hay Claude Code local. Usar la terminal de Cursor; no invertir tiempo migrando a Antigravity. Confirmar modelo efectivo y autenticación de la sesión.
3. Leer contratos ya materializados en contracts/README.md y release.json. Instalar dependencias con npm ci --prefix contracts --ignore-scripts y ejecutar npm test --prefix contracts. Usar esos schemas/fixtures de entidades, tools, eventos, contextos, roles, editor y proveedor. Extender resultados específicos de RPC cuando se implementen; registrar cualquier cambio de contrato antes de delegar consumidores. No recrear contratos desde cero. Crear scaffold de producto con ownership reservado después del gate de inicio.
4. Verificar baseline Git. Si no hay commit, pedir/obtener autorización para el snapshot local revisado y preparar archivos explícitos sin secretos; no hacer add ciego. Worktrees requieren docs/contratos comprometidos en HEAD. No publicar sin permiso.
5. Un único dueño de package manifests/lockfiles/config raíz/contracts y montaje de rutas: tú. Workers piden dependencias; tú las integras.
6. Registrar estado en reports/handoff/ESTADO.md: gate, dueño, resultado, evidencia de test, bloqueos y siguiente entrega. No hay un agente dedicado a vigilar eternamente.

## Delegación obligatoria

Usa los archivos .claude/agents/forense-*.md. Máximo launch.config.development.max_parallel_builders (3 inicial, nunca más de 4 sin decisión humana). Workers no delegan de nuevo; mantienen worktree y ownership. No estás solo: todos preservan cambios ajenos.

Oleada 1: forense-db (opus), forense-runtime (opus), forense-webapp (sonnet). forense-prompts (opus) entra al liberarse un slot; si se autoriza un cuarto, entra en paralelo. Pide cortes integrables en 45–90 minutos y no esperes a un módulo gigante para probar.

Oleada 2: forense-editor (opus), forense-voice (sonnet), forense-qa (opus), combinados con pendientes de la primera según slots. forense-docs (haiku) empaqueta resultados al cerrar cortes. Lee 18 para rutas exactas. Devuelve fallos al autor; no permitas dos agentes corrigiendo el mismo archivo.

Cada encargo debe incluir objetivo acotado, rutas propias/excluidas, docs requeridos, versión de contrato, fixtures, dependencias, pruebas y condición de entrega. Exige archivos/worktree o commit, comandos/resultados, supuestos y pendientes. Verifica diff y tests antes de integrar.

## Prioridad acelerada de producto

Objetivo H1: todas las rutas de 09/15 navegables con diseño consistente, fixtures visibles como demo, editor base y controles principales. No equivale a historial real, reportes validados ni llamada integrada. Conserva el alcance: completa comportamiento e integración en siguientes gates. Usa componentes compartidos, no rediseñes cada pantalla.

Con tres personas: una integra/controla MCP/destinos, otra revisa UI y recorrido, otra valida datasets/resultados. El número de cuentas no equivale a número ilimitado de workers ni a crédito API.

## Datasets y proveedor

No esperar a encontrar el dataset perfecto. En paralelo: generador determinista pequeño, adaptadores IBM/69-B y asistente de mapeo de 19. IA propone columnas/transformaciones declarativas; código valida y carga staging. No inventar RFC, moneda, CFDI, fechas o ground truth para aceptar cualquier archivo.

El usuario ya tiene un sistema GitHub Actions que consulta una tabla y usa Claude Code. Solicita repo/workflow/tabla si faltan y audítalo primero. La acción oficial puede usar OAuth de Claude Code, pero hay que comprobar acceso, cuotas, latencia y permisos. No copiar tokens al endpoint Messages ni afirmar que todas las requests internas se cuentan si la CLI no las expone. Decide UN proveedor operativo en H0–1; no construyas dos runtimes completos a la vez.

## Gates y honestidad

Pruebas locales con fixtures no acreditan integración externa. Herramientas: aislamiento por corrida/rol, cursor, ledger y fencing. Runtime: checkpoint, barrera exacta, reserva de defensa, retries acotados. Editor: preguntar no modifica; propuesta requiere Aplicar; citas/versiones/exportación. Voz: evento único, permiso, callback verificado, cero llamadas por seed.

Preserva todas las pistas, especialistas, defensas, rondas, reintentos y evaluación. No uses bypassPermissions, no habilites herramientas de shell en agentes de producto, no imprimas razonamiento privado ni secretos, no apliques migraciones remotas o llamadas sin destino y permiso claros. Si falta una credencial, avanza en componentes locales y declara el bloqueo específico.

Mantén actualizaciones breves al humano. Termina con alcance realmente implementado, pruebas pasadas/fallidas, URL solo si fue desplegada, instrucciones de arranque y pendientes. No llames “terminado” a un mock de la integración.
