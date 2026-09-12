# tests/editor

Dueño: **forense-editor**. Pruebas del editor del expediente que corren en entorno **node** (contratos, documento canónico, patches y BFF).

```
npm ci --prefix web
npx --prefix web vitest run ../tests/editor/     # 43 pruebas
npm --prefix web test                            # todo el paquete web, incluye estas
```

| Archivo | Cubre |
|---|---|
| `documento.test.ts` | `normalizarDocumento` contra `editor.documento` (JSON sucio de TipTap incluido), hashes canónicos, índice de 10 secciones. |
| `citas-markdown.test.ts` | Los 7 prefijos de `common.referencia` (IDs no-uuid), marca de cita sin evidencia, Markdown derivado que conserva citas. |
| `patch-propuesta.test.ts` | `before_hash`, bloques protegidos, y las validaciones de 07 §4 paso 3 (citas ajenas, nivel, sección protegida). |
| `rutas.test.ts` | Flujo completo del BFF: selección→propuesta→Aplicar crea versión; pregunta no modifica; doble Aplicar idempotente; conflicto de `version_base`; exportación que conserva citas. |
| `rutas-sin-backend.test.ts` | Fuente real sin webhook → 503 `backend_no_configurado`. |

Las pruebas de UI (jsdom) están en `web/components/editor/componentes.test.tsx`: `web/vitest.config.ts` no carga archivos jsdom fuera de `web/`. Pedido al coordinador ampliar `server.fs.allow` para moverlas aquí.
