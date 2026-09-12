# web/app/api/reportes

Dueño: **forense-editor**. BFF del expediente. La UI nunca habla con n8n (CLAUDE.md regla 3): todas estas rutas exigen sesión, mismo origen y rate limit, y corren en Node.js (ajv compila en runtime).

| Ruta | Método | Entrada | Efecto |
|---|---|---|---|
| `/api/reportes/propuestas` | POST | `editor.solicitud` (ajv) | Pregunta → mensaje. Propuesta → `editor.propuesta` con patch/diff/citas. **No versiona.** |
| `/api/reportes/aplicar?caso_id=…` | POST | `editor.aplicar` (ajv) | Crea versión. Idempotente por `idempotency_key` y por propuesta ya aplicada. 409 si `version_base` venció. |
| `/api/reportes/descartar` | POST | zod local | Marca la propuesta descartada. No versiona. |
| `/api/reportes/revertir` | POST | zod local (07 §4) | Copia la versión elegida a una **nueva**. Sin borrado, sin LLM. |
| `/api/reportes/exportar` | POST | zod local | MD o JSON con manifiesto (versión, fecha, hash, contratos, citas sin evidencia). |
| `/api/reportes/borrador` | POST | zod local | Autoguardado contra `version_base`. **No versiona**; 409 conserva el borrador del cliente. |
| `/api/reportes/versiones` | GET | `?caso_id=` | Historial para el diff del panel de versiones. |

`editor.aplicar` es `additionalProperties:false` y no lleva `caso_id`: el caso viaja en la query string. Cualquier clave extra en el cuerpo sería 422.

## De dónde sale el contenido

- `N8N_WEBHOOK_BASE` + `INTERNAL_WEBHOOK_SECRET` → `/propuestas` reenvía a `POST /webhook/forense/editar` (07 §4) y valida la salida contra `agents.editor`. El secreto solo viaja en el header; nunca se registra.
- Fuente de datos = fixtures → propuesta **determinista** (no es un modelo) y operaciones contra `lib/document/almacen-demo.ts`. Toda respuesta lleva `origen: "fixture"` para que la UI lo declare.
- Fuente de datos real sin webhook → `503 backend_no_configurado`, antes de tocar la fuente de datos. No se finge aceptación.

## Pendiente del coordinador

`descartar`, `revertir`, `exportar` y `borrador` no tienen contrato en `contracts/release.json` v1.2.0; se validan con esquemas zod locales (`lib/document/esquemas.ts`). Ver `solicitudes_coordinador` en la entrega del corte.

---

## Corte 2 (H5): persistencia real, no memoria disfrazada

`modoBackend()` ya no existe. Hay **dos** decisiones separadas:

| Decisión | Función | Valores |
|---|---|---|
| De dónde sale una **propuesta** (`/propuestas`) | `modoPropuesta()` en `lib/document/servidor.ts` | `webhook` (N8N_WEBHOOK_BASE + INTERNAL_WEBHOOK_SECRET) · `fixture` · `no_configurado` |
| Dónde se **persiste** el expediente (aplicar, descartar, revertir, borrador, versiones, exportar) | `repositorio()` → `lib/document/repositorio.ts` | `supabase` (SUPABASE_SERVICE_ROLE_KEY + URL) · `fixture` · `null` → 503 |

Por qué n8n no persiste: `n8n/workflows/MANIFEST.md` §5 describe un solo camino
(`POST /webhook/forense/editar`, `modo: pregunta|propuesta`) y su nodo 8 dice
«**Todavía no cambia el expediente**: Aplicar es operación determinista del
BFF». No hay nodo de webhook para las cinco operaciones deterministas, así que
`N8N_WEBHOOK_BASE` **no** las habilita.

Cada respuesta declara `origen` (`supabase` | `fixture` | `n8n`) y, cuando
escribe, `bitacora: true|false` — CLAUDE.md regla 2: el modo fixture nunca
afirma un evento que no ocurrió. Sin repositorio, Aplicar responde 503 y el
cliente conserva su borrador.

Envs nuevas que el despliegue necesita: `SUPABASE_SERVICE_ROLE_KEY` y
(opcional) `SUPABASE_URL` si difiere de `NEXT_PUBLIC_SUPABASE_URL`.
