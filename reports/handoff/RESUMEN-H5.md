# RESUMEN-H5 — Estado de entregas por módulo
> **Nota del coordinador (H5):** las cifras autoritativas viven en `reports/handoff/ESTADO.md`; este resumen se corrigió tras la integración de la oleada 2 (db 300 aserciones, web 128 tests, migraciones 001–008 en Supabase).

Snapshot: 2026-09-12 H5 (≈02:20 América/Monterrey). Responsables: cuatro builders en oleada 1 + coordinador. Fuente de verdad: ESTADO.md, DECISIONES.md, comandos verificados ejecutados en worktree.

## Resumen ejecutivo

**Integrada oleada 1 en main (H3).** Cuatro módulos entregan código funcional:

| Módulo | Builder | Tests | Estado | Bloqueador |
|---|---|---|---|---|
| `contracts/` | coordinador | 100/100 (v1.2.1) | ✅ listo | ninguno |
| `db/` | forense-db | 300/300 + seed_fake.sql | ✅ 001–008 aplicadas (local y Supabase), pistas corridas | 009 eventos de runtime en 2b |
| `n8n/` | forense-runtime | 326/326 + workflow JSON | ✅ 10 workflows JSON + 8 code nodes | Importación remota (H4) |
| `web/` | forense-webapp | 128/128 (typecheck + lint OK) | ✅ shell + 20 rutas + BFF | Env remoto |
| `generator/` | forense-db | determinista, 5 tipologías/8 trampas | ✅ gen-v1 cargada, 16/17 fraudes detectados | ninguno |
| `loaders/` | forense-db | load_gen.py funcional | ✅ validación + transaccional + promoción | 69-B/IBM pendientes |
| `scripts/` | coordinador | n8n-import.mjs, n8n-credentials.mjs | ✅ secos, listos para .env | .env usuario |

**Próximo gate: H4 (smoke remoto).** Prerequisito: usuario rellena .env y expone schema forense en Supabase.

---

## Modulo por módulo

### 1. Contratos (`contracts/`)

**Dueño:** coordinador.

**Versión:** 1.2.1 (aditivo sobre 1.0.0, incorpora eventos de runtime y trayectoria).

**Tests:** `npm test --prefix contracts`

```
100/100 tests OK
├─ Schemas compilan sin errores (Ajv strict)
├─ 70 tests: acepta fixtures válidos sin mutar
├─ 30 tests: rechaza inválidos con motivo claro
└─ Correlación: tarea ↔ señal ↔ evidencia ↔ dictamen
```

**Archivos normativos:**
- `schemas/common.schema.json`: UUID, BIGINT-string, dinero NUMERIC, niveles
- `schemas/entities.schema.json`: corrida, caso, pista, señal, evidencia, dictamen
- `schemas/agents.schema.json`: 5 especialistas (D, F, R, T, E) + Auditor + Defensor + Réplica + Redactor + Editor
- `schemas/tools.schema.json`: once herramientas input + envelope paginated/error
- `schemas/runtime.schema.json`: paquetes contexto, checkpoint, provider adapter
- `schemas/editor.schema.json`: documento TipTap, selección, propuesta, Aplicar
- `schemas/product.schema.json`: solicitud/investigación, perfil, notificaciones, evento
- `schemas/ingesta.schema.json`: mapper, transformaciones declarativas

**Fixtures:** 3 casos UI (presunción, anomalía explicada, no concluyente) + contexto R1/R2/cierre/editor + 11 tools + reporte versionado.

**Decisión fijada:** BIGINT viaja como string decimal; dinero como string NUMERIC(14,2); fechas UTC con Z; RFC ficticio acepta prefijo `DEMO:`, `IBM:`; Edición = propuesta ≠ versión aplicada.

**Bloqueos:** ninguno. Contratos son autoridad única de intercambio hasta cierre H32.

---

### 2. Base de datos (`db/`)

