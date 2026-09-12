// integrations/elevenlabs/callback.mjs — Callback post-llamada → estado + evaluación (16 §2, §3, §4).
//
// Mapea SOLO hechos realmente recibidos: si el proveedor no manda un tipo
// reconocido, el estado destino es 'resultado_desconocido', nunca se infiere
// "Sonando" ni "entregado" sin evidencia (16 línea 27, línea 88).

import { verificarFirma } from './hmac.mjs';
import { registrarCallback } from './dedupe.mjs';
import { transicionarEstado } from './estados.mjs';

const MAPA_TIPO_A_ESTADO = Object.freeze({
  initiated: 'aceptada',
  ringing: 'en_curso',
  in_progress: 'en_curso',
  completed: 'finalizada',
  failed: 'fallida',
  no_answer: 'sin_respuesta',
  busy: 'sin_respuesta',
});

function leerBooleano(valor) {
  return typeof valor === 'boolean' ? valor : null;
}

/**
 * Traduce el cuerpo YA VERIFICADO del callback a estado + los tres campos de
 * evaluación de 16 §4. `null` significa "sin evidencia" (desconocido), nunca
 * se rellena con `false` por defecto — una ausencia no es una negación.
 */
export function resultadoDesdeCallback(evento) {
  const tipo = evento?.type ?? evento?.status ?? null;
  const estado = MAPA_TIPO_A_ESTADO[tipo] ?? 'resultado_desconocido';
  const analysis = evento?.analysis ?? {};

  // Acepta el nombre de campo de 16 §4 (aviso_entregado) y, por compatibilidad,
  // el que usa n8n/runtime/voz-adaptador.mjs (aviso_confirmado); el primero gana.
  let avisoEntregado = leerBooleano(
    analysis.aviso_entregado !== undefined ? analysis.aviso_entregado : analysis.aviso_confirmado,
  );
  // Una llamada que no llegó a 'finalizada' no puede reclamar entrega, sin
  // importar qué diga el análisis: no hay evidencia de que el mensaje se dijo.
  if (avisoEntregado === true && estado !== 'finalizada') avisoEntregado = null;

  return {
    estado,
    aviso_entregado: avisoEntregado,
    solicita_no_llamar: leerBooleano(analysis.solicita_no_llamar),
    numero_equivocado: leerBooleano(analysis.numero_equivocado),
    conversation_id: evento?.conversation_id ?? null,
    call_sid: evento?.call_sid ?? evento?.callSid ?? null,
  };
}

/**
 * Alias de compatibilidad con n8n/runtime/voz-adaptador.mjs (mismo nombre,
 * misma forma reducida `{estado, aviso_entregado}`). Difiere del stub en que
 * `aviso_entregado` ausente es `null` (desconocido) y no `false`: 16 línea 88
 * exige tratar la falta de evidencia como desconocida, no como negada — y
 * `product.llamada.aviso_entregado` en contracts es `boolean|null`, no solo
 * boolean, así que `null` es la representación correcta del contrato.
 */
export function estadoDesdeCallback(evento) {
  const { estado, aviso_entregado } = resultadoDesdeCallback(evento);
  return { estado, aviso_entregado };
}

/**
 * Pipeline completo de un callback entrante: verifica firma sobre el cuerpo
 * CRUDO, deduplica por conversation_id/call_sid (o event_id si el proveedor
 * no manda ninguno) y aplica la transición de estado. Nunca lanza por un
 * callback inválido/duplicado/tardío: siempre responde `{aceptado, motivo}`
 * para que el workflow decida el código HTTP sin caerse (16 línea 127).
 *
 * @param {object} args
 * @param {string} args.rawBody cuerpo crudo tal cual llegó (para el HMAC)
 * @param {object} args.headers headers de la request (case-insensitive)
 * @param {string} args.secreto secreto compartido del webhook
 * @param {number} [args.ahora] epoch ms; default Date.now()
 * @param {object} [args.opcionesFirma] ver hmac.mjs
 * @param {string} [args.estadoActual] estado local previo de la llamada
 * @param {object} [args.almacenDedupe] de crearAlmacenDedupe(); si se omite, no dedupea aquí
 */
export function procesarCallback({ rawBody, headers, secreto, ahora, opcionesFirma, estadoActual, almacenDedupe }) {
  const firma = verificarFirma(rawBody, headers, secreto, ahora, opcionesFirma);
  if (!firma.valido) {
    return { aceptado: false, motivo: firma.motivo, estado: estadoActual ?? null };
  }

  let cuerpo;
  try {
    cuerpo = JSON.parse(rawBody);
  } catch {
    return { aceptado: false, motivo: 'json_invalido', estado: estadoActual ?? null };
  }

  if (almacenDedupe) {
    const eventId = cuerpo.completion_event_id ?? cuerpo.event_id ?? null;
    const dedupe = registrarCallback(almacenDedupe, {
      event_id: eventId,
      conversation_id: cuerpo.conversation_id ?? null,
      call_sid: cuerpo.call_sid ?? cuerpo.callSid ?? null,
    });
    if (!dedupe.nuevo) {
      return { aceptado: true, duplicado: true, motivo: dedupe.motivo, estado: estadoActual ?? null };
    }
  }

  const resultado = resultadoDesdeCallback(cuerpo);
  const transicion = estadoActual
    ? transicionarEstado(estadoActual, resultado.estado)
    : { estado: resultado.estado, cambio: true, motivo: null };

  return {
    aceptado: true,
    duplicado: false,
    estado: transicion.estado,
    cambio_estado: transicion.cambio,
    motivo_transicion: transicion.motivo,
    aviso_entregado: resultado.aviso_entregado,
    solicita_no_llamar: resultado.solicita_no_llamar,
    numero_equivocado: resultado.numero_equivocado,
    conversation_id: resultado.conversation_id,
    call_sid: resultado.call_sid,
  };
}
