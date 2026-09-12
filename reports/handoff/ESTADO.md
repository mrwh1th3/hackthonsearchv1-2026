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

## Hotfix H11 — integrado en main (commits ffb5050 → 93385ba)
Las tres ramas (db6, runtime6, qa5) entraron en orden de dependencia, y el
coordinador añadió 016 y 017 para cerrar lo que los verificadores dejaron
abierto. Todo lo de abajo está **medido en main**, no heredado de los
informes de los builders.

| Qué | Dónde | Medido en main |
|---|---|---|
| ANALYZE al clonar: el barrido de un clon no terminaba en 300 s | `db/014_estadisticas.sql` | clonado 417 ms + barrido 1 473 ms; el gate de QA mide 1 440 ms contra un umbral de 30 000 ms |
| `cobertura_completa` no la escribía nadie, así que todo caso salía `no_concluyente` | `db/015_cobertura.sql` | regla determinista en SQL, recalculada al cerrar la última ronda y antes del dictamen |
| Tres funciones de 014/015 quedaron ejecutables por PUBLIC (`proacl '=X'`) | `db/016_permisos_cobertura.sql` | aserción sobre `pg_proc.proacl`: ninguna entrada con beneficiario vacío |
| La cobertura medía `clusters.rfcs_frontera`, la LISTA DE CANDIDATOS, no la frontera que pidieron las señales | `db/016` | sobre un cluster real de gen-v1 (40 RFC, **70 candidatos**): sin frontera pedida `true`; con frontera pedida y cuota `false`; cuota agotada `true` |
| `max_expansiones_caso` sin sembrar caía en el default de código 2, contra el "máximo una expansión por cluster" de 03 §127 | `db/016` | sembrada en 1 y comprobada con un default imposible (99) |
| `casos.cobertura_completa` tenía dos escritores: la regla y el payload del dictaminador | `db/016` + `db/017` | el payload ya no la sube ni la baja; se recalcula tras el UPDATE, con evento en bitácora |
| **`anomalia_explicada` era inalcanzable** (ver abajo) | `db/017_evaluacion_pistas.sql` + `n8n/runtime/auditor-final.mjs` | 353 tests de runtime, con casos nuevos para pista sostenida, `no_evaluable` y defensa ausente |
| FORENSE_corrida no redespachaba hasta vaciar la cola | `n8n/` (runtime6) | e2e de corrida: 6 clusters con MAX_ACTIVOS=2 → 7 vueltas, 4 redespachos, corrida `completada`, 6,9 s |

Suites en main tras el hotfix: `db/tests/run.sh` **459 aserciones, 0 fallidas,
0 omitidas** con GEN=1 (417 con GEN=0, 4 omitidas); integración **157/157**
(exit 0, sin parches ad hoc); e2e webapp **8/8**; runtime **353/353**;
contratos **110/110**; prompts 106; voz 67; web typecheck + lint + **272/272**;
generadores de code-nodes y workflows sin deriva.

### Hallazgo H11-b: la capa de descarte de falsos positivos no podía producirse
Lo destapó el arreglo de la cobertura: mientras `cobertura_completa` era
siempre false, TODO caso salía `no_concluyente` y nadie notó que el nivel
`anomalia_explicada` era imposible.

- El dictaminador llegaba a ese nivel por una sola vía: que todas las pistas
  tuvieran `estado === 'refutada'`.
- `forense.pistas.estado` admite `disparada` y `no_evaluable`, y nada más
  (001); el contrato `entities.pista` declara el mismo par. El valor
  `refutada` no existe, así que la condición era siempre falsa.
- La defensa no toca el estado global de la pista, y hace bien: escribe el
  resultado **por caso** en `casos.evaluacion_pistas`.
- `paquete_auditor_final` exponía ese objeto leyéndolo por código de pista
  (`R1`) cuando la clave es el **ID** de la pista, que es como lo escribe la
  réplica y como lo declara el contrato del defensor. `evaluacion_caso`
  viajaba en null siempre.

Las pruebas lo ocultaron cinco oleadas porque alimentaban valores que la base
no puede contener (`estado: 'refutada'`, `estado: 'confirmada'`).

**Sin verificar todavía:** el descarte no se ha ejercido de punta a punta. El
ensayo (c) con proveedor simulado no corre el Defensor, y sin defensa ese
nivel es inalcanzable por construcción, así que el e2e lo reporta
`requiere_api_real` **antes** de mirar el nivel. Las cifras de trampas
(0/15) miden el **selector**, no el descarte. Queda como gate H8–10 con la
API real: una trampa legítima que cierre en `anomalia_explicada`.

## Abierto
- Aplicar 014–017 al proyecto Supabase `hackthon2026` (en curso por el coordinador).
- Bloqueado por .env: credenciales n8n, importación de workflows, carga remota de gen-v1, smoke H4 y gate H8–10 (primer expediente real con API).
- Sin empezar por los builders: horas intradía en `generator/gen.py` (gen-v2, necesario para que T2 sea evaluable), `loaders/load_69b.py`, `loaders/load_ibm_aml.py`.

## Acciones pendientes del usuario
- Rellenar `.env` (raíz, gitignored): `N8N_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Con eso el coordinador ejecuta `node scripts/n8n-credentials.mjs`, `node scripts/n8n-import.mjs`, carga gen-v1 en remoto y corre el smoke H4.
- **Exponer el schema `forense`** en Supabase → Project Settings → API → Exposed schemas (hoy PostgREST responde que el schema no está expuesto).
- Crear en n8n las credenciales `Forense Postgres` (host db.wplsldwzpyocmwzeyarj.supabase.co) y `Forense Supabase` (header apikey/Authorization con la service role del proyecto hackthon2026) y `Forense Webhook` (INTERNAL_WEBHOOK_SECRET). El coordinador no puede leer esas claves por MCP.
- Crear el proyecto Vercel `forense` (root `web`) y sus variables (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, NEXT_PUBLIC_DATA_SOURCE, DEMO_PASSWORD, SESSION_SECRET, N8N_WEBHOOK_BASE, INTERNAL_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY).
- Número saliente ElevenLabs cuando decida configurarlo.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
