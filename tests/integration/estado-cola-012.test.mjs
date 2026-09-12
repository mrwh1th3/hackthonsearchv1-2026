// =====================================================================
// tests/integration/estado-cola-012.test.mjs — una corrida NO está terminada
// mientras le queden clusters sin despachar (db/012_inyeccion_clusters.sql §3).
//
//   node --test tests/integration/estado-cola-012.test.mjs
//   (antes: bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Trabaja sobre una corrida PROPIA que crea y borra; no
// toca el fixture, gen-v1 ni la base compartida.
//
// El hallazgo alto que cierra 012: `estado_corrida` (010) sólo miraba
// `forense.casos`. Un cluster garantizado por la inyección nace DESPUÉS de que
// la corrida empezó a despachar; si nadie le crea caso, la vieja
// `estado_corrida` declaraba `completada` con trabajo sin empezar — y el
// runtime deja de hacer polling justo cuando el juez acaba de inyectar.
//
// El escenario es el mínimo que distingue las dos versiones: SEIS clusters,
// CUATRO despachados y cerrados como `dictaminado`. Con 010 eso da
// `terminada=true, completada` (no queda ningún caso en cola); con 012 tiene
// que dar `en_curso` porque quedan dos clusters sin caso. Los cuatro casos se
// cierran a propósito: si se dejaran abiertos, la prueba pasaría también con
// 010 y no probaría nada.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DB_QA, correr, correrOk, escalar, filas, hayBase, json } from './_ayudas.mjs';

const saltar = !hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)';

const SELLO = `qa-cola-${process.pid}-${Date.now().toString(36)}`;
const CORRIDA = randomUUID();
const CLUSTERS = Array.from({ length: 6 }, () => randomUUID());

function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Las seis columnas de `estado_corrida`, como objeto. */
function estado() {
  const [f] = filas(DB_QA, `
    select terminada, estado_final, completados, en_cola, errores
      from forense.estado_corrida(${lit(CORRIDA)}::uuid)`);
  assert.ok(f, 'estado_corrida no devolvió ninguna fila');
  return { terminada: f[0] === 't', final: f[1], completados: Number(f[2]),
           enCola: Number(f[3]), errores: Number(f[4]) };
}

/** `cola_corrida` (012, aditiva): el número que `estado_corrida` no puede exponer. */
function cola() {
  const [f] = filas(DB_QA, `
    select clusters_total, cola_restante, casos_activos
      from forense.cola_corrida(${lit(CORRIDA)}::uuid)`);
  assert.ok(f, 'cola_corrida no devolvió ninguna fila');
  return { total: Number(f[0]), restante: Number(f[1]), activos: Number(f[2]) };
}

/** Despacha un cluster con la RPC real (deja bitácora) y lo cierra dictaminado. */
function despachar(i) {
  const caso = json(DB_QA, `forense.crear_caso(${lit(CORRIDA)}::uuid, ${lit(CLUSTERS[i])}::uuid,
    'qa', ${lit(`${SELLO}-${i}`)}, ${lit(`${SELLO}-${i}`)})`);
  assert.equal(caso.ok, true, `crear_caso falló para el cluster ${i}: ${JSON.stringify(caso)}`);
  correrOk(DB_QA, `select * from forense.cerrar_caso(${lit(caso.caso_id)}::uuid, 'dictaminado');`);
  return caso.caso_id;
}

const hayCola = saltar || (escalar(DB_QA,
  `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'forense' and p.proname = 'cola_corrida'`) === '1'
  ? false
  : 'falta forense.cola_corrida: aplica db/012_inyeccion_clusters.sql');

