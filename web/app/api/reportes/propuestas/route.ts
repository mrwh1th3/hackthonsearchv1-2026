import { NextResponse } from "next/server";

import { validateContract } from "@/lib/contracts/validate";
import { borradorActual, registrarPropuesta } from "@/lib/document/almacen-demo";
import { indexarBloques } from "@/lib/document/documento";
import { verificarSeleccion } from "@/lib/document/seleccion";
import { construirPropuesta, salidaEditorDemostracion } from "@/lib/document/propuesta";
import {
  cargarCasoEditor,
  guardas,
  modoPropuesta,
  nuevoUuid,
  origenDe,
  reenviarAWebhook,
  repositorio,
  respuestaNoConfigurado,
} from "@/lib/document/servidor";
import type { SalidaEditor, SolicitudEdicion } from "@/lib/document/tipos";

/**
 * `POST /api/reportes/propuestas` — chat del expediente (15 §10, 07 §4).
 *
 * Entrada: `editor.solicitud` (contrato v1.2.0, `additionalProperties:false`).
 * Una **pregunta** devuelve solo mensaje y no crea versión; una **propuesta**
 * devuelve `editor.propuesta` con patch/diff/citas y tampoco crea versión:
 * eso lo hace Aplicar (CLAUDE.md regla 11).
 */