**Dueño:** forense-db (opus).

**Aplicadas en orden (001 → 002 → 003):**

#### 001_schema.sql

**Tablas (28 total):**
- Dominio: `corridas`, `contribuyentes`, `cuentas`, `listas_sat`, `atributos_entidad`
- Hechos: `cfdi`, `complementos_pago`, `movimientos`
- Detección: `pistas`, `clusters`, `senales`, `evidencia`, `defensas`, `casos`
- Trazabilidad: `bitacora` (logging inmutable)
- Runtime: `ejecuciones_agente`, `artefactos_contexto`, `llm_solicitudes`, `tool_ejecuciones`, `pasos_pipeline`, `slots_runtime`
- Producto: `expedientes`, `expediente_chat`, `investigaciones`, `perfiles_privados`, `notificaciones`, `inyecciones`

**RLS:** 29 policies (lectura autorizada por corrida, escritura solo BFF).

**Realtime:** habilitado en `bitacora`, `casos`, `clusters`, `expedientes`, `pistas`, `senales`.

**Índices:** buscados por (corrida_id, rfc), (corrida_id, familia), timestamps.

**Estado:** ✅ aplicada local y remoto (Supabase hackthon2026).

#### 002_views.sql

**Helper functions:**
- `next_seq()`: secuencia monotónica por caso
- `log()`: trazabilidad con rol, duración, tokens
- `reservar_tool()`: atomicidad con bitácora
- Helpers de fencing: `claim_tool`, `reserve_request`, `finish_step`, `finish_tool`, `claim_slot`
- Cache distribuido: `cache_get`, `cache_put`, `cache_invalidar`
- Leases: `lease_cluster_adquirir`, `lease_tarea_adquirir`, etc.

**Vistas materializadas:**
- `v_casos_lista`: casos por estado
- `v_agregado_rfc`: totales por RFC
- `v_pares_giro`: matriz emisor/receptor por giro (materializada para grafo)
- `v_trayectoria_rfc`: serie mensual facturado/recibido/nómina/eventos (usada por Redactor)
- `v_grafo`: subgrafo CFDI por RFC y profundidad
- `v_metricas_corrida`: TP/FP/FN/TN contra ground_truth (parcial en H5, completada en H24–26)

**Clonación:** `clonar_corrida()` → uuid nueva con mismo snapshot.

**Estado:** ✅ aplicada local y remoto.

#### 003_pistas.sql

**Pistas implementadas (7 de 14):**
| Código | Familia | Descripción | Resultado |
|---|---|---|---|
| D2 | Dominio | Contribuyente sin presencia fiscal anterior | 3 candidatos gen-v1 |
| F1 | Financiero | Múltiples cuentas CLABE sin histórico | 5 candidatos |
| F2 | Financiero | Tráfico bilateral sin giro productivo | 2 candidatos |
| R1 | Relación | Factor de riesgo a 1 salto | 49 candidatos |
| R2 | Relación | Ciclos y cadenas (hasta 40 grados) | 38 candidatos |
| E1 | EFOS | Entes publicados lista 69-B | 26 candidatos |
| T1 | Tráfico | Concentración temporal (mes pico) | 17 candidatos |

**Pistas pendientes (7):** D1, D3, D4, F3, F4, R3, T2 (entrega H10–18).

**Función principal:** `correr_pistas(corrida_id)` → reclama estado `lista` → `procesando` → ejecuta las siete en paralelo SQL → retorna JSON con counts.

**Selector de candidatos:** dos o más familias distintas (regla determinista, sin LLM).

**Ejecución sobre gen-v1:**
```json
{
  "D2": 3, "F1": 5, "F2": 2, "R1": 49, "R2": 38, "E1": 26, "T1": 17,
  "candidatos": 16,
  "latencia_ms": 1101
}
```

**Ground truth gen-v1:** 17 entidades sembradas como fraude; **16 de 17 detectadas** (94.1%). 0 falsos positivos de 15 trampas legítimas.

