#!/usr/bin/env node
// n8n/tests/e2e-camino-worker.mjs — ejecuta DE VERDAD (no PREPARE) el camino
// completo del worker contra una base Postgres con 001–008, con el proveedor
// SIMULADO: ningún HTTP a Anthropic, pero TODAS las RPC y funciones de
// orquestación son las reales y cada paso deja evento en `forense.bitacora`.
//
// Qué NO es: no es un test de `node --test` (necesita base y datos), no usa
// n8n, y no inventa números: el nivel lo decide `auditor-final.mjs`
// (determinista) sobre el paquete leído de la DB.
//
// Uso:
//   node n8n/tests/e2e-camino-worker.mjs [base] [--corrida <uuid>] [--json]
//
// Requisitos de la base: 001–008 aplicadas, una corrida con datos (gen-v1) y
// el check de `forense.bitacora.tipo_evento` ampliado con 'paso_en_cola' y
// 'paso_checkpoint' (009 de forense-db; ver IMPORT.md §Variables).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dictaminar, NIVELES } from '../runtime/auditor-final.mjs';

const RAIZ_N8N = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';
const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'forense_rt';
const SALIDA_JSON = args.includes('--json');
const CORRIDA_ARG = args.includes('--corrida') ? args[args.indexOf('--corrida') + 1] : null;

const ESPECIALISTAS = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];
const FAMILIA = { documental: 'D', financiero: 'F', relacional: 'R', temporal: 'T', externo: 'E' };

const tiempos = [];
const traza = [];

function psql(sql) {
  return execFileSync(
    PSQL,
    ['-U', 'postgres', '-h', 'localhost', '-d', BASE, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  ).trim();
}

/** Ejecuta y mide. `etiqueta` es el paso del pipeline, no el nombre del nodo. */
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
  traza.push({ etiqueta, ms });
  if (!SALIDA_JSON) console.log(`  · ${etiqueta.padEnd(38)} ${String(ms).padStart(6)} ms`);
  return salida;
}

function pasoJson(etiqueta, sql) {
  const s = paso(etiqueta, sql);
  if (!s) return null;
  // psql añade el tag del comando (`INSERT 0 1`) tras el RETURNING: el JSON es
  // la primera línea que abre llave.
  const linea = s.split('\n').find((l) => l.trimStart().startsWith('{') || l.trimStart().startsWith('['));
  return linea ? JSON.parse(linea) : null;
}

/** Literal SQL seguro para texto/uuid; `null` → NULL. */
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replaceAll("'", "''")}'`;
}
const jsonLit = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const arrLit = (xs) => `ARRAY[${xs.map(lit).join(',')}]::text[]`;

