# web/lib/document

Dueño: **forense-editor**. Modelo del documento canónico del expediente.

## Por qué existe cada pieza

| Archivo | Qué resuelve |
|---|---|
| `tipos.ts` | Espejo de `contracts/schemas/editor.schema.json` v1.2.0 (documento, bloque, texto, marca, patch, propuesta, solicitud, aplicar, reporte). |
| `sha256.ts` | Hash síncrono sin dependencias: el MISMO valor en el navegador y en el BFF. `common.hash` = `^[a-f0-9]{64}$`. |
| `documento.ts` | `normalizarDocumento` (frontera TipTap → contrato), serialización canónica con claves ordenadas y hashes de bloque/documento. |
| `citas.ts` | Los 7 prefijos de `common.referencia` (CFDI, MOV, ATR, LISTA, CICLO, CADENA, PAR), segmentación y estado "revisar citas". |
| `secciones.ts` | Catálogo de 10 secciones (8 fijas + Trayectoria + Cadena de explicación) e índice derivado del documento. |
| `markdown.ts` | Markdown derivado (`aMarkdown`) e importación única del legado (`desdeMarkdown`), determinista. |
| `patch.ts` | Aplicación de `editor.patch` con control optimista por `before_hash`; todo o nada. |
| `propuesta.ts` | Salida del agente Editor → propuesta con patch/diff/citas + validaciones de 07 §4 paso 3. |
| `esquemas.ts` | Zod local para descartar/revertir/exportar/borrador (sin contrato publicado todavía). |
| `almacen-demo.ts` | Versiones, propuestas y borradores **en memoria del proceso**. No es persistencia ni bitácora. |
| `servidor.ts` | Solo servidor: guardas del BFF, carga del caso y decisión fixture / webhook / 503. |

## Invariantes que no se negocian

1. El JSON de TipTap **no** valida contra `editor.documento` sin normalizar: ids obligatorios, conjunto de nodos cerrado (sin `codeBlock` ni `hardBreak`), celdas sin `colspan`/`rowspan`/`colwidth`, texto no vacío.
2. `before_hash` (bloque o documento) y `texto_hash` (texto seleccionado) son ambos `common.hash` y **no** son lo mismo.
3. El Markdown es derivado: no hay round-trip continuo. La importación desde Markdown ocurre una vez.
4. El editor nunca marca una versión como `validado`; esa promoción es del validador del servidor.
5. El texto del documento es dato, no instrucción (CLAUDE.md regla 6, 17 §7).

## Pruebas

```
npm ci --prefix web
npx --prefix web vitest run ../tests/editor/          # contrato, documento, patches, BFF
npx --prefix web vitest run components/editor         # UI (jsdom)
```
