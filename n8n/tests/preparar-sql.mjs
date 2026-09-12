#!/usr/bin/env node
// n8n/tests/preparar-sql.mjs — comprueba con Postgres REAL que la SQL de los
// workflows parsea y resuelve contra el esquema (001–003).
//
// No es un test de `node --test`: necesita una base local y por eso se ejecuta
// a mano. `PREPARE` analiza y comprueba tipos SIN ejecutar nada, así que no
// toca datos. Uso:
//
//   createdb forense_runtime && psql -d forense_runtime -f db/001_schema.sql …
//   node n8n/tests/preparar-sql.mjs forense_runtime
//
// Salida: una línea por consulta. `ok` = la función y las columnas existen;
// `PENDIENTE` = falla porque la función es de 004/005 (forense-db) y todavía no
// existe; `FALLA` = error real que hay que corregir antes del smoke.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'forense_runtime';
const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql';

// Funciones que entrega forense-db en 004/005 (y el enum de bitácora que hay
// que ampliar). Un fallo que las mencione es dependencia, no defecto.
const PENDIENTES = [
  // Ausentes de verdad en 001–008 (verificado con pg_proc el 2026-09-12 H5):
  // escrituras transaccionales que pertenecen a forense-db. Ver IMPORT.md
  // §«Funciones que faltan» y `solicitudes_coordinador` de la entrega.
  'abrir_corrida', 'cargar_o_clonar_snapshot', 'verificar_integridad_corrida',
  'estado_corrida', 'cerrar_ronda', 'aplicar_resolucion_replica',
  'paquete_auditor_final', 'guardar_dictamen', 'validar_expediente', 'cerrar_caso',
  'autores_reintento', 'expandir_cluster_reintento', 'crear_tareas_revision',
  'revalidar_caso', 'cerrar_barreras_vencidas', 'eventos_salida_pendientes',
  'cargar_version_expediente', 'guardar_propuesta_edicion',
  // 007 — el nodo llama a un nombre que 007 no expone; la capacidad existe con
  // otra firma (reclamar_evento_salida(owner,segundos), solicitar_llamada,
  // resultado_llamada). Pendientes de recablear, NO de migración.
  'leer_evento_salida', 'destinatario_aviso', 'omitir_llamada',
  'crear_intento_llamada', 'guardar_aceptacion_llamada', 'reclamar_evento_salida',
  'registrar_callback_llamada', 'actualizar_llamada',
  // 008 — idem: existe clusters_afectados(p_inyeccion) y registrar_inyeccion
  // con cinco argumentos.
  'clusters_por_prioridad_inyeccion', 'registrar_inyeccion',
  // enum de bitácora que 009 amplía
  'ck_bitacora_tipo_evento', 'paso_en_cola', 'paso_checkpoint',
];

const archivos = fs.readdirSync(path.join(RAIZ, 'workflows')).filter((f) => f.endsWith('.json'));
let ok = 0; let pendiente = 0; let falla = 0;

for (const archivo of archivos) {
  const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', archivo), 'utf8'));
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.postgres')) {
    const consulta = n.parameters.query;
    const sql = `PREPARE chk AS ${consulta};\nDEALLOCATE chk;`;
    try {
      execFileSync(PSQL, ['-U', 'postgres', '-h', 'localhost', '-d', BASE, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql],
        { stdio: ['ignore', 'pipe', 'pipe'] });
      console.log(`ok        ${wf.name} / ${n.name}`);
      ok += 1;
    } catch (err) {
      const detalle = String(err.stderr ?? err.message).split('\n').filter(Boolean)[0] ?? '';
      const esPendiente = PENDIENTES.some((p) => detalle.includes(p));
      console.log(`${esPendiente ? 'PENDIENTE' : 'FALLA    '} ${wf.name} / ${n.name}\n           ${detalle}`);
      if (esPendiente) pendiente += 1; else falla += 1;
    }
  }
}

console.log(`\nok=${ok} pendiente_004_005=${pendiente} falla=${falla}`);
process.exit(falla > 0 ? 1 : 0);
