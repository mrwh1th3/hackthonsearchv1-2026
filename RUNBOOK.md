# RUNBOOK — Inicio, desarrollo y despliegue del Agente Forense

Documento operativo de referencia para trabajar con el sistema multi-agente de investigación de fraude fiscal. Última actualización: 2026-09-12 H5.

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
```

- `001_schema.sql`: tablas, índices, RLS, realtime, control de runtime.
- `002_views.sql`: vistas de soporte, helpers de fencing, cálculos de presupuesto.
- `003_pistas.sql`: siete pistas iniciales (D2, F1, F2, R1, R2, E1, T1) y `correr_pistas()`.

**Estado actual:** 001–003 aplicadas en la instancia `forense` local (H5).

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

### Paso 5: Tests por módulo

#### 5.1 Tests de contratos (no dependen de DB)

```bash
npm test --prefix contracts
# Devuelve: 100 tests, 0 fallos, <1s
```

#### 5.2 Tests de runtime (n8n workflows)

```bash
node --test "n8n/tests/*.test.mjs"
# Devuelve: 326 tests, 0 fallos, ~300ms
```

Valida que cada workflow JSON tenga nodos válidos, que las referencias de subworkflows sean resolvibles tras importar, y que las queries SQL parseen contra Postgres 17 con migraciones 001–003.

#### 5.3 Tests de BD (migraciones + concurrencia)

```bash
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH bash db/tests/run.sh
# Devuelve: 109 aserciones, 0 fallos, ~30s
```

Crea base temporal, aplica migraciones, corre aserciones de función e idempotencia, valida pistas contra esquema de contratos. Borra base al terminar.

**Resultado esperado:** todas las pistas proyectadas al tipo `entities.pista` del contrato sin errores.

#### 5.4 Prompts (12 ficheros, 79 tests)

```bash
node --test "tests/prompts/*.test.mjs"
# Devuelve: 79 tests, 0 fallos
```

Valida que cada prompt tenga entrada/salida conforme a contrato y que no contenga strings secretos.

#### 5.5 Telefonía (ElevenLabs, omitida sin número saliente)

```bash
node --test "tests/voice/*.test.mjs"
# Devuelve: tests OK; llamadas reales saltadas sin número
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

#### 6.4 Build

```bash
npm --prefix web run build
```

Genera `.next/` pronto para prerendering. El build debe completarse sin errores.

#### 6.5 Desarrollo local

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

### Paso 7: Verificación de smoke local

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

**Estado actual (H5):** 001–003 confirmadas, seed_fake cargada.

**Tareas pendientes:**
- Exponer el schema `forense` en Project Settings → API → Exposed Schemas (sin esto PostgREST rechaza llamadas).

### Paso 2: Crear credenciales en n8n

Cuando `.env` esté rellenado en local, ejecutar:

```bash
node scripts/n8n-credentials.mjs
```

Este script (sin salida de secretos) crea tres credenciales por nombre exacto:
- `Forense Postgres`: conexión a la base `forense` en Supabase
- `Forense Supabase`: header `apikey` + `Authorization` para RPC
- `Forense Webhook`: header compartida de autenticación entre BFF y webhooks

**Verificación manual en n8n:**
1. Ir a Credentials (llave en la esquina)
2. Buscar "Forense"
3. Deben existir las tres con tipo `postgres`, `supabaseApi`, `httpHeaderAuth`

### Paso 3: Importar workflows

Una vez que las credenciales existen (paso 2), importar los diez workflows JSON:

```bash
node scripts/n8n-import.mjs --only FORENSE_ejecutar_agente,FORENSE_reintento,FORENSE_editar_expediente,FORENSE_investigar_cluster,FORENSE_corrida,FORENSE_inyectar,FORENSE_notificar_completada,FORENSE_resultado_llamada,FORENSE_reconciliador,FORENSE_errores
```

Esto:
1. Lee cada JSON de `n8n/workflows/`
2. Lo envía a la API de n8n
3. n8n asigna IDs y versionIds
4. Imprime el mapeo (sin ejecutar workflows)

**Resultado esperado:** 10 workflows importados, status `inactive`.

Ver `n8n/workflows/IMPORT.md` §2 para resolver los IDs de subworkflows (sustituir `PENDIENTE_FORENSE_*` por los IDs reales).

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

### Paso 5: Smoke remoto (H4)

