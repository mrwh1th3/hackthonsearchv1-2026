/**
 * Plantillas CSV por tabla canónica (21 §3.1). Las columnas se derivan del
 * catálogo real `ingesta.mapping.target` de `contracts/schemas/
 * ingesta.schema.json` (mismo enum que usa el mapper), agrupadas por tabla
 * según su nombre; no hay todavía un DDL de columnas por tabla leído de
 * `05-esquema-db.md` en este corte, así que el agrupamiento es una
 * inferencia razonable a partir del contrato — pendiente de confirmar con
 * forense-db (ver solicitudes_coordinador). `valor_untrusted` en
 * `atributos_entidad` no está en el enum: es texto libre del contribuyente
 * (CLAUDE.md regla 6), documentado con el sufijo correspondiente.
 */
export const TABLAS_CANONICAS = [
  "contribuyentes",
  "cuentas",
  "cfdi",
  "complementos_pago",
  "movimientos",
  "atributos_entidad",
  "listas_sat",
] as const;

export type TablaCanonica = (typeof TABLAS_CANONICAS)[number];

export const COLUMNAS_POR_TABLA: Record<TablaCanonica, string[]> = {
  contribuyentes: ["rfc", "giro", "fecha_alta"],
  cuentas: ["clabe", "rfc_titular"],
  cfdi: ["uuid", "emisor_rfc", "receptor_rfc", "fecha", "subtotal", "iva", "total", "cancelado", "metodo_pago", "clave_prod_serv"],
  complementos_pago: ["uuid", "fecha", "monto", "moneda", "cuenta_destino"],
  movimientos: ["id_origen", "monto", "moneda", "fecha", "cuenta_origen", "cuenta_destino", "tipo"],
  atributos_entidad: ["rfc", "tipo", "valor_untrusted"],
  listas_sat: ["rfc", "tipo", "fecha"],
};

export function generarPlantillaCsv(tabla: TablaCanonica): string {
  return COLUMNAS_POR_TABLA[tabla].join(",") + "\n";
}
