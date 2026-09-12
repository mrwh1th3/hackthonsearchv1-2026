// =====================================================================
// tests/integration/rendimiento-pistas.test.mjs — `correr_pistas` sobre un clon
// de gen-v1 tiene que caber en el gate de la inyección en vivo.
//
//   node --test tests/integration/rendimiento-pistas.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Clona gen-v1 en una corrida propia y la borra; la corrida
// base se LEE (regla 10: `correr_pistas` ESCRIBE pistas, así que nunca se
// ejecuta sobre gen-v1 directamente).
//
// Por qué 30 s: el juez inyecta datos con el sistema corriendo (21 §3) y lo
// que ve es clonar → recalcular pistas → reordenar la cola. Las pistas son el
// tramo largo de esa cadena. Pasados ~30 s la demo deja de leerse como una
// reacción y empieza a leerse como un cuelgue. El umbral NO es de QA: si el
// número real lo supera, esto se reporta al coordinador; no se sube el umbral.
//
// Cuando la medición se pasa del umbral la prueba NO se limita a fallar:
// cronometra cada pista por separado sobre otro clon y nombra a la culpable,
// además de decir cuándo fue el último ANALYZE de las tablas grandes. La
// diferencia entre 0.2 s y 42 s en `pista_f1` sobre el MISMO snapshot es un
// cambio de plan por estadísticas ausentes, no un problema de máquina, y esa
// distinción es justo lo que hay que poner en el informe.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORRIDA_GEN_V1, DB_QA, correr, correrOk, escalar, filas, hayBase, techoPrueba, TIMEOUT_MS } from './_ayudas.mjs';

/** Gate de la inyección en vivo (21 §3). No se relaja desde QA. */
const UMBRAL_MS = 30000;

/** Las 14 pistas de docs/02, en el orden en que las corre `correr_pistas`. */
const PISTAS = ['d1', 'd2', 'd3', 'd4', 'f1', 'f2', 'f3', 'f4', 'r1', 'r2', 'r3', 't1', 't2', 'e1'];

const SELLO = `qa-perf-${process.pid}-${Date.now().toString(36)}`;

