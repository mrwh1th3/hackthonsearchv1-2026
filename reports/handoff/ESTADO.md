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

## Oleada 1 — integrada en main (H3, ≈01:45)
| Builder | Entrega | Verificación reproducida |
|---|---|---|
| forense-db | 001/002/003 (D2,F1,F2,R1,R2,E1,T1), seed_fake, harness, generator (5 tipologías/8 trampas, determinista), loaders/load_gen.py | 109/109 aserciones; gen-v1: 8081 CFDI, 140 pistas, selector 16/17 fraudes, 0/15 trampas, 0/68 fondo |
| forense-runtime | n8n/runtime (provider, ledger, presupuesto, checkpoint, barrera, despertar, contexto, auditor-final, transporte, dispatcher), 8 code nodes generados, MANIFEST + 2 workflows JSON | 181/181 tests; generadores --check OK. Devuelto al autor: rama `cerrar` de decidir-paso devuelve estado actual (alto); IDs de modelo a claude-sonnet-5/opus-5 |
| forense-prompts | 12 prompts, ensamblar.mjs, manifest (version_prompts e4a2f861e988) | 79/79 tests; manifest --check OK |
| forense-webapp | shell + 20 rutas con fixtures rotulados, BFF sesión/investigaciones/inyecciones, componentes compartidos | typecheck OK, lint 0 errores, 43/43 tests, build OK con selector de fuente fixture |
Contratos **1.2.0** (CADENA, trayectoria, corrida_cargada/inyeccion): 100/100.

## Acciones pendientes del usuario
- Crear en n8n las credenciales `Forense Postgres` (host db.wplsldwzpyocmwzeyarj.supabase.co) y `Forense Supabase` (header apikey/Authorization con la service role del proyecto hackthon2026) y `Forense Webhook` (INTERNAL_WEBHOOK_SECRET). El coordinador no puede leer esas claves por MCP.
- Crear el proyecto Vercel `forense` (root `web`) y sus variables (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, NEXT_PUBLIC_DATA_SOURCE, DEMO_PASSWORD, SESSION_SECRET, N8N_WEBHOOK_BASE, INTERNAL_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY).
- Número saliente ElevenLabs cuando decida configurarlo.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
