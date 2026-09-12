#!/usr/bin/env node
// n8n/tests/e2e-corrida.mjs — camino COMPLETO de FORENSE_corrida contra una base
// Postgres real, con el proveedor SIMULADO.
//
// QUÉ MIDE (hallazgo alto H11): que el bucle de despacho DRENA la cola. Con más
// clusters que slots, el workflow anterior despachaba una vez y nunca volvía a
// despachar: los clusters sobrantes se quedaban sin investigar y la corrida no
// cerraba (`estado_corrida` de 012 cuenta la cola). Aquí se clona gen-v1, se
// arman los clusters reales y se corre el bucle con MAX_ACTIVOS reducido, así
// que el redespacho es obligatorio para terminar.
//
// QUÉ NO MIDE: que n8n importe el JSON, que el nodo wait espere de verdad, ni
// nada de conectividad (17 §9). Las consultas y los Code nodes se LEEN del JSON
// exportado -no se reescriben aquí-, así que una deriva del generador rompe
// este script; el orden de los nodos lo impone este runner, no n8n.
//
// El «trabajo» de FORENSE_investigar_cluster está simulado: cada vuelta termina
// UN caso con las funciones reales (crear_tareas_ronda → claim_step →
// finish_step → advance_case_if_ready → cerrar_ronda → guardar_dictamen →
// cerrar_caso). Ningún UPDATE directo y ninguna llamada al modelo. El nivel lo
// decide `auditor-final.mjs` (regla 4).
//
// No es un test de `node --test`: necesita base y datos y tarda minutos.
//
// Uso:
//   node n8n/tests/e2e-corrida.mjs [base] [--max N] [--clusters N] [--json] [--conservar]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { dictaminar, NIVELES } from '../runtime/auditor-final.mjs';

const RAIZ_N8N = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';

const args = process.argv.slice(2);
const valor = (bandera, pordefecto) => (args.includes(bandera)
  ? Number(args[args.indexOf(bandera) + 1]) : pordefecto);
const BASE = args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a))) ?? 'forense_rt';
const MAX_ACTIVOS = valor('--max', 2);
const CLUSTERS_MINIMOS = valor('--clusters', 6);
const SALIDA_JSON = args.includes('--json');
const CONSERVAR = args.includes('--conservar');
// Cota dura: un cluster atascado tiene que colgar la prueba CON diagnóstico, no
// girar para siempre. El bucle real lo acota el deadline de la corrida.
const MAX_VUELTAS = 60;

// ─────────────────────────────────────────────────────────────── utilidades

function psql(sql) {
  return execFileSync(
    PSQL,
    ['-U', 'postgres', '-h', 'localhost', '-d', BASE, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  ).trim();
}

const tiempos = [];
function paso(etiqueta, sql) {
  const t0 = Date.now();
  let salida;
  try {
    salida = psql(sql);
  } catch (err) {
    const detalle = String(err.stderr ?? err.message).split('\n').filter(Boolean)[0] ?? '';
    throw new Error(`${etiqueta}: ${detalle}`);
  }
  const ms = Date.now() - t0;
  tiempos.push({ etiqueta, ms });
  if (!SALIDA_JSON) console.log(`  · ${etiqueta.padEnd(46)} ${String(ms).padStart(6)} ms`);
  return salida;
}
const pasoJson = (etiqueta, sql) => JSON.parse(paso(etiqueta, sql) || 'null');

function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
}
const arrLit = (a) => (a.length ? `array[${a.map(lit).join(',')}]::text[]` : "'{}'::text[]");

const WORKFLOWS = new Map();
const nodoDe = (nombre, archivo = 'FORENSE_corrida') => {
  if (!WORKFLOWS.has(archivo)) {
    WORKFLOWS.set(archivo, JSON.parse(
      fs.readFileSync(path.join(RAIZ_N8N, 'workflows', `${archivo}.json`), 'utf8')));
  }
  const n = WORKFLOWS.get(archivo).nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`nodo ausente en ${archivo}: ${nombre}`);
  return n;
};

