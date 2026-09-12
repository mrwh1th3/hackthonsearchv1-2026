#!/usr/bin/env node
// n8n/tests/e2e-inyeccion.mjs — camino COMPLETO de FORENSE_inyectar contra una
// base Postgres real, con el proveedor SIMULADO: ningún HTTP a Anthropic, pero
// cada consulta se LEE DEL WORKFLOW EXPORTADO (no se reescribe aquí) y el nivel
// lo decide `auditor-final.mjs`, nunca un modelo (regla 4).
//
// No es un test de `node --test`: necesita base y datos, tarda minutos y por eso
// se ejecuta a mano, como preparar-sql.mjs y e2e-camino-worker.mjs. La suite
// hermética de `node --test "n8n/tests/*.test.mjs"` no lo recoge a propósito.
//
// Uso:
//   node n8n/tests/e2e-inyeccion.mjs [base] [--ensayo a|c] [--json] [--conservar]
//
// Qué comprueba, por ensayo de eval/inyecciones:
//   (a) a-carrusel-nuevo.json      → el caso del RFC inyectado queda en
//                                    `presuncion` o `presuncion_alta`.
//   (c) c-trampa-comercializadora.json → termina `anomalia_explicada` o
//                                    `no_concluyente`: la trampa legítima NO
//                                    se convierte en presunción.
// y en los dos: la corrida base queda intacta (regla 10), cada paso deja evento
// en forense.bitacora (regla 2) y el cluster del RFC inyectado se despacha
// PRIMERO (QA-004 / 21 §3).
//
// HALLAZGO H10, RESUELTO EN H11 POR db/015: `casos.cobertura_completa` nacía en
// false y nada la ponía en true, así que `dictaminar()` dejaba TODO caso en
// `no_concluyente`. `forense.cobertura_caso` (015) la calcula en SQL y
// `paquete_auditor_final` la expone calculada. Este script ya no la simula: se
// limita a cerrar la ronda con las funciones reales y a REPORTAR lo que salga.
//
// Qué cambia en H11 respecto de la versión anterior de este script:
//   - `forense.asegurar_clusters_inyectados` (db/012) es OBLIGATORIA. El
//     respaldo `armar_cluster_para` se retiró: probar contra el respaldo era
//     probar una ruta que el demo no ejecuta.
//   - La ronda simulada cierra por checkpoint (claim_step → finish_step →
//     advance_case_if_ready → cerrar_ronda). Ningún UPDATE sobre
//     `tareas_agente`: un UPDATE no deja rastro y fija la cobertura por la vía
//     que precisamente se quiere medir.
//   - El auditor simulado NO fabrica una evidencia por familia. Cita CFDI que
//     existen en el snapshot y que `forense_validar_evidencia` acepta; cuántas
//     familias quedan sustentadas es un RESULTADO, no una entrada.
//   - El ensayo (c) sólo CUMPLE si el sistema llegó a cobertura completa y aun
//     así no subió el nivel. Si la cobertura quedó incompleta, el nivel bajo no
//     prueba discriminación: se reporta `requiere_api_real`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { dictaminar, NIVELES } from '../runtime/auditor-final.mjs';

const RAIZ_N8N = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = path.resolve(RAIZ_N8N, '..');
const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'forense_rt';
const SALIDA_JSON = args.includes('--json');
const CONSERVAR = args.includes('--conservar');
const ENSAYO_ARG = args.includes('--ensayo') ? args[args.indexOf('--ensayo') + 1] : null;

