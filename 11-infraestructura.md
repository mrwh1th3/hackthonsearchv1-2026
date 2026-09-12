# 11 — Infraestructura

## Regla previa al arranque

**No se escribe lógica del reto hasta que empiece el hackathon.** Antes solo se deja el andamio permitido por las reglas del evento: cuentas, proyecto vacío, repo/documentación y credenciales. Los smoke tests genéricos de conectividad siguientes no contienen solución del reto; si las reglas no los permiten antes, ejecutarlos en H0–1. Migraciones y workflows funcionales empiezan durante el evento.

El andamio debe estar listo y probado. Perder dos horas del hackathon peleando con una credencial de Supabase es la forma más tonta de perder.

## Componentes

**Actualización de arranque:** conexiones declaradas por usuario, pendientes de verificar en Claude: n8n cuenta `victorinbm2006`, Supabase MCP, GitHub MCP (repo probable `hackthonmty2026`), Vercel y ElevenLabs. Resolver IDs/destinos antes de escribir. El proveedor LLM se decide con20: API directa o sistema existente Claude Code/Actions; no contratar ni activar una API por asumir que es obligatoria.

| Componente | Dónde | Para qué |
|---|---|---|
| **Supabase** | Proyecto nuevo dedicado, `forense` | Esquema canónico, pistas SQL, RPC, realtime, storage de la evidencia |
| **n8n** | El VPS Hostinger existente (Ubuntu 24.04), proyecto "Forense" | Orquestación de los agentes |
| **Vercel** | Proyecto nuevo | Frontend Next.js |
| **Claude Code + Codex** | Tres sesiones en ramas/worktrees aislados | Carriles de agentes, datos y UI según `12-plan-36h.md` |
| **GitHub** | Repo nuevo, privado | Fuente de verdad; Vercel despliega de aquí |
| **Anthropic API** | Key dedicada al proyecto | Los agentes en n8n |

Se reutiliza el VPS que ya corre n8n con Nginx, SSL y UFW. No se levanta infraestructura nueva: el tiempo del hackathon no se gasta en devops.

**Aviso de voz:** ElevenLabs Agents con número saliente conectado por Twilio; configuración y contrato en `16-notificaciones-elevenlabs.md`. Verificar acceso, saldo, restricciones del número y destinatario autorizado en H0–1. La configuración de voz no reemplaza la API de investigación. Una llamada real solo se prueba mediante acción explícita con consentimiento; no por ejecutar fixtures o guardar perfil.

## Supabase

**Proyecto nuevo, no reutilizar uno existente.** Razones: el esquema es grande, el free tier tiene límites de tamaño, y se quiere poder borrar todo y recargar sin miedo.

Configuración:

- Región: la más cercana (us-east o us-west).
- Medir capacidad del plan contratado, espacio de índices/bitácora y copias de snapshots. Empezar con el perfil pequeño; cargar IBM/perfil grande con límite declarado según espacio disponible. No presupuestar que tres corridas completas caben sin medir.
- Extensión `pgcrypto` habilitada (para `gen_random_uuid`).
- Realtime habilitado en las seis tablas de `05-esquema-db.md`.
- RLS y grants según `05-esquema-db.md`: lecturas necesarias para UI, escritura del pipeline solo backend. Exponer el schema `forense` en la API y usar `supabase.schema('forense')`; las RPC públicas tienen permisos explícitos. Probar lectura con anon y escritura rechazada con anon.
- Las tablas de producto de 006/007 no heredan lectura pública. El BFF Next.js valida sesión demo y scope antes de usar credenciales backend; datos personales y outbox quedan privados. La cookie demo no es un JWT de Supabase: notificaciones privadas se consultan mediante BFF con polling acotado; no suscribir anon directamente a tablas privadas. Realtime público se limita al dataset sintético.

**Las dos llaves:**

| Llave | Quién la usa | Alcance |
|---|---|---|
| `service_role` | n8n, loaders/scripts locales y BFF servidor autorizado | Bypassa RLS; validar scope en BFF; nunca en cliente web, bundle ni logs |
| `anon` | Solo el frontend | Solo lectura, sujeta a RLS |

Si la `service_role` acaba en el frontend, cualquiera puede escribir en la base durante el demo. Es el error de seguridad más fácil de cometer y el más caro.

## n8n

Instancia existente en el VPS Hostinger. Se crea un **proyecto nuevo llamado "Forense"** para no mezclar con los flujos de clientes.

**Credenciales a crear antes del hackathon:**

| Nombre | Tipo | Contenido |
|---|---|---|
| `Forense Supabase` | Header Auth | `apikey: <service_role>`, `Authorization: Bearer <service_role>` |
| `Forense Postgres` | Postgres | host, puerto 5432, db `postgres`, usuario `postgres`, password del proyecto |
| `Anthropic Forense` | Anthropic API | la key dedicada |

