import release from "@contracts/release.json";

/**
 * Manifiesto de descarga (15 §11, Corte 2 punto 5): nombre, ID, versión de
 * contratos, fecha y filtros aplicados van SIEMPRE junto al archivo — nunca
 * un CSV/JSON "pelón" sin decir de qué corrida/filtro salió. `version` lee
 * `contracts/release.json` directamente (no pasa por lib/contracts/validate,
 * que carga ajv + todos los schemas: innecesario en el cliente solo para un
 * número de versión).
 */
export interface ManifiestoDescarga {
  nombre: string;
  id: string;
  version: string;
  fecha: string;
  filtros: Record<string, unknown>;
  hash: string;
}

const contractVersion = (release as { version: string }).version;

/** FNV-1a de 32 bits: detecta cambios de contenido en un manifiesto local; no es criptográfico ni sustituye dataset_hash. */
export function hashManifiesto(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function idAleatorio(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function construirManifiestoDescarga(input: { nombre: string; filtros: Record<string, unknown> }): ManifiestoDescarga {
  const fecha = new Date().toISOString();
  const filtrosCanonicos = JSON.stringify(input.filtros, Object.keys(input.filtros).sort());
  return {
    nombre: input.nombre,
    id: idAleatorio(),
    version: contractVersion,
    fecha,
    filtros: input.filtros,
    hash: hashManifiesto(`${input.nombre}|${fecha}|${filtrosCanonicos}`),
  };
}

function escaparCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** CSV con el manifiesto como comentario `#` en las dos primeras líneas (RFC 4180 no las reserva, pero lectores de Excel/Sheets las ignoran igual que un encabezado repetido no lo haría). */
export function filasACsv<T extends object>(filas: T[], manifiesto: ManifiestoDescarga): string {
  const encabezadoManifiesto = [
    `# manifiesto: nombre=${manifiesto.nombre} id=${manifiesto.id} version=${manifiesto.version} fecha=${manifiesto.fecha} hash=${manifiesto.hash}`,
    `# filtros: ${JSON.stringify(manifiesto.filtros)}`,
  ].join("\n");
  if (filas.length === 0) return `${encabezadoManifiesto}\n`;
  const columnas = Object.keys(filas[0]) as Array<keyof T>;
  const cuerpo = filas.map((fila) => columnas.map((c) => escaparCsv(fila[c])).join(","));
  return [encabezadoManifiesto, columnas.join(","), ...cuerpo].join("\n");
}
