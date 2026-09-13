// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/interpretar-respuesta.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: stop_reason, cola de tool_use y parseo de salida (17 §5.5–5.8).

const paso = $('Decidir accion').first().json;
const ejecucion = $('Cargar ejecución').first().json;
const x = Object.assign({}, paso, {
  rol: ejecucion.rol,
  respuesta: $('POST /v1/messages').first().json,
  mensajes_previos: ($('Construir cuerpo Messages').first().json.cuerpo || {}).messages ?? (ejecucion.checkpoint || {}).mensajes ?? [],
});
const REQUERIDAS = {
  documental: ['senal_ids', 'resumen', 'limitaciones'],
  financiero: ['senal_ids', 'resumen', 'limitaciones'],
  relacional: ['senal_ids', 'resumen', 'limitaciones'],
  temporal: ['senal_ids', 'resumen', 'limitaciones'],
  externo: ['senal_ids', 'resumen', 'limitaciones'],
  auditor: ['rfc_principal', 'rfcs_satelite', 'tipologia', 'hipotesis', 'evidencia', 'limitaciones'],
  defensor: ['argumentos'],
  replica: ['resoluciones'],
  redactor: ['markdown'],
  editor: [],
};
const CONTRATO = {
  documental: 'agents.especialista', financiero: 'agents.especialista',
  relacional: 'agents.especialista', temporal: 'agents.especialista',
  externo: 'agents.especialista', auditor: 'agents.auditor',
  defensor: 'agents.defensor', replica: 'agents.replica',
  redactor: 'agents.redactor', editor: 'agents.editor',
};
// evento → estado interno destino desde `solicitar_modelo`. Es la parte de
// TRANSICIONES (checkpoint.mjs) que necesita este nodo; un Code node no puede
// importar el módulo, así que se inlinea y un test compara ambas tablas.
// Sin esto, `Guardar checkpoint` escribiría el estado de origen y el IF
// «¿Estado terminal?» del worker decidiría sobre un estado que ya cambió.
const DESTINO = {
  tool_use: 'ejecutar_herramienta',
  end_turn: 'validar_salida',
  max_tokens: 'reparar_json',
  refusal: 'error',
};
const rol = x.rol;
const identidad = {
  execution_id: x.execution_id ?? null,
  owner: x.owner ?? null,
  fencing_token: x.fencing_token ?? null,
  revision: x.revision ?? null,
  caso_id: x.caso_id ?? null,
  corrida_id: x.corrida_id ?? null,
  tarea_id: x.tarea_id ?? null,
  paso: x.paso ?? null,
  paso_pipeline: x.paso_pipeline ?? null,
  request_id: x.request_id ?? null,
};
const cuerpo = (x.respuesta && x.respuesta.body) ? x.respuesta.body : (x.body ?? {});
const stop = cuerpo.stop_reason ?? null;
const bloques = Array.isArray(cuerpo.content) ? cuerpo.content : [];
const comun = Object.assign({}, identidad, {
  provider_request_id: cuerpo.id ?? null,
  usage: cuerpo.usage ?? null,
  modelo: cuerpo.model ?? null,
  stop_reason: stop,
  bloques_assistant: bloques,
  rol,
  contrato: CONTRATO[rol] ?? null,
  requiere_validacion_contrato: true,
});

// Salida estructurada forzada: el especialista entrega llamando a esta
// herramienta (construir-cuerpo la añade y la fuerza en reparación/último
// turno). Su `input` ES la salida; nunca se ejecuta como herramienta.
const SALIDA_TOOL = 'forense_entregar_salida';
const estructura = (valor, texto) => {
  const requeridas = REQUERIDAS[rol] ?? [];
  const faltan = requeridas.filter((k) => valor[k] === undefined);
  const sobran = requeridas.length > 0 ? Object.keys(valor).filter((k) => requeridas.indexOf(k) < 0) : [];
  const errores = faltan.map((k) => ({ instancePath: `/${k}`, message: 'campo requerido ausente' }))
    .concat(sobran.map((k) => ({ instancePath: `/${k}`, message: 'campo no permitido por el contrato' })));
  return errores.length > 0
    ? Object.assign({}, comun, { tipo: 'schema_invalido', evento: 'end_turn', texto, salida: valor, errores })
    : Object.assign({}, comun, { tipo: 'salida_estructura_ok', evento: 'end_turn', salida: valor, errores: [] });
};
const entrega = bloques.find((b) => b.type === 'tool_use' && b.name === SALIDA_TOOL);

