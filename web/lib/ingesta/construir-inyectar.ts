import Papa from "papaparse";
import type { TablaCanonica } from "./plantillas";

export type FilaInyectar = Record<string, unknown>;

/**
 * Convierte texto pegado/subido a filas planas para `product.inyectar.
 * tablas.<tabla>` (cada fila debe ser un objeto no vacío, ver el schema:
 * `minProperties: 1, maxProperties: 60`). Acepta CSV con encabezado (lo que
 * produce `generarPlantillaCsv`) o un arreglo JSON de objetos — nunca
 * intenta adivinar una tabla objetivo a partir del contenido, eso lo dice
 * el llamador (columna elegida en la UI, nunca inferida del texto libre).
 */
export function parsearFilasPegadas(texto: string): FilaInyectar[] {
  const limpio = texto.trim();
  if (limpio.length === 0) return [];

  if (limpio.startsWith("[")) {
    try {
      const datos: unknown = JSON.parse(limpio);
      if (!Array.isArray(datos)) return [];
      return datos.filter((d): d is FilaInyectar => typeof d === "object" && d !== null && !Array.isArray(d));
    } catch {
      return [];
    }
  }

  const resultado = Papa.parse<FilaInyectar>(limpio, { header: true, skipEmptyLines: true });
  return resultado.data.filter((fila) => Object.keys(fila).length > 0);
}

export interface InyectarInput {
  corridaBaseId: string;
  origen: "ui" | "api" | "ensayo";
  tablas: Partial<Record<TablaCanonica, FilaInyectar[]>>;
  nota?: string;
  idempotencyKey: string;
}

/**
 * Arma el JSON exacto de `contracts/schemas/product.schema.json#/$defs/
 * inyectar` (release 1.2.0): mismas cuatro llaves requeridas, sin
 * `additionalProperties`. Filtra las tablas sin filas — el schema exige
 * `tablas` con `minProperties: 1` cuando no hay `archivos`, y cada entrada
 * de tabla con `minItems: 1`, así que una tabla vacía haría inválido el
 * payload entero si se dejara como `[]`.
 */
export function construirInyectar(input: InyectarInput): Record<string, unknown> {
  const tablas = Object.fromEntries(Object.entries(input.tablas).filter(([, filas]) => (filas?.length ?? 0) > 0));
  const payload: Record<string, unknown> = {
    corrida_base_id: input.corridaBaseId,
    origen: input.origen,
    tablas,
    idempotency_key: input.idempotencyKey,
  };
  if (input.nota) payload.nota = input.nota;
  return payload;
}
