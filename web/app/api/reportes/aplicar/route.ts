import { NextResponse } from "next/server";

import { validateContract } from "@/lib/contracts/validate";
import { estadoCitas } from "@/lib/document/citas";
import { cargarCasoEditor, guardas, repositorio, respuestaNoConfigurado } from "@/lib/document/servidor";
import type { SolicitudAplicar } from "@/lib/document/tipos";

/**
 * `POST /api/reportes/aplicar?caso_id=…` — crea la versión nueva.
 *
 * 07 §4 paso 5: Aplicar es **operación determinista del BFF** (verifica
 * propuesta y `version_base`, escribe JSON TipTap + Markdown derivado en la
 * misma operación, marca la propuesta aplicada). No pasa por el LLM.
 *
 * `editor.aplicar` es `additionalProperties:false` y no lleva `caso_id`: el
 * caso viaja en la query string, nunca en el cuerpo (un campo extra sería 422).
 *
 * Idempotencia: mismo `idempotency_key` o propuesta ya aplicada devuelven la
 * MISMA versión — el doble click no crea dos.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const control = await guardas(req, "reportes:aplicar", 60);
  if ("error" in control) return control.error;

  const casoId = new URL(req.url).searchParams.get("caso_id");
  if (!casoId) return NextResponse.json({ error: "caso_id_requerido" }, { status: 400 });

  const validacion = validateContract("editor.aplicar", control.ok.body);
  if (!validacion.ok) {
    return NextResponse.json({ error: "contrato_invalido", detalles: validacion.errors }, { status: 422 });
  }
  const solicitud = control.ok.body as SolicitudAplicar;

  // Sin repositorio NO se acepta la escritura: 503 y el cliente conserva su
  // borrador. La memoria del proceso nunca se hace pasar por persistencia.
  const repo = repositorio();
  if (!repo) return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(casoId, repo);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  let resultado;
  try {
    resultado = await repo.aplicar(
      casoId,
      {
        propuesta_id: solicitud.propuesta_id,
        version_base: solicitud.version_base,
        idempotency_key: solicitud.idempotency_key,
      },
      { perfilId: control.ok.session.perfil_id ?? null },
    );
  } catch {
    return NextResponse.json({ error: "persistencia_no_disponible" }, { status: 502 });
  }

  if (!resultado.ok) {
    if (resultado.motivo === "conflicto_version") {
      // 15 §10: el conflicto conserva el borrador del cliente y exige
      // reconfirmación explícita; el servidor no reintenta solo.
      return NextResponse.json(
        { error: "conflicto_version", version_actual: resultado.version_actual },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: resultado.motivo }, { status: 404 });
  }

  const { reporte, repetido } = resultado.valor;
  const validoReporte = validateContract("editor.reporte", reporte);
  if (!validoReporte.ok) {
    return NextResponse.json({ error: "reporte_invalido", detalles: validoReporte.errors }, { status: 500 });
  }

  const citas = estadoCitas(reporte.contenido_json, caso.referenciasValidadas);

  return NextResponse.json({
    origen: repo.origen,
    // CLAUDE.md regla 2: se declara si esta escritura dejó evento `edicion`
    // en `forense.bitacora`. El modo fixture nunca lo afirma.
    bitacora: repo.dejaBitacora,
    repetido,
    version: reporte.version,
    reporte,
    // "revisar citas" bloquea la publicación final, no la conservación (15 §10).
    revisar_citas: citas.revisarCitas,
    citas_invalidas: citas.invalidas,
  });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
