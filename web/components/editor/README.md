# web/components/editor

Dueño: **forense-editor**. Editor tipo Google Docs del expediente (15 §10, 09 §8) y chat de propuestas.

| Archivo | Qué es |
|---|---|
| `document-workspace.tsx` | Hoja A4 794 px con zoom, índice, toolbar, modos Editar/Sugerir/Lectura, autoguardado 1 s, historial con diff y revertir. |
| `report-chat.tsx` | Panel de 360 px redimensionable: sugerencias, chips de selección/versión/evidencia, propuesta con diff y Aplicar/Descartar. |
| `version-diff.tsx` | Render del diff unificado (propuesta e historial). |
| `cita-drawer.tsx` | Registro fuente de una cita; si el ID no tiene evidencia validada, lo declara. |
| `indice-secciones.tsx` | Índice plegable de las 10 secciones; las ausentes se muestran deshabilitadas con el motivo. |
| `toolbar.tsx` | Encabezados, marcas, listas, alineación, enlaces, tablas y deshacer/rehacer. |
| `descargas.tsx` | MD/JSON por el BFF y PDF por impresión de la hoja. |
| `extensiones.ts` | `AtributosBloque` (ids y `textAlign`) y `CitasDecoradas` (chips como decoración de ProseMirror). |
| `estilos-hoja.tsx` | CSS de la hoja y `@page` de impresión A4. |
| `cliente.ts` | Cliente del BFF (`/api/reportes/*`). |
| `componentes.test.tsx` | Pruebas de UI en jsdom. |

## Dos decisiones que el contrato impone

1. **Las citas no pueden ser un nodo ni una marca.** `editor.block` cierra el conjunto inline a `text`: una marca `cita` invalidaría el documento. Se pintan con decoraciones de ProseMirror, que no tocan el JSON.
2. **StarterKit va sin `codeBlock` ni `hardBreak`.** No existen en el contrato; un Shift+Enter bastaría para romper la validación. Las celdas combinadas tampoco sobreviven (se pierden `colspan`/`rowspan`).

## Por qué las pruebas de UI están aquí y no en `tests/editor/`

`web/vitest.config.ts` (de forense-webapp) no carga en entorno **jsdom** archivos fuera de `web/`; con `@vitest-environment node` el mismo archivo sí carga. Mientras el coordinador no amplíe `server.fs.allow`, las pruebas jsdom viven junto al componente y las de contrato/BFF en `tests/editor/`.

```
npx --prefix web vitest run components/editor
```
