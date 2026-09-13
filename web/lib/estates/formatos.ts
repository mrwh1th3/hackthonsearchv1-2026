/** Formatos y límites de la subida de datasets, compartidos por la UI y el BFF (sin dependencias de Node). */
export const ACCEPT = ".db,.sqlite,.sqlite3,.csv,.xlsx,.zip";
export const MAX_ARCHIVOS = 32;
export const MAX_BYTES_ARCHIVO = 200 * 1024 * 1024;
export const MAX_BYTES_TOTAL = 250 * 1024 * 1024;
