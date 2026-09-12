# ESTADO — coordinador

Actualizado: 2026-09-11 H0 (≈21:45, America/Monterrey). Dueño: coordinador (opus). Ver DECISIONES.md para el camino.

## Gate de inicio
- `hackathon_started=true` (usuario: "arranca YA todo el proyecto"). `node scripts/launch.mjs --check` pasa tras el commit baseline.
- Contratos **v1.1.0** (añade `product.inyectar` y `product.inyeccion`, 21 §3): `npm test --prefix contracts` → 98/98 OK (commit f6a9653).

## Destinos (verificados por lectura)
| Destino | Estado |
|---|---|
| GitHub | origin `mrwh1th3/hackthonsearchv1-2026` (**público**). `hackthonmty2026` vacío. |
| Supabase | **BLOQUEADO**: org free con 2/2 proyectos activos (clientes). Creación de `forense` rechazada (costo 0, límite de proyectos). Necesita decisión del usuario: pausar un proyecto propio o subir de plan. Mientras tanto: Postgres local. |
| n8n | proyecto personal `n0vtYcnvIW4LpWOE` en `n8n.srv1550651.hstgr.cloud`; prefijo `FORENSE_`; versión de n8n aún sin confirmar (typeVersions observados: code 2, postgres 2.7, httpRequest 4.2). **Smoke OK** `FORENSE_smoke_anthropic` (ejecución 283972): `claude-sonnet-5` → `tool_use` forense_perfil, 645/45 tokens, 1.1 s. |
| Vercel | equipo `team_btOOK1ypsV2lyPljQaC0r3Ui` (hobby); proyecto forense se crea cuando `web/` compile. |
| ElevenLabs | 0 números salientes → **llamadas bloqueadas externamente**; adaptador + tests sin llamadas. |
| Local | Postgres 17.11 `localhost:5432/forense` (usuario postgres, trust, pgcrypto); Python 3.9 + faker/networkx/pandas; Node 22. |

## Bloqueos externos abiertos (decisión del usuario)
1. **Supabase**: pausar/eliminar un proyecto propio de la org o upgrade; luego el coordinador crea `forense` y aplica migraciones.
2. ~~Anthropic~~ resuelto para `claude-sonnet-5` (smoke 2026-09-12 03:29Z); `claude-opus-5` también OK (ejecución 283975, 577/45 tokens, 1.7 s). Saldo total desconocido: medir consumo por caso en H8–10.
3. **ElevenLabs/Twilio**: sin número saliente no hay llamada real.
4. **Repo público**: decidir si se hace privado.

## Oleada 1 (en curso desde ≈22:10)
Workflow `forense-oleada-1` (run wf_51981d37-a2c): forense-db · forense-runtime · forense-webapp · forense-prompts en worktrees desde 26f0676; cada entrega pasa por un verificador de solo lectura (ownership, tests reproducidos, secretos, reglas). Cortes de 45–90 min con tests. Integración por el coordinador vía diff + tests.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