// ajv compila código en tiempo de ejecución: Node.js, nunca Edge.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const control = await guardas(req, "reportes:propuestas", 40);
  if ("error" in control) return control.error;

  const validacion = validateContract("editor.solicitud", control.ok.body);
  if (!validacion.ok) {
    return NextResponse.json({ error: "contrato_invalido", detalles: validacion.errors }, { status: 422 });
  }
  const solicitud = control.ok.body as SolicitudEdicion;

  // Antes de tocar la fuente de datos: sin backend de agentes ni fuente de
  // fixtures no hay respuesta que dar (no se finge una).
  const modo = modoPropuesta();
  if (modo === "no_configurado") return respuestaNoConfigurado();

  // Una propuesta se calcula contra el expediente persistido: sin repositorio
  // no hay versión base que leer ni propuesta que guardar (503, no invención).
  const repo = repositorio();
  if (!repo) return respuestaNoConfigurado();

  const caso = await cargarCasoEditor(solicitud.caso_id, repo);
  if (!caso) return NextResponse.json({ error: "caso_no_encontrado" }, { status: 404 });

  // Control optimista: la propuesta se calcula contra la versión vigente.
  if (caso.versionActual.version !== solicitud.version_base) {
    return NextResponse.json(
      { error: "conflicto_version", version_actual: caso.versionActual.version },
      { status: 409 },
    );
  }
  // La propuesta se calcula sobre lo que el usuario está viendo: el borrador
  // autoguardado de esta `version_base` si existe, y la versión almacenada si
  // no. Sin esto, un bloque escrito en esta sesión (id `blk-n…`, ausente de la
  // versión guardada) no podría seleccionarse —409 `seleccion_desplazada`— y
  // Aplicar descartaría en silencio la edición manual del borrador.
  const borrador = borradorActual(solicitud.caso_id);
  const documento =
    borrador && borrador.version_base === solicitud.version_base ? borrador.documento : caso.versionActual.contenido_json;

  // La selección se verifica contra la versión base: si los bloques ya no
  // existen, se pide reconfirmar la selección actual (07 §4 paso 3).
  let seleccionVerificada: boolean | undefined;
  if (solicitud.seleccion) {
    const indice = indexarBloques(documento);
    const faltantes = solicitud.seleccion.block_ids.filter((id) => !indice.has(id));
    if (faltantes.length > 0) {
      return NextResponse.json(
        { error: "seleccion_desplazada", bloques: faltantes, version_actual: caso.versionActual.version },
        { status: 409 },
      );
    }
    // Y el `texto_hash` se contrasta con el contenido real de esos bloques
    // (07 §4 nodo 6). Solo se rechaza cuando el desplazamiento se PUEDE
    // probar; si no cabe en el presupuesto o la selección toca contenedores,
    // se sigue adelante declarando que no se verificó.
    const verificacion = verificarSeleccion(documento, solicitud.seleccion);
    if (verificacion.estado === "desplazada") {
      return NextResponse.json(
        {
          error: "seleccion_desplazada",
          motivo: "texto_hash",
          bloques: solicitud.seleccion.block_ids,
          version_actual: caso.versionActual.version,
        },
        { status: 409 },
      );
    }
    seleccionVerificada = verificacion.estado === "verificada";
  }

  let salida: SalidaEditor;
  if (modo === "webhook") {
    // 07 §4: el BFF normaliza y reenvía; el agente Editor devuelve
    // `{modo, mensaje, contenido?}`. Si el backend falla, se informa: no se
    // sustituye por una respuesta inventada.
    let respuesta: Response;
    try {
      respuesta = await reenviarAWebhook("/editar", {
        caso_id: solicitud.caso_id,
        instruccion: solicitud.mensaje,
        seleccion: solicitud.seleccion,
        version_base: solicitud.version_base,
        directriz_id: solicitud.directriz_id,
        modo: solicitud.modo,
        evidencia_ids: solicitud.evidencia_ids,
        idempotency_key: solicitud.idempotency_key,
      });
    } catch {
      return NextResponse.json({ error: "backend_no_disponible" }, { status: 502 });
    }
    if (!respuesta.ok) {
      return NextResponse.json({ error: "backend_rechazo", status: respuesta.status }, { status: 502 });
    }
    const cuerpo = (await respuesta.json()) as unknown;
    const salidaValida = validateContract("agents.editor", cuerpo);
    if (!salidaValida.ok) {
      return NextResponse.json({ error: "salida_invalida", detalles: salidaValida.errors }, { status: 502 });
    }
    salida = cuerpo as SalidaEditor;
  } else {
    salida =
      solicitud.modo === "pregunta"
        ? { modo: "respuesta", mensaje: salidaEditorDemostracion({ mensajeUsuario: solicitud.mensaje, documento }).mensaje }
        : salidaEditorDemostracion({ mensajeUsuario: solicitud.mensaje, documento, seleccion: solicitud.seleccion });
  }

  const origen = origenDe(modo);

  // Una pregunta nunca modifica el documento (09 §8).
  if (solicitud.modo === "pregunta" || salida.modo === "respuesta") {
    return NextResponse.json({
      origen,
      modo: "pregunta",
      mensaje: salida.mensaje,
      version_base: solicitud.version_base,
      seleccion_verificada: seleccionVerificada,
    });
  }

  const propuestaId = nuevoUuid();
  const resultado = construirPropuesta({
    propuestaId,
    versionBase: solicitud.version_base,
    documento,
    salida,
    seleccion: solicitud.seleccion,
    referenciasValidadas: caso.referenciasValidadas,
  });

  if (resultado.tipo === "respuesta") {
    return NextResponse.json({ origen, modo: "pregunta", mensaje: resultado.mensaje, version_base: solicitud.version_base });
  }
  if (resultado.tipo === "rechazo") {
    return NextResponse.json({ error: resultado.motivo, detalle: resultado.detalle, origen }, { status: 422 });
  }

  const propuestaValida = validateContract("editor.propuesta", resultado.propuesta);
  if (!propuestaValida.ok) {
    // Nunca se devuelve algo que no cumple el contrato publicado.
    return NextResponse.json({ error: "propuesta_invalida", detalles: propuestaValida.errors }, { status: 500 });
  }

  registrarPropuesta(solicitud.caso_id, resultado.propuesta, resultado.previsualizacion);

  return NextResponse.json({
    origen,
    modo: "propuesta",
    propuesta: resultado.propuesta,
    advertencias: resultado.advertencias,
    seleccion_verificada: seleccionVerificada,
  });
}

export async function GET() {
  return NextResponse.json({ error: "metodo_no_permitido" }, { status: 405 });
}