function sqlDeNodo(nombre, valores, archivo = 'FORENSE_corrida') {
  let sql = nodoDe(nombre, archivo).parameters.query;
  for (let i = valores.length; i >= 1; i -= 1) sql = sql.replaceAll(`$${i}`, lit(valores[i - 1]));
  return sql;
}
const filaDeNodo = (etiqueta, nombre, valores, archivo = 'FORENSE_corrida') => pasoJson(
  etiqueta,
  `select coalesce(to_jsonb(t), 'null'::jsonb)::text from (${sqlDeNodo(nombre, valores, archivo)}) t limit 1`,
);
const filasDeNodo = (etiqueta, nombre, valores, archivo = 'FORENSE_corrida') => pasoJson(
  etiqueta,
  `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (${sqlDeNodo(nombre, valores, archivo)}) t`,
);

/**
 * Ejecuta un Code node TAL CUAL está en el JSON exportado, con los accesores de
 * n8n simulados. Lo ÚNICO que se cambia es el valor de la constante inyectada
 * MAX_ACTIVOS: bajarla es lo que fuerza el redespacho sin necesitar cientos de
 * clusters. Si la línea no estuviera, el script falla en vez de correr con 4.
 */
function ejecutarCodeNode(nombre, { entrada, corrida }) {
  const original = nodoDe(nombre).parameters.jsCode;
  let cuerpo = original;
  if (/const MAX_ACTIVOS = \d+;/.test(original)) {
    cuerpo = original.replace(/const MAX_ACTIVOS = \d+;/, `const MAX_ACTIVOS = ${MAX_ACTIVOS};`);
    if (cuerpo === original) throw new Error(`${nombre}: no se pudo fijar MAX_ACTIVOS`);
  }
  const items = entrada.map((json) => ({ json }));
  const $input = { all: () => items, first: () => items[0] ?? { json: {} } };
  const $ = (n) => {
    if (n === 'Validar e idempotencia') return { first: () => ({ json: corrida }) };
    throw new Error(`${nombre} pidió un nodo no simulado: ${n}`);
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$', cuerpo);
  return fn($input, $).map((i) => i.json);
}

/** El IF del workflow, leído del JSON: no se codifica «true» a mano. */
function condicionIf(nombre) {
  const c = nodoDe(nombre).parameters.conditions.conditions[0];
  const campo = String(c.leftValue).replace(/^=\{\{\s*\$json\./, '').replace(/\s*\}\}$/, '');
  return (fila) => fila[campo] === true;
}

const eventos = (corrida, tipo) => Number(psql(`select count(*) from forense.bitacora
   where corrida_id = ${lit(corrida)}::uuid and tipo_evento = ${lit(tipo)}`));

// ───────────────────────────────────────────────────────────────── arranque

const SELLO = `rt-corrida-${process.pid}-${Date.now().toString(36)}`;
const t0Total = Date.now();

for (const fn of ['cola_corrida', 'estado_corrida', 'analizar_snapshot']) {
  if (psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='forense' and p.proname=${lit(fn)}`) === '0') {
    throw new Error(`falta forense.${fn} en ${BASE}: aplica db/012 y db/014 antes de correr este e2e`);
  }
}

const CORRIDA_BASE = psql(
  "select id::text from forense.corridas where nombre = 'gen-v1' order by inicio limit 1");
if (!CORRIDA_BASE) throw new Error(`no hay corrida gen-v1 en ${BASE}`);
if (!SALIDA_JSON) {
  console.log(`base=${BASE} origen=${CORRIDA_BASE} (gen-v1) MAX_ACTIVOS=${MAX_ACTIVOS}`);
  console.log('\n── preparación de la corrida (nodos del JSON exportado)');
}

// 0. Regresión del caso degenerado: una corrida SIN clusters. `estado_corrida`
//    exige `total > 0` para declarar `terminada`, así que devuelve false y
//    `sin_clusters` indefinidamente; con el IF leyendo `terminada` a secas el
//    bucle giraba para siempre. Se comprueba con la consulta REAL del nodo
//    contra una corrida sin clusters (lectura pura, no muta nada).
const sinClusters = psql(`select id::text from forense.corridas c
   where not exists (select 1 from forense.clusters k where k.corrida_id = c.id) limit 1`);
if (sinClusters) {
  const degenerado = filaDeNodo('nodo Esperar y reconciliar (corrida sin clusters)',
    'Esperar y reconciliar', [sinClusters]);
  if (degenerado.estado_final !== 'sin_clusters' || degenerado.terminada !== false) {
    throw new Error(`el caso degenerado cambió de forma: ${JSON.stringify(degenerado)}`);
  }
  if (degenerado.cerrable !== true) {
    throw new Error('una corrida sin clusters no es `cerrable`: el bucle giraría para siempre');
  }
}

// 1. «Validar e idempotencia» → 2. «Cargar o clonar snapshot» → 3. integridad.
const idem = `${SELLO}`;
const abierta = filaDeNodo('nodo Validar e idempotencia', 'Validar e idempotencia',
  ['gen-v1-clon', idem, CORRIDA_BASE]);
const CORRIDA = abierta.corrida_id;
if (!CORRIDA || CORRIDA === CORRIDA_BASE) {
  throw new Error(`regla 10: la corrida nueva no puede ser la base (${CORRIDA})`);
}

const snapshot = filaDeNodo('nodo Cargar o clonar snapshot', 'Cargar o clonar snapshot',
  [CORRIDA, abierta.corrida_origen_id]);
const integridad = filaDeNodo('nodo Verificar integridad', 'Verificar integridad', [CORRIDA]);
if (integridad.estado !== 'lista') {
  throw new Error(`la corrida no quedó lista: ${integridad.estado} / ${integridad.causa}`);
}

const pistas = filaDeNodo('nodo Correr pistas', 'Correr pistas', [CORRIDA]);
const clusters = filaDeNodo('nodo Armar clusters', 'Armar clusters', [CORRIDA]);

// gen-v1 tiene 100 contribuyentes y `armar_clusters` le saca UN cluster: con un
// solo cluster el bucle no ejercita nada. Se completa la cola con
// `forense.armar_cluster_para` -la MISMA función que usa la ruta de inyección
// (004)- sobre los RFC con pistas que quedaron fuera de un cluster. Son
// clusters reales del snapshot, no filas inventadas, y aquí queda DECLARADO:
// el dataset no produce seis clusters por sí solo.
const completados = [];
function clustersActuales() {
  return Number(psql(`select count(*) from forense.clusters where corrida_id = ${lit(CORRIDA)}::uuid`));
}
if (clustersActuales() < CLUSTERS_MINIMOS) {
  const candidatos = pasoJson('RFC con pistas fuera de cluster', `
    select coalesce(jsonb_agg(r.rfc order by r.s desc), '[]'::jsonb)::text from (
      select p.rfc, sum(p.score) s from forense.pistas p
       where p.corrida_id = ${lit(CORRIDA)}::uuid
         and not exists (select 1 from forense.clusters k
                          where k.corrida_id = ${lit(CORRIDA)}::uuid and p.rfc = any(k.rfcs))
       group by p.rfc) r`);
  for (const rfc of candidatos) {
    if (clustersActuales() >= CLUSTERS_MINIMOS) break;
    const id = paso(`armar_cluster_para(${rfc})`,
      `select forense.armar_cluster_para(${lit(CORRIDA)}::uuid, ${lit(rfc)})::text`);
    completados.push({ rfc, cluster_id: id });
  }
}
const CLUSTERS = clustersActuales();
if (CLUSTERS < CLUSTERS_MINIMOS) {
  throw new Error(`el clon sólo llega a ${CLUSTERS} clusters y la prueba pide ${CLUSTERS_MINIMOS}`);
}

// ─────────────────────────────────────── trabajo simulado de un cluster

const ESPECIALISTAS = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];

function crearCaso(despacho) {
  const r = pasoJson(`crear_caso(${despacho.cluster_id.slice(0, 8)})`,
    `select forense.crear_caso(${lit(CORRIDA)}::uuid, ${lit(despacho.cluster_id)}::uuid,
       'pipeline', null, ${lit(despacho.idempotency_key)}, ${lit(SELLO)})::text`);
  if (r.ok !== true) throw new Error(`crear_caso falló: ${JSON.stringify(r).slice(0, 300)}`);
  return r.caso_id;
}

/**
 * Cierra un caso con las funciones reales del pipeline. El checkpoint se mueve
 * con claim_step/finish_step (nunca UPDATE sobre tareas_agente): así el paso
 * deja el mismo rastro que dejaría el worker.
 */
function completarCaso(casoId) {
  const ctx = pasoJson('preparar_contexto_ronda1',
    `select forense.preparar_contexto_ronda1(${lit(casoId)}::uuid)::text`);
  const roles = (ctx.roles_evaluables ?? ctx.agentes ?? ESPECIALISTAS).filter(Boolean);
  pasoJson('crear_tareas_ronda(1)',
    `select forense.crear_tareas_ronda(${lit(casoId)}::uuid, 1, ${arrLit(roles.length ? roles : ESPECIALISTAS)})::text`);

  // Una ejecución por tarea la crea `crear_tareas_ronda`; se reclama y se cierra
  // con el fence que devuelve el claim (17 §3): sin fence no hay escritura.
  const ejecuciones = pasoJson('ejecuciones de la ronda 1',
    `select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'rol', e.rol)), '[]'::jsonb)::text
       from forense.ejecuciones_agente e where e.caso_id = ${lit(casoId)}::uuid and e.tarea_id is not null`);
  for (const e of ejecuciones) {
    const claim = pasoJson(`claim_step(${e.rol})`,
      `select forense.claim_step(${lit(e.id)}::uuid, ${lit(`${SELLO}:${e.rol}`)})::text`);
    if (claim.ok !== true) throw new Error(`claim_step(${e.rol}) falló: ${JSON.stringify(claim).slice(0, 200)}`);
    const fin = pasoJson(`finish_step(${e.rol})`,
      `select forense.finish_step(${lit(e.id)}::uuid, ${claim.fence}::bigint,
         ${claim.revision}::int, 'terminado', '{"origen":"proveedor_simulado"}'::jsonb)::text`);
    if (fin.ok !== true) throw new Error(`finish_step(${e.rol}) falló: ${JSON.stringify(fin).slice(0, 200)}`);
  }

  const avance = pasoJson('advance_case_if_ready(ronda1)',
    `select forense.advance_case_if_ready(${lit(casoId)}::uuid, 'ronda1', NULL)::text`);
  if (avance.avanzo !== true) {
    throw new Error(`la barrera de ronda 1 no cerró: ${JSON.stringify(avance).slice(0, 300)}`);
  }
  pasoJson('cerrar_ronda(1)',
    `select coalesce(to_jsonb(t), 'null'::jsonb)::text from (
       select * from forense.cerrar_ronda(${lit(casoId)}::uuid, 1, '{}'::jsonb)) t limit 1`);

  // Dictamen determinista (regla 4) sobre el paquete que arma el nodo real.
  const paquete = pasoJson('nodo Paquete auditor final',
    `select to_jsonb(t)::text from (${sqlDeNodo('Paquete auditor final', [casoId], 'FORENSE_investigar_cluster')}) t`);
  const dictamen = dictaminar(paquete);
  if (!NIVELES.includes(dictamen.nivel)) {
    throw new Error(`nivel fuera del catálogo: ${dictamen.nivel} (máximo presuncion_alta, regla 7)`);
  }
  const guardado = pasoJson('nodo Guardar dictamen',
    `select to_jsonb(t)::text from (${sqlDeNodo('Guardar dictamen', [casoId, JSON.stringify(dictamen)], 'FORENSE_investigar_cluster')}) t`);
  if (guardado.nivel !== dictamen.nivel) {
    throw new Error(`guardar_dictamen persistió ${guardado.nivel} y el dictaminador dijo ${dictamen.nivel}`);
  }
  // `resultado_por_rfc` tiene que llegar PERSISTIDA. Nadie la emitía, así que
  // `guardar_dictamen` guardaba `[]` en todos los casos: 13 §2:00-2:45 ("cada
  // RFC lleva el suyo") no se cumplía y el panel Contraste (db/018) no tenía
  // niveles de vecinos que comparar. Se comprueba contra la BASE, no contra
  // el objeto que acabamos de construir en memoria.
  const rxr = pasoJson('resultado_por_rfc persistida',
    `select coalesce(resultado_por_rfc, '[]'::jsonb)::text from forense.casos
      where id = ${lit(casoId)}::uuid`);
  if (!Array.isArray(rxr) || rxr.length === 0) {
    throw new Error(`resultado_por_rfc quedó vacía en la base: ${JSON.stringify(rxr)}`);
  }
  if (rxr.length !== dictamen.resultado_por_rfc.length) {
    throw new Error(`resultado_por_rfc persistió ${rxr.length} RFC y el dictaminador emitió ${dictamen.resultado_por_rfc.length}`);
  }
  const sinNivel = rxr.filter((r) => !NIVELES.includes(r.nivel));
  if (sinNivel.length > 0) {
    throw new Error(`resultado_por_rfc con nivel fuera del catálogo: ${JSON.stringify(sinNivel.slice(0, 3))}`);
  }
  if (!SALIDA_JSON) {
    const reparto = rxr.reduce((a, r) => ({ ...a, [r.nivel]: (a[r.nivel] ?? 0) + 1 }), {});
    console.log(`  → resultado_por_rfc: ${rxr.length} RFC ${JSON.stringify(reparto)}`);
  }

  const cierre = pasoJson('nodo Cerrar caso',
    `select to_jsonb(t)::text from (${sqlDeNodo('Cerrar caso', [casoId, 'dictaminado'], 'FORENSE_investigar_cluster')}) t`);
  return { nivel: dictamen.nivel, estado: cierre.estado ?? cierre.estado_final ?? null };
}

// ───────────────────────────────────────────── el bucle del workflow

if (!SALIDA_JSON) console.log('\n── despacho inicial');

const hayAdmitidos = condicionIf('¿Hay admitidos?');
const hayPendientes = condicionIf('¿Hay pendientes?');

const filasCola = filasDeNodo('nodo Clusters por score', 'Clusters por score',
  [CORRIDA, abierta.investigacion_id, abierta.idempotency_key]);
const inicial = ejecutarCodeNode('Despachar hasta 4', { entrada: filasCola, corrida: abierta });
if (inicial.length === 0) throw new Error('el despacho inicial devolvió cero ítems: el bucle moriría aquí');

const casosAbiertos = [];
const despachados = [];
// Lo que realmente entra a «Ciclo de corrida» en la vuelta: los ítems que salió
// el IF por la rama que se tomó. Arranca con el despacho inicial y en cada
// vuelta se sustituye por lo que produjo el redespacho.
let itemsDeLaVuelta = inicial;
for (const d of inicial.filter(hayAdmitidos)) {
  despachados.push(d.cluster_id);
  casosAbiertos.push(crearCaso(d));
}
if (despachados.length !== MAX_ACTIVOS) {
  throw new Error(`el despacho inicial admitió ${despachados.length} y el techo es ${MAX_ACTIVOS}`);
}

const vueltas = [];
let vuelta = 0;
let estado = null;
const dictamenes = [];

while (true) {
  vuelta += 1;
  if (vuelta > MAX_VUELTAS) {
    throw new Error(`el bucle no terminó en ${MAX_VUELTAS} vueltas: `
      + `${JSON.stringify(estado)} — clusters sin despachar o casos atascados`);
  }
  if (!SALIDA_JSON) console.log(`\n── vuelta ${vuelta}`);

  // «Ciclo de corrida»: colapsa la vuelta a UN ítem antes de reconciliar. Se le
  // pasan los ítems de ESTA vuelta (el despacho inicial la primera vez, el
  // redespacho después): colapsar el lote del redespacho es justo su razón de
  // existir, y probarlo siempre con el lote inicial no mediría nada.
  const ciclo = ejecutarCodeNode('Ciclo de corrida', { entrada: itemsDeLaVuelta, corrida: abierta });
  if (ciclo.length !== 1) throw new Error(`«Ciclo de corrida» devolvió ${ciclo.length} ítems, no 1`);
  const esperados = itemsDeLaVuelta.filter((i) => i.despachar === true).length;
  if (ciclo[0].despachados_en_vuelta !== esperados) {
    throw new Error(`«Ciclo de corrida» contó ${ciclo[0].despachados_en_vuelta} despachos y entraron ${esperados}`);
  }

  estado = filaDeNodo('nodo Esperar y reconciliar', 'Esperar y reconciliar', [CORRIDA]);
  if (estado.terminada === true) break;

  // El trabajo del subworkflow: una vuelta, un caso terminado. Así el redespacho
  // es la ÚNICA manera de drenar la cola.
  if (casosAbiertos.length > 0) {
    const casoId = casosAbiertos.shift();
    dictamenes.push({ caso_id: casoId, ...completarCaso(casoId) });
  }

  // «Cola y slots» + «Redespachar pendientes» + el IF.
  const cola = filaDeNodo('nodo Cola y slots', 'Cola y slots', [CORRIDA]);
  if (Number(cola.cola_restante) !== (cola.pendientes ?? []).length) {
    throw new Error(`cola_restante=${cola.cola_restante} pero el selector ve `
      + `${(cola.pendientes ?? []).length}: el bucle giraría sin despachar`);
  }
  const redespacho = ejecutarCodeNode('Redespachar pendientes', { entrada: [cola], corrida: abierta });
  if (redespacho.length === 0) throw new Error('el redespacho devolvió cero ítems: el bucle moriría');
  const admitidos = redespacho.filter(hayPendientes);
  if (Number(cola.casos_activos) + admitidos.length > MAX_ACTIVOS) {
    throw new Error(`se pasaría del techo: activos=${cola.casos_activos} + ${admitidos.length} > ${MAX_ACTIVOS}`);
  }
  for (const d of admitidos) {
    despachados.push(d.cluster_id);
    casosAbiertos.push(crearCaso(d));
  }
  itemsDeLaVuelta = redespacho;
  vueltas.push({
    vuelta,
    cola_restante: Number(cola.cola_restante),
    casos_activos: Number(cola.casos_activos),
    redespachados: admitidos.length,
    estado_final: estado.estado_final,
  });
}

// ───────────────────────────────────────────── cierre: métricas y corrida

if (!SALIDA_JSON) console.log('\n── cierre');
const metricas = filaDeNodo('nodo Métricas', 'Métricas', [CORRIDA]);
// «Cerrar corrida» es un UPDATE ... RETURNING: no se puede envolver en un
// subselect, así que se ejecuta dentro de un CTE. La consulta sigue siendo la
// del JSON, sin reescribir.
const sqlCerrar = sqlDeNodo('Cerrar corrida', [CORRIDA, metricas.estado_final, JSON.stringify(metricas.metricas)])
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const cerrada = pasoJson('nodo Cerrar corrida',
  `with t as (${sqlCerrar}) select to_jsonb(t)::text from t limit 1`);

// ───────────────────────────────────────────── comprobaciones

const problemas = [];
const persistida = pasoJson('estado persistido de la corrida',
  `select to_jsonb(t)::text from (select c.estado, c.metricas is not null as tiene_metricas,
     (select count(*) from forense.clusters k where k.corrida_id = c.id) as clusters,
     (select count(*) from forense.casos k where k.corrida_id = c.id) as casos,
     (select count(*) from forense.casos k where k.corrida_id = c.id
       and k.estado in ('dictaminado','parcial','cerrado')) as casos_terminales
     from forense.corridas c where c.id = ${lit(CORRIDA)}::uuid) t`);

if (persistida.estado !== 'completada') problemas.push(`la corrida quedó ${persistida.estado}, no completada`);
if (!persistida.tiene_metricas) problemas.push('la corrida cerró sin métricas persistidas');
if (Number(persistida.casos) !== Number(persistida.clusters)) {
  problemas.push(`${persistida.clusters} clusters y sólo ${persistida.casos} casos: la cola no se drenó`);
}
if (Number(persistida.casos_terminales) !== Number(persistida.casos)) {
  problemas.push(`${persistida.casos_terminales}/${persistida.casos} casos terminales`);
}
if (despachados.length !== Number(persistida.clusters)) {
  problemas.push(`se despacharon ${despachados.length} de ${persistida.clusters} clusters`);
}
if (new Set(despachados).size !== despachados.length) problemas.push('un cluster se despachó dos veces');
if (vueltas.filter((v) => v.redespachados > 0).length === 0) {
  problemas.push('ninguna vuelta redespachó: la prueba no ejercitó el hallazgo');
}
// Regla 2: sin evento no hubo paso.
const evDictamen = eventos(CORRIDA, 'dictamen');
if (evDictamen === 0) problemas.push('regla 2: ningún evento `dictamen` en forense.bitacora');
if (eventos(CORRIDA, 'ronda_inicio') === 0) problemas.push('regla 2: ningún evento `ronda_inicio`');

const resumen = {
  base: BASE,
  corrida_base: CORRIDA_BASE,
  corrida: CORRIDA,
  max_activos: MAX_ACTIVOS,
  clusters: Number(persistida.clusters),
  clusters_de_armar_clusters: Number(clusters.clusters_armados),
  clusters_completados: completados,
  pistas_insertadas: pistas.pistas_insertadas,
  filas_clonadas: snapshot.filas_por_tabla,
  vueltas: vueltas.length + 1,
  redespachos: vueltas.filter((v) => v.redespachados > 0).length,
  detalle_vueltas: vueltas,
  despachados: despachados.length,
  casos_terminales: Number(persistida.casos_terminales),
  niveles: dictamenes.reduce((a, d) => ({ ...a, [d.nivel]: (a[d.nivel] ?? 0) + 1 }), {}),
  estado_persistido: persistida.estado,
  estado_nodo_cerrar: cerrada.estado,
  metricas_guardadas: persistida.tiene_metricas,
  metricas: metricas.metricas,
  eventos_dictamen: evDictamen,
  tiempos_ms: tiempos,
  tiempo_total_ms: Date.now() - t0Total,
  problemas,
  cumple: problemas.length === 0,
};

if (!CONSERVAR) {
  // La corrida clonada se conserva (es el resultado a inspeccionar); sólo se
  // avisa. Borrarla a ciegas se llevaría por delante la evidencia del e2e.
  resumen.nota_limpieza = `corrida ${CORRIDA} conservada en ${BASE}; bórrala a mano si estorba`;
}

if (SALIDA_JSON) {
  console.log(JSON.stringify(resumen, null, 2));
} else {
  console.log('\n────────────────────────── resumen');
  console.log(`corrida ${CORRIDA}  estado=${persistida.estado}  métricas=${persistida.tiene_metricas}`);
  console.log(`clusters=${persistida.clusters}  despachados=${despachados.length}  `
    + `vueltas=${resumen.vueltas}  redespachos=${resumen.redespachos}`);
  for (const v of vueltas) {
    console.log(`  vuelta ${String(v.vuelta).padStart(2)}  cola=${v.cola_restante}  `
      + `activos=${v.casos_activos}  redespachados=${v.redespachados}  estado=${v.estado_final}`);
  }
  const porEtapa = tiempos.reduce((a, t) => ({ ...a, [t.etiqueta.replace(/\(.*/, '')]: (a[t.etiqueta.replace(/\(.*/, '')] ?? 0) + t.ms }), {});
  console.log('\ntiempos por etapa (ms, acumulado):');
  for (const [k, v] of Object.entries(porEtapa).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${k.padEnd(46)} ${String(v).padStart(7)}`);
  }
  console.log(`\ntotal ${resumen.tiempo_total_ms} ms`);
  console.log(problemas.length === 0 ? '\nCUMPLE' : `\nNO CUMPLE:\n - ${problemas.join('\n - ')}`);
}

process.exit(problemas.length === 0 ? 0 : 1);
