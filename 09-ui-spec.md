# 09 — UI

Stack: Next.js (App Router) + Supabase JS con realtime + shadcn/ui + react-force-graph-2d + recharts + TipTap. Deploy en Vercel. Idioma: español.

**Diseño detallado vigente:** `15-design-system-webapp.md` define la réplica de lenguaje visual ElevenLabs, tokens, botones, favicon documento blanco/negro, login `1234`, perfil, historial, filtros, animaciones, toasts y editor tipo Google Docs. `16-notificaciones-elevenlabs.md` define estado `investigacion_completa` y la llamada de aviso. Las vistas forenses de este documento se conservan y usan esos componentes compartidos.

## Principio rector

**La UI lee datos persistidos, nunca el estado de n8n directamente.** Datos sintéticos forenses se consultan en Supabase; perfil, teléfonos y notificaciones privadas se consultan mediante BFF/RLS autorizado. Mutaciones pasan por endpoints Next.js con sesión demo que llaman a los webhooks (`corrida`, `investigar`, `editar` y avisos). Todo estado operativo mostrado tiene respaldo persistido.

Consecuencia práctica: `db/seeds/seed_fake.sql` tras 001+002 permite construir las vistas forenses antes de que exista un agente; `seed_producto.sql` tras 006+007 añade perfil/historial/avisos. Son fixtures manuales separados de migraciones y métricas. La integración se verifica después con escrituras reales del pipeline; la coincidencia del contrato no sustituye esa prueba.

**Regla de trazabilidad:** pasos forenses en `bitacora`; acciones de producto en `actividad_producto`, correlacionadas por IDs. La UI no inventa estados ni progreso.

## Mapa de vistas

```
/login                  Acceso simbólico: auditor / 1234
/                        Cola de casos
/historial              Historial de solicitudes, ejecuciones y llamadas
/investigaciones/[id]   Solicitud, estado de entrega, reportes y actividad
/perfil                 Perfil, preferencias, teléfono y aviso por llamada
/notificaciones         Centro persistente de avisos
/datos                  Importación, mapeo, cobertura y diagnósticos (19)
/corridas                Corridas y comparación
/corridas/[id]           Mapa de clusters de una corrida
/corridas/[id]/raw       Bitácora plana de toda la corrida (el "ver TODO")
/clusters/[id]           Vista de cluster: carriles + pizarrón + grafo
/casos/[id]              Detalle del caso
/casos/[id]/expediente   Documento editable con chat
/entidades/[rfc]         Explorador de entidad
/estadisticas            Métricas contra ground truth
```

---

## 1. Cola de casos `/`

- **KPIs arriba:** casos por nivel (incluido `no_concluyente`), casos en proceso, monto en riesgo sin duplicar CFDI, corrida activa y cobertura.
- **Barra "Investigar":** input que acepta RFC, UUID de CFDI o código de pista → BFF autenticado → `POST /webhook/forense/investigar`. Mostrar solicitud aceptada y luego el caso `en_cola` cuando se persista; medir latencia real, no prometer menos de un segundo.
- Añadir prompt multilinea y sugerencias de análisis encima según §15. El BFF crea `investigacion_id`, resuelve contexto/directriz y enlaza caso/corrida; una sugerencia se envía solo al pulsar Investigar.
- **Tabla:** RFC, razón social, tipología, nivel (badge), estado (con spinner si está activo), familias confirmadas (chips D/F/R/T/E), tamaño del cluster, monto en riesgo, reintentos, duración.
- **Filtros:** nivel, estado, tipología, corrida, "solo con reintentos", "solo presupuesto agotado".
- Orden por nivel descendente, luego por monto.

---

## 2. Vista de cluster `/clusters/[id]` — la vista estrella del demo

Es lo que hace visible la arquitectura. Tres zonas.

### Carriles de especialistas (zona superior, realtime)

