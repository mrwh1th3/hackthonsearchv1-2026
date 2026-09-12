// n8n/runtime/transporte.mjs — política de transporte HTTP (17 §6).
//
//  - 429/5xx: backoff exponencial con jitter y respeto de `Retry-After`,
//    hasta DOS reintentos de transporte dentro del deadline. No son reintentos
//    forenses (03) y no consumen cuota de request adicional.
//  - Timeout/desconexión: AMBIGUO. Puede haber coste en el proveedor aunque no
//    llegue respuesta: se marca `desconocido` y NO se reintenta automáticamente.
//    Este runtime no afirma exactly-once del proveedor.
//  - Sin red: `ejecutar`, `ahora`, `dormir` y `aleatorio` se inyectan.

import { MAX_REINTENTOS_TRANSPORTE } from './config.mjs';

export const BASE_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 8000;

/** Clasificación de un intento de transporte. */
export function clasificar({ status = null, tipo = null } = {}) {
  if (tipo === 'timeout' || tipo === 'conexion_interrumpida') return 'ambiguo';
  if (status === null) return 'error';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'reintentable';
  if (status >= 500) return 'reintentable';
  if (status === 408) return 'reintentable';
  return 'error';
}

/** Espera con jitter completo; `Retry-After` (segundos o fecha) manda si existe. */
export function calcularEspera({ intento, retry_after = null, ahora_ms = 0, aleatorio = Math.random }) {
  const segundos = interpretarRetryAfter(retry_after, ahora_ms);
  if (segundos !== null) return Math.max(0, Math.round(segundos * 1000));
  const techo = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, intento));
  return Math.round(techo * aleatorio());
}

function interpretarRetryAfter(valor, ahora_ms) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (Number.isFinite(numero)) return numero;
  const fecha = Date.parse(String(valor));
  if (Number.isFinite(fecha)) return Math.max(0, (fecha - ahora_ms) / 1000);
  return null;
}

/**
 * Ejecuta `ejecutar(intento)` aplicando la política.
 * @returns {Promise<{ok:boolean, estado:'completado'|'error'|'desconocido', respuesta:any,
 *   intentos:number, esperas_ms:number[], error:object|null}>}
 */
export async function enviarConReintentos({
  ejecutar,
  deadline_at,
  ahora = () => Date.now(),
  dormir = async () => {},
  aleatorio = Math.random,
  max_reintentos = MAX_REINTENTOS_TRANSPORTE,
  alIntentar = null,
}) {
  const limite = deadline_at ? Date.parse(deadline_at) : Number.POSITIVE_INFINITY;
  const esperas = [];
  let intentos = 0;
  let ultimo = null;

  for (;;) {
    if (ahora() >= limite) {
      return salida('error', null, intentos, esperas, {
        codigo: 'deadline_excedido', mensaje: 'deadline del paso alcanzado antes de enviar', reintentable: false,
      });
    }
    intentos += 1;
    if (alIntentar) alIntentar(intentos);
    let respuesta;
    try {
      respuesta = await ejecutar(intentos);
    } catch (err) {
      respuesta = { tipo: err?.tipo ?? 'error_transporte', mensaje: err?.message ?? String(err) };
    }
    ultimo = respuesta;
    const clase = clasificar(respuesta);
    if (clase === 'ok') return salida('completado', respuesta, intentos, esperas, null);
    if (clase === 'ambiguo') {
      return salida('desconocido', respuesta, intentos, esperas, {
        codigo: 'timeout_ambiguo',
        mensaje: 'sin respuesta del proveedor; posible consumo externo, no se reintenta automáticamente',
        reintentable: false,
      });
    }
    if (clase === 'error' || intentos > max_reintentos) {
      return salida('error', respuesta, intentos, esperas, {
        codigo: clase === 'error' ? 'error_proveedor' : 'reintentos_transporte_agotados',
        mensaje: `status=${respuesta?.status ?? respuesta?.tipo ?? 'desconocido'}`,
        reintentable: clase !== 'error',
      });
    }
    const espera = calcularEspera({
      intento: intentos - 1,
      retry_after: respuesta?.headers?.['retry-after'] ?? respuesta?.headers?.['Retry-After'] ?? null,
      ahora_ms: ahora(),
      aleatorio,
    });
    if (ahora() + espera >= limite) {
      return salida('error', respuesta, intentos, esperas, {
        codigo: 'deadline_excedido', mensaje: 'la espera de backoff excede el deadline', reintentable: false,
      });
    }
    esperas.push(espera);
    await dormir(espera);
  }

  function salida(estado, respuesta, n, esperas_ms, error) {
    return { ok: estado === 'completado', estado, respuesta: respuesta ?? ultimo, intentos: n, esperas_ms, error };
  }
}
