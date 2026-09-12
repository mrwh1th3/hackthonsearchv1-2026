// Importa/actualiza los workflows FORENSE_* en n8n vía API pública (n8n 2.33.7).
// Uso: node scripts/n8n-import.mjs [--dry-run] [--only FORENSE_x,...]
// Requiere en .env: N8N_BASE (https://host) y N8N_API_KEY. Nunca activa workflows.
// Resuelve PENDIENTE_FORENSE_* por nombre → ID real y BASE_REST por SUPABASE_URL.
// Escribe reports/handoff/n8n-ids.json (manifest de IDs reales, 17 §2).
import fs from 'node:fs';
import path from 'node:path';
import { leerEnv, exigir, root } from './env.mjs';

const ORDEN = ['FORENSE_ejecutar_agente', 'FORENSE_reintento', 'FORENSE_editar_expediente', 'FORENSE_investigar_cluster',
  'FORENSE_corrida', 'FORENSE_inyectar', 'FORENSE_notificar_completada', 'FORENSE_resultado_llamada', 'FORENSE_reconciliador', 'FORENSE_errores'];
const PENDIENTE = {
  PENDIENTE_FORENSE_EJECUTAR_AGENTE: 'FORENSE_ejecutar_agente', PENDIENTE_FORENSE_REINTENTO: 'FORENSE_reintento',
  PENDIENTE_FORENSE_NOTIFICAR_COMPLETADA: 'FORENSE_notificar_completada', PENDIENTE_FORENSE_INVESTIGAR_CLUSTER: 'FORENSE_investigar_cluster',
  PENDIENTE_FORENSE_EDITAR_EXPEDIENTE: 'FORENSE_editar_expediente', PENDIENTE_FORENSE_CORRIDA: 'FORENSE_corrida', PENDIENTE_FORENSE_INYECTAR: 'FORENSE_inyectar',
};
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean) : [];
const env = leerEnv();
if (!dry) exigir(env, ['N8N_BASE', 'N8N_API_KEY']);
const base = (env.N8N_BASE || 'https://n8n.srv1550651.hstgr.cloud').replace(/\/$/, '');
const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const manifestPath = path.join(root, 'reports', 'handoff', 'n8n-ids.json');
const ids = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).ids ?? {} : {};

async function api(metodo, ruta, body) {
  const r = await fetch(`${base}/api/v1${ruta}`, {
    method: metodo, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* texto plano */ }
  if (!r.ok) throw new Error(`${metodo} ${ruta} → HTTP ${r.status}: ${(json && json.message) || texto.slice(0, 300)}`);
  return json;
}
async function buscarPorNombre(nombre) {
  const r = await api('GET', `/workflows?limit=100`);
  return (r.data || []).find(w => w.name === nombre) || null;
}
function preparar(nombre, wf) {
  let texto = JSON.stringify(wf);
  const sinResolver = [];
  for (const [ph, destino] of Object.entries(PENDIENTE)) {
    if (!texto.includes(ph)) continue;
    if (ids[destino]) texto = texto.split(ph).join(ids[destino]); else sinResolver.push(`${ph}→${destino}`);
  }
  if (supabaseUrl) texto = texto.split('https://PENDIENTE_SUPABASE_REF.supabase.co').join(supabaseUrl);
  const w = JSON.parse(texto);
  // La API pública solo admite estos campos en create/update.
  const cuerpo = { name: nombre, nodes: w.nodes, connections: w.connections, settings: w.settings || { executionOrder: 'v1' } };
  if (w.staticData) cuerpo.staticData = w.staticData;
  return { cuerpo, sinResolver };
}
const resumen = [];
for (const nombre of ORDEN) {
  if (only.length && !only.includes(nombre)) continue;
  const archivo = path.join(root, 'n8n', 'workflows', `${nombre}.json`);
  if (!fs.existsSync(archivo)) { resumen.push({ nombre, estado: 'archivo ausente' }); continue; }
  const wf = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const { cuerpo, sinResolver } = preparar(nombre, wf);
  if (dry) { resumen.push({ nombre, nodos: cuerpo.nodes.length, sinResolver, estado: 'dry-run' }); continue; }
  try {
    const existente = await buscarPorNombre(nombre);
    const res = existente ? await api('PUT', `/workflows/${existente.id}`, cuerpo) : await api('POST', '/workflows', cuerpo);
    ids[nombre] = res.id;
    if (res.active) console.warn(`AVISO: ${nombre} quedó activo; desactívalo hasta el smoke.`);
    resumen.push({ nombre, id: res.id, nodos: cuerpo.nodes.length, sinResolver, estado: existente ? 'actualizado' : 'creado', active: !!res.active });
  } catch (e) { resumen.push({ nombre, estado: 'ERROR', error: String(e.message).slice(0, 400) }); break; }
}
// Segunda pasada: los que se importaron con PENDIENTE_* antes de conocer el ID destino.
if (!dry) {
  for (const fila of resumen.filter(f => f.id && f.sinResolver && f.sinResolver.length)) {
    const wf = JSON.parse(fs.readFileSync(path.join(root, 'n8n', 'workflows', `${fila.nombre}.json`), 'utf8'));
    const { cuerpo, sinResolver } = preparar(fila.nombre, wf);
    if (sinResolver.length) { fila.sinResolver = sinResolver; continue; }
    try { await api('PUT', `/workflows/${fila.id}`, cuerpo); fila.sinResolver = []; fila.estado += '+ids'; }
    catch (e) { fila.estado = 'ERROR 2a pasada'; fila.error = String(e.message).slice(0, 300); }
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ base, actualizado: new Date().toISOString(), ids, resumen }, null, 2) + '\n');
}
console.table(resumen.map(f => ({ nombre: f.nombre, estado: f.estado, id: f.id || '', nodos: f.nodos || '', sinResolver: (f.sinResolver || []).length, error: f.error || '' })));
process.exitCode = resumen.some(f => f.estado.startsWith('ERROR')) ? 1 : 0;
