# RUNBOOK — Inicio, desarrollo y despliegue del Agente Forense

Documento operativo de referencia para trabajar con el sistema multi-agente de investigación de fraude fiscal. Última actualización: 2026-09-12 H10 (oleada 4 integrada).

## (a) Requisitos locales

Antes de proceder, verificar que la máquina de desarrollo tiene:

- **Node.js 22** (verificado: 22.19.0)
  ```bash
  node --version
  ```

- **PostgreSQL 17** (Homebrew en macOS, localhost:5432, usuario postgres, autenticación trust)
  ```bash
  which psql
  psql --version
  # Debe estar disponible en /opt/homebrew/opt/postgresql@17/bin/psql
  ```

- **Python 3.9+** con paquetes: `faker`, `networkx`, `pandas`
  ```bash
  python3 --version
  pip3 list | grep -E 'faker|networkx|pandas'
  # Instalar si faltan:
  pip3 install faker networkx pandas
  ```

- **.env** en la raíz (gitignored) con tres variables:
  ```
  N8N_API_KEY=<clave de acceso a n8n, proyecto n0vtYcnvIW4LpWOE>
  SUPABASE_SERVICE_ROLE_KEY=<clave service_role del proyecto hackthon2026>
  SUPABASE_DB_URL=postgresql://postgres.wplsldwzpyocmwzeyarj:<password>@db.wplsldwzpyocmwzeyarj.supabase.co:5432/postgres
  ```
  
  Estas variables **nunca** se imprimen ni se debuggean. El usuario las provee desde el dashboard de n8n y Supabase.

## (b) Arranque local paso a paso

### Paso 0: Verificar baseline

```bash
cd /Users/victorblanco/Downloads/hackthonsearchv1/.claude/worktrees/agent-ac5fca6c76ab073aa
node scripts/launch.mjs --check
# Debe devolver exit code 0 si la configuración es válida
```

### Paso 1: Contratos (base ejecutable)

Los contratos son esquemas JSON compartidos, fixtures sintéticas y tests. No dependen de DB ni red.

```bash
npm ci --prefix contracts --ignore-scripts
npm test --prefix contracts
```

**Resultado esperado:** 100/100 tests OK (v1.2.1). El archivo `contracts/release.json` contiene el fingerprint de los schemas y versión.

### Paso 2: Base de datos local

#### 2.1 Crear base `forense` (una sola vez)

```bash
createdb forense
```

Si ya existe (verificar con `psql -l | grep forense`), puede reutilizarse. Los tests crean bases temporales descartables.

#### 2.2 Aplicar migraciones en orden

```bash
psql -d forense -f db/001_schema.sql
psql -d forense -f db/002_views.sql
psql -d forense -f db/003_pistas.sql
psql -d forense -f db/004_clusters.sql
psql -d forense -f db/005_rpc.sql
psql -d forense -f db/006_producto_ui.sql
psql -d forense -f db/007_notificaciones_voz.sql
psql -d forense -f db/008_ingesta.sql
psql -d forense -f db/009_runtime_eventos.sql
psql -d forense -f db/010_runtime_funciones.sql
psql -d forense -f db/011_metricas_corrida.sql
psql -d forense -f db/012_inyeccion_clusters.sql
psql -d forense -f db/013_rendimiento.sql
psql -d forense -f db/014_estadisticas.sql
psql -d forense -f db/015_cobertura.sql
psql -d forense -f db/016_permisos_cobertura.sql
psql -d forense -f db/017_evaluacion_pistas.sql
```