const ENSAYOS = [
  {
    id: 'a',
    archivo: 'a-carrusel-nuevo.json',
    // Carrusel nuevo de 3 RFC: R1 + R2 + T1. El dictamen determinista tiene que
    // sostener presunción; si baja, o el selector no vio el ciclo o las pistas
    // se descalibraron.
    niveles: ['presuncion', 'presuncion_alta'],
    porque: 'carrusel de 3 RFC con ciclo de facturas y de dinero (21 §3.4)',
  },
  {
    id: 'c',
    archivo: 'c-trampa-comercializadora.json',
    // Trampa legítima: entra al selector (dos familias) y DEBE llegar a
    // investigación, pero el nivel no puede subir a presunción. `sin_hallazgos`
    // tampoco vale: significaría que ni siquiera se miró.
    niveles: ['anomalia_explicada', 'no_concluyente'],
    porque: 'comercializadora legítima: entra al selector y el sistema la explica (21 §3.4)',
    // Con cobertura incompleta CUALQUIER caso sale `no_concluyente`: acertar así
    // no es discriminar.
    exige_cobertura: true,
    // Y con proveedor simulado NO CORRE EL DEFENSOR, que es la capa que
    // convierte una trampa legítima en `anomalia_explicada` (el nivel exige
    // que todas las pistas evaluables queden `descartada` en
    // casos.evaluacion_pistas, y sólo la defensa escribe ahí). Sin defensa
    // este ensayo no puede juzgarse: ni un nivel alto prueba que el sistema
    // falle, ni un nivel bajo prueba que discrimine. Se reporta
    // `requiere_api_real` ANTES de comparar el nivel. Simular refutaciones
    // sería fijar el resultado que la prueba dice medir, igual que fabricar
    // una evidencia por familia.
    exige_defensa: true,
  },
];

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
  if (!SALIDA_JSON) console.log(`  · ${etiqueta.padEnd(42)} ${String(ms).padStart(6)} ms`);
  return salida;
}
const pasoJson = (etiqueta, sql) => JSON.parse(paso(etiqueta, sql) || 'null');

function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const WORKFLOWS = new Map();
const nodoDe = (nombre, archivo = 'FORENSE_inyectar') => {
  if (!WORKFLOWS.has(archivo)) {
    WORKFLOWS.set(archivo, JSON.parse(
      fs.readFileSync(path.join(RAIZ_N8N, 'workflows', `${archivo}.json`), 'utf8')));
  }
  const n = WORKFLOWS.get(archivo).nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`nodo ausente en ${archivo}: ${nombre}`);
  return n;
};

/**
 * SQL del nodo exportado con los `$n` sustituidos. Se lee del JSON, no se copia:
 * si el generador cambia la consulta, este e2e cambia con ella. Divergir en
 * silencio es exactamente lo que este script existe para impedir.
 */
function sqlDeNodo(nombre, valores, archivo = 'FORENSE_inyectar') {
  let sql = nodoDe(nombre, archivo).parameters.query;
  for (let i = valores.length; i >= 1; i -= 1) sql = sql.replaceAll(`$${i}`, lit(valores[i - 1]));
  return sql;
}

/** Una fila del nodo, como objeto. */
const filaDeNodo = (etiqueta, nombre, valores) => pasoJson(
  etiqueta, `select coalesce(to_jsonb(t), 'null'::jsonb)::text from (${sqlDeNodo(nombre, valores)}) t limit 1`,
);
/** Todas las filas del nodo. */
const filasDeNodo = (etiqueta, nombre, valores) => pasoJson(
  etiqueta, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (${sqlDeNodo(nombre, valores)}) t`,
);

/**
 * Ejecuta el Code node «Priorizar afectados» TAL CUAL está en el JSON exportado,
 * con los accesores de n8n simulados. Reimplementar aquí su orden sería probar
 * una copia: lo que se despacha en el demo es este texto.
 */
function priorizar({ prioridad, garantizados, recalculo }) {
  const items = (v) => v.map((json) => ({ json }));
  const contexto = {
    $input: { all: () => items(prioridad) },
    $: (nombre) => {
      if (nombre === 'Asegurar clusters inyectados') return { all: () => items(garantizados) };
      if (nombre === 'Recalcular pistas y clusters') return { first: () => ({ json: recalculo }) };
      throw new Error(`el nodo pidió un nodo no simulado: ${nombre}`);
    },
  };
  const cuerpo = nodoDe('Priorizar afectados').parameters.jsCode;
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$', `${cuerpo}`);
  return fn(contexto.$input, contexto.$).map((i) => i.json);
}

function eventos(corrida, tipo) {
  return Number(psql(`select count(*) from forense.bitacora
     where corrida_id = ${lit(corrida)}::uuid and tipo_evento = ${lit(tipo)}`));
}

/** Huella de las tablas de dominio de una corrida: regla 10 comprobada, no prometida. */
const TABLAS_DOMINIO = ['contribuyentes', 'cuentas', 'cfdi', 'movimientos',
  'atributos_entidad', 'listas_sat', 'pistas'];
function huella(corrida) {
  const partes = TABLAS_DOMINIO.map((t) => `select ${lit(t)} as tabla,
      count(*)::text || ':' || coalesce(md5(string_agg(md5(x.*::text), '' order by md5(x.*::text))), 'vacia') as h
      from forense.${t} x where x.corrida_id = ${lit(corrida)}::uuid`).join(' union all ');
  return psql(`select string_agg(tabla || '=' || h, '|' order by tabla) from (${partes}) s`);
}

// ───────────────────────────────────────────────────────────────── ensayo

const SELLO = `rt-iny-${process.pid}-${Date.now().toString(36)}`;
const resultados = [];

const CORRIDA_BASE = psql(
  "select id::text from forense.corridas where nombre = 'gen-v1' order by inicio limit 1",
);
if (!CORRIDA_BASE) throw new Error(`no hay corrida gen-v1 en ${BASE}`);

for (const fn of ['asegurar_clusters_inyectados', 'cobertura_caso']) {
  if (psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname='forense' and p.proname=${lit(fn)}`) === '0') {
    throw new Error(`falta forense.${fn} en ${BASE}: aplica db/012 y db/015 antes de correr este e2e`);
  }
}

