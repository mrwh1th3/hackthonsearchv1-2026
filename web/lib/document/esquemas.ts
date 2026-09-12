import { z } from "zod";

/**
 * Esquemas locales de las operaciones del editor que **no** tienen contrato
 * publicado en `contracts/release.json` v1.2.0.
 *
 * El release define `editor.solicitud`, `editor.propuesta`, `editor.patch`,
 * `editor.aplicar`, `editor.reporte`, `editor.documento/block/text/mark`. No
 * define descartar, revertir, exportar ni el autoguardado de borrador, aunque
 * 07 §4 y 15 §10-11 los exigen. Mientras el coordinador no publique esas
 * formas (ver `solicitudes_coordinador`), viven aquí, dentro de la ownership
 * de forense-editor, y NO se añade nada a `contracts/`.
 *
 * Las rutas que sí tienen contrato validan con ajv contra el schema real
 * (`lib/contracts/validate.ts`), nunca con estos esquemas.
 */

const RE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const uuid = z.string().regex(RE_UUID, "uuid inválido");
const version = z.number().int().min(1).max(2147483647);

export const esquemaDescartar = z
  .object({
    caso_id: uuid,
    propuesta_id: uuid,
    idempotency_key: uuid,
  })
  .strict();

/** 07 §4: `accion='revertir', version_objetivo, version_base, idempotency_key`. */
export const esquemaRevertir = z
  .object({
    caso_id: uuid,
    accion: z.literal("revertir"),
    version_objetivo: version,
    version_base: version,
    idempotency_key: uuid,
  })
  .strict();

export const esquemaExportar = z
  .object({
    caso_id: uuid,
    version: version.optional(),
    formato: z.enum(["md", "json"]),
  })
  .strict();

/** Autoguardado (15 §10): conserva borrador, nunca crea versión. */
export const esquemaBorrador = z
  .object({
    caso_id: uuid,
    version_base: version,
    documento: z.unknown(),
  })
  .strict();

export type EntradaDescartar = z.infer<typeof esquemaDescartar>;
export type EntradaRevertir = z.infer<typeof esquemaRevertir>;
export type EntradaExportar = z.infer<typeof esquemaExportar>;
export type EntradaBorrador = z.infer<typeof esquemaBorrador>;
