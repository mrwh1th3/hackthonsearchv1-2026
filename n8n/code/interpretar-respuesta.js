// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/interpretar-respuesta.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: stop_reason, cola de tool_use y parseo de salida (17 §5.5–5.8).

const x = $input.first().json;
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
const rol = x.rol;
const cuerpo = (x.respuesta && x.respuesta.body) ? x.respuesta.body : (x.body ?? {});
const stop = cuerpo.stop_reason ?? null;
const bloques = Array.isArray(cuerpo.content) ? cuerpo.content : [];
const comun = {
  provider_request_id: cuerpo.id ?? null,
  usage: cuerpo.usage ?? null,
  modelo: cuerpo.model ?? null,
  stop_reason: stop,
  bloques_assistant: bloques,
  rol,
  contrato: CONTRATO[rol] ?? null,
  requiere_validacion_contrato: true,
};

let salida;
if (stop === 'tool_use') {
  const cola = bloques.filter((b) => b.type === 'tool_use')
    .map((b) => ({ tool_use_id: b.id, nombre: b.name, argumentos: b.input ?? {} }));
  salida = cola.length > 0
    ? Object.assign({}, comun, { tipo: 'tool_use', cola, evento: 'tool_use' })
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
    salida = Object.assign({}, comun, { tipo: 'json_invalido', evento: 'end_turn', texto, errores: [{ instancePath: '/', message: 'no se pudo parsear un objeto JSON' }] });
  } else {
    const requeridas = REQUERIDAS[rol] ?? [];
    const faltan = requeridas.filter((k) => valor[k] === undefined);
    const sobran = requeridas.length > 0 ? Object.keys(valor).filter((k) => requeridas.indexOf(k) < 0) : [];
    const errores = faltan.map((k) => ({ instancePath: `/${k}`, message: 'campo requerido ausente' }))
      .concat(sobran.map((k) => ({ instancePath: `/${k}`, message: 'campo no permitido por el contrato' })));
    salida = errores.length > 0
      ? Object.assign({}, comun, { tipo: 'schema_invalido', evento: 'end_turn', texto, salida: valor, errores })
      : Object.assign({}, comun, { tipo: 'salida_estructura_ok', evento: 'end_turn', salida: valor, errores: [] });
  }
} else {
  salida = Object.assign({}, comun, {
    tipo: 'stop_desconocido', evento: 'refusal',
    diagnostico: `stop_reason no soportada: ${String(stop)}`,
  });
}
return [{ json: salida }];