if (!SALIDA_JSON) {
  console.log(`base=${BASE} corrida_base=${CORRIDA_BASE} gen-v1`);
  console.log('db/012 y db/015 presentes: clusters garantizados por RPC y cobertura calculada en SQL');
}

function correrEnsayo(ensayo) {
  if (!SALIDA_JSON) console.log(`\n── ensayo (${ensayo.id}) ${ensayo.archivo} — ${ensayo.porque}`);
  const t0 = Date.now();
  const huellaAntes = huella(CORRIDA_BASE);

  // 0. Ingesta: la crea el mapper de 19 (registrar_inyeccion de 5 argumentos).
  //    El webhook de FORENSE_inyectar recibe una ingesta YA cargada, así que
  //    este paso es el que la deja lista, no parte del workflow.
  const payload = JSON.parse(fs.readFileSync(path.join(RAIZ, 'eval/inyecciones', ensayo.archivo), 'utf8'));
  payload.nota = `${payload.nota} [runtime ${SELLO} ${ensayo.id}]`;
  const idem = crypto.randomUUID();
  delete payload.idempotency_key;
  const texto = JSON.stringify(payload).replace(/\$/g, '');
  const ingesta = pasoJson('registrar_inyeccion (ingesta de 19)',
    `select forense.registrar_inyeccion(${lit(CORRIDA_BASE)}::uuid, $PAY$${texto}$PAY$::jsonb,
       'ensayo', ${lit(idem)}::uuid, null)::text`);
  if (ingesta.ok !== true) throw new Error(`la ingesta falló: ${JSON.stringify(ingesta).slice(0, 400)}`);

  // 1. «Registrar inyección» — mismo idempotency_key: devuelve la inyección ya
  //    creada en vez de duplicarla (es el contrato del nodo).
  const reg = filaDeNodo('nodo Registrar inyección', 'Registrar inyección',
    [CORRIDA_BASE, ingesta.ingesta_id, idem, 'inyectados']);
  if (reg.inyeccion_id !== ingesta.inyeccion_id) {
    throw new Error(`el nodo duplicó la inyección: ${reg.inyeccion_id} ≠ ${ingesta.inyeccion_id}`);
  }

  // 2. «Validar filas» — el IF del workflow lee `validada`. Si vuelve null,
  //    el grafo se iba entero por la rama de rechazo sin decir por qué.
  const val = filaDeNodo('nodo Validar filas', 'Validar filas', [reg.ingesta_id]);
  if (typeof val.validada !== 'boolean') {
    throw new Error(`«Validar filas» no devolvió la columna validada: ${JSON.stringify(val).slice(0, 300)}`);
  }
  if (val.validada !== true) {
    throw new Error(`inyección rechazada: ${JSON.stringify(val.diagnostico).slice(0, 500)}`);
  }

  // 3. «Clonar corrida» — corrida NUEVA, la base intacta (regla 10, 21 §3).
  const clon = filaDeNodo('nodo Clonar corrida', 'Clonar corrida', [CORRIDA_BASE, reg.ingesta_id]);
  const corrida = clon.corrida_nueva_id;
  if (!corrida) throw new Error(`«Clonar corrida» no devolvió corrida_nueva_id: ${JSON.stringify(clon)}`);
  if (corrida === CORRIDA_BASE) throw new Error('la inyección mutó el snapshot base');

  // 4. «Recalcular pistas y clusters» sobre la corrida nueva.
  const recalculo = filaDeNodo('nodo Recalcular pistas y clusters', 'Recalcular pistas y clusters',
    [corrida, reg.inyeccion_id]);

  // 5. «Asegurar clusters inyectados» (db/012) o su respaldo declarado.
  const rfcs = pasoJson('rfcs_afectados',
    `select coalesce(to_jsonb(rfcs_afectados), '[]'::jsonb)::text
       from forense.inyecciones where id = ${lit(reg.inyeccion_id)}::uuid`);
  const garantizados = filasDeNodo('nodo Asegurar clusters inyectados', 'Asegurar clusters inyectados',
    [corrida, reg.inyeccion_id]);
  if (garantizados.length === 0) throw new Error('ningún cluster garantizado para los RFC inyectados');

  // 6. «Clusters afectados primero» + «Priorizar afectados» (el Code node real).
  const prioridad = filasDeNodo('nodo Clusters afectados primero', 'Clusters afectados primero',
    [corrida, reg.inyeccion_id]);
  const despacho = priorizar({
    prioridad,
    garantizados,
    recalculo: { corrida_nueva_id: corrida, inyeccion_id: reg.inyeccion_id },
  });
  if (despacho.length === 0) throw new Error('no se despachó ningún cluster');
  const idsGarantizados = new Set(garantizados.map((g) => g.cluster_id));
  if (!idsGarantizados.has(despacho[0].cluster_id)) {
    throw new Error('QA-004: el primer cluster despachado no es uno de los garantizados por la inyección');
  }
  if (!despacho[0].garantizado || !despacho[0].idempotency_key.startsWith(`inyeccion:${reg.inyeccion_id}:`)) {
    throw new Error(`el despacho no lleva la marca de la inyección: ${JSON.stringify(despacho[0])}`);
  }

  // 7. Caso + dictamen DETERMINISTA (regla 4). El paquete se LEE de la base.
  const cluster = despacho[0].cluster_id;
  const caso = pasoJson('crear_caso',
    `select forense.crear_caso(${lit(corrida)}::uuid, ${lit(cluster)}::uuid, 'inyeccion',
       ${lit(reg.inyeccion_id)}, ${lit(`${SELLO}:${ensayo.id}`)}, null)::text`);
  if (caso.ok !== true) throw new Error(`crear_caso falló: ${JSON.stringify(caso).slice(0, 300)}`);
  // 7a. Ronda 1 SIMULADA: `dictaminar` sólo sube de `no_concluyente` cuando
  //     `cobertura_completa` es true, y eso lo fija la barrera de ronda 1
  //     cerrada, no la evidencia. Se crean las tareas de los roles evaluables
  //     con las funciones reales, se marcan completadas (el proveedor está
  //     simulado: no hay llamada al modelo) y se cierra la barrera con
  //     advance_case_if_ready. El nivel lo sigue calculando código determinista.
  const ctx1 = pasoJson('preparar_contexto_ronda1',
    `select forense.preparar_contexto_ronda1(${lit(caso.caso_id)}::uuid)::text`);
  const roles = (ctx1.roles_evaluables ?? ctx1.agentes ?? []).filter(Boolean);
  const rolesSql = roles.length
    ? `array[${roles.map(lit).join(',')}]::text[]`
    : `array['documental','financiero','relacional','temporal','externo']::text[]`;
  pasoJson('crear_tareas_ronda(1)',
    `select forense.crear_tareas_ronda(${lit(caso.caso_id)}::uuid, 1, ${rolesSql})::text`);

  // Cierre por CHECKPOINT, no por UPDATE (17 §3). `crear_tareas_ronda` ya creó
  // una ejecución por tarea y la barrera con el conjunto exacto de tarea_id;
  // aquí sólo se reclama el lease y se termina con el fence que devolvió el
  // claim. Un UPDATE directo saltaría el fencing y no dejaría rastro.
  const ejecuciones = pasoJson('ejecuciones de la ronda 1',
    `select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'rol', e.rol)), '[]'::jsonb)::text
       from forense.ejecuciones_agente e
      where e.caso_id = ${lit(caso.caso_id)}::uuid and e.tarea_id is not null`);
  if (ejecuciones.length === 0) throw new Error('la ronda 1 no creó ejecuciones: no hay nada que cerrar');
  for (const e of ejecuciones) {
    const claim = pasoJson(`claim_step(${e.rol})`,
      `select forense.claim_step(${lit(e.id)}::uuid, ${lit(`${SELLO}:${e.rol}`)})::text`);
    if (claim.ok !== true) throw new Error(`claim_step(${e.rol}): ${JSON.stringify(claim).slice(0, 200)}`);
    const fin = pasoJson(`finish_step(${e.rol})`,
      `select forense.finish_step(${lit(e.id)}::uuid, ${claim.fence}::bigint, ${claim.revision}::int,
         'terminado', '{"origen":"proveedor_simulado"}'::jsonb)::text`);
    if (fin.ok !== true) throw new Error(`finish_step(${e.rol}): ${JSON.stringify(fin).slice(0, 200)}`);
  }
  const avance = pasoJson('advance_case_if_ready(ronda1)',
    `select forense.advance_case_if_ready(${lit(caso.caso_id)}::uuid, 'ronda1', NULL)::text`);
  if (avance.avanzo !== true) {
    throw new Error(`la barrera de ronda 1 no cerró: ${JSON.stringify(avance).slice(0, 300)}`);
  }
  // `cerrar_ronda` es lo que recalcula la cobertura en la última ronda (015).
  // Se cierra la ronda 1 (no hay ronda 2 en el ensayo) y la cobertura la vuelve
  // a calcular `paquete_auditor_final` sobre el estado real del caso.
  pasoJson('cerrar_ronda(1)',
    `select coalesce(to_jsonb(t), 'null'::jsonb)::text from (
       select * from forense.cerrar_ronda(${lit(caso.caso_id)}::uuid, 1, '{}'::jsonb)) t limit 1`);

  // 7b. Auditor SIMULADO: sin evidencia citada el paquete siempre sale
  //     `no_concluyente` y el ensayo no mediría nada. El proveedor es simulado,
  //     pero la evidencia se registra con la RPC real (05 §4.11 valida que los
  //     rfcs_afectados intersequen emisor/receptor del CFDI citado) y la valida
  //     `forense_validar_evidencia`. El nivel lo sigue decidiendo el Auditor
  //     Final determinista sobre lo que quedó en la base (regla 4).
  const tAuditor = pasoJson('abrir_tarea_cierre(auditor)',
    `select forense.abrir_tarea_cierre(${lit(caso.caso_id)}::uuid, 'auditor')::text`);
  const tareaAuditor = tAuditor.tarea_id ?? tAuditor.id;
  // El auditor simulado NO fabrica una evidencia por familia: eso sería fijar el
  // resultado que la prueba dice medir. Cita los CFDI del snapshot que
  // efectivamente tocan a los RFC del caso y que la pista correspondiente
  // referencia; cuántas familias quedan sustentadas lo decide el dato, y lo
  // filtra después `forense_validar_evidencia`. Si un CFDI no existe o no
  // interseca los RFC del caso, la RPC lo rechaza y aquí no se compensa.
  const items = pasoJson('evidencia citada del snapshot', `
    with c as (select * from forense.casos where id = ${lit(caso.caso_id)}::uuid),
         rf as (select array[c.rfc_principal] || coalesce(c.rfcs_satelite, '{}') as rfcs from c),
         p as (select pi.id, pi.codigo, left(pi.codigo, 1) as familia, pi.rfc, pi.detalle
                 from forense.pistas pi, c, rf
                where pi.corrida_id = c.corrida_id and pi.rfc = any(rf.rfcs)),
         u as (select p.id, p.codigo, p.familia, f.uuid, f.emisor_rfc, f.receptor_rfc,
                      row_number() over (partition by p.id order by f.uuid) as n
                 from p
                 join c on true
                 join forense.cfdi f on f.corrida_id = c.corrida_id
                                    and (f.emisor_rfc = p.rfc or f.receptor_rfc = p.rfc))
    select coalesce(jsonb_agg(jsonb_build_object(
             'tipo', 'cfdi', 'ref_id', 'CFDI:' || u.uuid, 'pista_id', u.id,
             'pista_codigo', u.codigo, 'familia', u.familia,
             'rfcs_afectados', to_jsonb(array[u.emisor_rfc, u.receptor_rfc]),
             'referencias', jsonb_build_array('CFDI:' || u.uuid),
             'comprobacion', 'pista ' || u.codigo || ' citada sobre el CFDI ' || u.uuid,
             'descripcion', 'cita del snapshot para ' || u.codigo)), '[]'::jsonb)::text
      from u where u.n <= 2`);
  const registro = items.length
    ? pasoJson('forense_registrar_evidencia',
      `select public.forense_registrar_evidencia(p_caso=>${lit(caso.caso_id)}::uuid, p_agente=>'auditor',
         p_items=>${lit(JSON.stringify(items))}::jsonb, p_tarea=>${lit(tareaAuditor)}::uuid, p_ronda=>1)::text`)
    : { ok: true, nota: 'sin ids citables' };
  const validacion = pasoJson('forense_validar_evidencia',
    `select public.forense_validar_evidencia(${lit(caso.caso_id)}::uuid)::text`);

  // La tarea de cierre del auditor también tiene que quedar terminal antes de
  // pedir el paquete: `forense.cobertura_caso` (015) exige que TODAS las tareas
  // del caso lo estén. Dejarla abierta era lo que mantenía la cobertura en
  // false aunque la ronda 1 hubiera cerrado. Se cierra por checkpoint, igual
  // que las de la ronda.
  const ejecAuditor = psql(`select e.id::text from forense.ejecuciones_agente e
     where e.tarea_id = ${lit(tareaAuditor)}::uuid limit 1`);
  if (ejecAuditor) {
    const claimA = pasoJson('claim_step(auditor)',
      `select forense.claim_step(${lit(ejecAuditor)}::uuid, ${lit(`${SELLO}:auditor`)})::text`);
    if (claimA.ok !== true) throw new Error(`claim_step(auditor): ${JSON.stringify(claimA).slice(0, 200)}`);
    const finA = pasoJson('finish_step(auditor)',
      `select forense.finish_step(${lit(ejecAuditor)}::uuid, ${claimA.fence}::bigint, ${claimA.revision}::int,
         'terminado', '{"origen":"auditor_simulado"}'::jsonb)::text`);
    if (finA.ok !== true) throw new Error(`finish_step(auditor): ${JSON.stringify(finA).slice(0, 200)}`);
  }
  const coberturaSql = pasoJson('forense.cobertura_caso (015)',
    `select to_jsonb(forense.cobertura_caso(${lit(caso.caso_id)}::uuid))::text`);
  const tareasNoTerminales = pasoJson('tareas no terminales del caso',
    `select coalesce(jsonb_object_agg(t.agente, t.estado), '{}'::jsonb)::text
       from forense.tareas_agente t
      where t.caso_id = ${lit(caso.caso_id)}::uuid and t.estado not in ('completada','omitida')`);
  const fronteraPendiente = Number(psql(`select count(*) from forense.clusters k,
       unnest(coalesce(k.rfcs_frontera, '{}'::text[])) f
      where k.id = ${lit(cluster)}::uuid and not (f = any(coalesce(k.rfcs, '{}'::text[])))`));

  // El paquete se lee con la MISMA consulta del nodo «Paquete auditor final» de
  // FORENSE_investigar_cluster, que adapta la forma de 010 a la que consume
  // `dictaminar()` (monto en hecho_validado, no en la raíz del ítem). Leer la
  // función cruda daba «Monto validado ausente» — el desajuste que IMPORT.md
  // documenta y que el nodo ya resuelve.
  // ¿Corrió la defensa? Es la capa de descarte de falsos positivos: sin
  // filas en `forense.defensas` ni evaluación por caso, `anomalia_explicada`
  // es inalcanzable por construcción (db/017, auditor-final.mjs).
  const defensas = Number(psql(`select count(*) from forense.defensas d
      where d.caso_id = ${lit(caso.caso_id)}::uuid and d.aceptado is not null`));

  const paquete = pasoJson('nodo Paquete auditor final',
    `select to_jsonb(t)::text from (${sqlDeNodo('Paquete auditor final', [caso.caso_id], 'FORENSE_investigar_cluster')}) t`);
  const dictamen = dictaminar(paquete);
  if (!NIVELES.includes(dictamen.nivel)) {
    throw new Error(`nivel fuera del catálogo: ${dictamen.nivel} (máximo presuncion_alta, regla 7)`);
  }

  // 8. Reglas 2 y 10: eventos persistidos y base intacta.
  const evInyeccion = eventos(corrida, 'inyeccion') + eventos(CORRIDA_BASE, 'inyeccion');
  if (evInyeccion === 0) throw new Error('regla 2: la inyección no dejó evento en forense.bitacora');
  const huellaDespues = huella(CORRIDA_BASE);
  if (huellaAntes !== huellaDespues) throw new Error('regla 10: la corrida base cambió durante la inyección');

  const resultado = {
    ensayo: ensayo.id,
    archivo: ensayo.archivo,
    corrida_base: CORRIDA_BASE,
    corrida_nueva: corrida,
    inyeccion_id: reg.inyeccion_id,
    rfcs_afectados: rfcs,
    pistas_insertadas: recalculo.pistas_insertadas,
    clusters_armados: recalculo.clusters_armados,
    garantizados: garantizados.map((g) => ({ rfc: g.rfc, cluster_id: g.cluster_id, creado: g.creado })),
    ruta_garantia: 'forense.asegurar_clusters_inyectados (db/012)',
    despachados: despacho.map((d) => ({ cluster_id: d.cluster_id, garantizado: d.garantizado, creado: d.creado, rfc: d.rfc_inyectado })),
    en_cola: despacho[0].en_cola,
    caso_id: caso.caso_id,
    nivel: dictamen.nivel,
    niveles_esperados: ensayo.niveles,
    // Veredicto en TRES estados. Un nivel bajo sólo prueba discriminación si el
    // sistema llegó a cobertura completa y aun así no subió: con la cobertura
    // incompleta, `dictaminar` devuelve `no_concluyente` por construcción y el
    // ensayo (c) «acertaría» sin haber mirado nada. El proveedor simulado no
    // sabe distinguir una comercializadora legítima de un carrusel -eso es lo
    // que investiga el modelo-, así que ese caso se reporta como
    // `requiere_api_real`, no como CUMPLE.
    defensas_aplicadas: defensas,
    veredicto: (() => {
      // El orden importa. Las dos condiciones que hacen INJUZGABLE la
      // corrida se comprueban ANTES del nivel: si la capa que decide el
      // resultado no se ejecutó, el nivel que salga no es evidencia de nada.
      if (ensayo.exige_defensa && defensas === 0) return 'requiere_api_real';
      if (ensayo.exige_cobertura && paquete.cobertura_completa !== true) return 'requiere_api_real';
      if (!ensayo.niveles.includes(dictamen.nivel)) return 'falla';
      return 'cumple';
    })(),
    cumple: ensayo.niveles.includes(dictamen.nivel)
      && (!ensayo.exige_cobertura || paquete.cobertura_completa === true)
      && (!ensayo.exige_defensa || defensas > 0),
    cobertura_completa: paquete.cobertura_completa,
    cobertura_sql: coberturaSql,
    // Por qué el ensayo quedó injuzgable, si lo quedó. Sin esto el informe
    // culpa a la cobertura de algo que es la defensa ausente.
    motivo_api_real: (ensayo.exige_defensa && defensas === 0)
      ? 'no corrió el Defensor (0 defensas resueltas): sin capa de descarte, anomalia_explicada es inalcanzable'
      : ((ensayo.exige_cobertura && paquete.cobertura_completa !== true)
        ? 'cobertura incompleta: cualquier caso sale no_concluyente por construcción'
        : null),
    // Por qué la cobertura quedó como quedó, con los tres términos de la regla
    // de 015 a la vista: así el veredicto se puede discutir sin releer el script.
    motivo_cobertura: paquete.cobertura_completa === true ? 'completa'
      : (Object.keys(tareasNoTerminales).length > 0 ? 'tareas sin terminar: ' + JSON.stringify(tareasNoTerminales)
        : (fronteraPendiente > 0 ? `${fronteraPendiente} RFC de frontera sin explorar y sin expansión usada (ronda 2 no simulada)`
          : 'limitaciones abiertas en casos.pendientes')),
    tareas_no_terminales: tareasNoTerminales,
    rfcs_frontera_fuera_del_cluster: fronteraPendiente,
    pendientes: (paquete.pendientes ?? []).map((x) => x.motivo ?? x),
    familias_dictamen: dictamen.familias,
    regla_dictamen: dictamen.regla,
    evidencia_en_paquete: (paquete.evidencia ?? []).length,
    evidencia_valida_tecnica: (paquete.evidencia ?? []).filter((e) => e.valida_tecnica === true && e.validada === true && e.refutada !== true).length,
    roles_ronda1: roles,
    avance_ronda1: avance && avance.avanzo,
    evidencia_registrada: items.length,
    evidencia_valida: validacion && validacion.validas !== undefined ? validacion.validas : validacion,
    registro_ok: registro && registro.ok !== false,
    pistas_en_paquete: (paquete.pistas ?? []).length,
    eventos_inyeccion: evInyeccion,
    base_intacta: true,
    ms_total: Date.now() - t0,
  };

  if (!CONSERVAR) {
    const r = execFileSync(PSQL, ['-U', 'postgres', '-h', 'localhost', '-d', BASE, '-At', '-c',
      `delete from forense.corridas where id = ${lit(corrida)}::uuid`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    resultado.limpiado = String(r).trim() !== '';
  }
  return resultado;
}

let fallo = null;
for (const ensayo of ENSAYOS) {
  if (ENSAYO_ARG && ENSAYO_ARG !== ensayo.id) continue;
  try {
    const r = correrEnsayo(ensayo);
    resultados.push(r);
    if (r.veredicto === 'falla') fallo = `ensayo (${r.ensayo}): nivel ${r.nivel}, se esperaba ${r.niveles_esperados.join(' o ')}`;
    if (!SALIDA_JSON) {
      console.log(`  → nivel=${r.nivel} (esperado ${r.niveles_esperados.join('|')}) ${r.veredicto.toUpperCase()}`);
      console.log(`  → cobertura_completa=${r.cobertura_completa} (${r.motivo_cobertura}) pendientes=${JSON.stringify(r.pendientes)} evidencia=${r.evidencia_en_paquete}/${r.evidencia_valida_tecnica} familias=${JSON.stringify(r.familias_dictamen)}`);
      console.log(`  → garantizados=${r.garantizados.length} despachados=${r.despachados.length} en_cola=${r.en_cola} pistas=${JSON.stringify(r.pistas_insertadas)}`);
    }
  } catch (err) {
    fallo = `ensayo (${ensayo.id}): ${err.message}`;
    resultados.push({ ensayo: ensayo.id, error: err.message });
    break;
  }
}

const resumen = {
  base: BASE,
  corrida_base: CORRIDA_BASE,
  db_012: true,
  db_015: true,
  db_016: true,
  db_017: true,
  requieren_api_real: resultados.filter((r) => r.veredicto === 'requiere_api_real').map((r) => r.ensayo),
  ensayos: resultados,
  tiempos_por_etapa: tiempos,
  ms_total: tiempos.reduce((a, b) => a + b.ms, 0),
  ok: !fallo,
};

if (SALIDA_JSON) console.log(JSON.stringify(resumen, null, 2));
else {
  console.log(`\nSQL total ${resumen.ms_total} ms en ${tiempos.length} consultas`);
  const pendientesApi = resumen.requieren_api_real;
  if (fallo) console.log(`FALLA ${fallo}`);
  else if (pendientesApi.length > 0) {
    console.log(`ok con reservas: ensayo(s) ${pendientesApi.join(', ')} REQUIEREN API REAL`);
    for (const r of resultados.filter((x) => x.veredicto === 'requiere_api_real')) {
      console.log(`  (${r.ensayo}) nivel observado ${r.nivel}, no juzgable: ${r.motivo_api_real}`);
    }
  } else console.log('ok: los ensayos (a) y (c) cumplen su nivel esperado con cobertura completa');
}
process.exit(fallo ? 1 : 0);
