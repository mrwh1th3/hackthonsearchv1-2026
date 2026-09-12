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