```
 D  ────●───────●────┐
 F  ──●────●──●──────┤
 R  ────────●────────┼──▶ [PIZARRÓN] ──▶ ronda 2 ──▶ Auditor
 T  ──●──────────────┤         ▲
 E  ──●──────────────┘         │ señales
```

- Cinco carriles horizontales, uno por especialista, con su color de familia.
- Cada punto es una llamada a herramienta; al pasar el mouse muestra herramienta, args, duración y si vino de caché.
- Entre puntos, resúmenes explícitos de decisiones registrados como `razonamiento`; no se presentan como razonamiento interno del modelo. Tokens solo cuando la API los reporta, sin inventar un desglose por paso.
- Los carriles reflejan tareas persistidas: en cola, activas, cerradas o con error. El paralelismo visible debe corresponder a timestamps reales del worker y su límite de concurrencia.
- **La barrera** se dibuja como una línea vertical gruesa donde convergen.
- Si un especialista agota presupuesto, su carril termina en un marcador rojo.

### Pizarrón (columna central)

- Una tarjeta por señal, en orden de llegada: familia, titular, chips de RFC, contador de IDs, badge de confianza.
- Señales con `refuta: true` en azul, no en rojo: refutar es aportar.
- Click en tarjeta → drawer con el `detalle` completo.
- Cuando una señal despierta a otro especialista en la ronda 2, se dibuja una **flecha del pizarrón al carril despertado**, con el motivo del disparo.
- Los RFC de frontera aparecen como chips ámbar; si el cluster se expandió, un banner muestra la nueva versión de contexto. La ronda 2 investiga la ampliación; no se reinicia la ronda 1. Reintentos se agrupan además por `intento`.

### Grafo del cluster (zona inferior)

- Nodos: contribuyentes (círculo) y cuentas (cuadro).
- Aristas: facturas (sólida, grosor por monto) y movimientos (punteada).
- Color de nodo por nivel; el RFC semilla resaltado; los que están en 69-B con borde rojo; los de frontera con borde punteado ámbar.
- Los ciclos detectados se pintan y animan.
- Toggle de capas: facturas / dinero / ambas. Profundidad 1–3.
- Click en nodo → drawer con perfil y botón "investigar este RFC". Click en arista → el CFDI o movimiento real.

---

## 3. Detalle de caso `/casos/[id]`

Header: RFC + razón social, nivel, tipología, estado en vivo, monto, reintentos, corrida, y botones "Ver cluster", "Abrir expediente", "Re-investigar", "Ver ejecución en n8n" (link a `https://n8n.<host>/workflow/<id>/executions/<n8n_execution_id>`, solo para el equipo).

Tres columnas en desktop, tabs en móvil.

**Izquierda — Timeline de bitácora (realtime).** Un item por evento, ordenado por `seq`, agrupado por ronda con separadores. Cada `tipo_evento` con su ícono y color. Los `tool_call` muestran herramienta y args colapsados, con su `tool_result` anidado debajo (JSON viewer plegable, duración, tokens, flag de caché). Filtro por agente y por ronda. Al pie: totales de llamadas, tokens y duración.

**Centro — Grafo**, igual que en la vista de cluster pero centrado en el caso.

**Derecha — Paneles en acordeón:**

- *Pistas*: código, familia, score, estado (`disparada` / `confirmada` / `refutada` / `no_evaluable`), y una línea de por qué se disparó. Las `no_evaluable` tachadas con tooltip del motivo.
- *Evidencia*: tipo, ID, pista, familia y resultado de validación técnica/refutación por separado. Click abre el registro de la misma corrida. Que el ID exista no demuestra por sí solo que sustente la afirmación; el panel muestra qué se verificó.
- *Defensa*: cada argumento con la trampa que probó, herramientas usadas, resultado, y la respuesta de la Réplica (aceptado/rechazado).
- *Dictamen*: familias confirmadas como chips, la regla en texto ("2 familias independientes: F, R → presunción"), nivel final. Si hubo rechazos del Auditor Final, se listan con su motivo y qué se re-ejecutó.

