#!/usr/bin/env node
// n8n/tests/verificar-forma-nodos.mjs — ejecuta DE VERDAD la SQL de los nodos
// Postgres de LOS DIEZ workflows y comprueba que las columnas que declara
// CONTRATOS_NODOS vuelven con valor.
//
// Por qué existe: `PREPARE` (n8n/tests/preparar-sql.mjs) analiza tipos, NO la
// forma de la salida. Casi toda función de 004–010 devuelve `jsonb` escalar:
// una columna proyectada con `jsonb_to_record` que nombra una clave inexistente
// vuelve NULL en silencio, pasa PREPARE, pasa los tests de texto, y rompe el
// grafo dos nodos más adelante. Esto lo caza.
//
// Cada consulta corre dentro de BEGIN … ROLLBACK: no deja escrituras, ni
// siquiera los nodos que escriben (claims, barreras, dictamen, cierre).
//
// Uso:  node n8n/tests/verificar-forma-nodos.mjs [base] [--verbose]
//       (la base necesita 001–010 y un caso ya investigado; el script busca el
//        caso más reciente con tareas de ronda 1 → corre antes
//        `node n8n/tests/e2e-camino-worker.mjs <base>`)
//
// Un nodo sin caso declarado se OMITE y se cuenta: la salida dice exactamente
// qué queda sin verificar y por qué, en vez de aprobarlo en silencio.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CONTRATOS_NODOS } from '../runtime/generar-workflows.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'forense_rt';
const VERBOSE = args.includes('--verbose');
const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';

