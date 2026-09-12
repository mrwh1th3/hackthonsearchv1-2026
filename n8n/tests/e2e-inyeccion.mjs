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
// HALLAZGO H10 (medido aquí, no específico de la inyección): el ensayo (a) llega
// con dos familias sustentadas (R, T), evidencia válida y `pendientes` vacío, y
// aun así el nivel se queda en `no_concluyente` porque `casos.cobertura_completa`
// sigue en false. En 001–011 ninguna función la pone en true salvo
// `guardar_dictamen`, que la copia del dictamen — y `dictaminar()` la EXIGE para
// pasar de `no_concluyente`. Tal cual está, ningún caso puede alcanzar
// `presuncion`. Hace falta que el cierre de la última ronda (o la validación de
// evidencia) la fije cuando la cobertura es real. Petición a forense-db, no algo
// que el runtime pueda arreglar sin inventarse el dato (regla 4).
//
// PENDIENTE_DB_012: `forense.asegurar_clusters_inyectados(corrida, inyeccion)`
// la entrega forense-db. Mientras no exista, este script usa el respaldo
// `forense.armar_cluster_para` (004, ya existe) por cada RFC afectado — la misma
// ruta de investigación manual que la función va a encapsular — y lo DECLARA en
// la salida en vez de aprobarlo en silencio.

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

