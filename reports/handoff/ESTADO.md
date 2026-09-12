# ESTADO — coordinador

Actualizado: 2026-09-11 H0 (≈21:45, America/Monterrey). Dueño: coordinador (opus). Ver DECISIONES.md para el camino.

## Gate de inicio
- `hackathon_started=true` (usuario: "arranca YA todo el proyecto"). `node scripts/launch.mjs --check` pasa tras el commit baseline.
- Contratos v1.0.0: `npm test --prefix contracts` → 93/93 OK.

## Destinos (verificados por lectura)
| Destino | Estado |
|---|---|
| GitHub | origin `mrwh1th3/hackthonsearchv1-2026` (**público**). `hackthonmty2026` vacío. |
| Supabase | **BLOQUEADO**: org free con 2/2 proyectos activos (clientes). Creación de `forense` rechazada (costo 0, límite de proyectos). Necesita decisión del usuario: pausar un proyecto propio o subir de plan. Mientras tanto: Postgres local. |
| n8n | proyecto personal `n0vtYcnvIW4LpWOE`; prefijo `FORENSE_`; versión pendiente (agente de referencia). Credencial `Anthropic account` existe; saldo no verificado. |
| Vercel | equipo `team_btOOK1ypsV2lyPljQaC0r3Ui` (hobby); proyecto forense se crea cuando `web/` compile. |
| ElevenLabs | 0 números salientes → **llamadas bloqueadas externamente**; adaptador + tests sin llamadas. |
| Local | Postgres 17.11 `localhost:5432/forense` (usuario postgres, trust, pgcrypto); Python 3.9 + faker/networkx/pandas; Node 22. |

## Bloqueos externos abiertos (decisión del usuario)
1. **Supabase**: pausar/eliminar un proyecto propio de la org o upgrade; luego el coordinador crea `forense` y aplica migraciones.
2. **Anthropic**: saldo/modelos de `Anthropic account` se prueban en smoke H1; si falla, aportar `Anthropic Forense`.
3. **ElevenLabs/Twilio**: sin número saliente no hay llamada real.
4. **Repo público**: decidir si se hace privado.

## Oleada 1 (en curso)
forense-db · forense-runtime · forense-webapp · forense-prompts en worktrees desde el baseline. Cortes de 45–90 min con tests. Integración por el coordinador vía diff + tests.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
