// @vitest-environment node
import { describe, expect, it } from "vitest";

import propuestos from "@/lib/document/contratos-propuestos.json";
import {
  esquemaBorrador,
  esquemaDescartar,
  esquemaExportar,
  esquemaRevertir,
} from "@/lib/document/esquemas";

/**
 * Hallazgo 5 del verificador: las cuatro operaciones sin contrato publicado
 * (descartar, revertir, exportar, borrador) se entregan como JSON Schema en
 * `lib/document/contratos-propuestos.json`, para que el coordinador los
 * publique en `contracts/` —ownership suyo, este worktree no lo toca.
 *
 * Esta prueba impide la deriva: mientras el contrato no exista, la validación
 * real la hacen los zod de `esquemas.ts`, y esos zod tienen que decir
 * EXACTAMENTE lo mismo que el schema propuesto. Si alguien añade un campo a
 * uno y no al otro, esto falla.
 */

type Schema = {
  $id: string;
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, unknown>;
};

const catalogo = propuestos as unknown as Record<string, Schema>;

const zodPorId: Record<string, { shape: Record<string, unknown> }> = {
  "editor.descartar": esquemaDescartar as unknown as { shape: Record<string, unknown> },
  "editor.revertir": esquemaRevertir as unknown as { shape: Record<string, unknown> },
  "editor.exportar": esquemaExportar as unknown as { shape: Record<string, unknown> },
  "editor.borrador": esquemaBorrador as unknown as { shape: Record<string, unknown> },
};

describe("contratos propuestos al coordinador", () => {
  it("cada schema de entrada declara $id, additionalProperties:false y campos", () => {
    for (const id of Object.keys(zodPorId)) {
      const schema = catalogo[id];
      expect(`${id}:presente`).toBe(`${id}:${schema ? "presente" : "AUSENTE"}`);
      expect(schema.$id).toBe(id);
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties).length).toBeGreaterThan(0);
    }
  });

  it("los campos del schema propuesto coinciden EXACTAMENTE con el zod que valida hoy", () => {
    for (const [id, zod] of Object.entries(zodPorId)) {
      const schema = catalogo[id];
      const campoZod = Object.keys(zod.shape).sort();
      expect(`${id}:${Object.keys(schema.properties).sort().join(",")}`).toBe(`${id}:${campoZod.join(",")}`);
    }
  });

  it("los required del schema son los campos no opcionales del zod", () => {
    // `editor.exportar.version` es el único opcional de las cuatro entradas.
    expect(catalogo["editor.exportar"].required.sort()).toEqual(["caso_id", "formato"]);
    expect(catalogo["editor.descartar"].required.sort()).toEqual(["caso_id", "idempotency_key", "propuesta_id"]);
    expect(catalogo["editor.revertir"].required.sort()).toEqual([
      "accion",
      "caso_id",
      "idempotency_key",
      "version_base",
      "version_objetivo",
    ]);
    expect(catalogo["editor.borrador"].required.sort()).toEqual(["caso_id", "documento", "version_base"]);

    const sinVersion = esquemaExportar.safeParse({
      caso_id: "00000000-0000-4000-8000-000000000100",
      formato: "md",
    });
    expect(sinVersion.success).toBe(true);
  });

  it("también se proponen las tres respuestas, no solo las entradas", () => {
    expect(Object.keys(catalogo)).toContain("editor.exportado");
    expect(Object.keys(catalogo)).toContain("editor.borrador_guardado");
    expect(Object.keys(catalogo)).toContain("editor.descartado");
  });
});
