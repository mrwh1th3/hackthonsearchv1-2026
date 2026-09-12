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
 *
 * La clave real es (identidad, tipo_evento): una misma llamada manda varios
 * eventos legítimos y distintos (`initiated` → `ringing` → `completed`) con
 * la MISMA identidad de proveedor. Deduplicar solo por identidad descartaría
 * esa secuencia entera tras el primer evento, tratando "completed" como
 * duplicado de "initiated". `tipo_evento` es opcional para no romper a un
 * llamador que todavía no lo manda: en ese caso el comportamiento es el
 * previo (una única entrada por identidad).
 */
export function registrarCallback(almacen, { event_id, conversation_id, call_sid, tipo_evento }) {
  const identidad = conversation_id ?? call_sid ?? event_id;
  if (!identidad) {
    throw new ErrorVoz('argumento_invalido', 'registrarCallback requiere conversation_id, call_sid o event_id');
  }
  const clave = `${identidad}::${tipo_evento ?? 'sin_tipo'}`;
  if (almacen.callbacks.has(clave)) {
    return { nuevo: false, motivo: 'callback_duplicado', clave };
  }
  almacen.callbacks.add(clave);
  return { nuevo: true, motivo: null, clave };
}