Una vez que workflows estén importados y gen-v1 cargada:

```bash
# 1. Activar el workflow FORENSE_smoke_anthropic en n8n (manual en UI)
# 2. Dispararlo: POST /webhook/<url-pública> con payload:
{
  "corrida_id": "<uuid de gen-v1-remote>",
  "investigacion_id": "<uuid nuevo>"
}
# 3. Esperar ~10 segundos y revisar logs en n8n
# 4. Verificar en Supabase que se creó un evento de tipo 'investigacion_iniciada'
```

Esto verifica que:
- El provider API `messages_api` funciona (ya probado en H0 por el coordinador)
- Las credenciales n8n están correctas
- La base remota responde
- El webhook autentica correctamente

**Resultado esperado:** evento persistido, latencia ~1-2s.

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

## (d) Inyección en vivo

Los jueces inyectarán datos sintéticos mientras el sistema está corriendo. Cada inyección crea una corrida clonada que preserva el snapshot original.

### Flujo de una inyección

1. **Solicitud:** POST `/api/inyecciones` con
   ```json
   {
     "corrida_origen_id": "<uuid de gen-v1>",
     "filas_por_tabla": {
       "forense.contribuyentes": [...],
       "forense.cfdi": [...]
     }
   }
   ```

2. **Clonación:** `forense.clonar_corrida_con_inyeccion()` crea `corrida_nueva_id` con mismo nombre + timestamp

3. **Cálculo:** se reejecutar pistas en la corrida nueva

4. **Prioridad:** el frontend despacha primero los clusters que tocan los RFC inyectados

5. **Timeline persistido:** cada evento tiene `timestamp` y `tipo_evento` = `inyeccion`

6. **Diff UI:** lado a lado antes/después de la inyección, explicación de cambios

### Ensayar inyección en local

```bash
# 1. Tener gen-v1 cargada y pistas ya corridas (paso 4 de arranque local)

# 2. Crear una inyección ficticia (Python):
python3 << 'EOF'
import json
import uuid

# Simulación: agregar un CFDI sospechoso
nueva_corrida = str(uuid.uuid4())
inyeccion = {
  "corrida_origen_id": "<uuid de gen-v1>",
  "filas_por_tabla": {
    "forense.cfdi": [
      {
        "id": str(uuid.uuid4()),
        "corrida_id": nueva_corrida,
        "rfc_emisor": "DEMO:FRAUDE001",
        "rfc_receptor": "DEMO:VICTIMA001",
        "monto": "5000000.00",
        "fecha": "2026-01-15"
      }
    ]
  }
}
print(json.dumps(inyeccion, indent=2))
EOF

# 3. Cargar la inyección en Supabase (tabla forense.inyecciones)
psql -d forense << 'EOF'
INSERT INTO forense.inyecciones (id, corrida_origen_id, estado, payload)
VALUES (uuid_generate_v4(), '<uuid de gen-v1>', 'iniciada', '<json del paso 2>');
EOF

# 4. Ejecutar pistas en la nueva corrida
psql -d forense -c "select forense.correr_pistas('<nueva_corrida_id>');"
```

Ver `21-criterios-juez-e-inyeccion-en-vivo.md` §3.4 para el protocolo completo y casos de prueba.

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

## Apéndice: comandos rápidos (snippet)

```bash
# Verificar setup local
node scripts/launch.mjs --check

# Tests rápidos (sin DB)
npm test --prefix contracts && node --test "n8n/tests/*.test.mjs"

# Tests completos (con DB)
npm run test:all

# Regenerar dataset
python3 generator/gen.py --seed 42 --n 100 --meses 12 --out data/gen/

# Cargar en local
python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1

# Ejecutar pistas
psql -d forense -c "select forense.correr_pistas((select id from forense.corridas where nombre = 'gen-v1'));"

# Web dev
npm --prefix web run dev    # http://localhost:3000

# Rollback seguro
git revert HEAD && git push origin main
# o
git stash
```

---

**Responsables de secciones:**
- (a)–(b): forense-docs, verificado en H5
- (c): coordinador (opus), seguimiento en ESTADO.md
- (d): 21-criterios-juez-e-inyeccion-en-vivo.md §3
- (e): 13-demo.md (guión exhaustivo)
- (f): operaciones post-despliegue

Versión: 1.0 (H5, 2026-09-12)