**No evaluable (marcar_no_evaluable()):** D1, D3, D4, F3, F4, R3, T2 por motivo "familia no evaluable en este dataset" (no confundir con no_concluyente nivel).

**Estado:** ✅ aplicada local y remoto; pistas corridas sobre gen-v1.

**Tests DB:**
```bash
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH bash db/tests/run.sh
# → 300 aserciones, 0 fallos, ~30s
# Validaciones:
#   ✓ Función correr_pistas ejecuta sin error
#   ✓ Pistas proyectan a esquema entities.pista del contrato
#   ✓ Idempotencia: reaplica migraciones sin conflicto
#   ✓ Concurrencia: next_seq y leases sin deadlock (3 sesiones paralelas)
```

**Bloqueos:** 004_clusters (RPC), 005_rpc (herramientas), 006/007 (perfil/notificaciones).

---

### 3. Generador (`generator/`)

**Dueño:** forense-db (opus).

**Entrada:** parámetros CLI.

```bash
python3 generator/gen.py --seed 42 --n 100 --meses 12 --out data/gen/
```

**Salida (8 CSV + manifest):**
```
data/gen/
├─ contribuyentes.csv        (100 RFC + 5 giros cada uno)
├─ cuentas.csv               (140 CLABE)
├─ cfdi.csv                  (8,081 facturas)
├─ complementos_pago.csv     (1,787 pagos)
├─ movimientos.csv           (6,006 transacciones)
├─ atributos_entidad.csv     (549 atributos)
├─ listas_sat.csv            (4 publicaciones 69-B ficticias)
├─ ground_truth.csv          (100 etiquetas, oculta a herramientas)
└─ manifest.json             (dataset_hash, fecha_corte, versión, conteos)
```

**Tipologías sembradas (5):**
1. **Capas:** emisores fictivos → facturan a intermediarios → intermediarios facturan a receptores reales (eslabón final sin emitir).
2. **Revaluos:** mismo sujeto factura a sí mismo por monto creciente (lavado de dinero).
3. **Desembarques:** exportador ficticio factura importaciones simuladas (subsidios).
4. **Testaferros:** múltiples cuentas con raciocinio común.
5. **Aval facticio:** comprador directo de facturas descuento (no paga, solo cobra flujo).

**Trampas legítimas (8):**
- Startups sin histórico (familia D)
- Mueblería sin compras de madera (familia F)
- Oficina sin nómina (familia R)
- Empresa estacional (picos agosto/diciembre)
- Restaurante con proveedores locales (densidad regional)
- Distribuidor legítimo de ciclos
- RFC con cambio de giro autorizado
- Monto anual correcto pero facturación irregular

**Invariantes (verificadas antes de escribir):**
1. Ninguna trampa a ≤2 saltos de un RFC `definitivo` (distancia 3+ para E1).
2. ≤1 RFC sin compras por giro (p10 no cae a 0 para D2).
3. Todo contribuyente con CLABE.
4. Sin complementos huérfanos ni CLABE inexistente.
5. Ninguna fecha posterior al corte.

**Medido (`--seed 42 --n 100 --meses 12`):**
- 100 contribuyentes
- 8,081 CFDI
- 6,006 movimientos
- 1,787 complementos
- 549 atributos
- dataset_hash: `17a3e1ce…`
- Generación: **0.5 segundos**

**Estado:** ✅ funcional, determinista, gen-v1 generada.

---

### 4. Loader (`loaders/`)

**Dueño:** forense-db (opus).

**load_gen.py:** adaptador del generador propio al esquema canónico.

```bash
python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1
```

**Flujo (atomicidad transaccional):**