let salida;
if (entrega) {
  const valor = entrega.input;
  salida = valor && typeof valor === 'object' && !Array.isArray(valor)
    ? estructura(valor, null)
    : Object.assign({}, comun, { tipo: 'json_invalido', evento: 'end_turn', cola: [], errores: [{ instancePath: '/', message: 'la entrega no trae un objeto' }] });
  salida.via = 'herramienta_salida';
} else if (stop === 'tool_use') {
  const cola = bloques.filter((b) => b.type === 'tool_use')
    .map((b) => ({ tool_use_id: b.id, nombre: b.name, argumentos: b.input ?? {} }));
  salida = cola.length > 0
    ? Object.assign({}, comun, {
      tipo: 'tool_use', cola, evento: 'tool_use',
      // TODOS los tool_use de esta respuesta, en orden, no solo el primero.
      pending_tool_use_ids: cola.map((t) => t.tool_use_id),
    })
    : Object.assign({}, comun, { tipo: 'json_invalido', evento: 'end_turn', cola: [], diagnostico: 'stop_reason=tool_use sin bloques tool_use' });
} else if (stop === 'max_tokens') {
  // Salida truncada: jamás se persiste como informe válido (17 §7).
  salida = Object.assign({}, comun, {
    tipo: 'incompleto', evento: 'max_tokens', salida_valida: null,
    texto: bloques.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    diagnostico: 'salida truncada por max_tokens; no es un informe válido',
  });
} else if (stop === 'refusal') {
  salida = Object.assign({}, comun, { tipo: 'refusal', evento: 'refusal', diagnostico: 'el proveedor rechazó continuar' });
} else if (stop === 'end_turn' || stop === 'stop_sequence') {
  const texto = bloques.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const sinValla = texto.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const candidatos = [sinValla];
  const abre = sinValla.indexOf('{');
  const cierra = sinValla.lastIndexOf('}');
  if (abre >= 0 && cierra > abre) candidatos.push(sinValla.slice(abre, cierra + 1));
  let valor = null;
  for (const candidato of candidatos) {
    try {
      const parsed = JSON.parse(candidato);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { valor = parsed; break; }
    } catch (e) { /* siguiente candidato */ }
  }
  if (valor === null) {
    // «No es JSON» es REPARABLE: va a validar_salida, que falla, y decidir-paso
    // concede UNA reparación forzando la herramienta de salida.
    salida = Object.assign({}, comun, { tipo: 'json_invalido', evento: 'end_turn', texto, errores: [{ instancePath: '/', message: 'no se pudo parsear un objeto JSON' }] });
  } else {
    salida = estructura(valor, texto);
  }
} else {
  salida = Object.assign({}, comun, {
    tipo: 'stop_desconocido', evento: 'refusal',
    diagnostico: `stop_reason no soportada: ${String(stop)}`,
  });
}
// El destino del checkpoint sale de la tabla, no de una rama suelta: un
// `evento` sin destino conocido es error explícito, nunca avance silencioso.
salida.estado_interno = DESTINO[salida.evento] ?? 'error';
// Transcript completo: jamás se compacta borrando pares tool_use/tool_result
// (17 §7). El assistant entra entero, con sus bloques tool_use.
const previos = Array.isArray(x.mensajes_previos) ? x.mensajes_previos : [];
const mensajes = bloques.length > 0
  ? previos.concat([{ role: 'assistant', content: bloques }])
  : previos;
// Texto visible del turno (sin thinking) para el pizarrón y las
// herramientas pedidas, para la telemetría en vivo (db/028).
salida.texto_turno = bloques.filter((b) => b.type === 'text').map((b) => b.text).join('\n').slice(0, 600);
salida.herramientas_turno = bloques.filter((b) => b.type === 'tool_use' && b.name !== SALIDA_TOOL).map((b) => b.name);
salida.checkpoint = {
  estado_interno: salida.estado_interno,
  // Contadores persistidos: sin ellos el tope de reparación y de turnos no existe.
  reparaciones_json: Number(x.reparaciones_json ?? 0) + (x.motivo_request === 'reparacion' ? 1 : 0),
  turnos: Number(x.turnos ?? 0) + 1,
  mensajes,
  cola_tools: salida.tipo === 'tool_use' ? salida.cola : [],
  pending_tool_use_ids: salida.tipo === 'tool_use' ? salida.cola.map((t) => t.tool_use_id) : [],
  request_id: identidad.request_id,
  salida_valida: null,
  ultimo_evento: salida.evento,
};
return [{ json: salida }];
