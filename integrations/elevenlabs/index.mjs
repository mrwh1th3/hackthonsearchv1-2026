// integrations/elevenlabs/index.mjs — Punto de entrada único para el runtime (16, ver README.md).
//
// Re-exporta las constantes con el MISMO nombre y valor que
// n8n/runtime/voz-adaptador.mjs (ENDPOINT_LLAMADA, RUTA_CALLBACK,
// TOLERANCIA_FIRMA_S, ESTADOS_LLAMADA, VARIABLES_PERMITIDAS, ErrorVoz,
// estadoDesdeCallback) para que el swap del stub a este módulo sea de una
// línea de import. Las funciones de más alto nivel (construirPayload,
// procesarCallback, dedupe, estados) son las que consume el workflow real.

export {
  ENDPOINT_LLAMADA,
  RUTA_REPORTE_FIJA,
  VARIABLES_PERMITIDAS,
  enmascararTelefono,
  construirPayload,
} from './payload.mjs';

export {
  RUTA_CALLBACK,
  TOLERANCIA_FIRMA_S,
  verificarFirma,
} from './hmac.mjs';

export {
  ErrorVoz,
  ESTADOS_LLAMADA,
  ESTADOS_TERMINALES,
  transicionarEstado,
  marcarTimeout,
  reintentoManual,
} from './estados.mjs';

export {
  crearAlmacenDedupe,
  reservarSolicitud,
  liberarParaReintentoManual,
  registrarCallback,
} from './dedupe.mjs';

export {
  adaptarCuerpoProveedor,
  resultadoDesdeCallback,
  estadoDesdeCallback,
  procesarCallback,
} from './callback.mjs';
