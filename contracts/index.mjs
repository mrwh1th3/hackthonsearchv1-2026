import fs from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Harness Node de contratos. El frontend puede importar los JSON sin este módulo.
const directory = new URL('./schemas/', import.meta.url);
const files = fs.readdirSync(directory).filter(name => name.endsWith('.schema.json')).sort();
const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false,
  useDefaults: false, removeAdditional: false });
addFormats(ajv);
const refs = new Map();
const fingerprint = createHash('sha256');
for (const file of files) {
  const raw = fs.readFileSync(new URL(file, directory), 'utf8');
  const schema = JSON.parse(raw);
  ajv.addSchema(schema);
  fingerprint.update(file).update('\0').update(raw).update('\0');
  for (const definition of Object.keys(schema.$defs)) {
    refs.set(`${file.replace('.schema.json', '')}.${definition}`, `${schema.$id}#/$defs/${definition}`);
  }
}
export const contractVersion = '1.1.0';
export const schemaFingerprint = fingerprint.digest('hex');
export const contractNames = Object.freeze([...refs.keys()].sort());

export function validateContract(name, value) {
  if (!refs.has(name)) throw new Error(`Contrato desconocido: ${name}`);
  const validator = ajv.getSchema(refs.get(name));
  const ok = validator(value);
  return { ok, errors: structuredClone(validator.errors ?? []) };
}

export function compileContracts() {
  for (const name of contractNames) ajv.getSchema(refs.get(name));
  return contractNames.length;
}
