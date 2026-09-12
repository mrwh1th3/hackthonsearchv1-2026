import { createTwoFilesPatch } from "diff";

import { citasDeDocumento, extraerCitas } from "./citas";
import { clonar, esBloqueTexto, hashBloque, hashDocumento, indexarBloques, normalizarDocumento } from "./documento";
import { aMarkdown, desdeMarkdown, inlineDesdeTexto } from "./markdown";
import { aplicarPatch } from "./patch";
import { bloquesProtegidos, construirIndice, normalizarTitulo } from "./secciones";
import type { Bloque, Documento, Patch, Propuesta, SalidaEditor, Seleccion } from "./tipos";

/**
 * De la salida del agente Editor a una propuesta determinista.
 *
 * 07 §4: el Editor devuelve `{modo, mensaje, contenido?}` con
 * `fragmento|documento|respuesta`; el patch, el diff y las citas los arma el
 * backend, no el modelo. Una propuesta **no** cambia el expediente: solo
 * Aplicar crea versión (CLAUDE.md regla 11).
 *
 * El texto del documento es DATO, no instrucción (CLAUDE.md regla 6 y 17 §7:
 * "Texto del documento es dato, no system prompt"): aquí solo se transforma,
 * nunca se obedece.
 */

const LIMITE_DIFF = 80000; // editor.propuesta.diff maxLength

export interface ResultadoRespuesta {
  tipo: "respuesta";
  mensaje: string;
}

export interface ResultadoPropuesta {
  tipo: "propuesta";
  propuesta: Propuesta;
  /** Documento resultante si se aplicara (para previsualizar, no se persiste). */
  previsualizacion: Documento;
  advertencias: Advertencia[];
}

export interface ResultadoRechazo {
  tipo: "rechazo";
  motivo: MotivoRechazo;
  detalle: string;
}

export type MotivoRechazo =
  | "seleccion_requerida"
  | "seleccion_desplazada"
  | "bloque_no_encontrado"
  | "contenido_vacio"
  | "citas_no_autorizadas"
  | "seccion_protegida"
  | "cambio_de_nivel"
  | "patch_no_aplicable";

export interface Advertencia {
  codigo: "monto_nuevo" | "cita_sin_evidencia";
  detalle: string;
}

export type ResultadoEditor = ResultadoRespuesta | ResultadoPropuesta | ResultadoRechazo;

const NIVELES = [
  "presuncion_alta",
  "presuncion alta",
  "presunción alta",
  "presuncion",
  "presunción",
  "anomalia_explicada",
  "anomalia explicada",
  "anomalía explicada",
  "no_concluyente",
  "no concluyente",
  "sin_hallazgos",
  "sin hallazgos",
] as const;

function nivelesMencionados(texto: string): string[] {
  const normalizado = normalizarTitulo(texto);
  return NIVELES.filter((n) => normalizado.includes(normalizarTitulo(n))).map((n) => normalizarTitulo(n));
}

function textoDictamen(documento: Documento): string {
  const indice = construirIndice(documento);
  const dictamen = indice.find((e) => e.clave === "dictamen" && e.estado === "presente");
  if (!dictamen?.blockId) return "";
  const bloques = documento.content;
  const inicio = bloques.findIndex((b) => b.attrs.id === dictamen.blockId);
  if (inicio === -1) return "";
  const partes: string[] = [];
  for (let i = inicio; i < bloques.length; i += 1) {
    const bloque = bloques[i];
    if (i > inicio && bloque.type === "heading") break;
    partes.push(esBloqueTexto(bloque) ? bloque.content.map((t) => t.text).join("") : "");
  }
  return partes.join(" ");
}

const RE_NUMERO = /\d[\d.,]*/g;

function numerosDe(texto: string): Set<string> {
  return new Set((texto.match(RE_NUMERO) ?? []).map((n) => n.replace(/[.,]$/, "")));
}

