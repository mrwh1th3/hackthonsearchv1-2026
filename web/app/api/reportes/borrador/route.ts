import { NextResponse } from "next/server";

import { validateContract } from "@/lib/contracts/validate";
import { guardarBorrador } from "@/lib/document/almacen-demo";
import { estadoCitas } from "@/lib/document/citas";
import { normalizarDocumento } from "@/lib/document/documento";
import { esquemaBorrador } from "@/lib/document/esquemas";
import { cargarCasoEditor, guardas, modoBackend, origenDe, respuestaNoConfigurado } from "@/lib/document/servidor";

/**
 * `POST /api/reportes/borrador` — autoguardado (15 §10).
 *
 * **No crea versión.** Guarda el borrador de la edición humana contra su
 * `version_base`; si esa versión ya no es la vigente, responde 409 con la
 * versión actual y el cliente CONSERVA su borrador (nunca se sobrescribe con
 * el servidor). Solo Aplicar y revertir versionan.
 *
 * El borrador se conserva aunque tenga citas por revisar; solo una versión
 * validada es entregable final (09 §8). Sin contrato publicado para esta
 * operación: esquema local (ver `solicitudes_coordinador`).
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const control = await guardas(req, "reportes:borrador", 240);
  if ("error" in control) return control.error;

  const parseo = esquemaBorrador.safeParse(control.ok.body);
  if (!parseo.success) {
    return NextResponse.json({ error: "cuerpo_invalido", detalles: parseo.error.issues }, { status: 422 });
  }

  const modo = modoBackend();
  if (modo === "no_configurado") return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(parseo.data.caso_id);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  // El documento llega del editor del navegador: se normaliza y se valida
  // contra el contrato ANTES de guardarlo.
  const documento = normalizarDocumento(parseo.data.documento);
  const validacion = validateContract("editor.documento", documento);
  if (!validacion.ok) {
    return NextResponse.json({ error: "documento_invalido", detalles: validacion.errors }, { status: 422 });
  }

  const resultado = guardarBorrador(parseo.data.caso_id, {
    version_base: parseo.data.version_base,
    documento,
  });

  if (!resultado.ok) {
    if (resultado.motivo === "conflicto_version") {
      return NextResponse.json({ error: "conflicto_version", version_actual: resultado.version_actual }, { status: 409 });
    }
    return NextResponse.json({ error: resultado.motivo }, { status: 404 });
  }

  const citas = estadoCitas(documento, caso.referenciasValidadas);
  return NextResponse.json({
    origen: origenDe(modo),
    guardado: resultado.valor.guardado,
    version_base: resultado.valor.version_base,
    content_hash: resultado.valor.content_hash,
    revisar_citas: citas.revisarCitas,
    citas_invalidas: citas.invalidas,
  });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
