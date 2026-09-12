// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/normalizar-investigacion.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Investigación: une webhook y subworkflow; rechaza campos no aceptados.

const x = $input.first().json;
const PROHIBIDOS = ['system', 'system_prompt', 'prompt', 'instrucciones_sistema',
  'telefono', 'to_number', 'destinatario', 'model', 'modelo', 'nivel', 'dictamen',
  'service_role', 'apikey', 'authorization'];
const crudo = x.body ?? x;
const presentes = PROHIBIDOS.filter((k) => crudo[k] !== undefined);
if (presentes.length > 0) {
  throw new Error(`campos no aceptados en el payload: ${presentes.join(', ')}`);
}
const corrida_id = crudo.corrida_id ?? null;
if (!corrida_id) throw new Error('corrida_id obligatorio: nunca se elige corrida por aproximación');
const cluster_id = crudo.cluster_id ?? null;
const origen = crudo.origen ?? null;
const valor = crudo.valor ?? null;
if (!cluster_id && !(origen && valor)) {
  throw new Error('se requiere cluster_id, o bien origen + valor para resolver el cluster');
}
const idempotency_key = crudo.idempotency_key ?? null;
if (!idempotency_key) throw new Error('idempotency_key obligatoria: misma clave devuelve el mismo caso');
const salida = {
  corrida_id,
  cluster_id,
  origen,
  valor_untrusted: valor,
  investigacion_id: crudo.investigacion_id ?? null,
  idempotency_key,
  entrada: x.body ? 'webhook' : 'subworkflow',
};
return [{ json: salida }];