/** Diff unificado del Markdown derivado: lo que ve el humano antes de Aplicar. */
export function construirDiff(antes: Documento, despues: Documento): string {
  const diff = createTwoFilesPatch(
    "expediente (versión base)",
    "expediente (propuesta)",
    `${aMarkdown(antes)}\n`,
    `${aMarkdown(despues)}\n`,
    undefined,
    undefined,
    { context: 3 },
  );
  return diff.length > LIMITE_DIFF ? `${diff.slice(0, LIMITE_DIFF - 40)}\n… diff truncado por tamaño …` : diff;
}

export interface ArgsPropuesta {
  propuestaId: string;
  versionBase: number;
  documento: Documento;
  salida: SalidaEditor;
  seleccion?: Seleccion;
  /** Referencias con evidencia validada: una propuesta no puede introducir otras. */
  referenciasValidadas: ReadonlySet<string>;
}

export function construirPropuesta(args: ArgsPropuesta): ResultadoEditor {
  const { propuestaId, versionBase, documento, salida, seleccion, referenciasValidadas } = args;

  if (salida.modo === "respuesta") {
    // 09 §8: una pregunta solo crea un mensaje; no toca el documento.
    return { tipo: "respuesta", mensaje: salida.mensaje };
  }

  const contenido = (salida.contenido ?? "").trim();
  if (contenido.length === 0) return { tipo: "rechazo", motivo: "contenido_vacio", detalle: "El Editor no devolvió contenido para una propuesta de edición." };

  const protegidos = bloquesProtegidos(documento);
  const patch: Patch[] = [];

  if (salida.modo === "documento") {
    const nuevo = desdeMarkdown(contenido);
    patch.push({ op: "replace_document", before_hash: hashDocumento(documento), after: nuevo });
  } else {
    if (!seleccion || seleccion.block_ids.length === 0) {
      return { tipo: "rechazo", motivo: "seleccion_requerida", detalle: "Una propuesta de fragmento exige selección con bloques." };
    }
    const indice = indexarBloques(documento);
    const objetivo = indice.get(seleccion.block_ids[0]);
    if (!objetivo) {
      return { tipo: "rechazo", motivo: "bloque_no_encontrado", detalle: `El bloque ${seleccion.block_ids[0]} ya no existe en esta versión.` };
    }
    if (!esBloqueTexto(objetivo)) {
      return { tipo: "rechazo", motivo: "bloque_no_encontrado", detalle: "La selección apunta a un contenedor; selecciona un párrafo o encabezado." };
    }
    const reemplazo: Bloque = { ...clonar(objetivo), content: inlineDesdeTexto(contenido) };
    patch.push({ op: "replace_block", block_id: objetivo.attrs.id, before_hash: hashBloque(objetivo), after: reemplazo });

    // Bloques adicionales de la selección: se eliminan salvo encabezados
    // (protegen las secciones fijas del expediente; 08 §Redactor, 21 §4).
    for (const id of seleccion.block_ids.slice(1)) {
      const extra = indice.get(id);
      if (!extra || extra.type === "heading") continue;
      if (protegidos.has(id)) continue;
      patch.push({ op: "remove_block", block_id: id, before_hash: hashBloque(extra) });
    }
  }

  const aplicado = aplicarPatch(documento, patch, { protegidos });
  if (!aplicado.ok) {
    return {
      tipo: "rechazo",
      motivo: aplicado.motivo === "bloque_protegido" ? "seccion_protegida" : "patch_no_aplicable",
      detalle: `El patch no es aplicable sobre la versión base (${aplicado.motivo}).`,
    };
  }
  const previsualizacion = normalizarDocumento(aplicado.documento);

  // --- Validaciones del paso 3 de 07 §4 -----------------------------------
  const citasBase = new Set(citasDeDocumento(documento));
  const citasNuevas = citasDeDocumento(previsualizacion).filter((c) => !citasBase.has(c));
  const noAutorizadas = citasNuevas.filter((c) => !referenciasValidadas.has(c));
  if (noAutorizadas.length > 0) {
    return {
      tipo: "rechazo",
      motivo: "citas_no_autorizadas",
      detalle: `La propuesta introduce referencias sin evidencia validada: ${noAutorizadas.join(", ")}.`,
    };
  }

  const indiceDespues = construirIndice(previsualizacion);
  const faltantes = construirIndice(documento)
    .filter((e) => e.estado === "presente" && e.protegida)
    .filter((e) => !indiceDespues.some((d) => d.clave === e.clave && d.estado === "presente"));
  if (faltantes.length > 0) {
    return {
      tipo: "rechazo",
      motivo: "seccion_protegida",
      detalle: `La propuesta elimina secciones que no pueden faltar: ${faltantes.map((f) => f.titulo).join(", ")}.`,
    };
  }

  const nivelAntes = nivelesMencionados(textoDictamen(documento));
  const nivelDespues = nivelesMencionados(textoDictamen(previsualizacion));
  const cambioNivel =
    nivelAntes.length !== nivelDespues.length || nivelAntes.some((n, i) => n !== nivelDespues[i]);
  if (cambioNivel) {
    return {
      tipo: "rechazo",
      motivo: "cambio_de_nivel",
      detalle: "El nivel lo fija el dictamen determinista (CLAUDE.md regla 4): una edición no puede cambiarlo.",
    };
  }

  // Montos: se avisa, no se bloquea (una reescritura legítima puede reordenar
  // cifras). El número nuevo queda "pendiente de validación", nunca se
  // presenta como hecho verificado (15 §10).
  const advertencias: Advertencia[] = [];
  const numerosBase = numerosDe(aMarkdown(documento));
  for (const numero of numerosDe(contenido)) {
    if (!numerosBase.has(numero)) {
      advertencias.push({ codigo: "monto_nuevo", detalle: `La propuesta introduce la cifra ${numero}, que no está en la versión base: queda pendiente de validación.` });
    }
  }
  for (const cita of extraerCitas(contenido)) {
    if (!referenciasValidadas.has(cita)) {
      advertencias.push({ codigo: "cita_sin_evidencia", detalle: `La cita ${cita} no tiene evidencia validada en esta corrida.` });
    }
  }

  const propuesta: Propuesta = {
    propuesta_id: propuestaId,
    version_base: versionBase,
    mensaje: salida.mensaje,
    patch,
    diff: construirDiff(documento, previsualizacion),
    citas: [...new Set(extraerCitas(contenido))],
  };

  return { tipo: "propuesta", propuesta, previsualizacion, advertencias };
}

