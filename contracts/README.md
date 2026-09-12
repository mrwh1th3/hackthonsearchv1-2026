# Contratos compartidos v1.0.0

Base ejecutable autorizada por el usuario antes del inicio: schemas, fixtures y tests locales. **No incluye lógica de investigación, migraciones, llamadas a proveedores ni despliegues.** Los contratos son DTO de intercambio, no una copia completa del DDL de05.

## Ejecutar

Desde la raíz del repo:

```sh
npm ci --prefix contracts --ignore-scripts
npm test --prefix contracts
```

Solo la instalación descarga dependencias; los tests no usan red, DB, API ni credenciales. Dependencias fijadas por `package-lock.json`. Ejemplo Node:

```js
import { validateContract } from './contracts/index.mjs';
const result = validateContract('agents.especialista', payload);
if (!result.ok) console.error(result.errors);
```

`index.mjs` es un harness Node con lectura de archivos. Frontend y otros lenguajes deben consumir los JSON y resolver sus referencias localmente, no importar `node:fs` al navegador. Los `$id` bajo `forense.invalid` son identificadores, nunca URLs que deban consultarse. Implementar exportación standalone o tipos generados cuando se conecte el frontend, sin duplicar tipos manualmente.

## Archivos normativos

- `schemas/common.schema.json`: UUID, BIGINT serializado, dinero exacto, fechas UTC, niveles, pistas, referencias y cobertura.
- `schemas/entities.schema.json`: corrida, caso, tarea, pista, señal, evidencia propuesta/verificada y dictamen.
- `schemas/agents.schema.json`: salidas de especialistas, Auditor, Defensor, Réplica, Redactor y Editor. Auditor Final no es un agente LLM.
- `schemas/tools.schema.json`: once inputs visibles al modelo, llamada backend y envelope paginado/error. Identidad, operación y fencing quedan fuera de los argumentos del LLM.
- `schemas/runtime.schema.json`: paquetes de contexto, checkpoint y adapter de proveedor; separación de editor y tarea, R1/R2 y roles sin herramientas.
- `schemas/editor.schema.json`: documento estructurado básico, selección, propuesta, patch, Aplicar y reporte versionado.
- `schemas/product.schema.json`: solicitud/investigación, perfil privado, notificaciones y evento de finalización sin teléfono.
- `schemas/ingesta.schema.json`: propuesta del mapper y transformaciones declarativas. Aprobar JSON no autoriza importar.

Todos son JSON Schema2020-12, compilados con Ajv en modo estricto y formatos habilitados. No hay coerción, defaults ni eliminación silenciosa de propiedades. [Referencia Ajv](https://ajv.js.org/json-schema.html).

## Decisiones fijadas para los implementadores

1. BIGINT de Postgres viaja como **string decimal**, nunca como Number de JavaScript. UUID sigue siendo string UUID. El rango exacto de BIGINT se comprueba al persistir; patrón/longitud no sustituye ese rango.
2. Dinero de `NUMERIC(14,2)` viaja como string decimal de dos posiciones; el dictaminador usa centavos como string. Mantener moneda separada y no agregar monedas distintas. No redondear en la UI para decidir hechos.
3. Fechas de transporte en UTC con `Z`; zona IANA viaja aparte. Períodos `[desde,hasta_exclusivo)`. En `forense_facturas`, `p_hasta` también es exclusivo. Backend comprueba orden, ventana y validez de zona.
4. `rfc`/`rfc_principal` conservan nombre legado, pero aceptan IDs técnicos como `DEMO:...`/`IBM:...`. No equivalen a RFC fiscal real. No fabricar RFC para satisfacer una FK.
5. `pista_objetivo` se fija como ID de pista serializado, no código D2 ni texto libre. `comprobacion.codigo` usa catálogo D1…E1 como identificador del verificador; backend verifica que coincida con pista/familia/fuentes y que exista implementación.
6. `contexto.datos` usa paquete de especialista o de cierre; ver fixtures por rol. Editor añade `editor_operacion_id`, documento/selección/versión. Redactor no recibe hipótesis libre. La versión del contrato del paquete es `contexto.v1`.
7. Edición: propuesta ≠ versión aplicada. Patch admite reemplazar/insertar/eliminar bloques o reemplazar documento completo con hash previo. Backend comprueba conflicto, anclas, autorización y combinaciones válidas; no ejecuta un JSON Patch arbitrario.
8. Reportes de caso conservan IDs BIGINT como05. El resumen sin candidatos necesita persistirse como artefacto de reporte con ID compatible antes de emitir el manifest; no inventar un `caso_id`.

## Fixtures y alcance de las pruebas

`fixtures/manifest.json` identifica todos los samples válidos/negativos. Incluye tres casos de UI —presunción, anomalía explicada y no concluyente—, contexto R1/R2/cierre/editor, once tools, selección/propuesta/reporte, notificación y mapper incompleto.

Son **datos sintéticos de contrato, NO ground truth ni evaluación de detección**. Los resultados se escribieron como fixtures, no se obtuvieron ejecutando agentes o clasificadores. Sus hashes son placeholders de formato declarados en el manifest; el backend real debe calcularlos. Perfiles sin teléfono y llamadas desactivadas. Nunca cargar estos eventos en un webhook activo.

`release.json` fija versión, fingerprint de schemas y entradas públicas. Cambiar cualquier schema requiere actualizar fingerprint, tests y consumidores; cambios incompatibles exigen nueva versión mayor o aprobación explícita de transición antes de que existan consumidores. El coordinador controla `contracts/` y su lockfile.

## Lo que estos schemas NO prueban

- Autorización/RLS, pertenencia de IDs a corrida/caso, firma de cursor/webhook, fencing vigente, unicidad transaccional o presupuesto disponible: requieren DB/runtime.
- Materialidad, soporte semántico, clasificación correcta, igualdad entre evidencias y monto, o verdad de un reporte: requieren verificadores y evaluación.
- `tools.envelope.data` es deliberadamente el payload específico de cada RPC; este primer corte cierra envelope e inputs, **no todas las formas de resultados SQL internos**. Al implementar cada RPC, añadir su schema de resultado específico y tests antes de conectar el consumidor. No tratar el envelope común como validación de sus hechos.
- El documento define un subconjunto estructurado de TipTap. El editor debe validar estructura admitida por sus extensiones, orden de nodos, IDs únicos, selección, URLs sanitizadas y compatibilidad de tablas. No es un sanitizer HTML ni una implementación del editor.
- Eventos forenses son un DTO resumido seguro de UI; bitácora cruda/backend conserva sus payloads propios con acceso autorizado. No borrar datos de la traza por adaptar este DTO.
- Resoluciones de Réplica sin duplicados por defensa_id y cobertura exacta de argumentos; rango from/to; orden de fechas; completitud de todas las entregas: son comprobaciones cruzadas posteriores. El gate de esquema es necesario, no suficiente.

Esto materializa los contratos mínimos compartidos del arranque. La lógica que los hace cumplir frente a datos reales sigue reservada para la implementación autorizada del hackathon.
