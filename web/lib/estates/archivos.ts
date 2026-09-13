import { createHash } from "node:crypto";

/**
 * Validación de la subida de un dataset (BFF `/api/estates`). Acepta lo mismo que el CLI del auditor
 * (`python3 -m auditor run --estate`): un SQLite, uno o varios CSV (una tabla por archivo), uno o varios XLSX
 * (hoja por tabla) o un ZIP con CSV/XLSX. Un conjunto de CSV o un ZIP es UN solo dataset.
 *
 * El tipo se decide por contenido y debe coincidir con la extensión: una extensión sola no basta, y un
 * contenido sin la extensión esperada tampoco. La inspección profunda del ZIP (rutas, zip bomb) la hace el
 * puente Python antes de leer miembros (`loaders/ingestar_estate.py`); aquí va lo barato y lo que no
 * requiere descomprimir.
 */

import { MAX_ARCHIVOS, MAX_BYTES_ARCHIVO, MAX_BYTES_TOTAL } from "./formatos";

export { ACCEPT, MAX_ARCHIVOS, MAX_BYTES_ARCHIVO, MAX_BYTES_TOTAL } from "./formatos";

export type TipoArchivo = "sqlite" | "csv" | "xlsx" | "zip";
export type FormatoConjunto = "sqlite" | "csv_dir" | "xlsx" | "xlsx_dir" | "zip";

export type ArchivoEntrada = { nombre: string; bytes: Buffer };
export type ArchivoValidado = { nombre: string; tipo: TipoArchivo; bytes: Buffer };
export type Conjunto = { formato: FormatoConjunto; archivos: ArchivoValidado[]; sha256: string; bytesTotales: number };

export class ErrorSubida extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly codigo: string,
    readonly detalle: string,
  ) {
    super(detalle);
  }
}

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const XLSX_WORKBOOK = Buffer.from("xl/workbook.xml", "latin1");
const EXTENSIONES: Record<string, TipoArchivo> = { ".db": "sqlite", ".sqlite": "sqlite", ".sqlite3": "sqlite", ".csv": "csv", ".xlsx": "xlsx", ".zip": "zip" };

/**
 * Nombre de archivo seguro: solo el último segmento (sin `/`, `\`, `..` ni unidades), letras/dígitos Unicode,
 * `_ . - ` y espacio; sin puntos iniciales; 100 caracteres como máximo y extensión en minúsculas. La raíz
 * del nombre de un CSV es el nombre de la tabla, así que se conserva todo lo posible.
 */
export function sanearNombre(original: string, indice: number): string {
  const base = original.normalize("NFC").split(/[\\/]/).pop() ?? "";
  const limpio = base.replace(/[^\p{L}\p{N}_.\- ]/gu, "").replace(/\.{2,}/g, ".").replace(/^[.\s]+|\s+$/g, "");
  const punto = limpio.lastIndexOf(".");
  const ext = punto > 0 ? limpio.slice(punto).toLowerCase() : "";
  const raiz = (punto > 0 ? limpio.slice(0, punto) : limpio).slice(0, 100 - ext.length).trim();
  return `${raiz || `archivo-${indice + 1}`}${ext}`;
}

function extension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(i).toLowerCase() : "";
}

/** Tipo por contenido; `null` si no coincide con lo que promete la extensión. */
export function tipoPorContenido(nombre: string, bytes: Buffer): TipoArchivo | null {
  const esperado = EXTENSIONES[extension(nombre)];
  if (!esperado || bytes.length === 0) return null;
  const esSqlite = bytes.subarray(0, 16).equals(SQLITE_MAGIC);
  const esZip = bytes.subarray(0, 4).equals(ZIP_MAGIC);
  switch (esperado) {
    case "sqlite":
      return esSqlite ? "sqlite" : null;
    case "zip":
      // Un .xlsx renombrado a .zip también es un ZIP válido para la ingesta (la detecta por xl/workbook.xml).
      return esZip ? "zip" : null;
    case "xlsx":
      // El nombre de cada miembro aparece en claro en el directorio central del ZIP.
      return esZip && bytes.includes(XLSX_WORKBOOK) ? "xlsx" : null;
    case "csv": {
      if (esSqlite || esZip) return null;
      const muestra = bytes.subarray(0, 64 * 1024);
      // Texto: sin NUL (UTF-16 no se acepta; la ingesta decodifica utf-8, BOM, cp1252 y latin-1).
      return muestra.includes(0) ? null : "csv";
    }
  }
}

