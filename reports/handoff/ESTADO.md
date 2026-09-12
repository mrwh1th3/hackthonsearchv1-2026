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

## Oleadas 1–3 — integradas en main (H9, ≈07:40; commit b5374b8)
| Módulo | En main | Verificación en main |
|---|---|---|
| db | 001–011: esquema + runtime, 14 pistas calibradas, clusters, 11 RPC + sistema + 30 funciones del runtime (010), producto, voz, ingesta/inyección, eventos, métricas completas (011 = eval/metricas.py campo a campo); seeds; generator; loaders/load_gen; eval | `bash db/tests/run.sh` 392/392. gen-v1: selector 16/17 fraudes, 0/15 trampas; baseline FPR 4/15 |
| runtime | 10 workflows JSON cableados al 100% (preparar-sql ok=73/73), e2e del camino completo con dictamen determinista real, ensamblado embebido con sello 33a95afbc976, editar/inyectar/voz | 330/330; generadores --check OK |
| prompts | 12 prompts, techos por rol, variantes de reintento, Trayectoria | 106/106 |
| webapp + editor | 20 rutas, Supabase real, privado por perfil_id, realtime, inyección con diff, editor persistente (propuestas en DB, revertir por RPC, bitácora) | typecheck OK, lint 0, build OK, 272/272 |
| voice | adaptador ElevenLabs con firma t=,v0=, callback post_call_transcription, dedupe por tipo | 67/67 |
| qa | 131 integración (forense_qa 001–011) + 7 e2e; informes oleadas 2–3 | 131/131, 7/7 |
Oleada 4 integrada (H11): db 001–013 (381 aserciones sin gen; 012/013), runtime 337 tests y 155 nodos, QA 149 pruebas (gate de rendimiento rojo hasta 014), RUNBOOK/RESUMEN-H10. Contratos **1.3.1**: 110/110. Supabase remoto: **001–013 + 003 recalibrada + seeds aplicadas** (012/013: 5/5 cuerpos idénticos, 4 índices, 128 funciones con ACL explícita; 014 del hotfix pendiente) (versiones hasta 20260912094346; 32/32 cuerpos de 010/011 idénticos; 126 funciones en `forense`, ninguna con EXECUTE público; `v_metricas_corrida` completa). Datos remotos: solo fixture; gen-v1 pendiente de `SUPABASE_DB_URL`.

## Abierto (hotfix H11 en curso: db6 ∥ runtime6 → qa5)
- ANALYZE tras clonar (014) → gate de inyección <5 s; cobertura_completa calculada en código; FORENSE_corrida redespacha hasta vaciar la cola; e2e de corrida completa.
- ~~QA-004~~ resuelto en 012 (asegurar_clusters_inyectados) y cableado en FORENSE_inyectar.
- Rendimiento: causa real = estadísticas rancias tras clonar (F1 42 s → 0.24 s con ANALYZE); 013 añade índices y F1 equivalente; 014 (hotfix) añade el ANALYZE en el clonado.
- ~~Runtime: prompt_hash por variante y aviso de reintento~~ hecho en runtime5 (orden del nodo de aviso se corrige en hotfix).
- Bloqueado por .env: credenciales n8n, importación de workflows, carga remota de gen-v1, smoke H4 y gate H8–10 (primer expediente real con API).

## Acciones pendientes del usuario
- Rellenar `.env` (raíz, gitignored): `N8N_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Con eso el coordinador ejecuta `node scripts/n8n-credentials.mjs`, `node scripts/n8n-import.mjs`, carga gen-v1 en remoto y corre el smoke H4.
- **Exponer el schema `forense`** en Supabase → Project Settings → API → Exposed schemas (hoy PostgREST responde que el schema no está expuesto).
- Crear en n8n las credenciales `Forense Postgres` (host db.wplsldwzpyocmwzeyarj.supabase.co) y `Forense Supabase` (header apikey/Authorization con la service role del proyecto hackthon2026) y `Forense Webhook` (INTERNAL_WEBHOOK_SECRET). El coordinador no puede leer esas claves por MCP.
- Crear el proyecto Vercel `forense` (root `web`) y sus variables (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, NEXT_PUBLIC_DATA_SOURCE, DEMO_PASSWORD, SESSION_SECRET, N8N_WEBHOOK_BASE, INTERNAL_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY).
- Número saliente ElevenLabs cuando decida configurarlo.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