function psql(sql) {
  return execFileSync(
    PSQL,
    ['-U', 'postgres', '-h', 'localhost', '-d', BASE, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

// Contexto real de la base: ids que existen. Lo que no exista vuelve null y
// los nodos que lo necesiten se omiten con motivo.
const ctx = JSON.parse(psql(`
  select jsonb_build_object(
    'caso_id', c.id, 'cluster_id', c.cluster_id, 'corrida_id', c.corrida_id,
    'rfc', c.rfc_principal,
    'investigacion_id', (select i.id from forense.investigaciones i where i.caso_id = c.id order by i.creado limit 1),
    'tarea_id', (select t.id from forense.tareas_agente t where t.caso_id = c.id order by t.ronda limit 1),
    'tarea_replica_id', (select t.id from forense.tareas_agente t where t.caso_id = c.id and t.agente = 'replica' limit 1),
    'evento_id', (select s.id from forense.eventos_salida s order by s.creado desc limit 1),
    'inyeccion_id', (select y.id from forense.inyecciones y order by y.creado desc limit 1),
    'ingesta_id', (select g.id from forense.ingestas g order by g.creado desc limit 1),
    'version_expediente', (select max(x.version) from forense.expedientes x where x.caso_id = c.id)
  )::text
  from forense.casos c
  where exists (select 1 from forense.tareas_agente t where t.caso_id = c.id and t.ronda = 1)
  order by c.creado desc limit 1`));
if (!ctx?.caso_id) throw new Error(`no hay caso con tareas de ronda 1 en ${BASE}: corre antes e2e-camino-worker.mjs`);

const UUID_NULO = '00000000-0000-4000-8000-000000000000';

// Valores por posición de parámetro, por `WORKFLOW/Nodo`. La clave lleva el
// workflow porque los nombres de nodo SE REPITEN entre archivos («Crear caso»,
// «Barrera R2»…): un mapa plano ataría el caso equivocado a la consulta
// equivocada. Un valor `null` en la lista se envía como NULL; `undefined`
// (hueco) se envía como el UUID nulo.
const CASOS = {
  // ---------------------------------------------------------- investigación
  'FORENSE_investigar_cluster/Resolver y reclamar cluster': [ctx.corrida_id, ctx.cluster_id, 'pipeline', null, 'probe-forma', ctx.caso_id],
  'FORENSE_investigar_cluster/Crear caso': [ctx.corrida_id, ctx.cluster_id, null, 'probe-forma-caso', 'probe', ctx.caso_id, 'pipeline'],
  'FORENSE_investigar_cluster/Contexto ronda 1': [ctx.caso_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Crear tareas R1': [ctx.caso_id, '["documental"]', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Registrar barrera R1': [ctx.caso_id, `{${ctx.tarea_id}}`, '{}', '2099-01-01T00:00:00Z'],
  'FORENSE_investigar_cluster/Esperar barrera R1': [ctx.caso_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Ronda fin R1': [ctx.caso_id, 1, '{"resultados":[],"limitaciones":[]}'],
  'FORENSE_investigar_cluster/Barrera R2': [ctx.caso_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Expandir y crear tareas R2': [ctx.caso_id, '[]', '[]', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Auditoría': [ctx.caso_id, 'auditor', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Defensa': [ctx.caso_id, 'defensor', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Redacción': [ctx.caso_id, 'redactor', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Validar evidencia propuesta': [ctx.caso_id, ctx.tarea_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'FORENSE_investigar_cluster/Aplicar resolución': [ctx.caso_id, ctx.tarea_replica_id ?? ctx.tarea_id],
  'FORENSE_investigar_cluster/Paquete auditor final': [ctx.caso_id],
  'FORENSE_investigar_cluster/Claim de reintento': [ctx.caso_id, '{"motivo":"evidencia_insuficiente","objetivo":"probe"}'],
  // El dictamen es el que produce `dictaminar()`: niveles del catálogo, nunca
  // 'definitivo' (regla 7) y nunca decidido por el modelo.
  'FORENSE_investigar_cluster/Guardar dictamen': [ctx.caso_id,
    '{"nivel":"no_concluyente","familias":[],"monto_en_riesgo_centavos":"0","regla":"probe-forma","limitaciones":[]}'],
  'FORENSE_investigar_cluster/Validar citas': [ctx.caso_id, ctx.version_expediente ?? 1],
  'FORENSE_investigar_cluster/Cerrar caso': [ctx.caso_id, 'dictaminado'],
  // ------------------------------------------------------------- reintento
  'FORENSE_reintento/Cargar caso vigente': [ctx.caso_id, 1, 'evidencia_insuficiente', '{"rfcs":[]}'],
  'FORENSE_reintento/Seleccionar autores': [ctx.caso_id, 'evidencia_insuficiente', '{"rfcs":[]}'],
  'FORENSE_reintento/Registrar límite de expansión': [ctx.caso_id, '{"alcance":"expansion","intento":1}', ctx.corrida_id, '{documental}'],
  'FORENSE_reintento/Expandir para reintento': [ctx.caso_id, '{"rfcs":[]}'],
  'FORENSE_reintento/Crear tareas de revisión': [ctx.caso_id, 1, '{documental}', '{"motivo":"evidencia_insuficiente"}'],
  'FORENSE_reintento/Barrera reintento': [ctx.caso_id, 'reintento1'],
  'FORENSE_reintento/Revalidar si cambió evidencia': [ctx.caso_id],
  // --------------------------------------------------------- reconciliador
  'FORENSE_reconciliador/Slots vencidos': [],
  'FORENSE_reconciliador/Pasos recuperables': [],
  'FORENSE_reconciliador/Barreras vencidas': [],
  'FORENSE_reconciliador/Outbox pendiente': [20],
  // ---------------------------------------------------------------- errores
  'FORENSE_errores/Registrar y liberar': [ctx.caso_id, 'sistema', '{"error":"probe"}', ctx.tarea_id, ctx.corrida_id, 'probe: error técnico'],
  // ----------------------------------------------------------------- editor
  'FORENSE_editar_expediente/Cargar versión base': [ctx.caso_id, ctx.version_expediente ?? 1],
  // ---------------------------------------------------------------- corrida
  'FORENSE_corrida/Verificar integridad': [ctx.corrida_id],
  'FORENSE_corrida/Correr pistas': [ctx.corrida_id],
  'FORENSE_corrida/Armar clusters': [ctx.corrida_id],
  'FORENSE_corrida/Clusters por score': [ctx.corrida_id, ctx.investigacion_id ?? ctx.caso_id, 5],
  'FORENSE_corrida/Esperar y reconciliar': [ctx.corrida_id],
  'FORENSE_corrida/Métricas': [ctx.corrida_id],
  // --------------------------------------------------------------- inyectar
  ...(ctx.inyeccion_id ? {
    'FORENSE_inyectar/Validar filas': [ctx.inyeccion_id],
    'FORENSE_inyectar/Recalcular pistas y clusters': [ctx.corrida_id, ctx.inyeccion_id],
    'FORENSE_inyectar/Clusters afectados primero': [ctx.corrida_id, ctx.inyeccion_id],
  } : {}),
  // ------------------------------------------------------------------- voz
  ...(ctx.evento_id ? {
    'FORENSE_notificar_completada/Releer evento desde DB': [ctx.evento_id],
    'FORENSE_notificar_completada/Reclamar evento': [ctx.evento_id, 'probe-forma'],
  } : {}),
  ...(ctx.investigacion_id ? {
    'FORENSE_notificar_completada/Resolver destinatario': [ctx.investigacion_id],
  } : {}),
};

// Columnas que pueden venir NULL legítimamente (rama de error, o dato que sólo
// existe cuando la barrera venció / hubo expansión / no hay fila que reclamar).
const NULL_PERMITIDO = new Set([
  'motivo', 'faltantes', 'limitaciones', 'resultados', 'vencida', 'tarea_id',
  'tarea_ids', 'snapshot_senales', 'validadas', 'descartadas', 'rechazo',
  'tarea_replica_id', 'motivo_omision', 'diagnostico', 'error', 'pendientes',
  'investigacion_id', 'objetivo', 'autores', 'expansiones_usadas',
  'rfcs_frontera', 'ruta_material', 'roles_por_expansion', 'telefono_e164',
  // `verificar_integridad_corrida` solo llena `causa` cuando la corrida NO es
  // íntegra; `cargar_version_expediente` solo trae prompt_hash/modelo cuando
  // hay una propuesta del editor sobre esa versión.
  'causa', 'prompt_hash', 'modelo',
  'nombre', 'idioma', 'consentimiento', 'duracion_ms', 'estado_final',
]);

// Preparación dentro de la MISMA transacción que se revierte. La usa el nodo
// que inserta una fila con clave única que el e2e ya creó: sin esto el probe
// mide el UNIQUE, no la forma de la salida.
const PREVIO = {
  'FORENSE_investigar_cluster/Registrar barrera R1':
    (c) => `DELETE FROM forense.pasos_pipeline WHERE caso_id = '${c.caso_id}' AND paso = 'ronda1';`,
};

const lit = (v) => (v === null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);

let ok = 0; let fallas = 0; const omitidos = []; const vacios = [];
const archivos = fs.readdirSync(path.join(RAIZ, 'workflows')).filter((f) => f.endsWith('.json'));

for (const archivo of archivos.sort()) {
  const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', archivo), 'utf8'));
  const contrato = CONTRATOS_NODOS[wf.name] ?? {};
  for (const nodo of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres')) {
    const clave = `${wf.name}/${nodo.name}`;
    const valores = CASOS[clave];
    if (!valores) { omitidos.push(clave); continue; }
    // Sustitución por posición: $10 antes que $1 para no partir el número.
    let sql = nodo.parameters.query;
    for (let i = valores.length; i >= 1; i -= 1) {
      sql = sql.replaceAll(`$${i}`, lit(valores[i - 1] === undefined ? UUID_NULO : valores[i - 1]));
    }
    // Tres formas de consulta, tres envolturas. Un `SELECT ... FROM (INSERT …)`
    // no compila, y un CTAS no acepta un INSERT desnudo: envolver mal mide el
    // error de sintaxis de la envoltura, no la forma del nodo.
    const cuerpo = sql.replace(/^\s*(--[^\n]*\n)+/, '').trimStart();
    const previo = PREVIO[clave] ? `${PREVIO[clave](ctx)}\n` : '';
    const envoltura = /^(insert|update|delete)\b/i.test(cuerpo)
      ? `BEGIN; ${previo}WITH _probe AS (${sql}\n) SELECT to_jsonb(t)::text FROM _probe t LIMIT 1; ROLLBACK;`
      : `BEGIN; ${previo}CREATE TEMP TABLE _probe AS ${sql};\nSELECT to_jsonb(t)::text FROM _probe t LIMIT 1; ROLLBACK;`;
    let fila;
    try {
      const salida = psql(envoltura);
      const linea = salida.split('\n').find((l) => l.trimStart().startsWith('{'));
      // Cero filas: la consulta corre pero NO prueba su forma. Se cuenta
      // aparte; contarlo como «ok» sería aprobar lo que no se vio.
      if (!linea) { vacios.push(clave); continue; }
      fila = JSON.parse(linea);
    } catch (err) {
      const detalle = String(err.stderr ?? err.message).split('\n').filter(Boolean)[0] ?? '';
      console.log(`ERROR    ${clave}\n           ${detalle}`);
      fallas += 1;
      continue;
    }
    const declaradas = contrato[nodo.name] ?? [];
    const nulas = declaradas.filter((c) => !NULL_PERMITIDO.has(c) && (fila[c] === null || fila[c] === undefined));
    if (nulas.length) {
      console.log(`NULL     ${clave}\n           columnas declaradas sin valor: ${nulas.join(', ')}`);
      fallas += 1;
    } else {
      if (VERBOSE) console.log(`ok       ${clave}  (${declaradas.length} columnas declaradas)`);
      ok += 1;
    }
  }
}

if (vacios.length) {
  console.log(`\nsin filas (la consulta corre pero no prueba su forma): ${vacios.length}`);
  for (const c of vacios) console.log(`  · ${c}`);
}
if (omitidos.length) {
  console.log(`\nomitidos (sin caso declarado en CASOS): ${omitidos.length}`);
  for (const c of omitidos) console.log(`  · ${c}`);
}
console.log(`\nok=${ok} con_problema=${fallas} sin_filas=${vacios.length} omitidos=${omitidos.length}  base=${BASE} caso=${ctx.caso_id}`);
process.exit(fallas > 0 ? 1 : 0);