/** sha256 determinista del conjunto: nombres saneados en orden + tamaño + contenido de cada archivo. */
export function hashConjunto(formato: FormatoConjunto, archivos: { nombre: string; bytes: Buffer }[]): string {
  const h = createHash("sha256").update(`forense-estate-v1\0${formato}\0`);
  for (const a of [...archivos].sort((x, y) => (x.nombre < y.nombre ? -1 : x.nombre > y.nombre ? 1 : 0))) {
    h.update(`${a.nombre}\0${a.bytes.length}\0`).update(a.bytes);
  }
  return h.digest("hex");
}

export function validarConjunto(entradas: ArchivoEntrada[]): Conjunto {
  if (entradas.length === 0) throw new ErrorSubida(400, "falta_archivo", "Selecciona al menos un archivo.");
  if (entradas.length > MAX_ARCHIVOS) {
    throw new ErrorSubida(400, "demasiados_archivos", `Máximo ${MAX_ARCHIVOS} archivos por dataset.`);
  }
  let bytesTotales = 0;
  const vistos = new Set<string>();
  const archivos: ArchivoValidado[] = entradas.map((e, i) => {
    const nombre = sanearNombre(e.nombre, i);
    if (e.bytes.length > MAX_BYTES_ARCHIVO) {
      throw new ErrorSubida(413, "archivo_muy_grande", `${nombre} supera ${MAX_BYTES_ARCHIVO / (1024 * 1024)} MB.`);
    }
    bytesTotales += e.bytes.length;
    if (bytesTotales > MAX_BYTES_TOTAL) {
      throw new ErrorSubida(413, "conjunto_muy_grande", `El dataset supera ${MAX_BYTES_TOTAL / (1024 * 1024)} MB en total.`);
    }
    if (!EXTENSIONES[extension(nombre)]) {
      throw new ErrorSubida(400, "extension_no_admitida", `${nombre}: solo se aceptan .db, .sqlite, .sqlite3, .csv, .xlsx o .zip.`);
    }
    const tipo = tipoPorContenido(nombre, e.bytes);
    if (!tipo) {
      throw new ErrorSubida(400, "contenido_no_coincide", `${nombre}: el contenido no corresponde a un archivo ${extension(nombre)} válido.`);
    }
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) throw new ErrorSubida(400, "nombres_duplicados", `Hay dos archivos llamados ${nombre}.`);
    vistos.add(clave);
    return { nombre, tipo, bytes: e.bytes };
  });

  const tipos = new Set(archivos.map((a) => a.tipo));
  const n = archivos.length;
  let formato: FormatoConjunto;
  if (tipos.size > 1) {
    throw new ErrorSubida(
      400,
      "mezcla_invalida",
      "Un dataset es un SQLite, un ZIP, un conjunto de CSV o un conjunto de XLSX; no se pueden mezclar tipos.",
    );
  } else if (tipos.has("sqlite")) {
    if (n > 1) throw new ErrorSubida(400, "mezcla_invalida", "Sube un solo archivo SQLite por dataset.");
    formato = "sqlite";
  } else if (tipos.has("zip")) {
    if (n > 1) throw new ErrorSubida(400, "mezcla_invalida", "Sube un solo ZIP por dataset.");
    formato = "zip";
  } else if (tipos.has("xlsx")) {
    formato = n > 1 ? "xlsx_dir" : "xlsx";
  } else {
    formato = "csv_dir";
  }
  return { formato, archivos, sha256: hashConjunto(formato, archivos), bytesTotales };
}
