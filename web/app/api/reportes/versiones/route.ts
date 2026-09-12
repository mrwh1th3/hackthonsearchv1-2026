import { NextResponse } from "next/server";

import { versiones } from "@/lib/document/almacen-demo";
import { cargarCasoEditor, guardas, modoBackend, origenDe, respuestaNoConfigurado } from "@/lib/document/servidor";

/**
 * `GET /api/reportes/versiones?caso_id=…` — historial de versiones del
 * expediente (09 §8: "Historial de versiones con diff").
 *
 * Devuelve metadatos y Markdown derivado de cada versión para que `VersionDiff`
 * compare dos sin recalcular nada en el cliente. Sobre el almacén de
 * demostración mientras no exista la tabla real (ver `almacen-demo.ts`).
 */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const control = await guardas(req, "reportes:versiones", 120);
  if ("error" in control) return control.error;

  const casoId = new URL(req.url).searchParams.get("caso_id");
  if (!casoId) return NextResponse.json({ error: "caso_id_requerido" }, { status: 400 });

  const modo = modoBackend();
  if (modo === "no_configurado") return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(casoId);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  return NextResponse.json({
    origen: origenDe(modo),
    versiones: versiones(casoId).map((v) => ({
      version: v.version,
      autor: v.autor,
      estado_revision: v.estado_revision,
      creado: v.creado,
      content_hash: v.content_hash,
      markdown: v.markdown,
    })),
  });
}

export async function POST() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
