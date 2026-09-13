// n8n/runtime/config.mjs — configuración del runtime (17 §5, §6, §7; 03 presupuestos).
// Dueño: forense-runtime. Sin red, sin secretos, sin IDs de n8n.
//
// NOTA DE VERIFICACIÓN: `anthropic_version` sigue SIN comprobar. Los IDs de
// modelo sí lo están, pero por el smoke del coordinador en n8n (ver
// IDS_MODELO_EVIDENCIA), no por este worktree: aquí no hay red y ningún test
// de este repo prueba que la cuenta los acepte.

export const PROVEEDOR = 'messages_api';

export const API = Object.freeze({
  base_url: 'https://api.anthropic.com',
  ruta_mensajes: '/v1/messages',
  // Pendiente de smoke: "headers según versión API probada" (17 §5).
  anthropic_version: '2023-06-01',
  anthropic_version_verificada: false,
  // Deadline de request y lease propuestos por 17 §4.
  deadline_request_ms: 45_000,
  lease_ms: 90_000,
});

// 17 §7: asignación inicial de modelos del producto (propuesta a medir, no
// afirmación de disponibilidad). El modelo se resuelve SIEMPRE desde aquí,
// nunca desde el prompt ni desde datos del contribuyente.
export const MODELOS_POR_ROL = Object.freeze({
  documental: 'sonnet',
  financiero: 'opus',
  relacional: 'opus',
  temporal: 'sonnet',
  externo: 'sonnet',
  auditor: 'opus',
  defensor: 'opus',
  replica: 'opus',
  redactor: 'sonnet',
  // Editor: conversacional (modo "pregunta") + propuestas de edición sobre el
  // expediente. Por ahora es el único rol en haiku — el usuario lo pidió así
  // el 2026-09-12 mientras se mantiene solo conversacional; no confundir con
  // los especialistas de investigación, que siguen en sonnet/opus.
  editor: 'haiku',
});

// Alias → ID de API. sonnet/opus VERIFICADOS por el coordinador (ver
// IDS_MODELO_EVIDENCIA); smoke `FORENSE_smoke_anthropic` del 2026-09-12 con la
// credencial `Anthropic account`, ejecuciones n8n 283972 (claude-sonnet-5,
// stop_reason tool_use, usage 645/45, 1089 ms) y 283975 (claude-opus-5).
// `haiku` NO tiene smoke propio todavía — mismo formato de ID
// (claude-haiku-4-5-20251001) pero sin ejecución registrada; el coordinador
// debe correr el smoke antes de fiarse de esto en producción. Aquí no hay
// red: ningún test de este repo comprueba que exista.
export const IDS_MODELO = Object.freeze({
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  haiku: 'claude-haiku-4-5-20251001',
});
export const IDS_MODELO_VERIFICADOS = true;
export const IDS_MODELO_EVIDENCIA = Object.freeze({
  fecha: '2026-09-12',
  fuente: 'smoke del coordinador en n8n (FORENSE_smoke_anthropic)',
  ejecuciones: Object.freeze(['283972', '283975']),
  verificado_por: 'coordinador',
});

// 17 §7: techos de TOKENS de entrada por rol (medidos con contador del modelo).
export const TECHO_TOKENS_ENTRADA = Object.freeze({
  documental: 8000,
  financiero: 8000,
  relacional: 8000,
  temporal: 8000,
  externo: 8000,
  auditor: 16000,
  defensor: 16000,
  replica: 16000,
  redactor: 24000,
  editor: 24000,
});

// 08 + 17 §7: techos de CARACTERES del paquete inicial. Se aplican ADEMÁS de
// los techos de tokens; no son una conversión de aquéllos.
export const TECHO_CARACTERES_PAQUETE = Object.freeze({
  documental: 12000,
  financiero: 12000,
  relacional: 12000,
  temporal: 12000,
  externo: 12000,
  auditor: 24000,
  defensor: 24000,
  replica: 24000,
  redactor: 24000,
  editor: 24000,
});

// Techo de salida por rol (max_tokens del request). Configurable.
// Con thinking adaptativo (por defecto en claude-opus-5 / claude-sonnet-5) el
// razonamiento consume de max_tokens: con 2000 las respuestas se cortaban por
// `max_tokens` a mitad de un tool_use o de la salida JSON (ejecución real
// 2026-09-12). Es un techo, no un gasto: solo se cobra lo generado.
export const MAX_TOKENS_SALIDA = Object.freeze({
  documental: 8000,
  financiero: 8000,
  relacional: 8000,
  temporal: 8000,
  externo: 8000,
  auditor: 16000,
  defensor: 16000,
  replica: 8000,
  redactor: 16000,
  editor: 16000,
});