- `001_schema.sql`: tablas, índices, RLS, realtime, control de runtime.
- `002_views.sql`: vistas de soporte, helpers de fencing, cálculos de presupuesto.
- `003_pistas.sql`: siete pistas iniciales (D2, F1, F2, R1, R2, E1, T1) y `correr_pistas()`; la segunda entrega (D1, D3, D4, F3, F4, R3, T2) llega en la oleada 2b.
- `004_clusters.sql`: `armar_clusters`, `expandir_cluster`, leases de cluster.
- `005_rpc.sql`: las 11 herramientas `public.forense_*`, 3 funciones de sistema y las funciones que usa el runtime.
- `006_producto_ui.sql` y `007_notificaciones_voz.sql`: perfiles, investigaciones, propuestas, outbox y llamadas (sin SELECT público).
- `008_ingesta.sql`: ingestas, staging, `forense.inyecciones` y `clonar_corrida_con_inyeccion` (inyección en vivo, 21 §3).
- `009_runtime_eventos.sql` (oleada 2): tipos de evento (`paso_en_cola`, `paso_checkpoint`), catálogo ClaveProdServ por giro.
- `010_runtime_funciones.sql` (oleada 2b): 26+ funciones del runtime que los workflows de n8n llaman; todo retorna `table(...)` con nombres exactos del contrato.
- `011_metricas_corrida.sql` (oleada 3): `forense.v_metricas_corrida` completa (baseline, selector, acierto_de_cache, tasa_de_ronda_2, reintentos por motivo).
- `012_inyeccion_clusters.sql` (oleada 4): QA-004, garantiza cluster por RFC inyectado vía `forense.armar_cluster_para`, estado_corrida con clusters pendientes.
- `013_rendimiento.sql` (oleada 4): cuatro índices y F1 reescrita con resultado idéntico. Ojo: tras clonar una corrida hay que ejecutar `ANALYZE` (lo hace `forense.analizar_snapshot()` de 014 en el hotfix H11); sin él F1 tarda ~42 s por estadísticas rancias.

- `014_estadisticas.sql` (hotfix H11): `forense.analizar_snapshot()` y su llamada al final de cada clonado y como primer paso de `correr_pistas`. Sin ella el barrido sobre un clon recién creado no terminaba en 300 s; con ella, clonado 417 ms y barrido 1 473 ms.
- `015_cobertura.sql` (hotfix H11): `forense.cobertura_caso` / `recalcular_cobertura`. Antes nadie escribía `casos.cobertura_completa`, así que el dictaminador determinista devolvía `no_concluyente` en todos los casos.
- `016_permisos_cobertura.sql` (hotfix H11, coordinador): revoca el `execute` a PUBLIC que 014/015 no revocaron, hace que la cobertura mida la frontera pedida por las señales en vez de la lista de candidatos del cluster, siembra `max_expansiones_caso=1` y deja un solo escritor de la columna.
- `017_evaluacion_pistas.sql` (hotfix H11, coordinador): `paquete_auditor_final` lee `casos.evaluacion_pistas` por ID de pista, que es como la escribe la réplica. Sin esto `evaluacion_caso` viajaba en null y `anomalia_explicada` —la capa de descarte de falsos positivos— era inalcanzable. También mueve el recálculo de cobertura a después del update en `guardar_dictamen`.

**Estado actual:** 001–013 aplicadas en la instancia `forense` local y en Supabase `hackthon2026` (H10); 014–017 aplicadas en local y pendientes de aplicar en Supabase.

#### 2.3 Cargar fixture manual (UI)

```bash
psql -d forense -f db/seeds/seed_fake.sql
```

Crea tres casos de prueba con eventos sintéticos. Esta corrida se marca `completada` y no participa en evaluación de detección.

**Verificación:**
```bash
psql -d forense -c "select count(*) as casos from forense.casos where corrida_id = (select id from forense.corridas where nombre = 'Fixture UI — no es evaluación');"
# Debe devolver 3
```

### Paso 3: Generador y loader

#### 3.1 Generar dataset sintético

```bash
python3 generator/gen.py --seed 42 --n 100 --meses 12 --out data/gen/
```

Produce ocho archivos CSV y `data/gen/manifest.json`:
- `contribuyentes.csv`: 100 RFC ficticios
- `cfdi.csv`: 8,081 facturas
- `movimientos.csv`: 6,006 movimientos bancarios
- `ground_truth.csv`: etiquetas de fraude (ocultas a las herramientas)

**Verificación:**
```bash
wc -l data/gen/*.csv
# Debe tener ~8,082 facturas (incluida cabecera)
```

#### 3.2 Cargar dataset en Postgres

```bash
python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1
```

Realiza validación completa, carga transaccional y marca la corrida como `lista`. Devuelve un UUID de corrida y `dataset_hash`.

