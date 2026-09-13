import type { Familia, PistaCodigo } from "@/lib/data";

/**
 * Catálogo estático de las 14 pistas (docs/02-factores-correlaciones.md
 * "Catálogo de las 14 pistas"). Es taxonomía del dominio -- nombre y familia
 * de cada código -- no una métrica medida: no depende de ninguna corrida y
 * nunca cambia con el dataset, así que no es el tipo de número que
 * docs/22-frontend-inspector.md prohíbe inventar (CLAUDE.md reglas 4/10).
 *
 * El picker "Columns" del diseño (docs/22 "El picker 'Columns' — se lee, no
 * se inventa") lo cruza contra `Corrida.familias_evaluables` para decidir,
 * pista por pista, si esta corrida la puede evaluar.
 */
export interface PistaCatalogoEntry {
  codigo: PistaCodigo;
  familia: Familia;
  nombre: string;
}

export const CATALOGO_PISTAS: readonly PistaCatalogoEntry[] = [
  { codigo: "D1", familia: "D", nombre: "Industry vs. invoice description" },
  { codigo: "D2", familia: "D", nombre: "Operating capacity" },
  { codigo: "D3", familia: "D", nombre: "Descriptions & amounts" },
  { codigo: "D4", familia: "D", nombre: "Cancellations" },
  { codigo: "F1", familia: "F", nombre: "Invoice–bank reconciliation" },
  { codigo: "F2", familia: "F", nombre: "Pass-through" },
  { codigo: "F3", familia: "F", nombre: "Third-party payer" },
  { codigo: "F4", familia: "F", nombre: "Payment cycle" },
  { codigo: "R1", familia: "R", nombre: "Shared attributes" },
  { codigo: "R2", familia: "R", nombre: "Invoice cycles & chains" },
  { codigo: "R3", familia: "R", nombre: "Concentration" },
  { codigo: "T1", familia: "T", nombre: "Lifecycle" },
  { codigo: "T2", familia: "T", nombre: "Timing and seasonality" },
  { codigo: "E1", familia: "E", nombre: "Tax-authority watchlists" },
] as const;
