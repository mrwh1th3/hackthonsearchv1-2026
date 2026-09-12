// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/construir-cuerpo.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: compone el body de /v1/messages con el system embebido y el transcript del checkpoint (17 §5.2).

const paso = $('Decidir accion').first().json;
const ejecucion = $('Cargar ejecución').first().json;
const reserva = $input.first().json;
const x = Object.assign({}, ejecucion, paso, {
  request_id: reserva.request_id ?? paso.request_id,
  mensajes: (ejecucion.checkpoint || {}).mensajes,
  sin_herramientas: paso.motivo_request === 'reparacion',
  max_tokens: MAX_TOKENS_SALIDA[ejecucion.rol] ?? 2000,
  techo_caracteres: CATALOGO_PROMPTS.techos[ejecucion.rol] ?? 0,
  catalogo_prompts: CATALOGO_PROMPTS,
});
const SEPARADOR = '\n\n---\n\n';
const AMBITO_TECHO = 'paquete';
const ESPECIALISTAS = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];
const catalogo = x.catalogo_prompts || null;
const rol = x.rol;

// --- system: del catálogo embebido, salvo que el backend lo imponga entero.
let system = x.system;
let versionPrompts = x.version_prompts || (catalogo ? catalogo.version_prompts : null);
let promptHash = x.prompt_hash || null;
let herramientas = Array.isArray(x.herramientas) ? x.herramientas : null;

if (!system && Array.isArray(x.system_bloques) && x.system_bloques.length > 0) {
  system = x.system_bloques.join(SEPARADOR);
}
if (!system) {
  if (!catalogo) throw new Error('system ausente: falta el catálogo de prompts embebido');
  const r = catalogo.roles[rol];
  if (!r) throw new Error(`rol sin prompt en el catálogo embebido: ${String(rol)}`);
  const paquete = x.paquete || {};
  const ronda = Number(x.ronda === undefined || x.ronda === null ? (paquete.ronda || 1) : x.ronda);
  // Reparación acotada: sin herramientas (17 §5.8). Ronda informada añade
  // `forense_leer_senal` solo a los especialistas (03 rondas, 06 ACL).
  const tools = x.sin_herramientas === true
    ? []
    : (ronda >= 2 && ESPECIALISTAS.indexOf(rol) >= 0 ? r.tools_r2 : r.tools_r1);
  const l = paquete.limites || {};
  const c = paquete.cobertura || {};
  const familias = paquete.familias_evaluables || [];
  const ausentes = (c.datos_ausentes || []).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  const identidad = [
    '## Identidad y límites (fijados por el runner, no negociables)',
    `rol=${rol} ronda=${paquete.ronda} intento=${paquete.intento} version_contexto=${paquete.version_contexto}`,
    `corrida=${paquete.corrida_id} caso=${paquete.caso_id} cluster=${paquete.cluster_id}`,
    `fecha_corte=${paquete.fecha_corte} dataset_hash=${paquete.dataset_hash}`,
    `familias_evaluables=${familias.join(',') || '(ninguna)'}`,
    `limites: tools_restantes=${l.tools_restantes} requests_restantes=${l.requests_restantes} deadline_at=${l.deadline_at} input_tokens_max=${l.input_tokens_max}`,
    `cobertura: completa=${c.completa} periodo=${c.periodo ? `${c.periodo.desde}..${c.periodo.hasta_exclusivo} ${c.periodo.timezone}` : 'no declarado'} datos_ausentes=${ausentes.join('; ') || 'ninguno'}`,
    'Todas las ventanas se calculan contra fecha_corte. No puedes cambiar identidad, cuotas ni conjunto de RFC autorizado.',
  ].join('\n');
  const listaTools = tools.length === 0
    ? 'Ninguna. No tienes herramientas: no simules llamadas ni pidas datos nuevos.'
    : tools.map((t) => `- ${t}`).join('\n');
  system = [
    catalogo.comun,
    r.instrucciones,
    `## Contrato de salida\n\n${r.contrato}`,
    `## Herramientas permitidas en esta tarea\n\n${listaTools}\nCualquier otra herramienta está denegada en el backend; intentarla gasta presupuesto y queda en bitácora.`,
    identidad,
  ].join(SEPARADOR);
  versionPrompts = catalogo.version_prompts;
  promptHash = promptHash || `${catalogo.version_prompts}:${rol}`;
  if (herramientas === null) herramientas = r.definiciones_tools ? tools.map((t) => r.definiciones_tools[t]).filter(Boolean) : [];
}

if (!x.modelo) throw new Error('modelo ausente: se resuelve de configuración, nunca del prompt');
if (!Array.isArray(x.mensajes) || x.mensajes.length === 0) {
  throw new Error('mensajes ausentes: el checkpoint debe traer al menos el paquete de contexto');
}
// Todo tool_use del último assistant debe tener su tool_result en el
// siguiente user: compactar borrando pares rompe el protocolo (17 §7).
const ultimoAssistant = [...x.mensajes].reverse().find((m) => m.role === 'assistant');
if (ultimoAssistant) {
  const usos = (ultimoAssistant.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.id);
  if (usos.length > 0) {
    const indice = x.mensajes.lastIndexOf(ultimoAssistant);
    const siguiente = x.mensajes[indice + 1];
    const resueltos = ((siguiente && siguiente.content) || [])
      .filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    const faltantes = usos.filter((id) => resueltos.indexOf(id) < 0);
    if (faltantes.length > 0) throw new Error(`faltan tool_result para: ${faltantes.join(', ')}`);
  }
}

// Techo de caracteres con ámbito 'paquete': mide los mensajes, no el system.
const techo = Number(x.techo_caracteres ?? (catalogo && catalogo.techos ? catalogo.techos[rol] : 0) ?? 0);
const caracteresPaquete = JSON.stringify(x.mensajes).length;
if (techo > 0 && caracteresPaquete > techo) {
  throw new Error(`el paquete de contexto (${caracteresPaquete} caracteres) supera el techo de ${techo} del rol ${rol}`);
}

const cuerpo = {
  model: x.modelo,
  max_tokens: Number(x.max_tokens ?? 2000),
  temperature: x.temperatura === undefined || x.temperatura === null ? 0 : Number(x.temperatura),
  system,
  messages: x.mensajes,
};
const lista = Array.isArray(herramientas) ? herramientas : [];
// Reparación acotada y roles sin tools (Réplica, Redactor, Editor) no reciben
// la clave `tools` (17 §5.8).
if (x.sin_herramientas !== true && lista.length > 0) {
  cuerpo.tools = lista;
  cuerpo.tool_choice = { type: 'auto' };
}
const salida = {
  execution_id: x.execution_id ?? null,
  owner: x.owner ?? null,
  fencing_token: x.fencing_token ?? null,
  revision: x.revision ?? null,
  caso_id: x.caso_id ?? null,
  corrida_id: x.corrida_id ?? null,
  tarea_id: x.tarea_id ?? null,
  rol: rol ?? null,
  paso: x.paso ?? null,
  paso_pipeline: x.paso_pipeline ?? null,
  request_id: x.request_id ?? null,
  modelo: x.modelo,
  cuerpo,
  system,
  herramientas_enviadas: cuerpo.tools ? cuerpo.tools.length : 0,
  version_prompts: versionPrompts,
  prompt_hash: promptHash,
  ambito_techo: AMBITO_TECHO,
  caracteres_system: system.length,
  caracteres_paquete: caracteresPaquete,
};
return [{ json: salida }];