**Verificación:**
```bash
psql -d forense -c "select nombre, estado, dataset_hash from forense.corridas where nombre = 'gen-v1';"
# Debe mostrar: gen-v1, lista, <hash>
```

### Paso 4: Ejecutar pistas sobre el dataset

```bash
psql -d forense -c "select forense.correr_pistas((select id from forense.corridas where nombre = 'gen-v1'));"
```

Ejecuta D2, F1, F2, R1, R2, E1, T1 en ~1.1 segundos. La salida es un JSON con conteo de pistas por familia:

```json
{"D2": 3, "F1": 5, "F2": 2, "R1": 49, "R2": 38, "E1": 26, "T1": 17, "candidatos": 16}
```

**Datos esperados:** 16 candidatos de entidades con dos o más familias, 0 falsos positivos de trampas legítimas.

### Paso 5: Tests por módulo (todos en H10 verde)

#### 5.0 Ejecutar todo de una vez

```bash
npm run test:all  # contiene: contracts + n8n + db + prompts + voice + webapp
```

#### 5.1 Tests de contratos (no dependen de DB)

```bash
npm test --prefix contracts
# Devuelve: 110 tests, 0 fallos, ~260ms (oleada 4)
```

#### 5.2 Tests de runtime (n8n workflows)

```bash
node --test "n8n/tests/*.test.mjs"
# Devuelve: 337 tests, 0 fallos, ~360ms (oleada 4: e2e-inyeccion + variante-prompt)
```

Valida que cada workflow JSON tenga nodos válidos, que las referencias de subworkflows sean resolvibles tras importar, y que las queries SQL parseen contra Postgres 17 con migraciones 001–017.

#### 5.3 Tests de BD (migraciones + concurrencia)

```bash
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH bash db/tests/run.sh
# Devuelve: 461 aserciones (001-017) con GEN=1, 0 fallos; 417 con GEN=0 (4 omitidas)
# Archivos: assertions.sql, assertions_003…017.sql, assertions_*_gen.sql (gen-v1)
```

Crea base temporal, aplica migraciones 001–017, corre aserciones de función e idempotencia, valida pistas contra esquema de contratos. Borra base al terminar.

**Resultado esperado:** todas las pistas proyectadas al tipo `entities.pista` del contrato sin errores, clusters por RFC inyectado garantizados, rendimiento del barrido completo ≈1–2 s sobre gen-v1 con estadísticas actualizadas (ANALYZE tras clonar; 014).

#### 5.4 Prompts (variantes y techos por rol)

```bash
node --test "tests/prompts/*.test.mjs"
# Devuelve: 106 tests, 0 fallos (~420ms, oleada 4: variante_prompt, motivo_reintento)
```

Valida que cada prompt tenga entrada/salida conforme a contrato, techos de caracteres por rol (system ≤10k, paquete ≤12k/24k), variantes de reintento sin motivo, y que no contenga strings secretos.

#### 5.5 Telefonía (ElevenLabs, omitida sin número saliente)

```bash
node --test "tests/voice/*.test.mjs"
# Devuelve: 67 tests, 0 fallos, ~120ms
```

### Paso 6: Aplicación web (Next.js)

#### 6.1 Instalar dependencias

```bash
npm ci --prefix web --ignore-scripts
```

#### 6.2 Seleccionar fuente de datos

