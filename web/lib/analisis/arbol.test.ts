import { describe, expect, it } from "vitest";
import { construirArbol, duracion, etapaCaso, formatoTokens } from "./arbol";
import type { Caso, EventoForense, Tarea } from "@/lib/data";

const base = { corrida_id: "c", cluster_id: "k", caso_id: "caso", version_contexto: 1, idempotency_key: "x" };

function tarea(id: string, agente: string, ronda: number, estado: string, intento = 0): Tarea {
  return { ...base, id, agente, ronda, intento, estado, iniciado: "2026-01-31T12:00:00Z", terminado: null };
}

function evento(id: string, tarea_id: string | null, tipo: string, seq: number, tokens = 0): EventoForense {
  return {
    schema_version: "bitacora.v1",
    id,
    corrida_id: "c",
    caso_id: "caso",
    tarea_id,
    seq,
    ts: `2026-01-31T12:00:${String(seq).padStart(2, "0")}Z`,
    tipo_evento: tipo,
    payload: { resumen: tipo === "tool_call" ? "forense_facturas(rfc=X)" : "", referencias: [], operacion_id: null },
    tokens_in: tokens,
    tokens_out: 0,
  };
}

const caso = { id: "caso", estado: "ronda1" } as Caso;

describe("construirArbol", () => {
  it("agrupa especialistas por ronda y deja pendientes las etapas sin tareas", () => {
    const arbol = construirArbol(caso, [tarea("t1", "documental", 1, "completada"), tarea("t2", "financiero", 1, "ejecutando")], []);
    expect(arbol.etapas.map((e) => [e.titulo, e.nodos.length, e.pendiente])).toEqual([
      ["Ronda 1 · especialistas", 2, false],
      ["Auditoría", 0, true],
      ["Defensa", 0, true],
      ["Auditor final", 0, true],
      ["Redacción", 0, true],
    ]);
    expect(arbol.etapaActual).toBe("ronda 1 · especialistas");
    expect(arbol.terminado).toBe(false);
  });

  it("un tool_call sin resultado es el paso en proceso; los tokens se suman de la bitácora", () => {
    const arbol = construirArbol(
      caso,
      [tarea("t2", "financiero", 1, "ejecutando")],
      [evento("1", "t2", "razonamiento", 1, 120), evento("2", "t2", "tool_call", 2, 30), evento("3", null, "ronda_inicio", 0, 5)],
    );
    const nodo = arbol.etapas[0].nodos[0];
    expect(nodo.tokens).toBe(150);
    expect(arbol.tokens).toBe(155);
    expect(nodo.logs.map((l) => [l.nombre, l.ts === null])).toEqual([
      ["Razonamiento", false],
      ["forense_facturas(rfc=X)", true],
    ]);
  });

  it("una tarea completada no inventa paso en proceso y el reintento gana al intento previo", () => {
    const arbol = construirArbol(caso, [tarea("a", "auditor", 3, "error", 0), tarea("b", "auditor", 3, "completada", 1)], [evento("9", "b", "auditoria", 1)]);
    const auditoria = arbol.etapas.find((e) => e.id === "auditor")!;
    expect(auditoria.nodos).toHaveLength(1);
    expect(auditoria.nodos[0]).toMatchObject({ estado: "completada", intento: 1 });
    expect(auditoria.nodos[0].logs.every((l) => l.ts !== null)).toBe(true);
    // Sin `terminado` persistido, el reloj para en el último evento, no sigue contando.
    expect(auditoria.nodos[0].detenido).toBe("2026-01-31T12:00:01Z");
  });

  it("sin caso todavía (202 antes de 'Crear caso') el árbol queda en cola", () => {
    const arbol = construirArbol(null, [], []);
    expect(arbol.etapaActual).toBe("cola");
    expect(arbol.etapas.every((e) => e.pendiente)).toBe(true);
  });
});

describe("formatos", () => {
  it("duracion y tokens", () => {
    const t0 = "2026-01-31T12:00:00Z";
    expect(duracion(t0, Date.parse(t0) + 3_725_000)).toBe("1h 02m 05s");
    expect(duracion(t0, Date.parse(t0) + 65_000)).toBe("1m 05s");
    expect(duracion(null, 0)).toBe("—");
    expect(formatoTokens(18_420)).toBe("18k");
    expect(formatoTokens(1_250)).toBe("1.3k");
    expect(etapaCaso("auditando")).toBe("auditoría");
  });
});
