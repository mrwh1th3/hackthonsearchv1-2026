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
  { codigo: "D1", familia: "D", nombre: "Giro vs. concepto" },
  { codigo: "D2", familia: "D", nombre: "Capacidad operativa" },
  { codigo: "D3", familia: "D", nombre: "Conceptos y montos" },
  { codigo: "D4", familia: "D", nombre: "Cancelaciones" },
  { codigo: "F1", familia: "F", nombre: "Conciliación CFDI–banco" },
  { codigo: "F2", familia: "F", nombre: "Pass-through" },
  { codigo: "F3", familia: "F", nombre: "Tercero pagador" },
  { codigo: "F4", familia: "F", nombre: "Ciclo de dinero" },
  { codigo: "R1", familia: "R", nombre: "Atributos compartidos" },
  { codigo: "R2", familia: "R", nombre: "Ciclos y cadenas de facturas" },
  { codigo: "R3", familia: "R", nombre: "Concentración" },
  { codigo: "T1", familia: "T", nombre: "Ciclo de vida" },
  { codigo: "T2", familia: "T", nombre: "Sincronía y estacionalidad" },
  { codigo: "E1", familia: "E", nombre: "Listas del SAT" },
] as const;
