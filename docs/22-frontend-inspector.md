# 22 — Frontend Inspector (`Agents.dc.html`)

Normativo sobre la **apariencia e interacción** de la webapp. Donde discrepe con
15, prevalece este documento; donde discrepe con 21 (criterios del juez) o con
las reglas de `CLAUDE.md`, **prevalecen 21 y CLAUDE.md**: el diseño es genérico
y no conoce este dominio.

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
