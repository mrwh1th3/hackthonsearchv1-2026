# ESTADO — coordinador

Actualizado: 2026-09-11 H0 (≈21:45, America/Monterrey). Dueño: coordinador (opus). Ver DECISIONES.md para el camino.

## Gate de inicio
- `hackathon_started=true` (usuario: "arranca YA todo el proyecto"). `node scripts/launch.mjs --check` pasa tras el commit baseline.
- Contratos **v1.1.0** (añade `product.inyectar` y `product.inyeccion`, 21 §3): `npm test --prefix contracts` → 98/98 OK (commit f6a9653).

## Destinos (verificados por lectura)
| Destino | Estado |
|---|---|
| GitHub | origin `mrwh1th3/hackthonsearchv1-2026`, **privado** desde 2026-09-11 (petición del usuario). |
| Supabase | **Resuelto**: proyecto dedicado `hackthon2026` (ref `wplsldwzpyocmwzeyarj`, org `eakounkbsknkxdbfxioy`, us-east-2, Postgres 17.6, vacío). Migraciones remotas solo por el coordinador vía MCP cuando forense-db entregue 001/002 probadas en local. |
| n8n | proyecto personal `n0vtYcnvIW4LpWOE` en `n8n.srv1550651.hstgr.cloud`; prefijo `FORENSE_`; **n8n 2.33.7** confirmado por el usuario (instance id ce6b6b06…). **Smoke OK** `FORENSE_smoke_anthropic` (ejecución 283972): `claude-sonnet-5` → `tool_use` forense_perfil, 645/45 tokens, 1.1 s. |
| Vercel | equipo `team_btOOK1ypsV2lyPljQaC0r3Ui` (hobby). **403 al crear el proyecto vía MCP** ("You don't have permission to create the project"): el usuario lo crea desde el dashboard importando `mrwh1th3/hackthonsearchv1-2026` con Root Directory `web`, o da permiso al MCP. Variables de entorno de 11 se cargan en el dashboard. |
| ElevenLabs | 0 números salientes al leer la cuenta; el usuario indica que el número se configura desde la UI de ElevenLabs. Hasta que exista, el adaptador se entrega con tests y la UI muestra `omitida` con motivo; ninguna llamada real sin número y consentimiento. |
| Local | Postgres 17.11 `localhost:5432/forense` (usuario postgres, trust, pgcrypto); Python 3.9 + faker/networkx/pandas; Node 22. |

## Bloqueos externos abiertos (decisión del usuario)
0. **Vercel**: crear proyecto `forense` (repo privado, root `web`) y variables de entorno; el MCP no tiene permiso de creación.
1. ~~Supabase~~ resuelto (proyecto `hackthon2026`).
2. ~~Anthropic~~ resuelto para `claude-sonnet-5` (smoke 2026-09-12 03:29Z); `claude-opus-5` también OK (ejecución 283975, 577/45 tokens, 1.7 s). Saldo total desconocido: medir consumo por caso en H8–10.
3. **ElevenLabs/Twilio**: número saliente pendiente de que el usuario lo configure en la UI de ElevenLabs; sin él no hay llamada real.
4. ~~Repo público~~ resuelto (privado).

## Oleada 1 (continuación en curso, ≈00:25)
Primer run `wf_51981d37-a2c` (33 min, 4 builders) se cortó sin JSON de entrega; el trabajo quedó en los worktrees `.claude/worktrees/wf_51981d37-a2c-{1..4}`:
- db: commit f92e213 (001+002+seed_fake+tests); 003 sin commit; `bash db/tests/run.sh` → 99/99 OK (verificado por el coordinador).
- runtime: 12 módulos + 8 tests sin commit; MANIFEST/JSON pendientes.
- webapp: BFF + capa de datos (typecheck OK, 0 tests); shell y rutas pendientes.
- prompts: 12 prompts + ensamblador; manifest desactualizado; sin tests.
Continuación `wf_74e8de05-607`: los cuatro retoman su worktree, terminan corte 1 con tests y commit; verificador por entrega.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
