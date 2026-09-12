// Valida que las filas de forense.pistas se proyecten al contrato
// entities.pista de contracts/ v1. Lo que 005 va a servir es exactamente esto:
// si 003 deja de guardar 'resumen' o emite una referencia fuera del espacio de
// nombres, el fallo aparece aquí y no en la integración.
//
//   node db/tests/contrato_pistas.mjs <pistas.json> <ruta a contracts/index.mjs>
import fs from 'node:fs';

const [, , archivo, indice] = process.argv;
const { validateContract, contractVersion } = await import(indice);
const filas = JSON.parse(fs.readFileSync(archivo, 'utf8'));
let malas = 0;
for (const fila of filas) {
  const r = validateContract('entities.pista', fila);
  if (!r.ok) {
    malas++;
    if (malas <= 3) {
      console.error(`  ${fila.codigo}: ${r.errors.map(e => e.instancePath + ' ' + e.message).join('; ')}`);
    }
  }
}
console.log(`  contracts v${contractVersion}: ${filas.length} pistas, ${malas} fuera de contrato`);
process.exit(malas === 0 && filas.length > 0 ? 0 : 1);