**Verificación de arranque (timebox 30 minutos; antes solo si está permitido):**
1. Un workflow de prueba con un nodo Postgres que haga `select 1`. Si conecta, la credencial sirve.
2. Un nodo HTTP Request contra `https://<proj>.supabase.co/rest/v1/` con la credencial de header. Si responde, PostgREST está bien.
3. Un paso del adapter elegido con herramienta trivial: API usa HTTP Messages explícito (17); Actions usa trabajo autorizado con tools restringidas (20). Registrar versión, resultado, uso realmente expuesto y latencia. No depender de intermediateSteps de AI Agent.
4. Dos ejecuciones worker asíncronas: comprobar solape real por timestamps, estados persistidos y barrera. `batchSize=4` y cinco ramas dibujadas no demuestran concurrencia.

La trazabilidad imprescindible sale de las RPC y sus resúmenes de decisiones persistidos. Los intermediate steps son diagnóstico adicional; el pipeline no depende de extraer pensamiento privado del modelo.

**Si n8n corre en Docker:** verificar la red y el hostname accesible desde el contenedor. `127.0.0.1` apunta al propio contenedor; no asumir que `host.docker.internal` está configurado en el VPS Linux.

## Vercel

Proyecto nuevo conectado al repo, directorio raíz `/web`. Variables de entorno:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_N8N_UI_BASE         # para el link "ver ejecución", solo equipo
# Solo servidor, sin NEXT_PUBLIC_
N8N_WEBHOOK_BASE               # navegador → BFF → n8n
INTERNAL_WEBHOOK_SECRET
SUPABASE_SERVICE_ROLE_KEY      # solo runtime servidor BFF, nunca bundle
DEMO_PASSWORD                 # 1234 para la demo sintética
SESSION_SECRET
APP_BASE_URL
```

Deploy automático desde `main`. Durante el hackathon se trabaja en ramas y se mergea a `main` cuando algo funciona; así siempre hay una URL viva que enseñar.

**URL de producción con el fixture en H4**, y primer expediente real H8–10; gates completos en `12-plan-36h.md`.

## Repo y Claude Code en Cursor

```
forense/
├── CLAUDE.md              ← reglas e índice
├── docs/                  ← esta documentación
├── db/
│   ├── 001_schema.sql
│   ├── 002_views.sql      ← vistas + utilidades compartidas
│   ├── 003_pistas.sql
│   ├── 004_clusters.sql
│   ├── 005_rpc.sql
│   ├── 006_producto_ui.sql
│   ├── 007_notificaciones_voz.sql
│   ├── 008_ingesta.sql
│   └── seeds/
│       ├── seed_fake.sql ← fixture manual tras 001+002, fuera de migraciones
│       └── seed_producto.sql ← tras 006+007; sin llamadas reales
├── generator/
│   ├── gen.py
│   ├── giros.py           ← catálogos por giro
│   ├── tipologias.py      ← las 5 sembradas
│   └── trampas.py         ← las 8 legítimas
├── loaders/
│   ├── load_gen.py
│   ├── load_69b.py
│   └── load_ibm_aml.py
├── n8n/
│   ├── workflows/*.json   ← workflows exportados contra versión verificada
│   ├── runtime/*.mjs      ← módulos puros de control probados
│   ├── prompts/*.md
│   └── code/*.js
├── web/                   ← Next.js
├── eval/
│   ├── metricas.py
│   ├── comparar_corridas.py
│   └── cycles_networkx.py ← plan B de R2
├── data/
│   ├── raw/               ← gitignored
│   └── gen/               ← gitignored
├── .env.example
└── .gitignore
```

**Configuración de Claude Code en Cursor:**
- `CLAUDE.md` en la raíz (se lee solo).
- Husky pre-commit: typecheck + lint en `/web`, `ruff` en Python.
- TypeScript en modo estricto con `strictNullChecks`.
- Una rama y worktree por sesión; una rama distinta sin worktree no aísla archivos. Dueños A/B/C y merges cada 60–90 minutos según `12-plan-36h.md`.
- MCP de Supabase conectado: permite aplicar migraciones y consultar sin salir del editor.
- MCP de n8n conectado: permite crear y actualizar workflows desde Claude Code. Verificar antes que apunte a la instancia correcta del VPS.

## `.env.example`

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # local/n8n/BFF servidor; jamás en código cliente
SUPABASE_DB_URL=               # postgresql://... para psql y loaders

# n8n
N8N_BASE=https://n8n.<host>
N8N_WEBHOOK_BASE=https://n8n.<host>/webhook/forense
INTERNAL_WEBHOOK_SECRET=

# Sesión demo, solo servidor
DEMO_PASSWORD=1234
SESSION_SECRET=
APP_BASE_URL=

# Credenciales de n8n, no del navegador
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_AGENT_PHONE_NUMBER_ID=
ELEVENLABS_WEBHOOK_SECRET=

# Anthropic
ANTHROPIC_API_KEY=

# Kaggle (para IBM AML)
KAGGLE_USERNAME=
KAGGLE_KEY=
```

## Carga de datos

Los loaders escriben por `psql \copy` a tablas staging y de ahí a las canónicas con SQL. El loader crea una corrida `preparando`, registra hash/fecha de corte, normaliza campos y valida referencias antes de marcarla `lista`. Clonar para comparación conserva el snapshot pero no copia pistas, señales, casos ni caché.

```bash
python loaders/load_gen.py --input data/gen/ --nombre gen-v1
```

La interfaz CLI anterior se implementa en el loader; no es un script existente en este dossier. Internamente realiza `COPY` con columnas explícitas a staging, valida y carga en transacción. La corrida solo se ejecuta si está `lista`; un webhook no crea una corrida vacía para datos cargados bajo otro ID.

Para IBM AML, declarar el método de selección y su sesgo según `04-datos-y-datasets.md`; las etiquetas nunca entran a las herramientas. Cargar en chunks sin asumir que una muestra basada en etiquetas permite medir rendimiento global.

## Checklist del andamio (antes si las reglas lo permiten; si no, H0–1)

- [ ] Proyecto Supabase creado, `pgcrypto` habilitado, URL y ambas llaves guardadas
- [ ] Conexión Postgres directa probada con `psql`
- [ ] Proyecto "Forense" creado en n8n con las tres credenciales
- [ ] Nodo Postgres de prueba conecta
- [ ] Nodo HTTP contra PostgREST responde
- [ ] Adapter elegido llama herramienta y devuelve JSON; requests/turnos y límites observables declarados correctamente
- [ ] Dos ejecuciones worker se solapan y la barrera espera solo tareas despachadas
- [ ] Repo creado con la estructura de carpetas, `CLAUDE.md` y `/docs`
- [ ] Vercel conectado al repo, deploy vacío exitoso
- [ ] Tres carriles Claude/Codex en worktrees; MCPs de Supabase y n8n apuntan al proyecto correcto
- [ ] `.env` local lleno (no commiteado)
- [ ] Lista 69-B descargada a `data/raw/69b.csv`
- [ ] Cuenta de Kaggle con API key, o el CSV de HI-Small ya descargado
- [ ] Key de Anthropic probada con una llamada y herramienta; saldo, rate limits y modelo accesible verificados. Medir una investigación completa en H8–10
- [ ] ElevenLabs: agente/número disponibles, callback HTTPS y secreto HMAC; teléfono/consentimiento guardados en perfil privado al implementar 006
- [ ] Login demo y endpoints BFF con sesión, validación de origen/CSRF y rate limit; llamada de prueba requiere confirmación explícita y queda auditada
- [ ] Tras 007, webhook de INSERT en outbox autenticado y reconciliador; nunca conectar un seed a una llamada real

Descargas y cuotas se comprueban en H0–1. No estimar el coste como “12 llamadas por cluster”: cada agente puede hacer varias solicitudes al modelo. Presupuestos y reserva de cierre en `03-arquitectura-agentica.md`.

Los planes de programación Claude y el consumo de la API con clave en n8n tienen facturación separada; verificar el saldo de la cuenta API usada. Fuente: [Claude: suscripciones y API/Console](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console).

Esto no excluye la autenticación oficial de Claude Code en CI mediante OAuth: el usuario propone esa ruta. Su configuración, competencia por cuota y diferencias de observabilidad están en20. No introducir OAuth en el campo de API key ni duplicar runtimes antes de decidir.

## Plan B si algo falla

| Falla | Plan B |
|---|---|
| n8n no devuelve intermediate steps | Usar eventos de RPC y resúmenes explícitos de decisiones; la traza operativa se conserva, los tokens desconocidos quedan nulos |
| Supabase free tier se llena | Bajar el generador a 60 contribuyentes y filtrar IBM AML a 50k filas |
| Las CTE recursivas van lentas | `eval/cycles_networkx.py` calcula los ciclos fuera y escribe a `pistas` |
| Vercel falla en el demo | `next build && next start` en local, con la misma base de producción |
| La API de Anthropic da rate limit | Bajar slots globales de tareas LLM y clusters activos, aplicar backoff acotado y medir; no cambiar el número de especialistas del alcance |