// La SQL de los pasos de cierre no se reescribe aquí: se toma del workflow
// EXPORTADO y se le sustituyen los parámetros por posición ($10 antes que $1
// para no partir el número). Así el camino que mide este e2e es literalmente
// el que se importa en n8n; no puede haber una versión «de test».
const WORKFLOWS = new Map();
function sqlDeNodo(nombreNodo, valores, archivo = 'FORENSE_investigar_cluster') {
  if (!WORKFLOWS.has(archivo)) {
    WORKFLOWS.set(archivo, JSON.parse(
      fs.readFileSync(path.join(RAIZ_N8N, 'workflows', `${archivo}.json`), 'utf8')));
  }
  const nodo = WORKFLOWS.get(archivo).nodes.find((n) => n.name === nombreNodo);
  if (!nodo) throw new Error(`nodo ausente en ${archivo}: ${nombreNodo}`);
  let sql = nodo.parameters.query;
  for (let i = valores.length; i >= 1; i -= 1) sql = sql.replaceAll(`$${i}`, lit(valores[i - 1]));
  return sql;
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. Corrida aislada (regla 10): se CLONA gen-v1, nunca se investiga sobre ella.
// ─────────────────────────────────────────────────────────────────────────────
const sello = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const origen = CORRIDA_ARG ?? psql(
  "select id::text from forense.corridas where nombre = 'gen-v1' order by inicio desc limit 1",
);
if (!origen) throw new Error(`no hay corrida gen-v1 en ${BASE}`);

if (!SALIDA_JSON) console.log(`base=${BASE} corrida_origen=${origen}`);

// --reusar <uuid>: repite el camino del worker sobre una corrida clonada que ya
// tiene pistas y clusters, sin volver a pagar los ~45 s de `correr_pistas`.
const REUSAR = args.includes('--reusar') ? args[args.indexOf('--reusar') + 1] : null;
let corrida; let pistas; let nClusters;
if (REUSAR) {
  corrida = REUSAR;
  pistas = { reusada: true };
  nClusters = Number(paso('clusters existentes', `select count(*) from forense.clusters where corrida_id=${lit(corrida)}::uuid`));
} else {
  corrida = paso('clonar_corrida', `select forense.clonar_corrida(${lit(origen)}::uuid, ${lit(`runtime-e2e-${sello}`)})::text`);
  paso('corrida → lista', `update forense.corridas set estado='lista' where id=${lit(corrida)}::uuid`);
  pistas = pasoJson('correr_pistas', `select forense.correr_pistas(${lit(corrida)}::uuid)`);
  nClusters = Number(paso('armar_clusters', `select forense.armar_clusters(${lit(corrida)}::uuid)`));
}

// Cluster de mayor score: el mismo criterio que FORENSE_corrida / «Clusters por score».
const cluster = paso('cluster de mayor score',
  `select k.id::text from forense.clusters k
     where k.corrida_id=${lit(corrida)}::uuid
       and not exists (select 1 from forense.casos c where c.cluster_id = k.id)
     order by k.score desc nulls last, k.id limit 1`);
if (!cluster) throw new Error('la corrida clonada no produjo clusters');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reclamo del cluster y caso (FORENSE_investigar_cluster, primeros nodos).
// ─────────────────────────────────────────────────────────────────────────────
const owner = `e2e-${sello}`;
const reclamo = pasoJson('reclamar_cluster',
  `select forense.reclamar_cluster(${lit(corrida)}::uuid, ${lit(cluster)}::uuid, ${lit(owner)}, 'pipeline', NULL)`);
const caso = pasoJson('crear_caso',
  `select forense.crear_caso(${lit(corrida)}::uuid, ${lit(cluster)}::uuid, 'pipeline', NULL, NULL, ${lit(owner)})`);
const casoId = caso.caso_id;

const ctx1 = pasoJson('preparar_contexto_ronda1', `select forense.preparar_contexto_ronda1(${lit(casoId)}::uuid)`);
const rolesEvaluables = (ctx1.roles_evaluables ?? ctx1.agentes ?? ESPECIALISTAS).filter(Boolean);

const tareas1 = pasoJson('crear_tareas_ronda(1)',
  `select forense.crear_tareas_ronda(${lit(casoId)}::uuid, 1, ${arrLit(rolesEvaluables)})`);
const tareaIds = tareas1.tarea_ids ?? [];
const porAgente = tareas1.tareas ?? null;

// Mapa agente → tarea_id leído de la DB (no del payload): la barrera es el
// conjunto exacto de tareas, no un conteo.
const mapa = JSON.parse(psql(
  `select coalesce(jsonb_object_agg(agente, id)::text, '{}') from forense.tareas_agente where caso_id=${lit(casoId)}::uuid and ronda=1`,
));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ronda 1: cinco especialistas SIMULADOS que llaman RPC reales.
//    El «proveedor» está inyectado: decide qué herramienta pedir, pero los
//    datos y la escritura de señales salen de la DB.
// ─────────────────────────────────────────────────────────────────────────────
const rfcSemilla = psql(`select rfc_semilla from forense.clusters where id=${lit(cluster)}::uuid`);
const senalesEscritas = [];
const cfdiVistos = new Map();
let llamadasTool = 0;

for (const agente of Object.keys(mapa)) {
  if (!ESPECIALISTAS.includes(agente)) continue;
  const tarea = mapa[agente];
  const perfil = pasoJson(`${agente}: forense_perfil`,
    `select public.forense_perfil(p_caso=>${lit(casoId)}::uuid, p_agente=>${lit(agente)}, p_rfc=>${lit(rfcSemilla)}, p_tarea=>${lit(tarea)}::uuid, p_ronda=>1)`);
  llamadasTool += 1;
  const facturas = pasoJson(`${agente}: forense_facturas`,
    `select public.forense_facturas(p_caso=>${lit(casoId)}::uuid, p_agente=>${lit(agente)}, p_rfc=>${lit(rfcSemilla)}, p_rol=>'emisor', p_desde=>NULL, p_hasta=>NULL, p_limite=>25, p_tarea=>${lit(tarea)}::uuid, p_ronda=>1)`);
  llamadasTool += 1;

  // Los IDs citados salen del envelope de la herramienta, nunca inventados:
  // `data.filas[].uuid` de forense_facturas (06 §envelope).
  const filas = facturas?.data?.filas ?? facturas?.result?.data?.filas ?? [];
  for (const f of filas) if (f.uuid) cfdiVistos.set(f.uuid, f);
  const ids = filas.map((f) => f.uuid).filter(Boolean).slice(0, 3);
  const rfcsVecinos = [...new Set(filas.map((f) => f.contraparte).filter(Boolean))].slice(0, 2);

  const senal = pasoJson(`${agente}: forense_escribir_senal`,
    `select public.forense_escribir_senal(
        p_caso=>${lit(casoId)}::uuid, p_agente=>${lit(agente)}, p_familia=>${lit(FAMILIA[agente])},
        p_titular=>${lit(`hallazgo simulado ${agente} sobre ${rfcSemilla}`)},
        p_detalle=>${jsonLit({ origen: 'proveedor_simulado', ids_citados: ids })},
        p_rfcs=>${arrLit([rfcSemilla])}, p_ids=>${arrLit(ids)},
        p_frontera=>${arrLit(rfcsVecinos.map(String))}, p_confianza=>'media', p_refuta=>false,
        p_tarea=>${lit(tarea)}::uuid, p_ronda=>1)`);
  llamadasTool += 1;
  senalesEscritas.push({ agente, ok: senal?.ok !== false });

  paso(`${agente}: tarea terminada`,
    `update forense.tareas_agente set estado='completada', terminado=now(), lease_owner=NULL, lease_expires_at=NULL where id=${lit(tarea)}::uuid`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Barrera de ronda 1 + avance determinista del caso.
// ─────────────────────────────────────────────────────────────────────────────
paso('registrar barrera ronda1', `insert into forense.pasos_pipeline (caso_id, paso, revision, tareas_esperadas, estado, deadline)
  values (${lit(casoId)}::uuid, 'ronda1', 1, ${tareaIds.length ? `ARRAY[${tareaIds.map(lit).join(',')}]::uuid[]` : `(select coalesce(array_agg(id),'{}') from forense.tareas_agente where caso_id=${lit(casoId)}::uuid and ronda=1)`}, 'abierto', now() + interval '15 minutes')
  on conflict do nothing`);
const barrera1 = pasoJson('estado_barrera(ronda1)', `select forense.estado_barrera(${lit(casoId)}::uuid, 'ronda1')`);
const avance = pasoJson('advance_case_if_ready', `select forense.advance_case_if_ready(${lit(casoId)}::uuid, 'ronda1', NULL)`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Frontera y despertar (RPC reales de 004/006).
// ─────────────────────────────────────────────────────────────────────────────
const frontera = pasoJson('forense_evaluar_frontera', `select public.forense_evaluar_frontera(${lit(cluster)}::uuid)`);
const despertar = pasoJson('forense_despertar', `select public.forense_despertar(${lit(cluster)}::uuid)`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Auditor simulado: abre tarea de cierre, registra evidencia y valida.
// ─────────────────────────────────────────────────────────────────────────────
const tAuditor = pasoJson('abrir_tarea_cierre(auditor)', `select forense.abrir_tarea_cierre(${lit(casoId)}::uuid, 'auditor')`);
const tareaAuditor = tAuditor.tarea_id ?? tAuditor.id;

const pistasCaso = JSON.parse(psql(
  `select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'familia', left(p.codigo,1), 'rfc', p.rfc)), '[]')
     from forense.pistas p
     join forense.casos c on c.id = ${lit(casoId)}::uuid
    where p.corrida_id = c.corrida_id
      and p.rfc = any(array[c.rfc_principal] || coalesce(c.rfcs_satelite,'{}'))`));

// Una evidencia por familia con pista: `tipo/ref_id/pista_*/familia/referencias/
// comprobacion` son obligatorios en la RPC y `rfcs_afectados` debe intersecar
// emisor o receptor del CFDI citado (05 §4.11). Nada de esto lo decide el modelo.
const porFamilia = new Map();
for (const p of pistasCaso) if (!porFamilia.has(p.familia)) porFamilia.set(p.familia, p);
const uuids = [...cfdiVistos.keys()];
const items = [...porFamilia.values()].map((p, i) => {
  const uuid = uuids[i % Math.max(uuids.length, 1)];
  const fila = uuid ? cfdiVistos.get(uuid) : null;
  if (!uuid || !fila) return null;
  return {
    tipo: 'cfdi',
    ref_id: `CFDI:${uuid}`,
    pista_id: p.id,
    pista_codigo: p.codigo,
    familia: p.familia,
    rfcs_afectados: [p.rfc, fila.contraparte].filter(Boolean),
    referencias: [`CFDI:${uuid}`],
    comprobacion: `pista ${p.codigo} sostenida por el CFDI ${uuid} devuelto por forense_facturas`,
    descripcion: `evidencia simulada para ${p.codigo}`,
  };
}).filter(Boolean);

const evidencia = items.length
  ? pasoJson('forense_registrar_evidencia',
    `select public.forense_registrar_evidencia(p_caso=>${lit(casoId)}::uuid, p_agente=>'auditor', p_items=>${jsonLit(items)}, p_tarea=>${lit(tareaAuditor)}::uuid, p_ronda=>2)`)
  : { ok: true, nota: 'sin ids citables en las señales' };
const validacion = pasoJson('forense_validar_evidencia', `select public.forense_validar_evidencia(${lit(casoId)}::uuid)`);
paso('auditor: tarea terminada',
  `update forense.tareas_agente set estado='completada', terminado=now(), lease_owner=NULL, lease_expires_at=NULL where id=${lit(tareaAuditor)}::uuid`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Dictamen DETERMINISTA (regla 4): el paquete se lee de la DB y el nivel lo
//    decide auditor-final.mjs, nunca el modelo.
// ─────────────────────────────────────────────────────────────────────────────
// El paquete NO se arma aquí: se lee con la MISMA consulta que lleva el nodo
// «Paquete auditor final» del workflow exportado. Si el generador la cambia,
// este e2e cambia con él; si divergen, no hay forma de que este camino pase y
// el del workflow falle.
const paquete = JSON.parse(psql(
  `select to_jsonb(t)::text from (${sqlDeNodo('Paquete auditor final', [casoId])}) t`,
));

// Regla 4: el nivel sale de código determinista. Sin red de seguridad: si
// `dictaminar` lanza, el e2e falla. Un fallback local que inventara niveles
// («presuncion_media», «indicio») fabricaría valores fuera de NIVELES y del
// CHECK de `forense.casos.nivel`, y taparía cualquier deriva de firma.
const dictamen = dictaminar(paquete);
if (!NIVELES.includes(dictamen.nivel)) {
  throw new Error(`nivel fuera del catálogo: ${dictamen.nivel} (máximo presuncion_alta, regla 7)`);
}

// Persistencia REAL: guardar_dictamen (010) acota el nivel al catálogo,
// deduplica el monto y escribe resultado_por_rfc. Nada de UPDATE directo.
const guardado = pasoJson('forense.guardar_dictamen',
  `select to_jsonb(t) from (${sqlDeNodo('Guardar dictamen', [casoId, JSON.stringify(dictamen)])}) t`);
if (guardado.nivel !== dictamen.nivel) {
  throw new Error(`guardar_dictamen persistió ${guardado.nivel} y el dictaminador dijo ${dictamen.nivel}`);
}
// Regla 2: sin evento no hubo paso. Se comprueba que la propia función lo
// dejó; si no, lo deja el runner (que es quien ejecuta el paso).
if (Number(psql(`select count(*) from forense.bitacora
                  where caso_id=${lit(casoId)}::uuid and tipo_evento='dictamen'`)) === 0) {
  paso('bitacora: dictamen', `select forense.log(${lit(casoId)}::uuid, 'sistema', 'dictamen',
     ${jsonLit({ nivel: dictamen.nivel, familias: dictamen.familias ?? [], regla: dictamen.regla ?? null, monto_en_riesgo_centavos: dictamen.monto_en_riesgo_centavos })},
     NULL, NULL, NULL, NULL, NULL, ${lit(cluster)}::uuid, NULL, ${lit(corrida)}::uuid)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Redactor simulado y expediente guardado (tabla real de 001/006).
// ─────────────────────────────────────────────────────────────────────────────
const tRedactor = pasoJson('abrir_tarea_cierre(redactor)', `select forense.abrir_tarea_cierre(${lit(casoId)}::uuid, 'redactor')`);
const tareaRedactor = tRedactor.tarea_id ?? tRedactor.id;
paso('bitacora: redaccion_inicio', `select forense.log(${lit(casoId)}::uuid, 'redactor', 'redaccion_inicio',
   ${jsonLit({ version: 1, simulado: true })}, NULL, NULL, NULL, NULL, NULL, ${lit(cluster)}::uuid, ${lit(tareaRedactor)}::uuid, ${lit(corrida)}::uuid)`);

const citas = paquete.evidencia.filter((e) => e.validada === true).map((e) => e.ref_id).filter(Boolean).slice(0, 5);
const markdown = [
  `# Expediente ${casoId}`,
  '',
  `Nivel: **${dictamen.nivel}** (decidido por código determinista, no por el modelo).`,
  `Familias confirmadas: ${(dictamen.familias ?? []).join(', ') || 'ninguna'}.`,
  '',
  '## Cadena de explicación',
  citas.length ? citas.map((c, i) => `${i + 1}. Paso sostenido por ${c}.`).join('\n') : '1. Sin evidencia validada: no_concluyente.',
].join('\n');

const expediente = pasoJson('guardar expediente', `
  insert into forense.expedientes (caso_id, idempotency_key, version, markdown, autor)
  values (${lit(casoId)}::uuid, ${lit(`exp|${casoId}|1`)}, 1, ${lit(markdown)}, 'redactor')
  on conflict (idempotency_key) do update set markdown = excluded.markdown
  returning jsonb_build_object('caso_id', caso_id, 'version', version, 'creado', creado)`);
paso('bitacora: redaccion_fin', `select forense.log(${lit(casoId)}::uuid, 'redactor', 'redaccion_fin',
   ${jsonLit({ version: 1, citas: citas.length })}, NULL, NULL, NULL, NULL, NULL, ${lit(cluster)}::uuid, ${lit(tareaRedactor)}::uuid, ${lit(corrida)}::uuid)`);
paso('redactor: tarea terminada',
  `update forense.tareas_agente set estado='completada', terminado=now(), lease_owner=NULL, lease_expires_at=NULL where id=${lit(tareaRedactor)}::uuid`);

// Validación de citas y CIERRE con la función real (010). El estado final no
// lo elige el e2e: sale del nivel que dictaminó el código determinista.
const citasValidadas = pasoJson('forense.validar_expediente',
  `select to_jsonb(t) from (${sqlDeNodo('Validar citas', [casoId, 1])}) t`);
const cierre = pasoJson('forense.cerrar_caso',
  `select to_jsonb(t) from (${sqlDeNodo('Cerrar caso', [casoId, 'dictaminado'])}) t`);

// ─────────────────────────────────────────────────────────────────────────────
// 8. Medición: eventos en bitácora y tiempos. Sin evento no hubo paso (regla 2).
// ─────────────────────────────────────────────────────────────────────────────
const eventos = JSON.parse(psql(
  `select coalesce(jsonb_object_agg(tipo_evento, n)::text,'{}') from (
     select tipo_evento, count(*) n from forense.bitacora where caso_id=${lit(casoId)}::uuid group by 1) t`));
const totalEventos = Number(psql(`select count(*) from forense.bitacora where caso_id=${lit(casoId)}::uuid`));
// Las RPC de 06 se loggean a sí mismas: el conteo sale de la bitácora, no del
// ledger de runtime (`tool_ejecuciones` cuelga de una ejecución LLM, que aquí
// no existe porque el proveedor está simulado).
const totalTools = Number(psql(`select count(*) from forense.bitacora where caso_id=${lit(casoId)}::uuid and tipo_evento='tool_result'`));
const msTotal = tiempos.reduce((a, b) => a + b.ms, 0);

const resumen = {
  base: BASE,
  corrida_origen: origen,
  corrida_e2e: corrida,
  cluster_id: cluster,
  caso_id: casoId,
  pistas_insertadas: pistas,
  clusters_armados: nClusters,
  tareas_ronda1: Object.keys(mapa).length,
  senales_escritas: senalesEscritas.length,
  llamadas_rpc_tool: llamadasTool,
  tool_ejecuciones_registradas: totalTools,
  barrera_ronda1: barrera1,
  avance_caso: avance,
  frontera: frontera?.data ?? frontera,
  despertados: despertar?.data ?? despertar,
  evidencia: evidencia,
  validacion,
  dictamen,
  dictamen_persistido: guardado,
  expediente,
  citas_validadas: citasValidadas,
  cierre,
  eventos_bitacora_por_tipo: eventos,
  eventos_bitacora_total: totalEventos,
  pasos_medidos: tiempos.length,
  ms_total_sql: msTotal,
  ms_por_paso: tiempos,
};

if (SALIDA_JSON) {
  console.log(JSON.stringify(resumen, null, 2));
} else {
  console.log('\n─── resumen ───');
  console.log(`caso_id=${casoId}  corrida=${corrida}`);
  console.log(`eventos en bitacora=${totalEventos}  ${JSON.stringify(eventos)}`);
  console.log(`tool_ejecuciones=${totalTools}  senales=${senalesEscritas.length}`);
  console.log(`dictamen=${dictamen.nivel}  familias=${JSON.stringify(dictamen.familias ?? [])}`);
  console.log(`pasos=${tiempos.length}  ms_total_sql=${msTotal}`);
}

if (totalEventos === 0) {
  console.error('FALLA: ningún evento en forense.bitacora — regla 2');
  process.exit(1);
}
