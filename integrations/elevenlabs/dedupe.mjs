// integrations/elevenlabs/dedupe.mjs — Idempotencia de solicitud y de callback (16 §2.5, §3, §7).
//
// Es una librería PURA en memoria: no toca DB ni red. Sirve para dar al
// runtime/BFF una decisión testeable antes de depender únicamente de que un
// INSERT choque contra una constraint. La barrera real y durable en
// producción es la migración 007: `eventos_salida` unique(investigacion_id,
// tipo) y `llamadas_notificacion` unique(event_id,intento) — este módulo no
// las sustituye, y un `crearAlmacenDedupe()` nuevo por proceso NO sobrevive
// un restart ni se comparte entre workers de n8n.

import { ErrorVoz } from './estados.mjs';

export function crearAlmacenDedupe() {
  return { solicitudes: new Set(), callbacks: new Set() };
}

/**
 * Una llamada por investigación/evento, sin importar cuántas veces el
 * webhook de outbox reintente la entrega (16 línea 23, línea 124: "cinco
 * entregas repetidas del webhook no generan cinco llamadas").
 */
export function reservarSolicitud(almacen, { event_id }) {
  if (!event_id) throw new ErrorVoz('argumento_invalido', 'reservarSolicitud requiere event_id');
  if (almacen.solicitudes.has(event_id)) {
    return { reservado: false, motivo: 'evento_ya_solicitado' };
  }
  almacen.solicitudes.add(event_id);
  return { reservado: true, motivo: null };
}

/**
 * Libera la reserva de un evento para permitir una única solicitud nueva.
 * Solo debe invocarse desde el flujo de reintento MANUAL y auditado (16
 * línea 29): nunca automáticamente tras un fallo o timeout.
 */
export function liberarParaReintentoManual(almacen, { event_id }) {
  if (!event_id) throw new ErrorVoz('argumento_invalido', 'liberarParaReintentoManual requiere event_id');
  almacen.solicitudes.delete(event_id);
}

/**
 * Dedupe de callbacks correlacionando por conversation_id o call_sid del
 * proveedor (16 línea 61); si ninguno viene en el cuerpo, cae a event_id
 * para no procesar dos veces un callback sin identidad de proveedor.
 */
export function registrarCallback(almacen, { event_id, conversation_id, call_sid }) {
  const clave = conversation_id ?? call_sid ?? event_id;
  if (!clave) {
    throw new ErrorVoz('argumento_invalido', 'registrarCallback requiere conversation_id, call_sid o event_id');
  }
  if (almacen.callbacks.has(clave)) {
    return { nuevo: false, motivo: 'callback_duplicado', clave };
  }
  almacen.callbacks.add(clave);
  return { nuevo: true, motivo: null, clave };
}