// 03 + 06: allowlist de herramientas por rol. `leer_senal` NO existe para R1
// (ACL de 06); se habilita en ronda 2 / reintento y para Auditor y Defensor.
export const HERRAMIENTAS_POR_ROL = Object.freeze({
  documental: Object.freeze(['forense_perfil', 'forense_facturas', 'forense_pares',
    'forense_escribir_senal', 'forense_registrar_evidencia']),
  financiero: Object.freeze(['forense_conciliar', 'forense_seguir_dinero', 'forense_facturas',
    'forense_escribir_senal', 'forense_registrar_evidencia']),
  relacional: Object.freeze(['forense_relacionados', 'forense_ciclos', 'forense_facturas',
    'forense_escribir_senal', 'forense_registrar_evidencia']),
  temporal: Object.freeze(['forense_perfil', 'forense_facturas', 'forense_pares',
    'forense_escribir_senal', 'forense_registrar_evidencia']),
  externo: Object.freeze(['forense_listas', 'forense_relacionados',
    'forense_escribir_senal', 'forense_registrar_evidencia']),
  auditor: Object.freeze(['forense_perfil', 'forense_facturas', 'forense_conciliar',
    'forense_seguir_dinero', 'forense_relacionados', 'forense_ciclos', 'forense_pares',
    'forense_listas', 'forense_leer_senal', 'forense_registrar_evidencia']),
  defensor: Object.freeze(['forense_perfil', 'forense_facturas', 'forense_conciliar',
    'forense_seguir_dinero', 'forense_relacionados', 'forense_ciclos', 'forense_pares',
    'forense_listas', 'forense_leer_senal']),
  // 03/17: sin herramientas. No se envía la clave `tools`.
  replica: Object.freeze([]),
  redactor: Object.freeze([]),
  editor: Object.freeze([]),
});

// Herramienta de lectura del pizarrón: prohibida en R1 (17 §7, 06 ACL).
export const HERRAMIENTA_PIZARRON = 'forense_leer_senal';

export const ROLES_ESPECIALISTA = Object.freeze(['documental', 'financiero', 'relacional', 'temporal', 'externo']);
export const ROLES_SIN_TOOLS = Object.freeze(['replica', 'redactor', 'editor']);
export const ROLES_CIERRE = Object.freeze(['auditor', 'defensor', 'replica', 'redactor']);

export const FAMILIA_POR_ROL = Object.freeze({
  documental: 'D', financiero: 'F', relacional: 'R', temporal: 'T', externo: 'E',
});
export const ROL_POR_FAMILIA = Object.freeze({
  D: 'documental', F: 'financiero', R: 'relacional', T: 'temporal', E: 'externo',
});

// Contrato de salida por rol → nombre del contrato en contracts/release.json.
export const CONTRATO_SALIDA_POR_ROL = Object.freeze({
  documental: 'agents.especialista',
  financiero: 'agents.especialista',
  relacional: 'agents.especialista',
  temporal: 'agents.especialista',
  externo: 'agents.especialista',
  auditor: 'agents.auditor',
  defensor: 'agents.defensor',
  replica: 'agents.replica',
  redactor: 'agents.redactor',
  editor: 'agents.editor',
});

// 17 §6 / §5: una sola reparación acotada por paso de validación.
export const MAX_REPARACIONES_JSON = 1;
// 17 §6: hasta dos reintentos de TRANSPORTE (no son reintentos forenses).
export const MAX_REINTENTOS_TRANSPORTE = 2;
// 03: máximo dos reintentos forenses por caso.
export const MAX_REINTENTOS_FORENSES = 2;

// db/028 — complemento IA tras el auditor determinista. Espejo DOCUMENTAL de
// forense.config_presupuesto / forense.config_ia: la fuente que se aplica es la
// DB (reserve_request) más el tope de turnos de decidir-paso.
//  - Exactamente 5 especialistas por investigación (D,F,R,T,E): índice único
//    (investigacion_id, familia). Sin auditor/defensor/réplica/redactor LLM.
//  - Modelo de workers: sonnet (verificado por smoke). haiku costaría ~1/3 por
//    token pero NO tiene smoke: tras el smoke, `update forense.config_ia set
//    valor='claude-haiku-4-5-20251001' where clave='modelo_workers'`.
//  - Precios en forense.precios_modelo: SUPUESTOS sin verificar.
export const COMPLEMENTO_IA = Object.freeze({
  roles: Object.freeze(['documental', 'financiero', 'relacional', 'temporal', 'externo']),
  modelo_workers: 'claude-sonnet-5',
  modelo_respaldo_barato_sin_smoke: 'claude-haiku-4-5-20251001',
  requests_por_ejecucion: 8,
  tokens_por_ejecucion: 120_000,
  tokens_por_investigacion: 500_000,
  usd_por_ejecucion: 1.5,
  usd_por_investigacion: 5.0,
  max_reparaciones_json: 1,
  max_recuperaciones_paso: 2,
  herramienta_salida: 'forense_entregar_salida',
});
