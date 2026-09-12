/**
 * Modelo de documento del expediente (forense-editor).
 *
 * Punto único de importación para componentes y rutas BFF. El JSON TipTap
 * canónico, el Markdown derivado, las citas, los patches y el almacén de
 * versiones de demostración viven aquí; la validación contra los contratos
 * reales (ajv) se hace en la frontera de las rutas, no en el cliente.
 */
export * from "./tipos";
export * from "./sha256";
export * from "./documento";
export * from "./citas";
export * from "./secciones";
export * from "./markdown";
export * from "./patch";
export * from "./propuesta";
export * from "./esquemas";