Crear `.env.local` en `web/` (gitignored):
```
NEXT_PUBLIC_DATA_SOURCE=fixture
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

La variable `NEXT_PUBLIC_DATA_SOURCE` controla de dónde lee la UI:
- `fixture`: datos de `db/seeds/seed_fake.sql` desde BFF local
- `supabase`: datos desde el proyecto remoto `hackthon2026`

#### 6.3 Validar tipos y linting

```bash
npm --prefix web run typecheck   # TypeScript
npm --prefix web run lint         # ESLint + Prettier
```

**Resultado esperado:** 0 errores.

#### 6.4 Tests de webapp

```bash
npm --prefix web test
# Devuelve: 272 tests, 0 fallos, ~6s (oleada 4: QA integración, e2e inyección)
```

Valida rutas, middlewares de sesión, inyecciones, editor, persistencia, componentes React, y API de BFF.

#### 6.5 Build

```bash
npm --prefix web run build
```

Genera `.next/` pronto para prerendering. El build debe completarse sin errores.

#### 6.6 Desarrollo local

```bash
npm --prefix web run dev
# Escucha en http://localhost:3000
```

Acceder como usuario `auditor` / contraseña `1234` (fixture). Las rutas disponibles:
- `/login`: formulario de demo
- `/perfil`: configuración de usuario (perfil privado sin teléfono)
- `/historial`: investigaciones anteriores
- `/datos`: explorador de entidades y grafo
- `/casos/[id]`: detalle de caso
- `/casos/[id]/expediente`: documento estructurado con editor
- `/estadisticas`: comparativas entre corridas
- etc. (18 rutas totales)

### Paso 7: Smoke local (gate H4 — DB → herramientas → runtime → evento → UI)

Un smoke es una prueba técnica mínima de que el flujo DB → herramientas → UI funciona.

```bash
# 1. Verificar que existe la corrida gen-v1
psql -d forense -c "select id from forense.corridas where nombre = 'gen-v1' limit 1;"

# 2. Consultar un caso del fixture
psql -d forense -c "select * from forense.casos where corrida_id = (select id from forense.corridas where nombre = 'Fixture UI — no es evaluación') limit 1 \gx"

# 3. Verificar que la UI puede servirse con fixtures
npm --prefix web run build
npm --prefix web run start  # o npm --prefix web run dev

# 4. Abrir http://localhost:3000 y navegar a Casos
```

## (c) Despliegue remoto

Este es el estado de la instancia Supabase remota y n8n. **Solo el coordinador** realiza estos pasos.

### Paso 0: Accesos

El coordinador necesita acceso a:
1. Proyecto Supabase `hackthon2026` (wplsldwzpyocmwzeyarj)
2. Instancia n8n `n8n.srv1550651.hstgr.cloud` (proyecto n0vtYcnvIW4LpWOE, usuario victorinbm2006)
3. Repo GitHub privado `mrwh1th3/hackthonsearchv1-2026`
4. Vercel equipo `team_btOOK1ypsV2lyPljQaC0r3Ui` (hobby)

Ver `launch.config.json` para confirmación.

### Paso 1: Verificar migraciones en remoto

Supabase `hackthon2026` tiene aplicadas:
- 001_schema.sql (tablas, RLS, realtime, runtime)
- 002_views.sql (helpers, fencing)
- 003_pistas.sql (pistas D2, F1, F2, R1, R2, E1, T1)
- seed_fake.sql (fixture UI)

**Estado actual (H5):** 001–008 confirmadas en Supabase, seed_fake y seed_producto cargados.

**Tareas pendientes:**
- Exponer el schema `forense` en Project Settings → API → Exposed Schemas (sin esto PostgREST rechaza llamadas).

### Paso 2: Crear credenciales en n8n

Cuando `.env` esté rellenado en local:

```bash
# Verificar sin crear (--dry-run)
node scripts/n8n-credentials.mjs --dry-run

# Crear credenciales (requiere N8N_API_KEY en .env)
node scripts/n8n-credentials.mjs
```

Este script (sin salida de secretos) crea hasta cuatro credenciales por nombre exacto:
- `Forense Postgres`: conexión a la base `forense` en Supabase (requiere `SUPABASE_DB_URL`)
- `Forense Supabase`: header `apikey` + `Authorization` para RPC (requiere `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- `Forense Webhook`: header compartida de autenticación entre BFF y webhooks (requiere `INTERNAL_WEBHOOK_SECRET`)
- `ElevenLabs Forense`: opcional, para voz (requiere `ELEVENLABS_API_KEY`)

**Verificación manual en n8n:**
1. Ir a Credentials (llave en la esquina)
2. Buscar "Forense"
3. Deben existir las tres primarias con tipo `postgres`, `supabaseApi`, `httpHeaderAuth`

### Paso 3: Importar workflows (10 en ORDEN)

Una vez que las credenciales existen (paso 2):

