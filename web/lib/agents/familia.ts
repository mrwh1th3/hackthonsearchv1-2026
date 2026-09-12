import type { Familia } from "@/lib/data";

/**
 * Mapeo agente especialista -> familia (03-arquitectura-agentica.md: "cinco
 * especialistas por familia"; nombres de agente confirmados en el único
 * fixture de tarea/señal disponible: "documental" -> D). No hay un campo
 * `familia` directo en `Tarea`; se deriva del nombre del agente.
 */
const AGENTE_FAMILIA: Record<string, Familia> = {
  documental: "D",
  financiero: "F",
  relacional: "R",
  temporal: "T",
  externo: "E",
};

export function familiaDeAgente(agente: string): Familia | null {
  return AGENTE_FAMILIA[agente] ?? null;
}

export const FAMILIAS_ORDEN: Familia[] = ["D", "F", "R", "T", "E"];