const HAY_012 = psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='forense' and p.proname='asegurar_clusters_inyectados'`) !== '0';

if (!SALIDA_JSON) {
  console.log(`base=${BASE} corrida_base=${CORRIDA_BASE} gen-v1`);
  console.log(HAY_012
    ? 'db/012 presente: se ejecuta forense.asegurar_clusters_inyectados'
    : 'PENDIENTE_DB_012: sin forense.asegurar_clusters_inyectados; respaldo forense.armar_cluster_para');
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
  let garantizados;
  if (HAY_012) {
    garantizados = filasDeNodo('nodo Asegurar clusters inyectados', 'Asegurar clusters inyectados',
      [corrida, reg.inyeccion_id]);
  } else {
    garantizados = rfcs.map((rfc) => {
      const antes = psql(`select count(*) from forense.clusters k
         where k.corrida_id = ${lit(corrida)}::uuid and ${lit(rfc)} = any(k.rfcs)`);
      const cid = paso(`respaldo armar_cluster_para(${rfc})`,
        `select forense.armar_cluster_para(${lit(corrida)}::uuid, ${lit(rfc)})::text`);
      return { cluster_id: cid, rfc, creado: antes === '0' };
    });
  }
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
  paso('ronda 1: tareas completadas (proveedor simulado)',
    `update forense.tareas_agente set estado='completada', terminado=now(),
            lease_owner=NULL, lease_expires_at=NULL
      where caso_id = ${lit(caso.caso_id)}::uuid and ronda = 1`);
  paso('registrar barrera ronda1', `insert into forense.pasos_pipeline
     (caso_id, paso, revision, tareas_esperadas, estado, deadline)
     select ${lit(caso.caso_id)}::uuid, 'ronda1', 1,
            coalesce(array_agg(id), '{}'), 'abierto', now() + interval '15 minutes'
       from forense.tareas_agente where caso_id = ${lit(caso.caso_id)}::uuid and ronda = 1
     on conflict do nothing`);
  const avance = pasoJson('advance_case_if_ready(ronda1)',
    `select forense.advance_case_if_ready(${lit(caso.caso_id)}::uuid, 'ronda1', NULL)::text`);

  // 7b. Auditor SIMULADO: sin evidencia citada el paquete siempre sale
  //     `no_concluyente` y el ensayo no mediría nada. El proveedor es simulado,
  //     pero la evidencia se registra con la RPC real (05 §4.11 valida que los
  //     rfcs_afectados intersequen emisor/receptor del CFDI citado) y la valida
  //     `forense_validar_evidencia`. El nivel lo sigue decidiendo el Auditor
  //     Final determinista sobre lo que quedó en la base (regla 4).
  const tAuditor = pasoJson('abrir_tarea_cierre(auditor)',
    `select forense.abrir_tarea_cierre(${lit(caso.caso_id)}::uuid, 'auditor')::text`);
  const tareaAuditor = tAuditor.tarea_id ?? tAuditor.id;
  const items = pasoJson('evidencia simulada por familia', `
    with c as (select * from forense.casos where id = ${lit(caso.caso_id)}::uuid),
         p as (select pi.id, pi.codigo, left(pi.codigo, 1) as familia, pi.rfc
                 from forense.pistas pi, c
                where pi.corrida_id = c.corrida_id
                  and pi.rfc = any(array[c.rfc_principal] || coalesce(c.rfcs_satelite, '{}'))),
         u as (select distinct on (p.familia) p.id, p.codigo, p.familia, p.rfc,
                      f.uuid, f.emisor_rfc, f.receptor_rfc
                 from p
                 join c on true
                 join forense.cfdi f on f.corrida_id = c.corrida_id
                                    and (f.emisor_rfc = p.rfc or f.receptor_rfc = p.rfc)
                order by p.familia, f.uuid)
    select coalesce(jsonb_agg(jsonb_build_object(
             'tipo', 'cfdi', 'ref_id', 'CFDI:' || u.uuid, 'pista_id', u.id,
             'pista_codigo', u.codigo, 'familia', u.familia,
             'rfcs_afectados', to_jsonb(array[u.emisor_rfc, u.receptor_rfc]),
             'referencias', jsonb_build_array('CFDI:' || u.uuid),
             'comprobacion', 'pista ' || u.codigo || ' sostenida por el CFDI ' || u.uuid,
             'descripcion', 'evidencia simulada para ' || u.codigo)), '[]'::jsonb)::text
      from u`);
  const registro = items.length
    ? pasoJson('forense_registrar_evidencia',
      `select public.forense_registrar_evidencia(p_caso=>${lit(caso.caso_id)}::uuid, p_agente=>'auditor',
         p_items=>${lit(JSON.stringify(items))}::jsonb, p_tarea=>${lit(tareaAuditor)}::uuid, p_ronda=>1)::text`)
    : { ok: true, nota: 'sin ids citables' };
  const validacion = pasoJson('forense_validar_evidencia',
    `select public.forense_validar_evidencia(${lit(caso.caso_id)}::uuid)::text`);

  // El paquete se lee con la MISMA consulta del nodo «Paquete auditor final» de
  // FORENSE_investigar_cluster, que adapta la forma de 010 a la que consume
  // `dictaminar()` (monto en hecho_validado, no en la raíz del ítem). Leer la
  // función cruda daba «Monto validado ausente» — el desajuste que IMPORT.md
  // documenta y que el nodo ya resuelve.
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
    ruta_garantia: HAY_012 ? 'forense.asegurar_clusters_inyectados (db/012)' : 'PENDIENTE_DB_012: respaldo forense.armar_cluster_para',
    despachados: despacho.map((d) => ({ cluster_id: d.cluster_id, garantizado: d.garantizado, creado: d.creado, rfc: d.rfc_inyectado })),
    en_cola: despacho[0].en_cola,
    caso_id: caso.caso_id,
    nivel: dictamen.nivel,
    niveles_esperados: ensayo.niveles,
    cumple: ensayo.niveles.includes(dictamen.nivel),
    cobertura_completa: paquete.cobertura_completa,
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
    if (!r.cumple) fallo = `ensayo (${r.ensayo}): nivel ${r.nivel}, se esperaba ${r.niveles_esperados.join(' o ')}`;
    if (!SALIDA_JSON) {
      console.log(`  → nivel=${r.nivel} (esperado ${r.niveles_esperados.join('|')}) ${r.cumple ? 'OK' : 'FALLA'}`);
      console.log(`  → cobertura_completa=${r.cobertura_completa} pendientes=${JSON.stringify(r.pendientes)} evidencia=${r.evidencia_en_paquete}/${r.evidencia_valida_tecnica} familias=${JSON.stringify(r.familias_dictamen)}`);
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
  db_012: HAY_012,
  ensayos: resultados,
  tiempos_por_etapa: tiempos,
  ms_total: tiempos.reduce((a, b) => a + b.ms, 0),
  ok: !fallo,
};

if (SALIDA_JSON) console.log(JSON.stringify(resumen, null, 2));
else {
  console.log(`\nSQL total ${resumen.ms_total} ms en ${tiempos.length} consultas`);
  console.log(fallo ? `FALLA ${fallo}` : 'ok: los ensayos (a) y (c) cumplen su nivel esperado');
}
process.exit(fallo ? 1 : 0);
