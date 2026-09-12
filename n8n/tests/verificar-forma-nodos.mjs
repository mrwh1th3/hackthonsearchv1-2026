#!/usr/bin/env node
// n8n/tests/verificar-forma-nodos.mjs — ejecuta DE VERDAD la SQL de los nodos
// recableados y comprueba que las columnas que declara CONTRATOS_NODOS vuelven
// con valor.
//
// Por qué existe: `PREPARE` (n8n/tests/preparar-sql.mjs) analiza tipos, NO la
// forma de la salida. Casi toda función de 004–008 devuelve `jsonb` escalar:
// una columna proyectada con `jsonb_to_record` que nombra una clave inexistente
// vuelve NULL en silencio, pasa PREPARE, pasa los tests de texto, y rompe el
// grafo dos nodos más adelante. Esto lo caza.
//
// Cada consulta corre dentro de BEGIN … ROLLBACK: no deja escrituras.
//
// Uso:  node n8n/tests/verificar-forma-nodos.mjs [base]
//       (la base necesita 001–008 y un caso ya investigado; el script busca el
//        caso más reciente con tareas de ronda 1)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CONTRATOS_NODOS } from '../runtime/generar-workflows.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'forense_rt';
const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';

function psql(sql) {
  return execFileSync(
    PSQL,
    ['-U', 'postgres', '-h', 'localhost', '-d', BASE, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

const ctx = JSON.parse(psql(`
  select jsonb_build_object(
    'caso_id', c.id, 'cluster_id', c.cluster_id, 'corrida_id', c.corrida_id,
    'rfc', c.rfc_principal,
    'tarea_id', (select t.id from forense.tareas_agente t where t.caso_id = c.id order by t.ronda limit 1)
  )::text
  from forense.casos c
  where exists (select 1 from forense.tareas_agente t where t.caso_id = c.id and t.ronda = 1)
  order by c.creado desc limit 1`));
if (!ctx?.caso_id) throw new Error(`no hay caso con tareas de ronda 1 en ${BASE}: corre antes e2e-camino-worker.mjs`);

const UUID_NULO = '00000000-0000-4000-8000-000000000000';

// Valores por posición de parámetro, por nodo. Sólo los nodos cuya SQL se
// recableó en este corte: los demás siguen dependiendo de funciones ausentes.
const CASOS = {
  'Resolver y reclamar cluster': [ctx.corrida_id, ctx.cluster_id, 'pipeline', null, 'probe-forma', ctx.caso_id],
  'Crear caso': [ctx.corrida_id, ctx.cluster_id, null, 'probe-forma-caso', 'probe', ctx.caso_id, 'pipeline'],
  'Contexto ronda 1': [ctx.caso_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'Crear tareas R1': [ctx.caso_id, '["documental"]', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'Esperar barrera R1': [ctx.caso_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'Barrera R2': [ctx.caso_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'Expandir y crear tareas R2': [ctx.caso_id, '[]', '[]', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  Auditoría: [ctx.caso_id, 'auditor', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  Defensa: [ctx.caso_id, 'defensor', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  Redacción: [ctx.caso_id, 'redactor', ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
  'Validar evidencia propuesta': [ctx.caso_id, ctx.tarea_id, ctx.cluster_id, ctx.corrida_id, ctx.caso_id],
};

// Columnas que pueden venir NULL legítimamente (rama de error, o dato que sólo
// existe cuando la barrera venció / hubo expansión).
const NULL_PERMITIDO = new Set([
  'motivo', 'faltantes', 'limitaciones', 'resultados', 'vencida', 'tarea_id',
  'tarea_ids', 'snapshot_senales', 'validadas', 'descartadas',
]);

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);

const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', 'FORENSE_investigar_cluster.json'), 'utf8'));
const contrato = CONTRATOS_NODOS.FORENSE_investigar_cluster;
let ok = 0; let fallas = 0;

for (const nodo of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres')) {
  const valores = CASOS[nodo.name];
  if (!valores) continue;
  // Sustitución por posición: $10 antes que $1 para no partir el número.
  let sql = nodo.parameters.query;
  for (let i = valores.length; i >= 1; i -= 1) {
    sql = sql.replaceAll(`$${i}`, lit(valores[i - 1] ?? UUID_NULO));
  }
  const envoltura = `BEGIN; SELECT coalesce(to_jsonb(t), '{}'::jsonb)::text FROM (${sql}) t LIMIT 1; ROLLBACK;`;
  let fila;
  try {
    const salida = psql(envoltura);
    const linea = salida.split('\n').find((l) => l.trimStart().startsWith('{'));
    fila = linea ? JSON.parse(linea) : {};
  } catch (err) {
    const detalle = String(err.stderr ?? err.message).split('\n').filter(Boolean)[0] ?? '';
    console.log(`ERROR    ${nodo.name}\n           ${detalle}`);
    fallas += 1;
    continue;
  }
  const declaradas = contrato[nodo.name] ?? [];
  const nulas = declaradas.filter((c) => !NULL_PERMITIDO.has(c) && (fila[c] === null || fila[c] === undefined));
  if (nulas.length) {
    console.log(`NULL     ${nodo.name}\n           columnas declaradas sin valor: ${nulas.join(', ')}`);
    fallas += 1;
  } else {
    console.log(`ok       ${nodo.name}  (${declaradas.length} columnas declaradas)`);
    ok += 1;
  }
}

console.log(`\nok=${ok} con_problema=${fallas}  base=${BASE} caso=${ctx.caso_id}`);
process.exit(fallas > 0 ? 1 : 0);