test('estado_corrida no cierra una corrida con clusters pendientes (6 clusters, 4 despachados)',
  { skip: saltar || hayCola, timeout: 300000 }, async (t) => {
    correrOk(DB_QA, `
      insert into forense.corridas (id, nombre, dataset, dataset_hash, fecha_corte, estado, modo)
      values (${lit(CORRIDA)}::uuid, ${lit(SELLO)}, 'qa-cola', md5(${lit(SELLO)}),
              now(), 'procesando', 'fiscal');
      insert into forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado)
      select v.id::uuid, ${lit(CORRIDA)}::uuid, array['QAC' || v.n || '0101AAA'],
             'QAC' || v.n || '0101AAA', 1, 10 - v.n, md5(v.id), 'pendiente'
        from (values ${CLUSTERS.map((id, i) => `(${lit(id)}, ${i})`).join(',')}) as v(id, n);`);

    t.after(() => {
      const r = correr(DB_QA, `delete from forense.corridas where id = ${lit(CORRIDA)};`);
      if (r.code !== 0) console.log(`[limpieza] no se borró la corrida ${CORRIDA}: ${r.error.slice(0, 200)}`);
    });

    await t.test('recién armada: 6 clusters en cola y ningún caso ⇒ en_curso, no sin_clusters', () => {
      assert.deepEqual(cola(), { total: 6, restante: 6, activos: 0 });
      const e = estado();
      assert.equal(e.terminada, false, 'una corrida con 6 clusters sin despachar no está terminada');
      assert.equal(e.final, 'en_curso',
        `estado_final=${e.final}: con 010 salía 'sin_clusters' porque no había casos todavía`);
    });

    await t.test('4 de 6 despachados y dictaminados ⇒ sigue en_curso (el hallazgo de 012)', () => {
      for (let i = 0; i < 4; i += 1) despachar(i);

      const c = cola();
      assert.equal(c.total, 6, 'cola_corrida perdió clusters de vista');
      assert.equal(c.restante, 2,
        `quedan ${c.restante} clusters sin caso y deberían quedar 2: el cluster garantizado ` +
        'de una inyección es justo el que se cuenta aquí');
      assert.equal(c.activos, 0, 'los cuatro casos se cerraron: no debería quedar ninguno activo');

      const e = estado();
      assert.equal(e.completados, 4, 'los cuatro casos dictaminados no se contaron');
      assert.equal(e.enCola, 0, 'no debería quedar ningún CASO en cola (la cola que queda es de clusters)');
      assert.equal(e.terminada, false,
        'la corrida se declaró terminada con 2 clusters sin despachar: es exactamente el bug que 012 cierra ' +
        '(el runtime dejaría de hacer polling justo después de una inyección en vivo)');
      assert.equal(e.final, 'en_curso', `estado_final=${e.final} con 2 clusters pendientes`);
    });

    await t.test('drenada la cola de clusters ⇒ completada', () => {
      for (let i = 4; i < 6; i += 1) despachar(i);

      assert.deepEqual(cola(), { total: 6, restante: 0, activos: 0 });
      const e = estado();
      assert.equal(e.completados, 6);
      assert.equal(e.terminada, true, 'con los 6 clusters despachados y cerrados la corrida sí termina');
      assert.equal(e.final, 'completada', `estado_final=${e.final}`);
    });

    await t.test('cada despacho dejó su rastro en la bitácora (regla 2)', () => {
      const eventos = Number(escalar(DB_QA, `
        select count(*) from forense.bitacora
         where corrida_id = ${lit(CORRIDA)} and tipo_evento = 'caso_creado'`));
      assert.equal(eventos, 6, `${eventos} eventos caso_creado para 6 clusters despachados`);
    });

    await t.test('un cluster que reaparece vuelve a abrir la corrida', () => {
      // La cola se mide cada vez, no se recuerda: si la inyección agrega un
      // cluster después de que la corrida se declaró completada, la corrida
      // vuelve a estar en curso. Es la propiedad que hace utilizable el polling.
      const extra = randomUUID();
      correrOk(DB_QA, `
        insert into forense.clusters (id, corrida_id, rfcs, rfc_semilla, n_rfcs, score, huella, estado)
        values (${lit(extra)}::uuid, ${lit(CORRIDA)}::uuid, array['QAC90101AAA'],
                'QAC90101AAA', 1, 1, md5(${lit(extra)}), 'pendiente');`);
      const c = cola();
      assert.equal(c.total, 7);
      assert.equal(c.restante, 1, 'el cluster recién agregado no entró en la cola');
      const e = estado();
      assert.equal(e.terminada, false, 'un cluster nuevo sin caso tiene que reabrir la corrida');
      assert.equal(e.final, 'en_curso', `estado_final=${e.final} tras agregar un cluster sin caso`);
    });

    await t.test('la corrida marcada completada manda sobre la cola', () => {
      // `estado_corrida` respeta el estado de la propia corrida: cerrarla a
      // mano (o con error) es una decisión de operación, no un cálculo.
      correrOk(DB_QA, `update forense.corridas set estado = 'completada' where id = ${lit(CORRIDA)};`);
      const e = estado();
      assert.equal(e.terminada, true, 'con corridas.estado=completada la corrida está terminada');
      assert.equal(e.final, 'completada');
      correrOk(DB_QA, `update forense.corridas set estado = 'procesando' where id = ${lit(CORRIDA)};`);
    });
  });