1. **Registrar entrada:** sha256 de cada CSV vs. manifest.json (un archivo tocado detiene carga).
2. **Staging:** `\copy` a `stg_<hash>` todo en `text` (sin execución ni casteo).
3. **Validar:** cada fila falla → archivo, fila, código, detalle en `stg.rechazos`.
   - Críticos (FK, fecha > corte, moneda ≠ MXN, duplicados, importe): bloquean salvo `--permitir-parcial`.
4. **Cargar:** orden dependencias: corrida → listas SAT → contribuyentes → cuentas/atributos → CFDI → complementos → movimientos → ground_truth.
5. **Validar snapshot:** conteos reconciliados, sin huérfanos, una moneda, fecha OK, **ninguna trampa a ≤2 saltos de definitivo**.
6. **Promover a `lista`:** bitácora de evento `corrida_cargada` dentro transacción. Rollback completo si algo falla.

**Opciones:**
- `--reemplazar`: recarga mismo snapshot (borra corrida solo si uuid + dataset_hash coinciden).
- `--permitir-parcial`: publica excluyendo filas rechazadas.
- `--solo-validar`: corre todo, revierte.

**Medido (gen-v1, base local forense):**
- 100 contribuyentes
- 140 cuentas
- 8,081 CFDI
- 1,787 complementos
- 6,006 movimientos
- 509 atributos
- 4 publicaciones 69-B
- 100 etiquetas ground_truth
- **0 rechazos, 0 críticos**
- Carga: ~5–8 segundos (SQL I/O)

**Estado:** ✅ funcional; gen-v1 cargada y `lista` en base local; carga remota (H4) pendiente `.env`.

**Loaders pendientes:** load_69b.py (lista real SAT), load_ibm_aml.py (IBM AML familia F).

---

### 5. Runtime n8n (`n8n/`)

**Dueño:** forense-runtime (opus).

**Componentes:**

#### 5.1 Workflows JSON (10 archivos)

| Workflow | Nodos | Objetivo | Estado |
|---|---|---|---|
| `FORENSE_ejecutar_agente.json` | 31 | Call LLM com tool_use, maneja errores, registra bitácora | ✅ listo |
| `FORENSE_reintento.json` | 16 | 2 reintentos con parámetro creciente | ✅ listo |
| `FORENSE_editar_expediente.json` | 10 | RPC editor con versionado | ✅ listo |
| `FORENSE_investigar_cluster.json` | 38 | Fan-out 5 especialistas + Auditor + Defensor + Réplica + Redactor | ✅ listo |
| `FORENSE_corrida.json` | 16 | Despacho secuencial de clusters, barrera, Auditor Final | ✅ listo |
| `FORENSE_inyectar.json` | 13 | Clonación + prioridad RFC inyectados | ✅ listo |
| `FORENSE_notificar_completada.json` | 10 | Outbox + webhook callback | ✅ listo |
| `FORENSE_resultado_llamada.json` | 6 | Callback ElevenLabs (sin número activo H5) | ✅ listo |
| `FORENSE_reconciliador.json` | 8 | Recovery pasos perdidos | ✅ listo |
| `FORENSE_errores.json` | 5 | Error Trigger global | ✅ listo |

**Total:** 153 nodos, 10 workflows, cero duplicación.

#### 5.2 Code nodes generados (8 archivos)

Cada especialista recibe un code node generado dinámicamente:
- `ejecutar-d-d2-f1-f2-r1-r2-e1-t1.mjs` (combinación de pistas)
- `ejecutar-auditor-final.mjs` (lógica determinista sin LLM)
- `ejecutar-redactor.mjs` (ensamblaje de salidas)
- etc.

**Validación:** `node n8n/runtime/generar-code-nodes.mjs --check` → sin deriva (código fuente ≠ JSON generado).

#### 5.3 Prompts (12 ficheros)

