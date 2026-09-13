# 22 — Frontend Inspector (`Agents.dc.html`)

Normativo sobre la **apariencia e interacción** de la webapp. Donde discrepe con
15, prevalece este documento; donde discrepe con 21 (criterios del juez) o con
las reglas de `CLAUDE.md`, **prevalecen 21 y CLAUDE.md**: el diseño es genérico
y no conoce este dominio.

## Flujo único vigente · 2026-09-13

La corrección más reciente del usuario mantiene **una sola página principal**. Tras seleccionar datos y, opcionalmente, dar contexto y fechas de enfoque, `InvestigationComposer` inicia una ejecución que corre el motor antes de A/B. `InspectorHome` conserva selección, ejecución y resultados en `/?corrida=…&run=…`; `IntegratedLabRun` se monta dentro del mismo shell. El mapa compacto presenta Motor → Contexto → A y B → Compilador → Revisión; al desglosar aparecen preparación, muestras, ramas A/B e intercambio incidental. El resultado del motor, la evidencia, la bitácora, propuestas y consumo se consultan en esa misma investigación. El historial integra ejecuciones nuevas y anteriores. No hay una entrada separada de laboratorio; `/laboratorio` redirige al main.

La cobertura muestra **muestras entregadas**, no equivale a investigación concluida. Resultados sin evidencia, errores y consumo desconocido tienen estados explícitos. Guardar propuestas no representa aprobación humana. Los detalles completos y las listas extensas se expanden bajo demanda.

## Fuente de verdad

| Archivo | Qué es |
|---|---|
| `design-ref/Agents.dc.html` | 803 líneas. Plantilla `<x-dc>` (líneas 9–447) + bloque de lógica (449–800). Importado el 2026-09-12 del proyecto Claude Design `89706e41-2942-4ca9-bce1-f6ad23241446` ("ElevenLabs Login UI"). |
| `design-ref/support.js` | Runtime `dc` **generado**. Referencia sólo para entender `{{ }}`, `sc-for`, `sc-if`. **No se vendorea ni se importa.** |
| `web/public/inspector-logo.png` | Icono de marca, 2000×2000, copiado byte a byte del proyecto. |

**Desviación declarada — el wordmark.** `assets/inspector-wordmark.png`
(1250×217) es la palabra "Inspector" rasterizada. La API de diseño lo devuelve
en base64 dentro del resultado, no como fichero, así que copiarlo exigía
transcribir ~13 KB de base64 a mano: riesgo de corrupción silenciosa para una
imagen de 22 px de alto. Se renderiza como **texto** en `Instrument Sans` —la
tipografía del propio diseño— al mismo tamaño: visualmente equivalente, nítido
a cualquier densidad, y traducible. Si se quiere el PNG exacto, se guarda del
proyecto de diseño a `web/public/inspector-wordmark.png` y se cambia el
componente `Wordmark` por un `<img>`; nada más depende de ello.

El proyecto de diseño se trata **como lectura**. No se escribe en él (es de una
cuenta de cliente); nada de `finalize_plan` ni `write_files` contra ese id.

`Login.dc.html` existe en el mismo proyecto y **no** entra en este corte.

## La UI del diseño ES la navegación principal, y va exacta

**Corrección del usuario (2026-09-12), y manda sobre lo que decía antes este
documento.** `Agents.dc.html` no es una piel que se le pone a la webapp
existente: **es la navegación principal**. Se implementa **idéntica** — mismo
layout, mismos espaciados, mismos radios, mismas transiciones, mismo panel
izquierdo deslizante como navegación, mismos estados de `:hover` y `:focus`— y
lo del dominio se añade **encima de esa UI**, en su propio lenguaje visual.

Lo que NO se hace: conservar el `AppShell` actual y repintarlo. El shell del
diseño **sustituye** al actual. Una barra lateral fija de 18 rutas al lado del
panel deslizante del diseño serían dos navegaciones compitiendo, y eso ya no es
la UI que se pidió.

### Ser idéntico y tener URLs no son cosas opuestas

En el original cada pantalla es un booleano de `this.state` (`panel`, `board`,
`results`, `doc`, `manage`, `ask`, `connect`). Copiar **esa** parte daría una
sola página sin enlace profundo, y de eso dependen el e2e, la sesión del BFF y
los requisitos por caso de 21.

