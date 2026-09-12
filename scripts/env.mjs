// Lector mínimo de .env (raíz, gitignored). Sin dependencias. Nunca imprime valores.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function leerEnv(archivo = path.join(root, '.env')) {
  const env = { ...process.env };
  if (!fs.existsSync(archivo)) return env;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || linea.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in env) || env[m[1]] === '') env[m[1]] = v;
  }
  return env;
}

export function exigir(env, claves) {
  const faltan = claves.filter(k => !env[k]);
  if (faltan.length) {
    console.error(`Faltan en .env: ${faltan.join(', ')} (solo nombres; nunca se imprimen valores).`);
    process.exit(2);
  }
}