```bash
# Verificar sin importar (--dry-run)
node scripts/n8n-import.mjs --dry-run

# Importar TODOS en orden
node scripts/n8n-import.mjs

# O solo algunos (--only)
node scripts/n8n-import.mjs --only FORENSE_ejecutar_agente,FORENSE_inyectar,FORENSE_reintento
```

El script:
1. Lee cada JSON de `n8n/workflows/` en orden (ORDEN definida en script)
2. Lo envía a la API de n8n
3. n8n asigna IDs y versionIds
4. Guarda mapeo de IDs en `reports/handoff/n8n-ids.json` (manifest)
5. Resuelve `PENDIENTE_FORENSE_*` en segunda pasada si los IDs ya existen

**Resultado esperado:** 10 workflows importados, status `inactive`, manifest guardado.

Ver `n8n/workflows/IMPORT.md` para detalles de subworkflows y resolutores de referencias.

### Paso 4: Cargar gen-v1 en remoto

Cuando la base remota esté lista y los tests locales pasen:

```bash
python3 loaders/load_gen.py \
  --in data/gen/ \
  --db forense \
  --nombre gen-v1-remote \
  --pgbin /opt/homebrew/opt/postgresql@17/bin \
  --psql-host db.wplsldwzpyocmwzeyarj.supabase.co \
  --psql-user postgres \
  --psql-password <contraseña de la BD>
```

Esto realiza la validación y carga remota. Devuelve uuid de corrida.

### Paso 5: Smoke remoto (H4 gate)

Una vez que workflows estén importados y gen-v1 cargada:

```bash
# 1. En n8n UI: activar el workflow FORENSE_smoke_anthropic (si existe) o crear uno nuevo con:
#    Trigger: Webhook, POST a /webhook/FORENSE_smoke
#    Nodo: HTTP Request → https://api.anthropic.com/v1/messages (POST)
#    Headers: x-api-key = ANTHROPIC_API_KEY, content-type = application/json
#    Body: model="claude-sonnet-5", max_tokens=500, messages=[{"role": "user", "content": "¿quién eres?"}]
#    Nodo: Set → guardar response en bitacora como evento 'smoke_ok'

# 2. Disparar manualmente en n8n UI (Test) o por webhook:
curl -X POST 'https://n8n.srv1550651.hstgr.cloud/webhook/FORENSE_smoke' \
  -H 'Content-Type: application/json' \
  -d '{"corrida_id": "<uuid de gen-v1-remote>", "test": "smoke"}'

# 3. Esperar ~5 segundos y revisar:
#    - Logs en n8n (execution successful)
#    - Supabase: SELECT * FROM forense.bitacora WHERE tipo_evento = 'smoke_ok' LIMIT 1
#    - Response time < 3s (provider latency ≈ 1-1.5s + overhead)
```

**Resultado esperado (H4 gate):** evento `smoke_ok` persistido, latencia ≤3s, modelo responde, token usage registrado en bitacora.

Esto verifica que:
- El provider API `messages_api` funciona con credenciales reales
- Las credenciales n8n están correctas
- La base remota responde y registra eventos
- El webhook autentica correctamente
- La latencia de end-to-end es aceptable para investigaciones

### Paso 6: Desplegar web en Vercel

**Prerequisito:** el usuario crea el proyecto desde el dashboard (el MCP no tiene permisos de creación).