No hace falta elegir: cada estado del diseño **empuja una URL** y se ve
exactamente igual. El usuario ve las transiciones del diseño; el navegador
tiene una dirección que se puede compartir, recargar y enlazar. Si la
transición se nota distinta por hacerlo con rutas, gana el diseño: `router`
suave, sin recarga completa, sin parpadeo del shell.

| Estado del diseño | URL que empuja | Dato real |
|---|---|---|
| hero + picker | `/` | `listCorridas()` |
| dataset seleccionado + composer | `/` (estado en la URL) | `getCorrida(id)` |
| board (Canvas + Timeline) | `/corridas/[id]` | `getClusterGrafo()`, `getBitacoraCorrida()` |
| results (stats + findings) | `/casos/[id]` | `getEstadisticas()`, `listCasos()`, `getCasoDetalle()` |
| doc | `/casos/[id]/expediente` | editor existente |
| panel izquierdo (navegación) | overlay sobre cualquiera | `listInvestigaciones()` |
| manage data | `/datos` | ingesta existente |

Las rutas que el diseño no contempla (`/perfil`, `/notificaciones`,
`/historial`, `/estadisticas`, `/metodo`, `/entidades/[rfc]`, `/inyecciones`)
**siguen existiendo** y se alcanzan desde el panel izquierdo, que es donde el
diseño pone la navegación. Se repintan con sus tokens para que no canten, pero
no se les inventa una barra lateral nueva.

## Lo que el diseño NO tiene y aquí es obligatorio

El diseño es un "inspecciona un dataset" genérico. No ofrece hueco para nada de
esto, y omitirlo sería tirar justo lo que pidió el juez principal:

| Falta en el diseño | Dónde va | Fuente |
|---|---|---|
| **Contraste** ("por qué esta sí y aquella no", 21) | tarjeta propia en `/casos/[id]`, en el lenguaje visual del diseño | `getContraste()` |
| **Trayectoria** (21) | sección en `/entidades/[rfc]` y en el expediente | `getTrayectoria()` |
| **Cadena de explicación** (21) | apéndice del doc, junto al run log | `getCasoDetalle()` |
| **Los cinco `nivel`** (`sin_hallazgos`, `anomalia_explicada`, `no_concluyente`, `presuncion`, `presuncion_alta`) | cada finding los lleva; nunca un finding sin nivel | `Caso.nivel` |
| **Citas por ID** (`CFDI:…`, `MOV:…`, `ATR:…`, `LISTA:…`, `CICLO:…`, `CADENA:…`, `PAR:…`) | dentro de cada finding | `getCasoDetalle()` |
| **Capa de descarte / Defensor** | estado visible del finding: sostenida vs **descartada** con su motivo | `casos.evaluacion_pistas` |
| **Badge de fixture** | se conserva tal cual en toda vista de fixtures (regla 3) | `FixtureBadge` |

Un `finding` del diseño es `{title, detail}`. Aquí es: nivel + pistas con su ID
+ familias + estado de descarte. Si no cabe en la fila, cabe al abrirla.

## Tres trampas

**1. Ni un literal del bloque de lógica se publica.** `SCHEMAS`, `SPANS`,
`SEED`, `findings`, `stats`, `docMethod`, `docRecs`, `docNotes`,
`resultSummary` y la respuesta enlatada de `sendChat()` son **inventados**. En
un producto forense un número inventado que parece medido es una violación de
las reglas 4 y 10 que además *aparenta* funcionar. Todo valor que se pinta sale
de una llamada del `DataSource` o **no se pinta**. Las barras de `stats` son
porcentajes inventados: se derivan de un denominador real o se quita la barra.

**2. El diseño no tiene estados vacíos honestos, y aquí hacen falta:** corrida
en `procesando`, cero casos, `resultado_por_rfc` vacío, cobertura incompleta,
`no_concluyente`. Ninguno se pinta como "sin hallazgos" (H11-h fija esa
distinción para el fallo de datos; aquí es la misma regla para el dato ausente).

**3. "Add context for this inspection…" es prosa libre del usuario.** Entra al
pipeline como `product.investigar.mensaje` (ya existe, `maxLength` 4000): puede
orientar el alcance, se persiste y se traza, y **nunca** fija ni sube el
`nivel` (reglas 4 y 6).

## El picker "Columns" — se lee, no se inventa

