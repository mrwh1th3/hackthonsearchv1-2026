// integrations/elevenlabs/hmac.mjs — Verificación HMAC del callback post-llamada (16 §3).
//
// FORMATO CONFIRMADO (hallazgo QA #5, documentación pública de ElevenLabs:
// https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks,
// enlazada también en 16 línea 61): el header `ElevenLabs-Signature` (lectura
// case-insensitive) trae `t=<epoch_s>,v0=<hex hmac-sha256 de "<t>.<cuerpo_crudo>">`.
// Ya no es un supuesto sin verificar (n8n/runtime/voz-adaptador.mjs también
// asumía este mismo `t=`/`v0=`, así que coincide con la única otra evidencia
// del repo) y es el default de `OPCIONES_POR_DEFECTO`. Aun así el esquema
// completo se recibe por `opciones` — no está cableado — porque una cuenta
// real puede usar un header/prefijo propio (multi-tenant, entorno de
// pruebas, etc.): eso queda como alternativa configurable, probada aparte
// de la ruta por default (ver tests/voice/hmac.test.mjs).

import { createHmac, timingSafeEqual } from 'node:crypto';

export const RUTA_CALLBACK = '/webhook/forense/elevenlabs-resultado';
export const TOLERANCIA_FIRMA_S = 300;

const OPCIONES_POR_DEFECTO = Object.freeze({
  header: 'elevenlabs-signature',
  prefijoTimestamp: 't=',
  prefijoFirma: 'v0=',
  separador: ',',
  construirMensaje: (t, crudo) => `${t}.${crudo}`,
});

function extraerHeader(headers, nombre) {
  if (!headers) return null;
  if (headers[nombre] !== undefined) return headers[nombre];
  const entrada = Object.entries(headers).find(([clave]) => clave.toLowerCase() === nombre.toLowerCase());
  return entrada ? entrada[1] : null;
}

function analizarFirma(valor, opciones) {
  if (!valor) return null;
  const partes = String(valor).split(opciones.separador).map((parte) => parte.trim());
  let t = null;
  let v0 = null;
  for (const parte of partes) {
    if (parte.startsWith(opciones.prefijoTimestamp)) t = parte.slice(opciones.prefijoTimestamp.length);
    else if (parte.startsWith(opciones.prefijoFirma)) v0 = parte.slice(opciones.prefijoFirma.length);
  }
  if (!t || !v0 || !/^\d+$/.test(t)) return null;
  return { t, v0 };
}

/**
 * Verifica la firma HMAC de un callback sobre el CUERPO CRUDO (nunca el
 * objeto ya parseado: reserializar cambia bytes y rompe la firma).
 *
 * Dos formas de llamada, ambas soportadas para no dejar una trampa de
 * integración si el runtime importa esta función con la convención del stub:
 *   - Posicional (canónica aquí): verificarFirma(rawBody, headers, secreto, ahora, opciones?)
 *   - Objeto (paridad con n8n/runtime/voz-adaptador.mjs): verificarFirma({crudo, firma, secreto, ahora_ms, tolerancia_s})
 *     El secreto se lee POR NOMBRE del propio objeto (hallazgo QA #3) — no
 *     de un segundo argumento posicional — para que la forma objeto sea
 *     autocontenida y no dependa de recordar un orden de parámetros aparte.
 *
 * @returns {{valido:boolean, motivo:string|null}}
 */
export function verificarFirma(a, b, c, d, e) {
  if (a && typeof a === 'object' && !Buffer.isBuffer(a)) {
    const { crudo, firma, secreto, ahora_ms, tolerancia_s } = a;
    const opciones = tolerancia_s ? { ventanaS: tolerancia_s } : undefined;
    // `c ?? b` es compatibilidad transicional con un llamador que aún pasara
    // el secreto posicional en vez de dentro del objeto; `secreto` nombrado
    // es la forma correcta y la que debe usarse de aquí en adelante.
    return verificarFirma(crudo, { 'elevenlabs-signature': firma }, secreto ?? c ?? b, ahora_ms, opciones);
  }

  const rawBody = a;
  const headers = b;
  const secreto = c;
  const ahora = d ?? Date.now();
  const opciones = { ...OPCIONES_POR_DEFECTO, ...(e ?? {}) };
  const ventanaS = opciones.ventanaS ?? TOLERANCIA_FIRMA_S;

  if (typeof rawBody !== 'string') {
    return { valido: false, motivo: 'cuerpo_no_crudo' };
  }
  if (!secreto) {
    return { valido: false, motivo: 'secreto_no_configurado' };
  }
  const encabezado = extraerHeader(headers, opciones.header);
  if (!encabezado) return { valido: false, motivo: 'sin_firma' };

  const analizada = analizarFirma(encabezado, opciones);
  if (!analizada) return { valido: false, motivo: 'firma_malformada' };

  const edadS = Math.abs(ahora / 1000 - Number(analizada.t));
  if (!Number.isFinite(edadS) || edadS > ventanaS) {
    return { valido: false, motivo: 'fuera_de_ventana' };
  }

  const mensaje = opciones.construirMensaje(analizada.t, rawBody);
  const esperadaHex = createHmac('sha256', secreto).update(mensaje).digest('hex');
  const bufEsperada = Buffer.from(esperadaHex, 'hex');
  const bufRecibida = Buffer.from(analizada.v0, 'hex');
  if (bufRecibida.length === 0 || bufEsperada.length !== bufRecibida.length) {
    return { valido: false, motivo: 'firma_invalida' };
  }
  if (!timingSafeEqual(bufEsperada, bufRecibida)) {
    return { valido: false, motivo: 'firma_invalida' };
  }
  return { valido: true, motivo: null };
}
