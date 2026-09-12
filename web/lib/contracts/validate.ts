import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import release from "@contracts/release.json";

import commonSchema from "@contracts/schemas/common.schema.json";
import entitiesSchema from "@contracts/schemas/entities.schema.json";
import agentsSchema from "@contracts/schemas/agents.schema.json";
import toolsSchema from "@contracts/schemas/tools.schema.json";
import runtimeSchema from "@contracts/schemas/runtime.schema.json";
import editorSchema from "@contracts/schemas/editor.schema.json";
import productSchema from "@contracts/schemas/product.schema.json";
import ingestaSchema from "@contracts/schemas/ingesta.schema.json";

/**
 * Validador de contratos para la webapp (BFF), reutilizando los MISMOS
 * schemas JSON de `contracts/schemas/*.schema.json` (contracts/release.json
 * v1.0.0) sin copiarlos ni redefinirlos.
 *
 * Por qué no se usa `contracts/index.mjs` aquí: ese harness Node hace
 * `fs.readdirSync(new URL('./schemas/', import.meta.url))` para descubrir
 * los archivos. `contracts/README.md` es explícito: "index.mjs es un
 * harness Node con lectura de archivos. Frontend y otros lenguajes deben
 * consumir los JSON y resolver sus referencias localmente, no importar
 * node:fs al navegador." Next.js empaqueta las rutas API con webpack aun en
 * runtime nodejs, y ese patrón de directorio dinámico no es empaquetable
 * (build falla: "Module not found: Can't resolve './schemas/'"). Este
 * módulo es la resolución local que el README pide: mismos JSON, mismo
 * compilador Ajv2020 con la misma configuración estricta, importados de
 * forma estática para que Next los incluya en el bundle del servidor.
 *
 * Si `contracts/` publica una versión nueva con más archivos de schema, este
 * arreglo estático debe actualizarse (ver solicitudes_coordinador: pedir
 * exportación standalone o tipos generados, como ya sugiere el README).
 */

type SchemaFile = { $id: string; $defs?: Record<string, unknown> };

const schemaFiles: ReadonlyArray<{ name: string; schema: SchemaFile }> = [
  { name: "common", schema: commonSchema as SchemaFile },
  { name: "entities", schema: entitiesSchema as SchemaFile },
  { name: "agents", schema: agentsSchema as SchemaFile },
  { name: "tools", schema: toolsSchema as SchemaFile },
  { name: "runtime", schema: runtimeSchema as SchemaFile },
  { name: "editor", schema: editorSchema as SchemaFile },
  { name: "product", schema: productSchema as SchemaFile },
  { name: "ingesta", schema: ingestaSchema as SchemaFile },
];

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormats(ajv);

const refs = new Map<string, string>();
for (const { name, schema } of schemaFiles) {
  ajv.addSchema(schema);
  for (const definition of Object.keys(schema.$defs ?? {})) {
    refs.set(`${name}.${definition}`, `${schema.$id}#/$defs/${definition}`);
  }
}

export const contractNames: readonly string[] = Object.freeze([...refs.keys()].sort());

/**
 * Versión publicada de `contracts/release.json`. Fuente única para el badge
 * "Datos de demostración · contratos vX" (CLAUDE.md regla 3, 15 §13): ningún
 * componente debe escribir el número a mano. El coordinador ya publicó
 * 1.1.0 en `main` con `product.inyectar`/`product.inyeccion` (pendiente de
 * merge a este worktree, ver solicitudes_coordinador); cuando se integre,
 * este valor se actualiza solo con `release.json`.
 */
export const contractVersion: string = (release as { version: string }).version;

export interface ValidacionContrato {
  ok: boolean;
  errors: Array<Record<string, unknown>>;
}

export function validateContract(name: string, value: unknown): ValidacionContrato {
  const ref = refs.get(name);
  if (!ref) throw new Error(`Contrato desconocido: ${name}`);
  const validator = ajv.getSchema(ref);
  if (!validator) throw new Error(`Schema no compilado para: ${name}`);
  const ok = Boolean(validator(value));
  const errors = validator.errors ?? [];
  return { ok, errors: errors.map((e) => ({ ...e }) as Record<string, unknown>) };
}