"Columns N/M" se reinterpreta como **alcance de pistas**, que ya existe en el
dominio: `corridas.familias_evaluables` y `forense.marcar_no_evaluable` (003
§47) con su motivo por escrito.

**En este corte es de lectura:** enseña las 14 pistas con su estado real por
corrida —evaluable, o no evaluable **con el motivo**— y el conteo "N de 14 en
alcance". Eso es informativo y verdadero, y le dice al juez qué puede soportar
el dataset.

**No se ponen casillas que no hagan nada.** Convertirlo en *entrada* es el
incremento siguiente y cuesta: campo nuevo en `product.investigar.contexto`
(hoy `additionalProperties: false`, así que es bump de contrato), consumo en
`FORENSE_investigar_cluster`, y sobre todo que **restringir el alcance cambia la
cobertura y por tanto el veredicto** (015/016/017), así que tendría que quedar
trazado y visible en el dictamen. Mientras no esté eso, de lectura.

## El payload ya existe: no hace falta tocar n8n en este corte

El composer manda `product.investigar`, que ya cubre todo lo que el diseño pide:

| Control del diseño | Campo del contrato |
|---|---|
| textarea de contexto | `mensaje` |
| dataset seleccionado | `contexto.corrida_id` |
| rango de fechas | `contexto.periodo` = `{desde, hasta_exclusivo, timezone}` |
| chips de sugerencia | `directriz_id` (`seguir_dinero`, `sin_pago`, `intentar_refutar`, `comparar_pares`, `explicar_cadena`, `resumen`) |
| — | `idempotency_key`, `directriz_version`, `investigacion_padre_id` |

`periodo` **exige** `timezone`: se usa `ZONA_POR_OMISION` de
`web/lib/date/formato.ts` y se formatea con ese módulo, nunca con
`toLocale*` a pelo (H11-g). `hasta_exclusivo` es **exclusivo**: el selector
enseña el día que el usuario espera y la conversión es del código.

Los límites del selector de fechas (`min`/`max`) salen de la corrida
(`fecha_corte` y su ventana), no de `SPANS`.

## Notas mecánicas

- `style-hover`, `style-focus`, `style-focus-within` son atributos del runtime
  `dc` **sin equivalente en HTML**: se convierten en CSS real.
- Todo el estilo del original es hex en línea. Se mapea a los tokens
  `--color-*` de `web/app/globals.css`; no se clavan hex nuevos. El diseño fija
  `background:#ffffff` — **comprobar el tema oscuro** antes de asumir fondo
  blanco.
- `Instrument Sans` se añade junto a la tipografía actual, no la sustituye en
  silencio.
- Textos en **español**. El original está en inglés.
- El badge "Dynamic / Syncing" tiene un equivalente real y mejor:
  `corrida_origen_id != null` es una corrida **clonada por inyección en vivo**
  (regla 12, la prueba del juez), y `estado` dice si va corriendo. Se usa eso.

## La palanca principal es la paleta, no los componentes nuevos

`web/app/globals.css` ya tiene **la misma estructura de tokens** que necesita el
diseño. La diferencia es de **valores**: la paleta actual es zinc fría y la del
diseño es cálida. Cambiar los valores re-skinea de golpe las 12 rutas que ya
existen, sin tocar sus componentes — por eso no hace falta bifurcar en dos
shells, y por eso el corte 1 es barato.

| Token | Actual (zinc) | Inspector (cálido) |
|---|---|---|
| `--app-bg` | `#fafafa` | `#ffffff` |
| `--surface` | `#ffffff` | `#ffffff` (igual) |
| `--surface-muted` | `#f4f4f5` | `#f2f1ee` |
| `--surface-hover` | `#ececee` | `#f7f6f4` |
| `--text` | `#18181b` | `#141413` |
| `--text-muted` | `#52525b` | `#3d3b37` |
| `--text-subtle` | `#71717a` | `#6b6862` |
| `--border` | `#e4e4e7` | `#ebe8e2` |
| `--primary` | `#18181b` | `#141413` |
| `--primary-hover` | `#27272a` | `#2e2d2a` |

Tokens **nuevos** que el diseño usa y hoy no existen (se añaden con nombre, no
como hex suelto en los componentes):

