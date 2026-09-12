// n8n/runtime/nodos/construir-cuerpo.mjs — fuente del Code node «Construir
// cuerpo Messages» del worker (17 §5.2 y §5.3).
//
// Dos insumos con dueños distintos:
//
//  - El **system** se arma aquí desde el catálogo de prompts que
//    `n8n/runtime/generar-workflows.mjs` EMBEBE en el Code node en tiempo de
//    generación (bloque común + rol + contrato de salida + allowlist, leídos de
//    `n8n/prompts/` y sellados con el `version_prompts` del manifest). Así el
//    worker no depende de una tabla de prompts que todavía no existe y el JSON
//    exportado declara qué versión de prompts lleva dentro. Un cambio en
//    `n8n/prompts/` sin regenerar hace fallar `--check`.
//  - Los **mensajes** salen del checkpoint (transcript persistido) y el paquete
//    de contexto del artefacto inmutable: los construye el backend, no el nodo.
//
// El modelo se resuelve de configuración de cuenta, nunca del prompt del
// usuario ni de un campo `_untrusted`. El techo de caracteres se aplica con
// `ambito_techo='paquete'` (decisión del coordinador H3 01:36): los 12k/24k de
// 08 + 17 §7 miden el paquete de contexto, no el system, que tiene su propia
// medición en el manifest.

// Las constantes de la gramática de variantes las publica el ensamblador. Aquí se
// IMPORTAN para el uso como módulo; dentro del Code node exportado llegan inyectadas
// por `n8n/runtime/generar-workflows.mjs` (mismo valor, sellado en el JSON).
import {
  MOTIVOS_REINTENTO, ROLES_CON_REINTENTO, VARIANTE_REINTENTO_SIN_MOTIVO, FEWSHOT_POR_ROL,
} from '../../prompts/ensamblar.mjs';

const ROLES_FEWSHOT = Object.keys(FEWSHOT_POR_ROL);

export function construirCuerpoNodo(x) {
  // <<<CODE_NODE_INICIO
  const SEPARADOR = '\n\n---\n\n';
  const AMBITO_TECHO = 'paquete';
  const ESPECIALISTAS = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];
  const catalogo = x.catalogo_prompts || null;
  const rol = x.rol;

  // --- variante de prompt y aviso de reintento (decisión H9 07:33).
  // Gramática publicada (n8n/prompts/README.md y tests/prompts/gramatica.test.mjs):
  //   variante := <rol> ["+fewshot"] ["+reintento:" (<motivo> | "sin_motivo")]
  // Fuente de verdad: `meta` del ensamblado cuando el backend lo corrió. Cuando el
  // system se arma AQUÍ desde el catálogo embebido no hay `meta`, así que se deriva
  // con las mismas constantes que exporta n8n/prompts/ensamblar.mjs, inyectadas por
  // el generador. `n8n/tests/variante-prompt.test.mjs` fija que las dos coincidan:
  // si divergen, `prompt_hash` deriva en silencio y 10 compara corridas distintas.
  const metaEnsamblado = x.meta && typeof x.meta === 'object' ? x.meta : null;
  const paqueteVar = x.paquete || {};
  const intentoVar = Number(x.intento === undefined || x.intento === null ? (paqueteVar.intento || 0) : x.intento) || 0;
  const motivoBruto = x.motivo_reintento || paqueteVar.motivo_reintento || null;
  const motivoVar = MOTIVOS_REINTENTO.indexOf(motivoBruto) >= 0 ? motivoBruto : null;
  // `fewshot` para un rol sin ejemplo adversarial no existe: se ignora en vez de
  // tumbar el paso (el ensamblado sí lanza, pero aquí ya no hay a quién devolver).
  const fewshotVar = x.fewshot === true && ROLES_FEWSHOT.indexOf(rol) >= 0;
  const sinMotivoVar = motivoVar === null && intentoVar >= 1 && ROLES_CON_REINTENTO.indexOf(rol) >= 0;
  const varianteDerivada = [rol]
    .concat(fewshotVar ? ['fewshot'] : [])
    .concat(motivoVar ? [`reintento:${motivoVar}`] : [])
    .concat(sinMotivoVar ? [VARIANTE_REINTENTO_SIN_MOTIVO] : [])
    .join('+');
  const avisoDerivado = sinMotivoVar
    ? `motivo_reintento_ausente: el paquete declara intento=${intentoVar} y el ensamblado no recibió motivo tipificado (${MOTIVOS_REINTENTO.join('|')}); se usó el bloque genérico y la variante quedó como ${VARIANTE_REINTENTO_SIN_MOTIVO}.`
    : null;
  const variantePrompt = metaEnsamblado && metaEnsamblado.variante_prompt
    ? metaEnsamblado.variante_prompt
    : varianteDerivada;
  const avisoReintento = metaEnsamblado && metaEnsamblado.aviso_reintento !== undefined
    ? metaEnsamblado.aviso_reintento
    : avisoDerivado;

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
    // Respaldo del prompt_hash: identifica la VARIANTE, no el rol. Dos llamadas del
    // mismo rol con y sin reintento producen prompts distintos; colapsarlas en un
    // hash igual hacía irreproducible la comparación de corridas de 10.
    promptHash = promptHash || `${catalogo.version_prompts}:${variantePrompt}`;
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
    variante_prompt: variantePrompt,
    intento: intentoVar,
    motivo_reintento: motivoVar,
    // Hueco declarado, no excepción: el nodo siguiente lo escribe en
    // `forense.bitacora` (regla 2). `null` cuando no hubo degradación.
    aviso_reintento: avisoReintento,
    ambito_techo: AMBITO_TECHO,
    caracteres_system: system.length,
    caracteres_paquete: caracteresPaquete,
  };
  // <<<CODE_NODE_FIN
  return salida;
}
