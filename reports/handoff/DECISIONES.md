# DECISIONES — bitácora del camino (H0 → H36)

Registro cronológico de decisiones con evidencia y alternativa descartada. Los jueces evalúan el camino (21 §1.6); este archivo es la fuente de `/metodo`.

| Hora | Decisión | Evidencia | Alternativa descartada |
|---|---|---|---|
| H0 2026-09-11 21:20 | Reto de fraude fiscal; sistema multi-agente con capa de falsos positivos (00). | Transcripción del juez: "no queremos acusar por una o dos transacciones raras"; "¿por qué esa sí y esta no?" | Detector de anomalías con score. |
| H0 21:25 | Leer la grabación Plaud del juez principal y volverla normativa (21). | `21-criterios-juez-e-inyeccion-en-vivo.md` §1 | Seguir 00 sin ajustar. |
| H0 21:30 | Añadir prueba de **inyección en vivo** como gate propio: corrida clonada + prioridad a clusters afectados + timeline/diff. | Juez: "si inyectamos datos sintéticos, ¿cómo reacciona y cómo se explica?" | Mutar el snapshot activo (rompe regla 10 y la reproducibilidad). |
| H0 21:32 | Proveedor `messages_api`. | Auditoría de `mrwh1th3/eximapp` ai-loop: 1 runner, ≤3 jobs, ≤14 min, sin métricas por request; inyección exige latencia baja y 8 tareas LLM. | `claude_code_actions` (queda como fallback documentado). |
| H0 21:33 | Cuatro builders en oleada 1 (db, runtime, webapp, prompts). | Usuario: "arranca YA todo el proyecto"; ownership disjunto. | Tres builders y prompts en espera. |
| H0 21:35 | Postgres 17 local (Homebrew) para migraciones; remoto solo por coordinador. | Sin docker/psql en la máquina. | Probar migraciones directamente en remoto. |
| H0 21:36 | Coordinador scaffolda `web/` y root con Husky; workers piden dependencias. | Regla: un único dueño de lockfiles. | Cada worker instala sus paquetes (colisión de lockfile). |
| H0 21:45 | Supabase `forense` **no creado**: la org free tiene 2/2 proyectos activos (clientes). Se registra bloqueo; el usuario decide pausar/upgradear. | Error `BadRequestException` del MCP al crear. | Pausar un proyecto de cliente (prohibido por regla de no tocar clientes). |
| H0 22:05 | Contratos 1.1.0 aditivos con el DTO de inyección antes de que existan consumidores. | `contracts/release.json` fingerprint 66a1414b…; 98 tests. | Dejar que db/webapp definieran cada uno su propio formato. |
| H0 22:10 | Oleada 1 con verificación adversarial por entrega (ownership, tests reproducidos, secretos). | Regla 18: el coordinador integra por diff y tests, no por resúmenes. | Integrar confiando en el reporte del builder. |
| H0 22:30 | Smoke real de la API vía n8n (`FORENSE_smoke_anthropic`, inactivo, una ejecución manual): confirma proveedor `messages_api` con credencial existente. | Ejecución 283972: modelo claude-sonnet-5, stop_reason tool_use, usage 645/45, 1089 ms. | Asumir saldo por suscripciones de programación (11 lo prohíbe). |
| H1 2026-09-11 23:35 | Usuario resolvió Supabase (proyecto dedicado `hackthon2026`), repo a privado, n8n 2.33.7 confirmado, número ElevenLabs se configurará desde la UI del proveedor. | `launch.config.json` targets; `gh repo edit --visibility private`. | Seguir en local hasta el final (perdería demo en producción). |
| H2 2026-09-12 00:20 | Oleada 1 se cortó sin JSON de entrega: las definiciones forense-* no incluían la herramienta StructuredOutput. Se añade a las 8 definiciones y la continuación usa agentes generales con modelo por rol sobre los mismos worktrees. | Notificación del workflow wf_51981d37: 4 agentes 'completed without calling StructuredOutput'; trabajo real presente en los worktrees. | Descartar los worktrees y empezar de cero. |