| Nuevo token | Valor | Para qué |
|---|---|---|
| `--border-strong` | `#dcd8d0` | borde en `:hover` |
| `--border-stronger` | `#c9c5bd` | borde en `:focus-within` |
| `--border-dashed` | `#ddd9d1` | zona de "subir datos" |
| `--surface-raised` | `#fcfbfa` | textarea, burbuja del agente, chips |
| `--placeholder` | `#a3a09a` | `input::placeholder` |
| `--live-fg` / `--live-bg` / `--live-border` / `--live-dot` | `#1f6b3a` / `#eaf7ee` / `#bfe3cb` / `#1f8a4c` | el badge de corrida clonada por inyección |

**No se toca `--fam-*`.** Los cinco colores de familia (D/F/R/T/E) son
semánticos del dominio y el diseño no tiene opinión sobre ellos.

Radios del diseño, más grandes que los actuales (`8px`/`12px`): `999px` pill,
`24px` composer, `18px`–`20px` tarjeta grande, `13px`–`14px` tarjeta chica,
`9px`–`11px` control. Se añaden como tokens, no sueltos.

Tipografía: `Instrument Sans` (400/500/600) **junto a** Inter, no en su lugar,
y se carga por `next/font` en lugar del `<link>` a `fonts.googleapis.com` del
original.

## Corte 1 (lo que se entrega ahora)

1. Tokens, tipografía y CSS de `:hover`/`:focus` del diseño en el sistema actual.
2. Shell **del diseño** sustituyendo al `AppShell` actual: wordmark, panel izquierdo deslizante como navegación única, con investigaciones reales.
3. `/` — hero + picker de corridas reales, búsqueda, orden, estado y badge de
   inyección.
4. Composer en `/` con contexto, rango de fechas de la corrida y alcance de
   pistas de lectura; manda `product.investigar` por el BFF.
5. `/corridas/[id]` — Canvas con el grafo del cluster y Timeline con la bitácora
   real (regla 2: si no está en `forense.bitacora`, no se pinta).

Cada entrega dice qué podría romper y trae prueba (regla 1). No se borra
ninguna funcionalidad existente (regla 9).

El composer recupera **Contexto | Filtros**, con texto libre, Desde/Hasta inclusivos y Todo el rango. El giro pertenece a las herramientas: un paso interno lo infiere a partir de actividades acotadas antes de consultar contexto; si no puede, declara contexto general. `mensaje` y `filtros` viajan por el BFF, supervisor y `brief.user_focus` hasta A, B y compilador. Son prioridades de investigación/presentación: el motor mantiene el estate completo y no se ocultan relaciones fuera del periodo.

El encabezado presenta inicio, fin, duración medida y contador mientras corre, en hora de Ciudad de México. Las ejecuciones terminales con observaciones se muestran como Finalizada; los detalles de cobertura, límites y errores persisten en bitácora y artefactos. Los fallos del supervisor siguen como Interrumpida.


## Document-first investigations · 2026-09-13

Opening a saved unified run from Home or navigation now renders `InvestigationDocument`: a paper report, five-section outline and the existing `ReportChat`. Legacy investigations open their existing document editor by default. The report progressively reveals findings, money trails, saved exhibits, dismissed leads, A/B reviews and exact trace artifacts. Phone layouts switch between document and assistant. Original findings remain immutable; this report reader does not add rich-text editing to unified runs.

The authenticated, owner-scoped `/api/laboratorio/[id]/assistant` endpoint answers through the existing local Codex provider. The server supplies a bounded overview or selected finding; clients cannot inject evidence. References must belong to the saved excerpt. Inputs and answers persist privately under the run’s `assistant/` directory; follow-up usage remains separate from the original investigation. The evidence drawer displays the saved exhibit, not a new database query. Existing legacy report editing continues through its original endpoints.

Validation: 480 web tests and 53 lab tests passed; typecheck and isolated production build passed. Desktop and 390px phone layouts were inspected. A real Codex question on seed 105 run `06a3fe55-f478-4003-a7c6-7cce08360c79`, finding 9, completed in 15.627 seconds with four validated references. Opening a citation and restoring the saved conversation after reload were verified.

### Visual report and hypothesis workspace · 2026-09-13

The document reader now has six sections, including **Method & limits**. `ReportSnapshot`,
`InvestigationJourney`, `EvidenceTrail`, `AmountProof` and `ReviewScope` show saved results,
actual workflow states, individual money movements, per-table arithmetic and the A/B sample.
Amounts retain cents and the report identifies overlaps and reconciliation differences.
Each movement opens its saved exhibit; unrelated transfers are not drawn as a continuous path.
The overview separates whole-investigation usage from engine-only metrics and later chat calls.
Unknown subscription cost stays unavailable. Company and period come from recorded metadata;
the free-text focus does not silently redefine the audited period.