function lit(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

const conBase = hayBase(DB_QA);
const hayGen = conBase && escalar(DB_QA,
  `select count(*) from forense.corridas where id = ${lit(CORRIDA_GEN_V1)}`) === '1';

const saltar = (!conBase && 'sin base forense_qa (corre tests/integration/preparar-db.sh)') ||
  (!hayGen && 'sin gen-v1 en forense_qa (corre DATOS=clon bash tests/integration/preparar-db.sh)');

const creadas = [];

function clonar(marca) {
  const nueva = escalar(DB_QA,
    `select forense.clonar_corrida(${lit(CORRIDA_GEN_V1)}::uuid, ${lit(`${SELLO}-${marca}`)})::text`);
  assert.ok(nueva, 'clonar_corrida no devolvió corrida');
  creadas.push(nueva);
  return nueva;
}

function limpiar(corrida) {
  const r = correr(DB_QA, `delete from forense.corridas where id = ${lit(corrida)};`);
  if (r.code !== 0) console.log(`[limpieza] no se borró ${corrida}: ${r.error.slice(0, 200)}`);
}

/** Milisegundos de reloj de una sentencia, medidos en el cliente. */
function cronometrar(sql) {
  const t0 = process.hrtime.bigint();
  correrOk(DB_QA, sql);
  return Number((process.hrtime.bigint() - t0) / 1000000n);
}

/** Cuándo se analizaron por última vez las tablas que pesan en el barrido. */
function estadisticas() {
  return filas(DB_QA, `
    select relname,
           coalesce(to_char(greatest(last_analyze, last_autoanalyze), 'HH24:MI:SS'), 'NUNCA')
      from pg_stat_user_tables
     where schemaname = 'forense' and relname in ('cfdi','movimientos','cuentas','complementos_pago')
     order by 1`).map(([t, cuando]) => `${t}=${cuando}`).join(' ');
}

test('correr_pistas sobre un clon de gen-v1 cabe en el gate de 30 s de la inyección en vivo',
  { skip: saltar, timeout: techoPrueba(6) }, async (t) => {
    t.after(() => creadas.forEach(limpiar));

    await t.test('la base sólo tiene lo que debe: el número se puede interpretar', () => {
      const inventario = filas(DB_QA, `
        select c.id::text, c.nombre, (select count(*) from forense.cfdi f where f.corrida_id = c.id)
          from forense.corridas c order by 3 desc`);
      console.log(`[base] ${inventario.length} corridas en ${DB_QA}: ` +
        inventario.map(([, n, k]) => `${n}=${k} CFDI`).join(', '));
      console.log(`[estadisticas] último ANALYZE: ${estadisticas()}`);

      const gen = Number(escalar(DB_QA,
        `select count(*) from forense.cfdi where corrida_id = ${lit(CORRIDA_GEN_V1)}`));
      assert.ok(gen > 5000,
        `gen-v1 tiene ${gen} CFDI: medir sobre un snapshot recortado no diría nada del gate`);

      const gordas = inventario.filter(([id, , k]) => Number(k) > 1000 && id !== CORRIDA_GEN_V1);
      if (gordas.length) {
        console.log(`[aviso] ${gordas.length} corrida(s) grandes además de gen-v1 ` +
          `(${gordas.map(([, n]) => n).join(', ')}): la medición compite con ellas`);
      }
    });

    await t.test(`el barrido completo por debajo de ${UMBRAL_MS} ms`, () => {
      const corrida = clonar('barrido');
      const ms = cronometrar(`select forense.correr_pistas(${lit(corrida)}::uuid);`);
      const pistas = Number(escalar(DB_QA,
        `select count(*) from forense.pistas where corrida_id = ${lit(corrida)}`));

      console.log(`[rendimiento] correr_pistas = ${ms} ms sobre un clon de gen-v1 ` +
        `(${pistas} pistas; umbral ${UMBRAL_MS} ms; margen ${UMBRAL_MS - ms} ms)`);
      assert.ok(pistas > 0,
        'el clon no produjo ni una pista: se estaría midiendo un no-op, no el barrido');

      if (ms > UMBRAL_MS) {
        // Desglose sobre OTRO clon: el barrido no se puede repetir sobre el
        // mismo (las pistas ya están escritas) y hay que saber si la culpa es
        // de una pista o está repartida entre las catorce.
        const otro = clonar('desglose');
        correrOk(DB_QA, `update forense.corridas set estado = 'procesando' where id = ${lit(otro)};`);
        const refresco = cronometrar('refresh materialized view forense.v_pares_giro;');
        const porPista = PISTAS.map((p) => ({
          pista: p.toUpperCase(),
          ms: cronometrar(`select forense.pista_${p}(${lit(otro)}::uuid);`),
        })).sort((a, b) => b.ms - a.ms);
        const top = porPista.slice(0, 3).map((x) => `${x.pista}=${x.ms} ms`).join(', ');
        console.log(`[desglose] refresh v_pares_giro=${refresco} ms; ${porPista.map((x) => `${x.pista}=${x.ms}`).join(' ')}`);

        assert.fail(
          `correr_pistas tardó ${ms} ms sobre un clon de gen-v1 (${pistas} pistas) y el gate de la ` +
          `inyección en vivo es ${UMBRAL_MS} ms. Las tres pistas más caras: ${top}. ` +
          `Último ANALYZE: ${estadisticas()}. ` +
          'Si una sola pista se lleva casi todo el tiempo, el sospechoso es el PLAN sobre un clon ' +
          'recién creado (filas sin estadísticas), no la máquina: `analyze forense.cfdi, ' +
          'forense.movimientos, forense.cuentas, forense.complementos_pago` cuesta ~120 ms. ' +
          'QA no sube el umbral: esto va al coordinador y a forense-db (db/013_rendimiento.sql).');
      }
    });
  });

// ---------------------------------------------------------------------
// Guarda del orden de techos (QA-006)
// ---------------------------------------------------------------------

test('ninguna prueba del banco declara un techo por debajo del techo del cliente psql', () => {
  // El orden tiene que ser statement_timeout < timeout del cliente < timeout
  // de la prueba. Invertido, node mata la prueba antes de que el servidor
  // cancele la consulta: se pierde el error de SQL y el backend sigue vivo con
  // el lock de `v_pares_giro`. Así fallaba inyeccion-008 con la máquina
  // cargada. `techoPrueba()` lo deriva del cliente; esta guarda impide que
  // vuelva a colarse un literal por debajo.
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const malos = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.mjs'))) {
    const texto = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of texto.matchAll(/timeout:\s*(\d+)/g)) {
      if (Number(m[1]) < TIMEOUT_MS) malos.push(`${f}: timeout: ${m[1]} < ${TIMEOUT_MS}`);
    }
  }
  assert.deepEqual(malos, [],
    `techos de prueba por debajo del techo del cliente psql (usa techoPrueba(n)): ${malos.join('; ')}`);
});