---

## 4. Explorador de entidad `/entidades/[rfc]`

Perfil, estatus en listas SAT, atributos compartidos (tabla: atributo, valor, RFC que lo comparten), facturas emitidas y recibidas (tabla filtrable), movimientos por cuenta, mini grafo de relacionados, y **comparación contra pares del giro** (facturación, ratio de nómina, cancelaciones, número de clientes: valor propio vs p10/p50/p90). Casos previos donde aparece. Botón "Investigar".

El enlace incluye `?corrida_id=...`; un mismo RFC puede aparecer en distintos snapshots. Las consultas de perfil, grafo, facturas y citas conservan ese scope. El color de un nodo requiere hallazgos atribuidos a ese RFC, no solo pertenecer a un cluster marcado.

La comparación contra pares es la que hace entender por qué un umbral relativo importa; vale la pena enseñarla en el demo si hay tiempo.

---

## 5. Mapa de clusters `/corridas/[id]`

Grid de bloques, uno por cluster, ordenados por score. Cada bloque: número de RFC, estado (con animación si está activo), nivel del caso si ya cerró, y una barra de progreso por rondas. Click → vista de cluster.

Es la vista que demuestra escalabilidad: con el perfil grande del generador se ven 80 bloques procesándose en lotes, y se puede decir "el contexto de cada agente es el mismo que con 12".

---

## 6. Bitácora cruda `/corridas/[id]/raw`

Tabla plana de toda la `bitacora` de la corrida: timestamp, cluster, caso, ronda, agente, evento, payload (expandible), duración, tokens. Filtrable por todo y exportable a CSV.

Es el "ver TODO" literal. Poco glamoroso y muy convincente: un juez que pregunta "¿cómo sé que hizo eso?" recibe esta pantalla.

---

## 7. Estadísticas `/estadisticas`

Selector de corrida, con modo de comparación de dos corridas lado a lado.

- Pistas disparadas por código y por familia (barras).
- **Embudo:** pistas → RFC candidatos → clusters → casos con ≥2 familias → presunción alta. Muestra dónde se filtra el ruido.
- Casos por tipología y nivel (barras apiladas).
- Monto en riesgo por tipología.
- **Contra ground truth:** matriz de confusión, precisión, recall, F1, y por separado la **tasa de falsos positivos sobre la cohorte de trampas legítimas** — la métrica del pitch, destacada en su propia tarjeta grande.
- Mostrar denominadores, cobertura, pendientes/errores/no concluyentes y baseline según `10-evaluacion.md`. La ausencia de investigación del despacho no se cuenta como éxito del Defensor. Con ocho trampas, cada FP cambia la FPR en 12.5 puntos porcentuales.
- Tabla de errores: cada FP y FN con link directo al caso.
- Costo y latencia: tokens y duración por caso y por agente, llamadas promedio, tasa de acierto del caché.
- Rondas: % de clusters que necesitaron ronda 2, % que expandieron frontera, % con reintento.
- **Evolución entre corridas:** líneas de precisión / recall / FPR por `version_prompts`. Esto es lo que demuestra que el equipo iteró y no tuvo suerte.

---

## 8. Expediente `/casos/[id]/expediente`

- Editor TipTap sobre JSON canónico de la última versión, con las ocho secciones fijas; importar Markdown legado una vez y derivarlo al exportar, sin round-trip que pierda formato.
- Cada cita `[CFDI:uuid]` renderiza como chip con tooltip del registro real. **Si un ID citado no existe en `evidencia` validada, se marca en rojo** — validación del lado de la UI, independiente del backend.
- Chat lateral: seleccionar texto + instrucción → propuesta con diff → Aplicar crea versión; Descartar conserva el documento. Sin selección admite preguntas, que solo crean un mensaje. Sugerencias/contexto/versionado y contrato completo en §15; reemplaza el guardado inmediato de propuestas del diseño anterior.
- Historial de versiones con diff.
- Aplicar/revertir pasa por el backend y conserva versiones; revertir crea una versión nueva. Autoguardado de edición humana conserva borrador aunque tenga citas por revisar; solo una versión validada es entregable final. El servidor comprueba citas y versión base.
- Exportar a .md y PDF.