`/hypotheses` is a separate, owner-scoped destination in the main navigation. It collects A's
reviews and leads, B's hypotheses, compiler proposals, notes and recorded decisions across saved
runs. Search, type filters, real/demo filters, pagination and `?run=UUID` preserve provenance.
The detail panel exposes evidence references, alternatives, missing support, recorded steps and
the originating investigation. Notes and journal entries are not counted as new hypotheses.
No proposal approves itself or changes a detector through this page. Active runs refresh every
15 seconds; global memory without run ownership is excluded.

Login uses an English editorial layout with an interactive three-step preview, clear validation
and the existing session endpoint. Home restores the animated magnifier and Context disclosure;
the free-text context and date filters remain intact. Motion respects reduced-motion preferences.
Desktop and 390px layouts were inspected for the report, evidence drawer, hypotheses and login.
The complete web suite passed 524 tests; the final affected-component check passed 14 tests.
TypeScript and the isolated production build passed.

### Inspector identity and shared controls · 2026-09-13

The app identity is the supplied four-point star with the live **Inspector** wordmark in
Instrument Sans, matching page titles. `Logo` and `InspectorWordmark` replace the old document
symbol and raster wordmark. Browser titles and the install manifest use Inspector. The vector
source is `web/public/inspector-star.svg`; `npm --prefix web run icons` regenerates the SVG
favicon, 16/32/48px ICO, 180px Apple icon, 192/512px PWA icons and a separate safe-area maskable
icon. No extra dependency was installed.

`AppSelect` replaces native select menus throughout the app, including report sections,
payment paths, hypothesis filters, profile settings and the legacy editor. Radix provides
keyboard navigation, typeahead, Escape and focus restoration. Menus and dialogs use the app's
surface/shadow treatment; brand tokens define sage text selection, focus, caret and control
states. Domain-specific chart colors remain semantic.

The unified report's title and status now share the top row with navigation. Its actions menu
belongs to a sticky toolbar inside the reader. The reader isolates its stacking context so
opening app navigation covers the toolbar correctly. Downloads and reruns retain their existing
handlers. Desktop and 390px checks verified the placement, scrolling and custom section menu.

`AppDateField` replaces native date controls in Home and the date-range picker. Its branded
calendar supports manual ISO dates, month navigation, keyboard selection, Escape and clearing.
Existing inclusive date filters and UTC boundaries are preserved. Desktop and 390px browser
checks verified selection, full-range reset and popover placement without horizontal overflow.
The complete web suite passed 555 tests in 72 files; TypeScript and the isolated production
build passed. The build retains two existing unused-prop lint warnings in the legacy editor.

### Whole-investigation overview and timing · 2026-09-13

The report header groups the back arrow, dataset title and status at the far right; its
actions remain sticky inside the reader. The first report page presents company/period/seed,
a prominent whole-investigation clock, timestamps, usage and replay scope before the executive
summary. Clickable pattern bars and a traceability preview lead to findings and exact saved
exhibits. Findings, closed leads and unvalidated AI hypotheses remain separate counts. Home
shows the selected dataset's latest investigation and the same compact timing component.

`RunTiming` reads launch measurements, never engine-only or A/B-only fallback durations.
The worker's `report` phase keeps polling alive through publication; a running supervisor
also takes precedence during the short transition after the agent summary finishes. New
`timing_scope=through_report` records include report preparation; older records disclose
their timing scope. Export failures surface without discarding saved investigation results.
Recorded token subtotals are identified when historical selector usage is absent from the
actor summary; subscription MXN allocation remains unavailable without configured inputs.

Verification: 565 full-suite web tests and 31 final scoped tests passed, with TypeScript and
the isolated production build. Chrome desktop and 390px checks covered the right-aligned
header, main-page timing, branded section menu, finding 9 and its exact BNK-00834 citation.
The new self-contained HTML was inspected at both widths with no horizontal page overflow.

The latest saved real Codex run `ac160589-4af3-4234-a891-8865017e0df7` was inspected read-only:
202.058 seconds through report validation, six provider invocations and 176,850 recorded tokens.
The displayed duration and usage match its manifest. No additional model call was made for UI QA.