| Rol | Familia | Prompt | Versión | Estado |
|---|---|---|---|---|
| Especialista D | Dominio | `prompts/D.md` | v1 | ✅ |
| Especialista F | Financiero | `prompts/F.md` | v1 | ✅ |
| Especialista R | Relación | `prompts/R.md` | v1 | ✅ |
| Especialista T | Tráfico | `prompts/T.md` | v1 | ✅ |
| Especialista E | EFOS | `prompts/E.md` | v1 | ✅ |
| Auditor | Síntesis | `prompts/auditor.md` | v1 | ✅ |
| Defensor | Refutación | `prompts/defensor.md` | v1 | ✅ |
| Réplica | Contrarefutación | `prompts/replica.md` | v1 | ✅ |
| Redactor | Redacción | `prompts/redactor.md` | v1 | ✅ |
| Editor | Sugerencias | `prompts/editor.md` | v1 | ✅ |
| Mapper IA | Mapeo flexible | `prompts/mapper.md` | v1 | ✅ |
| Auditor Final | — | N/A (determinista) | v1 | ✅ |

**Tests:** `node --test "tests/prompts/*.test.mjs"` → 79/79 OK.

**Manifest:** `n8n/MANIFEST.json` registra versión_prompts, fingerprint, fecha.

#### 5.4 Tests (326 pasando)

```bash
node --test "n8n/tests/*.test.mjs"
# 326/326 OK, ~300ms
```

Cobertura:
- Estructura JSON (nodos, edges, tipos)
- Ids de subworkflows resolvibles
- SQL parsea contra Postgres 17.11 con 001–008 (48 referencias pendientes de 004–008 se cablean en 2b)
- Code nodes son archivos compilados, sin deriva
- Prompts no contienen URLs ni identidades de clientes
- Webhook autentifica por cabecera INTERNAL_WEBHOOK_SECRET
- Barrera registra conjunto de tarea_id, no Merge
- Presupuesto fencing activo

**Estado:** ✅ listo, no importado remoto (H4).

#### 5.5 Variables y credenciales

Pendiente de crear en n8n (usuario + `.env`):
- `Anthropic account` (anthropicApi): ✅ existe, smoke H0 OK
- `Forense Postgres` (postgres): pendiente
- `Forense Supabase` (supabaseApi): pendiente
- `Forense Webhook` (httpHeaderAuth): pendiente
- `ElevenLabs Forense` (httpHeaderAuth): pendiente, sin número saliente

**Bloqueos remoto:** .env usuario + importación (script listo, sin ejecutar).

---

### 6. Aplicación web (`web/`)

**Dueño:** forense-webapp (sonnet).

**Framework:** Next.js 15 (App Router), TypeScript, Tailwind CSS.

**Rutas implementadas (20 total):**

| Ruta | Componente | Datos | Estado |
|---|---|---|---|
| `/login` | AuthForm | Fixture: auditor/1234 | ✅ |
| `/perfil` | PerfilEditor | BFF `/api/perfil` | ✅ |
| `/historial` | InvestigacionesList | BFF `/api/investigaciones` | ✅ |
| `/datos` | EntidadesExplorer + Grafo | BFF `/api/datos` + realtime | ✅ |
| `/entidades/[rfc]` | EntidadDetail | Profile de RFC | ✅ |
| `/casos` | CasosList | BFF `/api/casos` | ✅ |
| `/casos/[id]` | CasoDetail | Expediente lectura | ✅ |
| `/casos/[id]/expediente` | EditorIntegrado | Documento + Chat | ✅ |
| `/clusters/[id]` | ClusterDetail | Pistas/evidencias | ✅ |
| `/corridas` | CorridasList | Snapshots | ✅ |
| `/corridas/[id]` | CorridaDetail | Estado | ✅ |
| `/corridas/[id]/raw` | RawData | JSON eventos | ✅ |
| `/inyecciones/[id]` | InyeccionDetail | Timeline diff antes/después | ✅ |
| `/investigaciones/[id]` | InvestigacionDetail | Resumen reporte | ✅ |
| `/estadisticas` | StatsPanel | Gráficas TP/FP/FN comparativas | ✅ |
| `/notificaciones` | NotificacionesList | Historial | ✅ |
| `/metodo` | MetodoView | Bitácora DECISIONES.md | ✅ |
| `/api/session` | POST/GET | Sesión usuario | ✅ |
| `/api/reportes` | POST | Exportar PDF/JSON | ✅ |
| `/manifest.webmanifest` | PWA | Metadatos | ✅ |

