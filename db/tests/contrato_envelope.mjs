// Valida que cada envelope devuelto por las RPC de 005 cumpla el contrato
// tools.envelope de contracts/ v1. Si una herramienta añade una clave fuera
// del envelope o devuelve `data` con ok=false, el fallo aparece aquí y no en
// la integración con n8n.
//
//   node db/tests/contrato_envelope.mjs <envelopes.json> <ruta a contracts/index.mjs>
//
// El archivo de entrada es un arreglo de {tool, envelope}.
import fs from 'node:fs';

const [, , archivo, indice] = process.argv;
const { validateContract, contractVersion } = await import(indice);
const filas = JSON.parse(fs.readFileSync(archivo, 'utf8'));
let malas = 0;
for (const fila of filas) {
  const r = validateContract('tools.envelope', fila.envelope);
  if (!r.ok) {
    malas++;
    if (malas <= 6) {
      console.error(`  ${fila.tool}: ${r.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
    }
  }
}
console.log(`  contracts v${contractVersion}: ${filas.length} envelopes, ${malas} fuera de contrato`);
process.exit(malas === 0 && filas.length > 0 ? 0 : 1);
