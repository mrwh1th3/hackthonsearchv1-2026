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

  // Se devuelven los reportes completos (`editor.reporte`), con
  // `contenido_json`: el editor los usa para adoptar la versión vigente al
  // montar —una recarga tras Aplicar volvería a montar en v1 y toda escritura
  // chocaría en 409— y para el diff del historial, sin una segunda petición.
  return NextResponse.json({ origen: origenDe(modo), versiones: versiones(casoId) });
}

export async function POST() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