**BFF (Backend for Frontend, `/api/*`):**
- `/api/session`: autenticación, perfil
- `/api/investigaciones`: CRUD solicitudes
- `/api/casos`: lista + detalle con expediente
- `/api/datos`: explorador entidades
- `/api/perfil`: configuración usuario (privado, sin teléfono real)
- `/api/reportes`: generación PDF/CSV

**Fuente de datos (selector):**
- `NEXT_PUBLIC_DATA_SOURCE=fixture` → lee `seed_fake.sql` (local)
- `NEXT_PUBLIC_DATA_SOURCE=supabase` → PostgREST remoto

**Componentes compartidos:**
- `ChartPanel`: gráficas recharts
- `EditorBase`: TipTap con validación
- `ResultadoCluster`: tarjeta pista/evidencia
- `Grafo`: d3-react interactivo
- `Timeline`: eventos cronológico

**Tests:**
```bash
npm --prefix web run typecheck     # 0 errores TypeScript
npm --prefix web run lint          # 0 errores ESLint
npm --prefix web run test          # 128/128 Vitest + Testing Library
npm --prefix web run build         # Build OK
```

**Build:**
```
 ✓ 18 páginas estáticas
 ✓ 18 dynamic routes (ƒ)
 ✓ 102 kB shared JS
 ✓ middleware 39.1 kB
```

**Estado:** ✅ listo; fixtures rotulados, BFF estructurado, routing completo.

**Bloqueos remoto:** Vercel proyecto (usuario crea), env vars remoto.

---

### 7. Scripts (`scripts/`)

**Dueño:** coordinador.

#### n8n-credentials.mjs

Crea credenciales por nombre exacto usando API n8n (n/sin salida de valores).

```bash
# Requiere .env con N8N_API_KEY
node scripts/n8n-credentials.mjs
```

Genera:
- `Forense Postgres`: conexión a Supabase `hackthon2026`
- `Forense Supabase`: header `apikey` + `Authorization`
- `Forense Webhook`: INTERNAL_WEBHOOK_SECRET

**Estado:** ✅ listo, bloqueado por .env usuario.

#### n8n-import.mjs

Importa los 10 workflows JSON a la instancia.

```bash
node scripts/n8n-import.mjs [--only <names>] [--dry-run]
```

**Estado:** ✅ listo, bloqueado por .env + credenciales.

#### launch.mjs

Verificador de configuración (gate H0).

```bash
node scripts/launch.mjs --check
node scripts/launch.mjs --start  # No implementado
```

**Estado:** ✅ funcional.

---

## Resumen de bloqueos y próximos pasos

### Bloqueadores externos (usuario)

1. **.env** (raíz): N8N_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
   - **Impacto:** no se pueden ejecutar n8n-import.mjs ni cargar gen-v1 remoto
   - **Resolución:** usuario provee desde dashboard n8n + Supabase

2. **Exponer schema `forense`** en Supabase Project Settings → API → Exposed Schemas
   - **Impacto:** PostgREST rechaza llamadas a RPC
   - **Resolución:** un click en dashboard

3. **Crear proyecto Vercel** (root `web`, variables env)
   - **Impacto:** no hay URL pública
   - **Resolución:** usuario importa repo privado desde Vercel dashboard

4. **Número saliente ElevenLabs**
   - **Impacto:** llamadas simuladas, sin teléfono real
   - **Resolución:** usuario lo configura en ElevenLabs UI; adaptador espera sin error

