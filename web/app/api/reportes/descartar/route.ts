import { NextResponse } from "next/server";

import { esquemaDescartar } from "@/lib/document/esquemas";
import { cargarCasoEditor, guardas, repositorio, respuestaNoConfigurado } from "@/lib/document/servidor";

/**
 * `POST /api/reportes/descartar` — 07 §4: "Descartar registra estado sin crear
 * versión". El documento queda exactamente como estaba.
 *
 * No hay contrato publicado para esta operación en `contracts/release.json`
 * v1.2.0 (solo `editor.solicitud`/`propuesta`/`aplicar`/`reporte`): se valida
 * con el esquema local de `lib/document/esquemas.ts` y se pide la forma
 * canónica al coordinador (ver `solicitudes_coordinador`).
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const control = await guardas(req, "reportes:descartar", 60);
  if ("error" in control) return control.error;

  const parseo = esquemaDescartar.safeParse(control.ok.body);
  if (!parseo.success) {
    return NextResponse.json({ error: "cuerpo_invalido", detalles: parseo.error.issues }, { status: 422 });
  }

  const repo = repositorio();
  if (!repo) return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(parseo.data.caso_id, repo);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  let resultado;
  try {
    resultado = await repo.descartar(parseo.data.caso_id, parseo.data.propuesta_id);
  } catch {
    return NextResponse.json({ error: "persistencia_no_disponible" }, { status: 502 });
  }
  if (!resultado.ok) return NextResponse.json({ error: resultado.motivo }, { status: 404 });

  return NextResponse.json({
    origen: repo.origen,
    // CLAUDE.md regla 2: se declara si este descarte dejó evento `edicion`
    // (con `payload.evento_real='propuesta_descartada'`) en `forense.bitacora`.
    bitacora: resultado.valor.bitacora,
    propuesta_id: parseo.data.propuesta_id,
    estado: resultado.valor.estado,
    version_actual: caso.versionActual.version,
  });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
