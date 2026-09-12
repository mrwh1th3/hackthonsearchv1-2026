import { NextResponse } from "next/server";

import { validateContract } from "@/lib/contracts/validate";
import { esquemaRevertir } from "@/lib/document/esquemas";
import { cargarCasoEditor, guardas, repositorio, respuestaNoConfigurado } from "@/lib/document/servidor";

/**
 * `POST /api/reportes/revertir` — 07 §4: "copiar la versión elegida a una nueva
 * tras comprobar estado actual, sin LLM ni borrado". Revertir **crea versión
 * nueva** (09 §8): el historial nunca se destruye.
 *
 * Forma tomada de 07 §4 (`accion='revertir', version_objetivo, version_base,
 * idempotency_key`) más `caso_id`. Sin contrato publicado todavía: esquema
 * local, ver `solicitudes_coordinador`.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const control = await guardas(req, "reportes:revertir", 30);
  if ("error" in control) return control.error;

  const parseo = esquemaRevertir.safeParse(control.ok.body);
  if (!parseo.success) {
    return NextResponse.json({ error: "cuerpo_invalido", detalles: parseo.error.issues }, { status: 422 });
  }

  const repo = repositorio();
  if (!repo) return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(parseo.data.caso_id, repo);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  let resultado;
  try {
    resultado = await repo.revertir(
      parseo.data.caso_id,
      {
        version_objetivo: parseo.data.version_objetivo,
        version_base: parseo.data.version_base,
        idempotency_key: parseo.data.idempotency_key,
      },
      { perfilId: control.ok.session.perfil_id ?? null },
    );
  } catch {
    return NextResponse.json({ error: "persistencia_no_disponible" }, { status: 502 });
  }

  if (!resultado.ok) {
    if (resultado.motivo === "conflicto_version") {
      return NextResponse.json({ error: "conflicto_version", version_actual: resultado.version_actual }, { status: 409 });
    }
    return NextResponse.json({ error: resultado.motivo }, { status: 404 });
  }

  const { reporte, repetido } = resultado.valor;
  const valido = validateContract("editor.reporte", reporte);
  if (!valido.ok) return NextResponse.json({ error: "reporte_invalido", detalles: valido.errors }, { status: 500 });

  return NextResponse.json({
    origen: repo.origen,
    bitacora: repo.dejaBitacora,
    repetido,
    version: reporte.version,
    reporte,
  });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