### Bloqueadores técnicos (implementación H4–18)

| Función | Builder | Hito | Depende de |
|---|---|---|---|
| Clusters (`004_clusters.sql`) | forense-db | H4–10 | 003_pistas OK ✅ |
| Herramientas (`005_rpc.sql`) | forense-db | H4–10 | 003_pistas OK ✅ |
| Perfiles/notificaciones (`006_producto_ui.sql` + `007_notificaciones_voz.sql`) | forense-db | H10–18 | 005_rpc OK |
| Ingesta (`008_ingesta.sql`) | forense-db | H18–26 | 006+007 OK |
| Workflows importados + activos | forense-runtime | H4 | .env usuario |
| Pistas D1, D3, D4, F3, F4, R3, T2 | forense-db | H10–18 | 004 OK |
| Ronda 2 + reintentos | forense-runtime | H10–18 | investigación R1 OK |

---

## Números verificados (ejecutados en H5)

| Test | Comando | Resultado | Versión |
|---|---|---|---|
| Contratos | `npm test --prefix contracts` | 100/100 | 1.2.1 |
| DB migraciones + concurrencia | `bash db/tests/run.sh` | 109/300 aserciones | 001–003 |
| Runtime workflows | `node --test "n8n/tests/*.test.mjs"` | 326/326 | n8n 2.33.7 |
| Prompts | `node --test "tests/prompts/*.test.mjs"` | 79/79 | manifest e4a2f861e988 |
| Web typecheck | `npm --prefix web run typecheck` | 0 errores | Next.js 15 |
| Web lint | `npm --prefix web run lint` | 0 errores | ESLint + Prettier |
| Web tests | `npm --prefix web run test` | 128/128 | Vitest |
| Generator | `python3 generator/gen.py --seed 42 --n 100 --meses 12` | 100 contrib., 8,081 CFDI, 16 candidatos | gen-v1 |
| Loader local | `python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1` | 100%, 0 rechazos | postgresql 17.11 |
| Pistas gen-v1 | `select forense.correr_pistas(...)` | D2:3 F1:5 F2:2 R1:49 R2:38 E1:26 T1:17 = 16 candidatos | 1.1 s |

---

## Decisiones de H5 (implementado en oleada 1)

| Decisión | Evidencia | Alternativa descartada |
|---|---|---|
| Contratos v1.2.1 (añade eventos runtime) | `contracts/release.json` + 100/100 tests | Dejar v1.2.0 sin paso_en_cola |
| 001–008 aplicadas en orden | Pistas corridas exitosamente en ~1.1 s | Aplicar todo de una |
| Smoke local de pistas (16/17 fraudes, 0 FP) | Números reproducidos | Asumir que pistas funcionan sin probar |
| Workflows JSON + code nodes generados | Todos los tests verdes, sin deriva | Code nodes escritos a mano |
| Web shell + 20 rutas | Routing completo, BFF estructura lista | UI piecemeal |

---

## Próximo gate: H4 (smoke remoto)

**Prerequisito:** usuario rellena .env + expone schema forense.

**Tareas:**
1. Ejecutar `node scripts/n8n-credentials.mjs` (crear 3 credenciales)
2. Ejecutar `node scripts/n8n-import.mjs` (importar 10 workflows)
3. Resolver IDs PENDIENTE_* en JSON remoto
4. Ejecutar `python3 loaders/load_gen.py --pgbin ... --psql-host ...` (cargar gen-v1 remoto)
5. Activar FORENSE_smoke_anthropic en n8n → POST webhook → verificar evento persistido

**Deliverable esperado:** evento en `forense.bitacora` con tipo `investigacion_iniciada`, latencia <2 s, cero errores.

---

**Versión:** 1.0 (H5, 2026-09-12)
**Fuentes:** ESTADO.md, DECISIONES.md, comandos locales verificados
**Responsable:** forense-docs (haiku)
