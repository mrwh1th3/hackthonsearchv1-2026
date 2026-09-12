// integrations/elevenlabs/estados.mjs — Errores y máquina de estados de la llamada de aviso (16 §2).
//
// Dueño: forense-voice. Sin dependencias externas, sin red, sin DB: opera
// sobre valores que el llamador (runtime/BFF) lee y persiste.

import { randomUUID } from 'node:crypto';

/** Mismo nombre y valores que n8n/runtime/voz-adaptador.mjs (paridad de interfaz). */
export class ErrorVoz extends Error {
  constructor(codigo, mensaje) {
    super(`${codigo}: ${mensaje}`);
    this.name = 'ErrorVoz';
    this.codigo = codigo;
  }
}

/** Estados locales de llamada (16 §2 línea 27). Idéntico a voz-adaptador.mjs. */
export const ESTADOS_LLAMADA = Object.freeze([
  'pendiente', 'solicitando', 'aceptada', 'en_curso', 'finalizada',
  'fallida', 'sin_respuesta', 'omitida', 'resultado_desconocido',
]);

/** Estados que ya no aceptan transición automática (16 línea 29: sin redial automático). */
export const ESTADOS_TERMINALES = Object.freeze([
  'finalizada', 'fallida', 'sin_respuesta', 'omitida', 'resultado_desconocido',
]);

/** Estados desde los que un reintento MANUAL (explícito, auditado) está permitido. */
const ESTADOS_REINTENTABLES = Object.freeze(['fallida', 'sin_respuesta', 'resultado_desconocido']);

/**
 * Transiciones permitidas por estado. La clave de señal es siempre el nombre
 * del estado destino (o 'timeout', normalizado abajo a 'resultado_desconocido').
 * Esto evita un vocabulario de señales paralelo al de estados.
 */
const TRANSICIONES = Object.freeze({
  pendiente: ['solicitando', 'omitida'],
  solicitando: ['aceptada', 'fallida', 'resultado_desconocido'],
  aceptada: ['en_curso', 'finalizada', 'fallida', 'sin_respuesta', 'resultado_desconocido'],
  en_curso: ['finalizada', 'fallida', 'sin_respuesta', 'resultado_desconocido'],
});

/**
 * Aplica una transición de estado. Nunca lanza para una transición inválida:
 * un callback fuera de orden, tardío o duplicado no debe romper el pipeline
 * (16 línea 127); en su lugar devuelve `cambio:false` con el motivo. Un
 * estado terminal es absorbente: ninguna señal posterior lo mueve.
 *
 * `'timeout'` es una válvula de escape universal: desde CUALQUIER estado no
 * terminal —incluido 'pendiente'— mueve a 'resultado_desconocido'. Es la
 * única señal que no depende de la tabla de transiciones, porque un timeout
 * puede llegar sin que exista todavía un callback real que lo explique
 * (16 línea 29: "si el POST tiene timeout ... marcar resultado_desconocido").
 *
 * @returns {{estado:string, cambio:boolean, motivo:string|null}}
 */
export function transicionarEstado(estadoActual, señalCruda) {
  if (!ESTADOS_LLAMADA.includes(estadoActual)) {
    throw new ErrorVoz('estado_desconocido', `estado local desconocido: ${estadoActual}`);
  }
  if (ESTADOS_TERMINALES.includes(estadoActual)) {
    return { estado: estadoActual, cambio: false, motivo: 'estado_terminal' };
  }
  if (señalCruda === 'timeout') {
    return { estado: 'resultado_desconocido', cambio: true, motivo: null };
  }
  if (!ESTADOS_LLAMADA.includes(señalCruda)) {
    return { estado: estadoActual, cambio: false, motivo: 'senal_desconocida' };
  }
  const permitidos = TRANSICIONES[estadoActual] ?? [];
  if (!permitidos.includes(señalCruda)) {
    return { estado: estadoActual, cambio: false, motivo: 'transicion_no_permitida' };
  }
  return { estado: señalCruda, cambio: true, motivo: null };
}

/** Timeout ambiguo del POST saliente (sin callback aún) → resultado_desconocido. Nunca redial automático. */
export function marcarTimeout(estadoActual) {
  return transicionarEstado(estadoActual, 'timeout');
}

/**
 * Reintento MANUAL de una llamada terminal no exitosa (16 línea 29). Nunca
 * reescribe el intento anterior: crea la fila del siguiente intento, tal
 * como exige unique(event_id,intento) de 007. Lanza si el estado no es
 * reintentable (p. ej. 'omitida' o 'finalizada') o si ya se alcanzó el
 * máximo de 3 intentos de product.llamada.
 */
export function reintentoManual(llamadaActual) {
  if (!ESTADOS_REINTENTABLES.includes(llamadaActual?.estado)) {
    throw new ErrorVoz('reintento_no_permitido', `no se reintenta una llamada en estado ${llamadaActual?.estado}`);
  }
  if (!(llamadaActual.intento < 3)) {
    throw new ErrorVoz('limite_reintentos', 'máximo de 3 intentos alcanzado (product.llamada)');
  }
  return {
    ...llamadaActual,
    id: randomUUID(),
    intento: llamadaActual.intento + 1,
    estado: 'pendiente',
    conversation_id: null,
    aviso_entregado: null,
    error: null,
  };
}