1. En Vercel dashboard: New Project → Import Git Repository → `mrwh1th3/hackthonsearchv1-2026`
2. Framework: Next.js, Root Directory: `web`
3. Agregar variables de entorno (Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto hackthon2026
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: clave pública anon
   - `NEXT_PUBLIC_DATA_SOURCE`: `supabase`
   - `DEMO_PASSWORD`: contraseña para demo (auditor/XXXX)
   - `SESSION_SECRET`: string aleatorio 32+ caracteres para sesión
   - `N8N_WEBHOOK_BASE`: URL base de webhooks de n8n (sin trailing slash)
   - `INTERNAL_WEBHOOK_SECRET`: string para autentificar BFF → webhooks
   - `SUPABASE_SERVICE_ROLE_KEY`: clave service_role (solo BFF server-side)

4. Deploy: Vercel genera URL como `forense-fpo3j.vercel.app`

**Verificación:** navegar a `/login` y ver formulario de demo.

## (d) Inyección en vivo (oleada 4 — QA-004)

Los jueces inyectarán datos sintéticos mientras el sistema está corriendo (H32–34). Cada inyección crea una corrida clonada que preserva el snapshot original y garantiza un cluster por RFC inyectado.

### Requisito: QA-004 (criterio del juez, H9 07:32)

Tras clonar una corrida con inyección, `armar_clusters` puede dejar fuera RFC inyectados que no cruzan el selector de dos familias. **Garantía:** `forense.armar_cluster_para(corrida_id, rfc)` crea cluster manual, y `estado_corrida` cuenta también `clusters_pendientes`.

### Flujo de inyección en vivo

1. **Solicitud:** POST `/api/inyecciones` con tres paquetes:
   ```json
   {
     "corrida_origen_id": "<uuid de gen-v1>",
     "filas_por_tabla": {
       "forense.contribuyentes": [{ "id": "...", "rfc": "INY:001", ... }, ...],
       "forense.cfdi": [{ "id": "...", "rfc_emisor": "INY:001", ... }, ...],
       "forense.movimientos": [{ "id": "...", "rfc_cuenta": "INY:001", ... }, ...]
     }
   }
   ```

2. **Clonación:** `forense.clonar_corrida_con_inyeccion(corrida_id, inyeccion_payload)` crea `corrida_nueva_id` con timestamp, preserva pistas de origen

3. **Cálculo:** re-ejecutar pistas en la corrida nueva (solo sobre datos inyectados para latencia baja)

4. **Garantía Q-004:** para cada RFC inyectado sin cluster:
   - Llamar `forense.armar_cluster_para(corrida_id, 'INY:001')` 
   - Cluster existe aunque no cruce el selector (ruta manual, decisión determinista igual)

5. **Prioridad:** frontend despacha primero clusters que tocan RFC inyectados

6. **Timeline:** cada evento tiene `timestamp`, `tipo_evento='inyeccion'`, `corrida_origen_id`

7. **Diff UI:** lado a lado antes/después, cambios en pistas, nuevos clusters, explicación

### Ensayar inyección en local (H24–26)

```bash
# 1. Tener gen-v1 cargada y pistas ya corridas
psql -d forense -c "select id, nombre from forense.corridas where nombre = 'gen-v1' limit 1;"

# 2. Simulación: crear inyección con los tres paquetes
python3 << 'EOTEST'
import json
import uuid
from datetime import datetime

corrida_origen = "<uuid de gen-v1>"
nueva_corrida = str(uuid.uuid4())

inyeccion_payload = {
  "corrida_origen_id": corrida_origen,
  "timestamp": datetime.utcnow().isoformat(),
  "filas_por_tabla": {
    "forense.contribuyentes": [
      {
        "id": str(uuid.uuid4()),
        "corrida_id": nueva_corrida,
        "rfc": "INY:FRAUDE001",
        "razon_social": "Empresa Fantasma de Prueba",
        "regimen_fiscal": "603"
      }
    ],
    "forense.cfdi": [
      {
        "id": str(uuid.uuid4()),
        "corrida_id": nueva_corrida,
        "rfc_emisor": "INY:FRAUDE001",
        "rfc_receptor": "DEMO:VICTIMA001",
        "monto": "5000000.00",
        "fecha": "2026-01-15",
        "tipo_comprobante": "I"
      }
    ],
    "forense.movimientos": [
      {
        "id": str(uuid.uuid4()),
        "corrida_id": nueva_corrida,
        "rfc_cuenta": "INY:FRAUDE001",
        "monto": "5000000.00",
        "fecha": "2026-01-15"
      }
    ]
  }
}

print(json.dumps(inyeccion_payload, indent=2))
EOTEST

# 3. Guardar payload y hacer inyección (coordina con coordinador para remoto)
psql -d forense << 'EOSQL'
-- Insertar inyección
INSERT INTO forense.inyecciones (id, corrida_origen_id, estado, payload, creado_en)
VALUES (
  uuid_generate_v4(),
  '<uuid de gen-v1>',
  'iniciada',
  '<json del paso 2>',
  now()
);

-- Ejecutar clonar_corrida_con_inyeccion (crea corrida nueva y ejecuta pistas)
SELECT forense.clonar_corrida_con_inyeccion(
  (SELECT id FROM forense.corridas WHERE nombre = 'gen-v1'),
  '<json del paso 2>'::jsonb
) AS nueva_corrida_id;

-- Verificar clusters nuevos (QA-004)
SELECT 
  c.id, c.estado, 
  COUNT(DISTINCT e.rfc) as rfcs_en_cluster,
  ARRAY_AGG(DISTINCT e.rfc) as rfcs
FROM forense.clusters c
JOIN forense.cluster_entidades ce ON c.id = ce.cluster_id
JOIN forense.entidades e ON ce.entidad_id = e.id
WHERE c.corrida_id = '<nueva_corrida_id>'
GROUP BY c.id, c.estado;
EOSQL
```

### Smoke H4 con inyección

Ver `n8n/tests/e2e-inyeccion.mjs` (447 líneas, test case completo con tres paquetes y assertion de cluster por RFC).

Ver `21-criterios-juez-e-inyeccion-en-vivo.md` §3 para protocolo completo, ejecución H32–34, y evaluación del juez.

## (e) Demo

El demo ocurre en H32–36 ante los jueces. Ver `13-demo.md` completo para guión, preguntas y tiempos.

### Checklist previo (H31)

- [ ] Corrida `gen-v1` o similar procesada hasta `investigacion_completa`
- [ ] Al menos un expediente tiene reporte finalizado (Auditor, Defensor, Réplica, Validador, Auditor Final)
- [ ] UI carga la pantalla de Casos sin errores
- [ ] Editor funciona: seleccionar texto, propuesta, Aplicar genera nueva versión
- [ ] Chat propone ediciones sin mutar documento
- [ ] Notificaciones se envían (sin llamadas si no hay número)
- [ ] Video grabado de corrida completa H30–32 (resolución ≥720p, ≤4 min)

### Ejecución (H32–36)

1. **Preparación (15 min antes):** conectar pantalla, login auditor/1234, navegar a Casos
2. **Introducción (1 min):** explicar reto, alcance, familias de pistas
3. **Cadena de fraude (1 min):** abrir expediente → mostrar "Trayectoria" y "Cadena de explicación"
4. **Defensa legítima (0.5 min):** abrir un caso NO fraude → mostrar por qué fue descartado (falso positivo evitado)
5. **Editor y chat (0.5 min):** proponer edición, usuario aplica, nueva versión guardada
6. **Métricas (0.5 min):** ir a /estadisticas, mostrar FP/FN/cobertura
7. **IBM (0.5 min):** comparar con benchmark
8. **Cierre (0.5 min):** mostrar video grabado H33

**Tiempo total:** ~4 minutos.

### Materiales de entrega

- URL vivo de Vercel (https://forense-XXXXX.vercel.app)
- Video MP4 H33 (respaldo si hay desconexión)
- PDF con métricas finales (FP, FN, FPR, cobertura)
- Repositorio privado en GitHub con commit final

## (f) Rollback no destructivo

Si algo falla después del despliegue, el rollback respeta datos y trazabilidad.

### Desactivar workflows

En n8n, parar workflows sin borrar:
1. Cada workflow → Settings → Activate (toggle OFF)
2. Webhooks quedan en registro pero no disparan
3. Los eventos ya persistidos quedan intactos

### Revertir a fixtures local

```bash
export NEXT_PUBLIC_DATA_SOURCE=fixture
npm --prefix web run dev
# UI lee de seed_fake.sql en lugar de remoto
```

### Clonar corrida en lugar de borrar

```bash
psql -d forense -c "select forense.clonar_corrida('<corrida_id_original>', 'backup-H25');"
# Nueva corrida con mismo snapshot, nueva versión de prompts
# Experimenta sobre la clon, no sobre el original
```

### Revertar commit Git

```bash
git log --oneline | head -5
git revert HEAD      # Crea commit inverso, no resetea
git push origin main # Solo si autorizado
```

### Verificar integridad de datos

```bash
# Contar eventos persistidos
psql -d forense -c "select tipo_evento, count(*) from forense.bitacora where corrida_id = '<id>' group by tipo_evento;"

# Verificar que no hay datos de clientes (siempre sintéticos)
psql -d forense -c "select distinct rfc from forense.contribuyentes limit 10;"
# Todos deben tener prefijo DEMO:, IBM:, o RFC ficticio
```

---

## Apéndice: variables de entorno (.env)

Refere solo al coordinador, nunca se imprime ni se debuggea. Las variables se carguen en:

```
/raiz/.env (gitignored)
/web/.env.local (gitignored)
```

Variables del sistema (server-side):
- `N8N_API_KEY`: acceso a instancia n8n
- `SUPABASE_SERVICE_ROLE_KEY`: clave service_role para migraciones/loader
- `SUPABASE_DB_URL`: conexión Postgres remota

Variables públicas (client-side, prefijo `NEXT_PUBLIC_`):
- `NEXT_PUBLIC_DATA_SOURCE`: `fixture` o `supabase`
- `NEXT_PUBLIC_SUPABASE_URL`: endpoint PostgREST
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: clave pública anon

Secretos de aplicación (server-side):
- `SESSION_SECRET`: sesión de usuario
- `DEMO_PASSWORD`: contraseña auditor
- `INTERNAL_WEBHOOK_SECRET`: autentificación BFF-webhooks
- `N8N_WEBHOOK_BASE`: URL base n8n

Nunca confundir roles de secreto. Un secreto de servidor en una variable pública es exfiltración.

## Apéndice: comandos rápidos (snippet H10)

```bash
# Verificar setup local
node scripts/launch.mjs --check

# Tests completos (oleada 4: 110 + 337 + 106 + 67 + 272 + ~400 aserciones DB)
npm run test:all

# O por módulo
npm test --prefix contracts                           # 110 tests
node --test "n8n/tests/*.test.mjs"                    # 337 tests
node --test "tests/prompts/*.test.mjs"                # 106 tests
node --test "tests/voice/*.test.mjs"                  # 67 tests
npm --prefix web test                                 # 272 tests
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH \
  bash db/tests/run.sh                                # ~400+ assertions

# n8n (remoto)
node scripts/n8n-credentials.mjs --dry-run            # verificar
node scripts/n8n-credentials.mjs                      # crear (requiere .env)
node scripts/n8n-import.mjs --dry-run                 # listar workflows
node scripts/n8n-import.mjs                           # importar todos

# Dataset
python3 generator/gen.py --seed 42 --n 100 --meses 12 --out data/gen/
python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1

# Pistas en local
psql -d forense -c "select forense.correr_pistas((select id from forense.corridas where nombre = 'gen-v1'));"

# Inyección en local (oleada 4)
psql -d forense -c "select forense.clonar_corrida_con_inyeccion(...)" 

# Web dev
npm --prefix web run dev    # http://localhost:3000

# Rollback seguro (no destruir datos)
git revert HEAD             # crea commit inverso
# o para worktree
git stash push -u -m "WIP-worktree"
```

---

**Responsables de secciones (oleada 4):**
- (a)–(b): forense-docs (haiku), verificado en H10
  - Migraciones 001–017, scripts n8n con --dry-run, conteos reales de tests
  - Tests: 110 (contracts) + 337 (n8n) + 106 (prompts) + 67 (voice) + 272 (webapp) + ~400 (db assertions)
- (c): coordinador (opus), ESTADO.md y DECISIONES.md
- (d): inyección en vivo (oleada 4) — QA-004, cluster por RFC garantizado, e2e-inyeccion.mjs
- (e): 13-demo.md (guión exhaustivo, H32–36)
- (f): operaciones post-despliegue

**Bloqueos externos abiertos (ESTADO.md H10):**
0. `.env` del usuario: N8N_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
1. Supabase: exponer schema `forense` en Project Settings → API → Exposed Schemas
2. Vercel: crear proyecto `forense` (root `web`) si es necesario
3. ElevenLabs: número saliente configurado en UI (voz sin número se omite)

Versión: 1.1 (H10, 2026-09-12 — oleada 4 integrada)
