// integrations/elevenlabs/callback.mjs — Callback post-llamada → estado + evaluación (16 §2, §3, §4).
//
// Mapea SOLO hechos realmente recibidos: si el proveedor no manda un tipo
// reconocido, el estado destino es 'resultado_desconocido', nunca se infiere
// "Sonando" ni "entregado" sin evidencia (16 línea 27, línea 88). Esa regla
// aplica IGUAL a los dos formatos de cuerpo que este módulo acepta — ver
// `adaptarCuerpoProveedor` — nunca se relaja para el más nuevo de los dos.

import { verificarFirma } from './hmac.mjs';
import { registrarCallback } from './dedupe.mjs';
import { transicionarEstado } from './estados.mjs';

// --- Formato "plano" (heredado; el que usa n8n/runtime/voz-adaptador.mjs y
// el que documentaba hasta ahora este módulo en solitario):
// {type|status, conversation_id, call_sid, analysis}.
const MAPA_TIPO_A_ESTADO = Object.freeze({
  initiated: 'aceptada',
  ringing: 'en_curso',
  in_progress: 'en_curso',
  completed: 'finalizada',
  failed: 'fallida',
  no_answer: 'sin_respuesta',
  busy: 'sin_respuesta',
});

// --- Formato documentado públicamente por ElevenLabs para el webhook
// post-llamada (16 línea 61, https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks):
// {type:'post_call_transcription'|'post_call_audio', data:{conversation_id,
// agent_id, status, analysis, metadata, ...}}. La documentación reporta
// `data.status` como `done`/`failed`; cualquier valor no reconocido (o su
// ausencia) NO se traduce a 'finalizada' por default — sería inventar
// evidencia de éxito para un vocabulario de proveedor que cambió (16 línea 27,
// regla 4 de CLAUDE.md). Cae a 'resultado_desconocido', igual que el plano.
const MAPA_STATUS_POST_CALL = Object.freeze({
  done: 'finalizada',
  completed: 'finalizada',
  success: 'finalizada',
  failed: 'fallida',
  error: 'fallida',
  no_answer: 'sin_respuesta',
  busy: 'sin_respuesta',
});

function esEnvolturaPostCall(cuerpo) {
  return (
    typeof cuerpo?.type === 'string' &&
    cuerpo.type.startsWith('post_call') &&
    cuerpo?.data !== null &&
    typeof cuerpo?.data === 'object' &&
    !Array.isArray(cuerpo.data)
  );
}

/**
 * Normaliza CUALQUIERA de los dos formatos de callback documentados (ver
 * arriba) a una forma interna única. No decide nada de negocio propio del
 * dictamen (regla 4 de CLAUDE.md): solo reubica campos y resuelve `estado`
 * vía tablas de mapeo declarativas.
 *
 * Exportada a propósito: el runtime/BFF puede querer inspeccionar `formato`
 * (p. ej. para logging/bitácora) sin reimplementar esta detección.
 *
 * @returns {{formato:'plano'|'post_call', tipo_evento:string|null, estado:string, status_crudo:string|null, analysis:object, conversation_id:string|null, call_sid:string|null, event_id:string|null}}
 */
export function adaptarCuerpoProveedor(cuerpoCrudo) {
  const cuerpo = cuerpoCrudo ?? {};
  if (esEnvolturaPostCall(cuerpo)) {
    const datos = cuerpo.data;
    return {
      formato: 'post_call',
      tipo_evento: cuerpo.type, // 'post_call_transcription' | 'post_call_audio' (16 §3, §4)
      estado: MAPA_STATUS_POST_CALL[datos.status] ?? 'resultado_desconocido',
      status_crudo: datos.status ?? null,
      analysis: datos.analysis ?? {},
      conversation_id: datos.conversation_id ?? null,
      call_sid: datos.call_sid ?? datos.callSid ?? null,
      event_id: datos.completion_event_id ?? datos.event_id ?? cuerpo.completion_event_id ?? cuerpo.event_id ?? null,
    };
  }
  const tipo = cuerpo.type ?? cuerpo.status ?? null;
  return {
    formato: 'plano',
    tipo_evento: tipo,
    estado: MAPA_TIPO_A_ESTADO[tipo] ?? 'resultado_desconocido',
    status_crudo: tipo,
    analysis: cuerpo.analysis ?? {},
    conversation_id: cuerpo.conversation_id ?? null,
    call_sid: cuerpo.call_sid ?? cuerpo.callSid ?? null,
    event_id: cuerpo.completion_event_id ?? cuerpo.event_id ?? null,
  };
}

function leerBooleano(valor) {
  return typeof valor === 'boolean' ? valor : null;
}

/**
 * Traduce un cuerpo YA NORMALIZADO (`adaptarCuerpoProveedor`) a los tres
 * campos de evaluación de 16 §4. `null` significa "sin evidencia"
 * (desconocido), nunca se rellena con `false` por defecto — una ausencia no
 * es una negación. Interna: `resultadoDesdeCallback` y `procesarCallback` la
 * comparten para que dedupe y decisión de estado vengan de la MISMA
 * normalización y nunca diverjan entre sí.
 */
function resultadoDesdeNormalizado(normalizado) {
  const { estado, analysis } = normalizado;

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
    conversation_id: normalizado.conversation_id,
    call_sid: normalizado.call_sid,
  };
}

/**
 * Traduce el cuerpo YA VERIFICADO del callback (en cualquiera de los dos
 * formatos de `adaptarCuerpoProveedor`) a estado + los tres campos de
 * evaluación de 16 §4.
 */
export function resultadoDesdeCallback(evento) {
  return resultadoDesdeNormalizado(adaptarCuerpoProveedor(evento));
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

  // Una sola normalización para dedupe Y para la decisión de estado: si cada
  // una llamara a adaptarCuerpoProveedor por su cuenta, una diferencia futura
  // entre ambas rutas podría deduplicar con una identidad y decidir el
  // estado con otra.
  const normalizado = adaptarCuerpoProveedor(cuerpo);

  if (almacenDedupe) {
    const dedupe = registrarCallback(almacenDedupe, {
      event_id: normalizado.event_id,
      conversation_id: normalizado.conversation_id,
      call_sid: normalizado.call_sid,
      tipo_evento: normalizado.tipo_evento,
    });
    if (!dedupe.nuevo) {
      return { aceptado: true, duplicado: true, motivo: dedupe.motivo, estado: estadoActual ?? null };
    }
  }

  const resultado = resultadoDesdeNormalizado(normalizado);
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
