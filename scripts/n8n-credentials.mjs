// Crea (si no existen) las credenciales por NOMBRE que referencian los workflows FORENSE_*.
// Uso: node scripts/n8n-credentials.mjs [--dry-run]
// Lee de .env: N8N_BASE, N8N_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
// INTERNAL_WEBHOOK_SECRET, ELEVENLABS_API_KEY (opcional). Nunca imprime valores.
import { leerEnv, exigir } from './env.mjs';

const dry = process.argv.includes('--dry-run');
const env = leerEnv();
if (!dry) exigir(env, ['N8N_BASE', 'N8N_API_KEY']);
const base = (env.N8N_BASE || '').replace(/\/$/, '');
async function api(metodo, ruta, body) {
  const r = await fetch(`${base}/api/v1${ruta}`, { method: metodo, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  if (!r.ok) throw new Error(`${metodo} ${ruta} → HTTP ${r.status}: ${(j && j.message) || t.slice(0, 300)}`);
  return j;
}
function pg(url) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432), database: u.pathname.replace(/^\//, '') || 'postgres', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), ssl: /supabase\.co$/.test(u.hostname) ? 'require' : 'disable' };
}
const plan = [];
if (env.SUPABASE_DB_URL) plan.push({ name: 'Forense Postgres', type: 'postgres', data: pg(env.SUPABASE_DB_URL) }); else plan.push({ name: 'Forense Postgres', omitida: 'falta SUPABASE_DB_URL' });
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) plan.push({ name: 'Forense Supabase', type: 'supabaseApi', data: { host: env.SUPABASE_URL.replace(/\/$/, ''), serviceRole: env.SUPABASE_SERVICE_ROLE_KEY } }); else plan.push({ name: 'Forense Supabase', omitida: 'faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' });
if (env.INTERNAL_WEBHOOK_SECRET) plan.push({ name: 'Forense Webhook', type: 'httpHeaderAuth', data: { name: 'x-forense-secret', value: env.INTERNAL_WEBHOOK_SECRET } }); else plan.push({ name: 'Forense Webhook', omitida: 'falta INTERNAL_WEBHOOK_SECRET' });
if (env.ELEVENLABS_API_KEY) plan.push({ name: 'ElevenLabs Forense', type: 'httpHeaderAuth', data: { name: 'xi-api-key', value: env.ELEVENLABS_API_KEY } }); else plan.push({ name: 'ElevenLabs Forense', omitida: 'falta ELEVENLABS_API_KEY (opcional)' });
const resumen = [];
for (const c of plan) {
  if (c.omitida) { resumen.push({ name: c.name, estado: `omitida: ${c.omitida}` }); continue; }
  if (dry) { resumen.push({ name: c.name, type: c.type, estado: 'dry-run', campos: Object.keys(c.data).join(',') }); continue; }
  try {
    const res = await api('POST', '/credentials', { name: c.name, type: c.type, data: c.data });
    resumen.push({ name: c.name, type: c.type, estado: 'creada', id: res.id });
  } catch (e) {
    const msg = String(e.message);
    resumen.push({ name: c.name, type: c.type, estado: /exist|duplic/i.test(msg) ? 'ya existía' : 'ERROR', error: msg.slice(0, 200) });
    if (/HTTP 400/.test(msg)) { try { const s = await api('GET', `/credentials/schema/${c.type}`); console.error(`Schema ${c.type}:`, JSON.stringify(s).slice(0, 600)); } catch { /* */ } }
  }
}
console.table(resumen);
process.exitCode = resumen.some(f => f.estado === 'ERROR') ? 1 : 0;
