// n8n/runtime/voz-adaptador.mjs — RE-EXPORTACIÓN, ya no adaptador.
//
// Hasta H7 este archivo era el stub del runtime: constantes propias y un
// `verificarFirma` que devolvía `{valido:false}` porque no había HMAC real.
// forense-voice entregó `integrations/elevenlabs/` (payload, hmac, estados,
// dedupe, callback) en la oleada 2b, así que el stub desapareció: aquí sólo
// queda el nombre viejo apuntando al módulo real, para no romper los imports
// que ya existen mientras se migran.
//
// Reglas de uso desde el runtime:
//
//  - `verificarFirma` se llama en su FORMA POSICIONAL
//    `verificarFirma(rawBody, headers, secreto, ahora_ms, opciones)`. La forma
//    de objeto `{crudo, firma, ahora_ms}` sigue aceptada por compatibilidad,
//    pero no verifica nada sin secreto: devuelve
//    `{valido:false, motivo:'secreto_no_configurado'}`, que es el lado seguro.
//  - El Code node «Verificar HMAC» de FORENSE_resultado_llamada NO importa
//    este archivo: `n8n/runtime/generar-workflows.mjs` EMBEBE
//    `integrations/elevenlabs/hmac.mjs` y `callback.mjs` verbatim en el JSON
//    exportado (`embeberModulo`). Un n8n no resuelve imports del repo.
//  - `integrations/` es de forense-voice: se consume, no se edita.

export {
  ENDPOINT_LLAMADA,
  RUTA_REPORTE_FIJA,
  VARIABLES_PERMITIDAS,
  enmascararTelefono,
  construirPayload,
  RUTA_CALLBACK,
  TOLERANCIA_FIRMA_S,
  verificarFirma,
  ErrorVoz,
  ESTADOS_LLAMADA,
  ESTADOS_TERMINALES,
  transicionarEstado,
  marcarTimeout,
  reintentoManual,
  resultadoDesdeCallback,
  estadoDesdeCallback,
  procesarCallback,
} from '../../integrations/elevenlabs/index.mjs';