---

## Sistema visual

Aplicar tokens y layout de §15: base blanca/grises, CTA negro, sidebar compacta, colores semánticos de familias, controles y animación compartidos. Cada gráfica ofrece vista alternativa compatible, tabla de datos, filtros de fecha y descarga; el estado filtrado persiste en URL. Un filtro visual no reejecuta investigación.

| Elemento | Valores |
|---|---|
| **Nivel** | `sin_hallazgos` gris · `anomalia_explicada` azul · `no_concluyente` neutral con motivo · `presuncion` ámbar · `presuncion_alta` rojo. Nunca "definitivo"; falta de datos no equivale a absolución |
| **Estado de caso** | `en_cola` gris · rondas y auditoría con spinner · `dictaminado` verde · `reintento` ámbar con contador · `error` rojo |
| **Familias** | D documental · F financiera · R relacional · T temporal · E externa. Chip con letra y color fijo, **los mismos colores en carriles, chips, grafo y estadísticas** |
| **Pista `no_evaluable`** | tachada, tooltip con el motivo ("el dataset no trae CFDI") |
| **Señal `refuta`** | azul, nunca rojo |
| **Presupuesto agotado** | marcador rojo al final del carril + badge en el caso |
| **Estado de entrega** | `investigacion_completa`: reporte validado disponible, independiente de nivel de riesgo y de estado de llamada; `parcial` no se presenta como completa |

La consistencia de color de familia entre todas las vistas es lo que hace que el sistema se lea rápido. Es la decisión de diseño con más retorno.

## Realtime

Suscripciones Supabase para datos sintéticos; producto privado mediante BFF con polling acotado y deduplicación (16). La cookie demo no autoriza canales privados de Supabase:

| Vista | Suscripción |
|---|---|
| Cola | `casos` filtrado por corrida |
| Cluster | `senales` y `bitacora` filtradas por `cluster_id`, `clusters` por id |
| Caso | `bitacora` filtrada por `caso_id`, `casos` por id |
| Expediente | `expedientes` filtrada por `caso_id` |
| Mapa de clusters | `clusters` filtrada por corrida |
| Historial de producto | BFF: `investigaciones` del perfil; enlaza corridas/casos |
| Campana/toasts | BFF: `notificaciones` del perfil, deduplicadas por evento |
| Aviso telefónico | BFF: lectura autorizada/enmascarada de `llamadas_notificacion` |

## Orden de construcción

| # | Hito | Verificable cuando… |
|---|---|---|
| 1 | Migraciones + `seed_fake` | tres casos completos visibles en `/` |
| 2 | Cola + Detalle con timeline realtime | insertar un evento a mano en `bitacora` lo hace aparecer sin recargar |
| 3 | Grafo + drawers | click en nodo abre el perfil real |
| 4 | Vista de cluster con carriles y pizarrón | la animación corre con datos sembrados |
| 5 | Explorador de entidad | comparación contra pares se ve |
| 6 | Estadísticas con ground truth | fixture comprueba el render de la matriz, identificado como prueba UI; las métricas comparables usan corridas reales del generador |
| 7 | Expediente + chat | seleccionar → instrucción → propuesta/diff → Aplicar → versión nueva |
| 8 | Mapa de clusters + bitácora cruda | |

Cada hito se desarrolla contra fixtures y se acepta con pruebas de integración. La UI avanza sin esperar al pipeline; las fechas vigentes y la cobertura completa están en `12-plan-36h.md`.
