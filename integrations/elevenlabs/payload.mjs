// integrations/elevenlabs/payload.mjs — Cuerpo del POST de aviso (16 §3) + fila product.llamada.
//
// El teléfono SIEMPRE sale de `perfil.telefono_e164` (backend, propietario
// autenticado), nunca de texto libre del evento ni de argumentos del LLM
// (16 línea 59, línea 128). `evento` solo aporta IDs e investigacion_id; un
// campo `evento.telefono` inyectado (ver fixture invalid/evento-con-telefono)
// se ignora por construcción: esta función no lo lee.

import { randomUUID } from 'node:crypto';
import { ErrorVoz } from './estados.mjs';

export const ENDPOINT_LLAMADA = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';
export const RUTA_REPORTE_FIJA = 'Historial de investigaciones';

/** Variables dinámicas permitidas: todo lo demás es fuga (16 §3). Mismo nombre que voz-adaptador.mjs. */
export const VARIABLES_PERMITIDAS = Object.freeze([
  'nombre_usuario', 'referencia_corta', 'ruta_reporte', 'completion_event_id',
]);

const LIMITE_NOMBRE = 60;
const LIMITE_GENERICO = 120;
const PATRON_TELEFONO_E164 = /^\+[1-9][0-9]{7,14}$/;

// Mismos patrones que n8n/runtime/voz-adaptador.mjs: un RFC o un monto dentro
// de una variable de voz es una fuga, aunque venga de un campo "seguro".
const PATRON_RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i;
const PATRON_MONTO = /\d[\d.,]*\s*(mxn|usd|pesos|d[oó]lares)|[$]\s?\d/i;

// Un UUID (p. ej. el event_id que viaja como completion_event_id) es hex con
// guiones: por coincidencia de formato, un segmento como "abc010101def" tiene
// la forma exacta de un RFC (3-4 letras + 6 dígitos + 3 alfanuméricos) sin
// serlo. PATRON_RFC no debe correr sobre un identificador opaco de sistema,
// nunca sobre datos que el contribuyente podría haber escrito (hallazgo QA #4).
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function truncar(texto, limite) {
  return texto.length > limite ? texto.slice(0, limite) : texto;
}

/** Quita substrings con forma de UUID antes de correr PATRON_RFC (guarda final defensiva incluida). */
function quitarUUIDs(texto) {
  return texto.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
}

function validarVariable(clave, valor) {
  const texto = String(valor ?? '');
  const esIdentificadorOpaco = clave === 'completion_event_id' || PATRON_UUID.test(texto);
  if (!esIdentificadorOpaco && PATRON_RFC.test(texto)) {
    throw new ErrorVoz('fuga_rfc', `${clave} contiene algo con forma de RFC`);
  }
  if (PATRON_MONTO.test(texto)) throw new ErrorVoz('fuga_monto', `${clave} contiene un monto`);
  return texto;
}

/** `^\*{4,}[0-9]{0,4}$` de contracts product.llamada: al menos 4 asteriscos. */
export function enmascararTelefono(telefonoE164) {
  const digitos = String(telefonoE164).replace(/^\+/, '');
  const ultimos4 = digitos.slice(-4);
  const restantes = Math.max(4, digitos.length - 4);
  return '*'.repeat(restantes) + ultimos4;
}

/** Referencia corta legible SIN datos fiscales: fragmento del UUID de investigación, nunca RFC/caso/monto. */
function referenciaCortaDesdeInvestigacion(investigacionId) {
  const fragmento = String(investigacionId ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return `INV-${fragmento || 'DESCONOCIDA'}`;
}

function filaLlamadaBase(evento, overrides = {}) {
  return {
    id: randomUUID(),
    event_id: evento.event_id,
    intento: 1,
    estado: 'omitida',
    destino_enmascarado: null,
    conversation_id: null,
    aviso_entregado: null,
    error: null,
    ...overrides,
  };
}

/**
 * Construye el body de POST /v1/convai/twilio/outbound-call, o `{omitida,
 * motivo}` si falta teléfono/preferencia/consentimiento/configuración. En
 * ambos casos devuelve `llamada`, la fila lista para validar contra
 * contracts `product.llamada` y persistir en `forense.llamadas_notificacion`.
 *
 * Orden de validación (determinista, para que `motivo` sea estable):
 * teléfono → preferencia de llamadas → consentimiento → formato de teléfono
 * → configuración del agente/proveedor.
 */
export function construirPayload(evento, perfil, config = {}) {
  if (!evento?.event_id) throw new ErrorVoz('argumento_invalido', 'evento.event_id es obligatorio');

  if (!perfil?.telefono_e164) {
    return { omitida: true, motivo: 'sin_telefono', cuerpo: null, llamada: filaLlamadaBase(evento) };
  }
  if (perfil.llamadas_activadas !== true) {
    return { omitida: true, motivo: 'llamadas_desactivadas', cuerpo: null, llamada: filaLlamadaBase(evento) };
  }
  if (!perfil.consentimiento_at) {
    return { omitida: true, motivo: 'sin_consentimiento', cuerpo: null, llamada: filaLlamadaBase(evento) };
  }
  if (!PATRON_TELEFONO_E164.test(perfil.telefono_e164)) {
    return { omitida: true, motivo: 'telefono_invalido', cuerpo: null, llamada: filaLlamadaBase(evento) };
  }
  if (!config?.agent_id || !config?.agent_phone_number_id) {
    return { omitida: true, motivo: 'configuracion_incompleta', cuerpo: null, llamada: filaLlamadaBase(evento) };
  }

  const variables = {
    nombre_usuario: truncar(String(perfil.nombre ?? '').trim() || 'Usuario', LIMITE_NOMBRE),
    referencia_corta: truncar(referenciaCortaDesdeInvestigacion(evento.investigacion_id), LIMITE_GENERICO),
    ruta_reporte: truncar(String(config.ruta_reporte ?? RUTA_REPORTE_FIJA), LIMITE_GENERICO),
    completion_event_id: evento.event_id,
  };
  for (const [clave, valor] of Object.entries(variables)) validarVariable(clave, valor);

  const cuerpo = {
    agent_id: config.agent_id,
    agent_phone_number_id: config.agent_phone_number_id,
    to_number: perfil.telefono_e164,
    conversation_initiation_client_data: { dynamic_variables: variables },
  };

  // Guarda final defensiva: el cuerpo entero, no solo las variables, nunca
  // debe contener forma de RFC o de monto. Se excluyen los UUID (p. ej.
  // completion_event_id) antes de correr PATRON_RFC por la misma razón que
  // en validarVariable: un identificador opaco no es un dato del contribuyente.
  const cuerpoSinUUIDs = quitarUUIDs(JSON.stringify(cuerpo));
  if (PATRON_RFC.test(cuerpoSinUUIDs) || PATRON_MONTO.test(JSON.stringify(cuerpo))) {
    throw new ErrorVoz('fuga_fiscal', 'el cuerpo de la llamada contiene datos con forma fiscal');
  }

  const llamada = filaLlamadaBase(evento, {
    estado: 'pendiente',
    destino_enmascarado: enmascararTelefono(perfil.telefono_e164),
  });

  return { omitida: false, motivo: null, cuerpo, llamada };
}
