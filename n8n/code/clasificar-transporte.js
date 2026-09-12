// ARCHIVO GENERADO — no editar a mano.
// Fuente: ../runtime/nodos/clasificar-transporte.mjs (región CODE_NODE). Regenerar: node n8n/runtime/generar-code-nodes.mjs
// Worker: 429/5xx con Retry-After, timeout ambiguo (17 §6).

const x = $input.first().json;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
const MAX_REINTENTOS = Number(x.max_reintentos ?? 2);
const status = x.status === undefined ? null : x.status;
const tipo = x.tipo ?? null;
const intento = Number(x.intento ?? 1);
const ahora = Number(x.ahora_ms ?? Date.parse(x.ahora ?? new Date().toISOString()));
const limite = x.deadline_at ? Date.parse(x.deadline_at) : Number.POSITIVE_INFINITY;
const headers = x.headers ?? {};

let clase;
if (tipo === 'timeout' || tipo === 'conexion_interrumpida') clase = 'ambiguo';
else if (status === null) clase = 'error';
else if (status >= 200 && status < 300) clase = 'ok';
else if (status === 429 || status === 408 || status >= 500) clase = 'reintentable';
else clase = 'error';

const crudo = headers['retry-after'] ?? headers['Retry-After'] ?? null;
let segundos = null;
if (crudo !== null && crudo !== undefined && crudo !== '') {
  const numero = Number(crudo);
  if (Number.isFinite(numero)) segundos = numero;
  else {
    const fecha = Date.parse(String(crudo));
    if (Number.isFinite(fecha)) segundos = Math.max(0, (fecha - ahora) / 1000);
  }
}
const aleatorio = x.aleatorio === undefined || x.aleatorio === null ? Math.random() : Number(x.aleatorio);
const techo = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, intento - 1)));
const espera_ms = segundos !== null ? Math.max(0, Math.round(segundos * 1000)) : Math.round(techo * aleatorio);

const cabeEnDeadline = ahora + espera_ms < limite;
const reintentar = clase === 'reintentable' && intento <= MAX_REINTENTOS && cabeEnDeadline;
// Ruta EXCLUYENTE para el switch del workflow: una respuesta correcta no
// puede caer además en la rama de «desconocido».
let ruta;
if (clase === 'ok') ruta = 'continuar';
else if (reintentar) ruta = 'reintentar';
else if (clase === 'ambiguo') ruta = 'desconocido';
else ruta = 'error';
const salida = {
  clase,
  ruta,
  espera_ms: reintentar ? espera_ms : 0,
  intento,
  reintentar,
  retry_after_respetado: segundos !== null,
  motivo: clase === 'ambiguo'
    ? 'timeout_ambiguo: posible consumo externo sin respuesta; no se reintenta automáticamente'
    : clase === 'reintentable' && !reintentar
      ? (cabeEnDeadline ? 'reintentos_transporte_agotados' : 'deadline_excedido')
      : null,
};
return [{ json: salida }];
