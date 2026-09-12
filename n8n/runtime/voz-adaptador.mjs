// n8n/runtime/voz-adaptador.mjs — INTERFAZ del adaptador de voz (16 §2 y §3).
//
// STUB MARCADO. El adaptador real es de **forense-voice** y vive en
// `integrations/elevenlabs/`, que hoy solo tiene un README. Este archivo NO lo
// sustituye: declara, del lado del runtime, exactamente qué necesitan los
// workflows `FORENSE_notificar_completada` y `FORENSE_resultado_llamada`, para
// que cuando el adaptador exista se conecte sin rediseñar el grafo.
//
// Lo que este archivo SÍ hace: fijar el contrato y fallar en vez de fingir.
//   - `construirLlamada` arma el cuerpo de 16 §3 y RECHAZA cualquier variable
//     dinámica con datos fiscales (RFC, montos, sospechas, reporte).
//   - `verificarFirma` es el stub: sin implementación real devuelve
//     `{valido:false, motivo:'verificador_no_instalado'}`; el Code node del
//     workflow convierte eso en un 401. Nunca acepta un callback sin verificar.
//
// Bloqueo externo conocido (21 §5): la cuenta ElevenLabs tiene CERO números
// salientes, así que no hay ninguna llamada real ejecutada ni verificable aquí.

export const ENDPOINT_LLAMADA = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';
export const RUTA_CALLBACK = '/webhook/forense/elevenlabs-resultado';
export const TOLERANCIA_FIRMA_S = 300;

/** Estados locales de llamada (16 §2). No hay ninguno que signifique «entregado» por sí solo. */
export const ESTADOS_LLAMADA = Object.freeze([
  'pendiente', 'solicitando', 'aceptada', 'en_curso', 'finalizada',
  'fallida', 'sin_respuesta', 'omitida', 'resultado_desconocido',
]);

/** Variables dinámicas permitidas: todo lo demás es fuga (16 §3). */
export const VARIABLES_PERMITIDAS = Object.freeze([
  'nombre_usuario', 'referencia_corta', 'ruta_reporte', 'completion_event_id',
]);

// Un RFC mexicano de persona moral/física dentro de una variable de voz es una
// fuga: el agente telefónico no recibe datos fiscales, ni siquiera el RFC.
const PATRON_RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i;
const PATRON_MONTO = /\d[\d.,]*\s*(mxn|usd|pesos|d[oó]lares)|[$]\s?\d/i;

export class ErrorVoz extends Error {
  constructor(codigo, mensaje) {
    super(`${codigo}: ${mensaje}`);
    this.name = 'ErrorVoz';
    this.codigo = codigo;
  }
}

/**
 * Cuerpo del POST de 16 §3. El teléfono viene del PERFIL del propietario
 * autenticado, resuelto en backend; jamás de texto libre ni de argumentos del
 * LLM. Esta función no hace red.
 */
export function construirLlamada({ agent_id, agent_phone_number_id, to_number, variables }) {
  for (const [campo, valor] of Object.entries({ agent_id, agent_phone_number_id, to_number })) {
    if (!valor) throw new ErrorVoz('configuracion_incompleta', `falta ${campo}`);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(to_number)) {
    throw new ErrorVoz('telefono_invalido', 'el teléfono debe venir del perfil en formato E.164');
  }
  const entradas = Object.entries(variables ?? {});
  const ajenas = entradas.map(([k]) => k).filter((k) => !VARIABLES_PERMITIDAS.includes(k));
  if (ajenas.length > 0) {
    throw new ErrorVoz('variable_no_permitida', `el agente de voz no recibe ${ajenas.join(', ')}`);
  }
  for (const [clave, valor] of entradas) {
    const texto = String(valor ?? '');
    if (texto.length > 120) throw new ErrorVoz('variable_larga', `${clave} supera 120 caracteres`);
    if (PATRON_RFC.test(texto)) throw new ErrorVoz('fuga_rfc', `${clave} contiene algo con forma de RFC`);
    if (PATRON_MONTO.test(texto)) throw new ErrorVoz('fuga_monto', `${clave} contiene un monto`);
  }
  return {
    agent_id,
    agent_phone_number_id,
    to_number,
    conversation_initiation_client_data: {
      dynamic_variables: Object.fromEntries(entradas.map(([k, v]) => [k, String(v)])),
    },
  };
}

/**
 * Verificación HMAC del callback sobre el cuerpo CRUDO (16 §3).
 *
 * STUB: devuelve siempre `valido:false` mientras `integrations/elevenlabs` no
 * aporte la implementación. El workflow traduce esto a 401 y no escribe nada:
 * es preferible perder un callback a aceptar uno sin firma comprobada.
 */
export function verificarFirma({ crudo, firma, ahora_ms = Date.now(), tolerancia_s = TOLERANCIA_FIRMA_S }) {
  if (typeof crudo !== 'string') {
    return { valido: false, motivo: 'cuerpo_no_crudo', implementado: false };
  }
  if (!firma) return { valido: false, motivo: 'sin_firma', implementado: false };
  const marca = /t=(\d+)/.exec(String(firma));
  if (marca) {
    const edad = Math.abs(ahora_ms / 1000 - Number(marca[1]));
    if (edad > tolerancia_s) return { valido: false, motivo: 'fuera_de_ventana', implementado: false };
  }
  return {
    valido: false,
    motivo: 'verificador_no_instalado',
    implementado: false,
    dueño: 'forense-voice (integrations/elevenlabs)',
  };
}

/** Mapeo de hechos del callback a estado local. Solo hechos RECIBIDOS (16 §2). */
export function estadoDesdeCallback(evento) {
  const tipo = evento?.type ?? evento?.status ?? null;
  const MAPA = {
    initiated: 'aceptada',
    ringing: 'en_curso',
    in_progress: 'en_curso',
    completed: 'finalizada',
    failed: 'fallida',
    no_answer: 'sin_respuesta',
    busy: 'sin_respuesta',
  };
  const estado = MAPA[tipo] ?? 'resultado_desconocido';
  // `aviso_entregado` es dato aparte y solo verdadero si el análisis lo
  // respalda: una llamada «finalizada» no prueba que alguien escuchara.
  const aviso_entregado = estado === 'finalizada' && evento?.analysis?.aviso_confirmado === true;
  return { estado, aviso_entregado };
}
