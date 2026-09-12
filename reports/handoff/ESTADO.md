# ESTADO — coordinador

Actualizado: 2026-09-11 H0 (≈21:45, America/Monterrey). Dueño: coordinador (opus). Ver DECISIONES.md para el camino.

## Gate de inicio
- `hackathon_started=true` (usuario: "arranca YA todo el proyecto"). `node scripts/launch.mjs --check` pasa tras el commit baseline.
- Contratos **v1.1.0** (añade `product.inyectar` y `product.inyeccion`, 21 §3): `npm test --prefix contracts` → 98/98 OK (commit f6a9653).

## Destinos (verificados por lectura)
| Destino | Estado |
|---|---|
| GitHub | origin `mrwh1th3/hackthonsearchv1-2026`, **privado** desde 2026-09-11 (petición del usuario). |
| Supabase | proyecto `hackthon2026` (ref `wplsldwzpyocmwzeyarj`). **Aplicadas 001_schema, 002_views, 003_pistas (versiones 20260912050501/050846/051124) y seed_fake** (corrida fixture con 3 casos, 30 eventos). RLS 29/29, 22 policies de lectura, 7 tablas privadas sin policy (diseño), realtime en bitacora/casos/clusters/expedientes/pistas/senales. Advisors: solo INFO/WARN de plataforma. **Pendiente del usuario: exponer el schema `forense` en Project Settings → API → Exposed schemas.** |
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

## Oleadas 1, 2 y 2b — integradas en main (H7, ≈05:25)
| Módulo | En main | Verificación en main |
|---|---|---|
| db | 001–009 (14 pistas calibradas, clusters, 11 RPC + sistema + runtime, producto, voz, ingesta/inyección, eventos de runtime + catálogo de giros), seeds, generator, loaders/load_gen, eval/metricas + comparar_corridas, eval/inyecciones a/b/c | `bash db/tests/run.sh` 313/313. gen-v1: selector 16/17 fraudes, 0/15 trampas, 0/68 fondo; baseline dos pistas FPR 4/15 |
| runtime | módulos + dispatcher, 9 code nodes, 10 workflows JSON recableados (preparar-sql ok=45, pendientes 28 → 26 funciones SQL que faltan, listadas en la entrega de db 2b), e2e del camino del worker con proveedor simulado: 45 eventos en bitácora | 326/326; generadores --check OK |
| prompts | 12 prompts, ámbito paquete, ACL, Trayectoria, variantes de reintento; version_prompts 61ed12e965dd | 96/96; manifest --check OK |
| webapp | 20 rutas, SupabaseDataSource forense, privado por service_role (perfil, investigaciones, notificaciones, inyecciones, vistas), realtime, BFF a n8n, /datos real, /inyecciones diff | typecheck OK, lint 0, build OK, 231/231 (con editor) |
| editor | DocumentWorkspace + chat + BFF /api/reportes con modos fixture/supabase/n8n, selección verificada por texto_hash, bitácora | hallazgo alto abierto: previsualización de propuesta en memoria en modo supabase (oleada 3) |
| voice | integrations/elevenlabs (payload, HMAC, dedupe, estados, callback) | 52/52; sin llamadas reales |
| qa | 67 integración (forense_qa, 001–009) + 6 e2e + informe | 64 pass / 2 todo (QA-003 db) tras corregir un comentario; e2e 4/6: la prueba de propuesta manda un texto_hash que el editor rechaza con 409 (alinear en QA, oleada 3) |
Contratos 1.2.1: 100/100. Supabase remoto: 001–008 + seeds aplicadas; 009 + 003 recalibrada en aplicación (agente).

## Acciones pendientes del usuario
- Rellenar `.env` (raíz, gitignored): `N8N_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Con eso el coordinador ejecuta `node scripts/n8n-credentials.mjs`, `node scripts/n8n-import.mjs`, carga gen-v1 en remoto y corre el smoke H4.
- **Exponer el schema `forense`** en Supabase → Project Settings → API → Exposed schemas (hoy PostgREST responde que el schema no está expuesto).
- Crear en n8n las credenciales `Forense Postgres` (host db.wplsldwzpyocmwzeyarj.supabase.co) y `Forense Supabase` (header apikey/Authorization con la service role del proyecto hackthon2026) y `Forense Webhook` (INTERNAL_WEBHOOK_SECRET). El coordinador no puede leer esas claves por MCP.
- Crear el proyecto Vercel `forense` (root `web`) y sus variables (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, NEXT_PUBLIC_DATA_SOURCE, DEMO_PASSWORD, SESSION_SECRET, N8N_WEBHOOK_BASE, INTERNAL_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY).
- Número saliente ElevenLabs cuando decida configurarlo.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
