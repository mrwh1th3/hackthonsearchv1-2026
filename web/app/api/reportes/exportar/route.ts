import { NextResponse } from "next/server";

import { contractVersion } from "@/lib/contracts/validate";
import { citasDeMarkdown, estadoCitas } from "@/lib/document/citas";
import { esquemaExportar } from "@/lib/document/esquemas";
import { cargarCasoEditor, guardas, repositorio, respuestaNoConfigurado } from "@/lib/document/servidor";

/**
 * `POST /api/reportes/exportar` — Markdown y JSON del expediente (15 §11).
 *
 * Cada descarga lleva nombre legible, ID, versión, fecha, origen y hash del
 * contenido. El PDF no se genera aquí: se imprime la hoja A4 con CSS de
 * impresión desde el navegador (15 §10-11), sin añadir una segunda biblioteca.
 *
 * El Markdown se DERIVA del JSON canónico en el momento de crear la versión
 * (ambos se guardan en la misma operación), así que exportar no puede perder
 * citas: la prueba compara los dos conjuntos de referencias.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const control = await guardas(req, "reportes:exportar", 40);
  if ("error" in control) return control.error;

  const parseo = esquemaExportar.safeParse(control.ok.body);
  if (!parseo.success) {
    return NextResponse.json({ error: "cuerpo_invalido", detalles: parseo.error.issues }, { status: 422 });
  }

  const repo = repositorio();
  if (!repo) return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(parseo.data.caso_id, repo);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  let reporte;
  try {
    reporte = parseo.data.version
      ? await repo.obtenerVersion(parseo.data.caso_id, parseo.data.version)
      : await repo.versionActual(parseo.data.caso_id);
  } catch {
    return NextResponse.json({ error: "persistencia_no_disponible" }, { status: 502 });
  }
  if (!reporte) return NextResponse.json({ error: "version_inexistente" }, { status: 404 });

  const citas = estadoCitas(reporte.contenido_json, caso.referenciasValidadas);
  const manifiesto = {
    caso_id: reporte.caso_id,
    rfc_principal: caso.rfc,
    version: reporte.version,
    estado_revision: reporte.estado_revision,
    autor: reporte.autor,
    creado: reporte.creado,
    generado: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    origen: repo.origen,
    contratos: `v${contractVersion}`,
    content_hash: reporte.content_hash,
    citas_totales: citas.total,
    citas_sin_evidencia: citas.invalidas,
    nota:
      citas.invalidas.length > 0
        ? "Citations need review before this report can be delivered."
        : "Citations checked against validated dataset evidence.",
  };

  const nombreBase = `expediente-${caso.rfc}-v${reporte.version}`;

  if (parseo.data.formato === "md") {
    const encabezado = [
      `<!-- ${nombreBase} -->`,
      `<!-- caso ${reporte.caso_id} · version ${reporte.version} · ${reporte.creado} -->`,
      `<!-- contenido ${reporte.content_hash} · contratos v${contractVersion} · origen ${manifiesto.origen} -->`,
      "",
    ].join("\n");
    const contenido = `${encabezado}${reporte.markdown}\n`;
    return NextResponse.json({
      formato: "md",
      nombre: `${nombreBase}.md`,
      mime: "text/markdown;charset=utf-8",
      contenido,
      manifiesto,
      // Comprobación explícita: el Markdown exportado conserva las citas del JSON.
      citas: citasDeMarkdown(contenido),
    });
  }

  const contenido = `${JSON.stringify({ manifiesto, reporte }, null, 2)}\n`;
  return NextResponse.json({
    formato: "json",
    nombre: `${nombreBase}.json`,
    mime: "application/json",
    contenido,
    manifiesto,
    citas: citasDeMarkdown(reporte.markdown),
  });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