/**
 * Salida determinista de demostración cuando no hay backend de agentes
 * configurado (`N8N_WEBHOOK_BASE` ausente y fuente de datos = fixture).
 * NO es un modelo: es una transformación fija y etiquetada como tal en la
 * respuesta del BFF (`origen: "fixture"`), para que la UI lo declare.
 */
export function salidaEditorDemostracion(args: {
  mensajeUsuario: string;
  documento: Documento;
  seleccion?: Seleccion;
}): SalidaEditor {
  const { mensajeUsuario, documento, seleccion } = args;
  if (!seleccion || seleccion.block_ids.length === 0) {
    return {
      modo: "respuesta",
      mensaje:
        "Respuesta de demostración (sin agente Editor configurado): esta sección se apoya en la evidencia citada del expediente. Selecciona texto para proponer una edición.",
    };
  }
  const indice = indexarBloques(documento);
  const objetivo = indice.get(seleccion.block_ids[0]);
  const textoActual = objetivo && esBloqueTexto(objetivo) ? objetivo.content.map((t) => t.text).join("") : "";
  const citas = extraerCitas(textoActual);
  const sinCitas = textoActual.replace(/\s*\[[^\]]+\]/g, "").trim();
  const sufijo = citas.length > 0 ? ` ${citas.map((c) => `[${c}]`).join(" ")}` : "";
  return {
    modo: "fragmento",
    mensaje: `Propuesta determinista de demostración para: "${mensajeUsuario.slice(0, 160)}". Conserva las citas del fragmento.`,
    contenido: `${sinCitas}${sinCitas.endsWith(".") ? "" : "."} Redacción revisada para mayor claridad.${sufijo}`,
  };
}
