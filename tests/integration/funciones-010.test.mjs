// =====================================================================
// tests/integration/funciones-010.test.mjs — las funciones de runtime de
// db/010_runtime_funciones.sql, contra el catálogo de Postgres.
//
//   node --test tests/integration/funciones-010.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Sólo lee db/ y n8n/; escribe únicamente en forense_qa,
// sobre una corrida propia con prefijo `qa-010-`.
//
// Qué se afirma y por qué:
//   1. La firma. Cada función que 010 DECLARA existe en `pg_proc` con los
//      mismos parámetros de entrada (nombre y orden) y, cuando devuelve
//      `returns table(...)`, con las mismas columnas. `PREPARE` comprueba
//      tipos de una llamada concreta; esto comprueba la firma COMPLETA, que
//      es lo que rompe un nodo Postgres que hace `SELECT *`.
//      La lista NO se escribe a mano: se deriva del .sql. Si forense-db añade
//      o quita una función, la prueba lo dice sin editarla.
//   2. Regla 2 de CLAUDE.md sobre TODAS a la vez: si una función de 010 muta
//      una tabla de dominio, su cuerpo tiene que dejar evento
//      (`forense.log`/`log_corrida`, o insert directo en `forense.bitacora`
//      o `forense.actividad_producto`). Es un cierre transitivo sobre
//      `prosrc`: una que delegue el registro en un ayudante también pasa.
//   3. Y una comprobación de COMPORTAMIENTO —no de texto— sobre las que se
//      pueden ejecutar baratas: se llaman de verdad y se cuenta la fila en
//      `forense.bitacora`. El análisis estático solo demuestra que el código
//      lo nombra; esto demuestra que la fila llega.
//
// No duplica `db/tests/assertions_010.sql` (dueño forense-db), que ejecuta
// cada función con datos propios: aquí se mide la superficie (firma + rastro)
// sobre la MISMA base donde corre el resto del banco de QA.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DB_QA, RAIZ, correrOk, escalar, filas, hayBase, json } from './_ayudas.mjs';

const FUENTE = path.join(RAIZ, 'db/010_runtime_funciones.sql');
const saltar = (!hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)') ||
  (!fs.existsSync(FUENTE) && 'falta db/010_runtime_funciones.sql (pendiente de forense-db)');

function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------
// Lectura del .sql: nombre, parámetros de entrada y columnas devueltas.
// ---------------------------------------------------------------------

/** Texto entre el paréntesis que abre en `desde` y el que lo cierra. */
function bloqueParentesis(texto, desde) {
  let profundidad = 0;
  for (let i = desde; i < texto.length; i += 1) {
    if (texto[i] === '(') profundidad += 1;
    else if (texto[i] === ')') {
      profundidad -= 1;
      if (profundidad === 0) return texto.slice(desde + 1, i);
    }
  }
  return null;
}

/** Corta por comas de primer nivel (no las de `numeric(12,2)` ni `array[...]`). */
function partesTopLevel(texto) {
  const partes = [];
  let profundidad = 0; let actual = '';
  for (const ch of texto) {
    if (ch === '(' || ch === '[') profundidad += 1;
    else if (ch === ')' || ch === ']') profundidad -= 1;
    if (ch === ',' && profundidad === 0) { partes.push(actual); actual = ''; continue; }
    actual += ch;
  }
  if (actual.trim()) partes.push(actual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

const IDENT = /^([a-z_][a-z0-9_]*)/;

/** Las funciones que 010 declara, con su firma tal como está escrita. */
function declaradas() {
  const sql = fs.readFileSync(FUENTE, 'utf8');
  const salida = [];
  const re = /^create or replace function forense\.([a-z0-9_]+)\s*\(/gmi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const nombre = m[1];
    const abre = sql.indexOf('(', m.index + m[0].length - 1);
    const args = bloqueParentesis(sql, abre);
    assert.ok(args !== null, `paréntesis sin cerrar en forense.${nombre}`);
    const params = partesTopLevel(args).map((p) => {
      const id = IDENT.exec(p.trim());
      assert.ok(id, `parámetro ilegible en forense.${nombre}: ${p}`);
      return id[1];
    });

    // `returns table(...)` → columnas; `returns jsonb`/`void`/… → escalar.
    const resto = sql.slice(abre + args.length + 2, abre + args.length + 2 + 4000);
    const mr = /^\s*returns\s+(setof\s+)?table\s*\(/i.exec(resto);
    let columnas = null;
    if (mr) {
      const cuerpo = bloqueParentesis(resto, resto.indexOf('(', mr[0].length - 1));
      columnas = partesTopLevel(cuerpo).map((c) => IDENT.exec(c.trim())[1]);
    }
    salida.push({ nombre, params, columnas, firma: `${nombre}(${params.join(', ')})` });
  }
  return salida;
}

const DECLARADAS = fs.existsSync(FUENTE) ? declaradas() : [];

// ---------------------------------------------------------------------
// 1. Cada función declarada existe en pg_proc con la MISMA firma
// ---------------------------------------------------------------------

test('db/010 declara funciones y el catálogo de Postgres las tiene con la firma esperada',
  { skip: saltar }, async (t) => {
    assert.ok(DECLARADAS.length > 0, 'no se pudo leer ninguna función de db/010_runtime_funciones.sql');

    // Catálogo: por nombre, todas las sobrecargas con sus argumentos de
    // ENTRADA (pg_get_function_arguments no incluye las columnas de TABLE) y
    // el resultado. `proargnames` mezclaría entrada y columnas devueltas.
    const catalogo = new Map();
    for (const [nombre, args, resultado] of filas(DB_QA, `
      select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'forense' order by 1, 2`)) {
      if (!catalogo.has(nombre)) catalogo.set(nombre, []);
      catalogo.get(nombre).push({ args, resultado });
    }

    /** Nombres de los parámetros de una firma del catálogo, en orden. */
    const nombresDe = (args) => partesTopLevel(args).map((a) => IDENT.exec(a.trim())?.[1]).filter(Boolean);

    for (const fn of DECLARADAS) {
      await t.test(fn.firma, () => {
        const candidatas = catalogo.get(fn.nombre) ?? [];
        assert.ok(candidatas.length > 0,
          `forense.${fn.nombre} está en db/010 y no en la base: ¿se aplicó la migración?`);

        const igual = candidatas.find((c) => {
          const n = nombresDe(c.args);
          return n.length === fn.params.length && n.every((x, i) => x === fn.params[i]);
        });
        assert.ok(igual,
          `ninguna sobrecarga de forense.${fn.nombre} tiene los parámetros ${JSON.stringify(fn.params)};\n` +
          `  en la base: ${candidatas.map((c) => c.args).join('  |  ')}`);

        if (fn.columnas) {
          const mc = /^TABLE\((.*)\)$/is.exec(igual.resultado);
          assert.ok(mc, `forense.${fn.nombre} declara returns table y la base dice ${igual.resultado}`);
          const enBase = partesTopLevel(mc[1]).map((c) => IDENT.exec(c.trim())[1]);
          assert.deepEqual(enBase, fn.columnas,
            `las columnas devueltas por forense.${fn.nombre} no son las declaradas: ` +
            'un nodo Postgres que hace SELECT * leería otras claves');
        }
      });
    }
  });

// ---------------------------------------------------------------------
// 2. Las sobrecargas conviven sin ambigüedad
// ---------------------------------------------------------------------

test('las funciones de 010 que sobrecargan a 007/008 conviven y se resuelven por tipos',
  { skip: saltar }, () => {
    const porNombre = new Map();
    for (const fn of DECLARADAS) porNombre.set(fn.nombre, (porNombre.get(fn.nombre) ?? 0) + 1);
    const sobrecargadas = [...porNombre].filter(([, n]) => n > 1).map(([n]) => n);

    for (const nombre of ['reclamar_evento_salida', 'registrar_inyeccion']) {
      const n = Number(escalar(DB_QA, `
        select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'forense' and p.proname = ${lit(nombre)}`));
      assert.ok(n >= 2,
        `forense.${nombre} debería convivir con la versión de 007/008 (hay ${n})`);
    }
    // Dos declaraciones con los MISMOS nombres de parámetro en el mismo orden
    // serían la misma función: la segunda habría reemplazado a la primera.
    for (const nombre of sobrecargadas) {
      const firmas = DECLARADAS.filter((f) => f.nombre === nombre).map((f) => f.params.join(','));
      assert.equal(new Set(firmas).size, firmas.length,
        `forense.${nombre} se declara dos veces con la misma firma: la segunda borra a la primera`);
    }
  });

// ---------------------------------------------------------------------
// 3. Regla 2: lo que muta deja evento. Cierre transitivo sobre prosrc.
// ---------------------------------------------------------------------

test('toda función de 010 que muta deja rastro (regla 2), directamente o por un ayudante',
  { skip: saltar }, () => {
    const fuentes = new Map(Object.entries(json(DB_QA, `
      (select jsonb_object_agg(p.proname || '/' || pg_get_function_arguments(p.oid), p.prosrc)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'forense'
          and p.prolang <> (select oid from pg_language where lanname = 'c'))`)));

    // prosrc por nombre (todas las sobrecargas concatenadas): el cierre
    // transitivo se sigue por nombre, que es lo que aparece en el texto.
    const porNombre = new Map();
    for (const [clave, src] of fuentes) {
      const nombre = clave.split('/')[0];
      porNombre.set(nombre, (porNombre.get(nombre) ?? '') + '\n' + src);
    }

    const REGISTRO = /forense\.log\s*\(|forense\.log_corrida\s*\(|insert\s+into\s+forense\.bitacora|insert\s+into\s+forense\.actividad_producto/i;
    // Escrituras sobre el dominio. `bitacora` y `actividad_producto` no
    // cuentan como mutación a registrar: son el registro.
    const MUTA = /\b(insert\s+into|update|delete\s+from)\s+forense\.(?!bitacora|actividad_producto)[a-z_]+/i;

    /** ¿El texto de `nombre`, o el de algo que llama, registra? */
    const registra = (nombre, vistos = new Set()) => {
      if (vistos.has(nombre)) return false;
      vistos.add(nombre);
      const src = porNombre.get(nombre);
      if (!src) return false;
      if (REGISTRO.test(src)) return true;
      for (const otro of porNombre.keys()) {
        if (otro.length > 3 && otro !== nombre && src.includes(`forense.${otro}(`)) {
          if (registra(otro, vistos)) return true;
        }
      }
      return false;
    };

    const mudas = [];
    for (const fn of DECLARADAS) {
      const src = porNombre.get(fn.nombre);
      if (!src || !MUTA.test(src)) continue;   // función de sólo lectura
      if (!registra(fn.nombre)) mudas.push(fn.nombre);
    }
    assert.deepEqual(mudas, [],
      `funciones de 010 que escriben en el dominio sin dejar evento (regla 2): ${mudas.join(', ')}`);

    // Y que la prueba no sea vacía: 010 es runtime, tiene que mutar.
    const mutantes = DECLARADAS.filter((f) => MUTA.test(porNombre.get(f.nombre) ?? ''));
    assert.ok(mutantes.length >= 10,
      `sólo ${mutantes.length} funciones de 010 mutan: el análisis no está viendo los cuerpos`);
  });

// ---------------------------------------------------------------------
// 4. Comportamiento: se ejecutan de verdad y la fila llega a la bitácora
// ---------------------------------------------------------------------

test('las funciones de mutación ejecutadas de verdad dejan su fila en forense.bitacora',
  { skip: saltar }, async (t) => {
    const SELLO = `qa-010-${process.pid}-${Date.now().toString(36)}`;

    // `abrir_corrida` necesita un dataset ya autorizado; se toma de la propia
    // base en vez de inventarlo (un dataset desconocido se rechaza a
    // propósito, y entonces no habría mutación que medir).
    const dataset = escalar(DB_QA, `
      select dataset from forense.corridas
       where dataset is not null group by dataset order by count(*) desc limit 1`);
    assert.ok(dataset, 'ninguna corrida de la base declara dataset: no hay origen autorizado que usar');

    let corrida = null;

    await t.test('abrir_corrida crea la corrida y deja evento', () => {
      const r = json(DB_QA, `(select to_jsonb(t) from forense.abrir_corrida(
        ${lit(dataset)}, ${lit(`${SELLO}-abrir`)}, null) t)`);
      assert.ok(r.corrida_id, `abrir_corrida no devolvió corrida_id: ${JSON.stringify(r)}`);
      assert.equal(r.reutilizada, false, 'una idempotency_key nueva no puede reutilizar corrida');
      corrida = r.corrida_id;

      const n = Number(escalar(DB_QA,
        `select count(*) from forense.bitacora where corrida_id = ${lit(corrida)}`));
      assert.ok(n >= 1, 'abrir_corrida no dejó ningún evento: sin evento el paso no existió (regla 2)');
    });

    await t.test('abrir_corrida con la misma idempotency_key reutiliza en vez de duplicar', () => {
      const r = json(DB_QA, `(select to_jsonb(t) from forense.abrir_corrida(
        ${lit(dataset)}, ${lit(`${SELLO}-abrir`)}, null) t)`);
      assert.equal(r.corrida_id, corrida, 'la reentrega creó una corrida distinta');
      assert.equal(r.reutilizada, true, 'la reentrega no se declaró reutilizada');
    });

    await t.test('log_corrida escribe en bitacora el evento que se le pide', () => {
      const antes = Number(escalar(DB_QA, `
        select count(*) from forense.bitacora
         where corrida_id = ${lit(corrida)} and tipo_evento = 'corrida_cargada'`));
      correrOk(DB_QA, `select forense.log_corrida(${lit(corrida)}::uuid, 'sistema',
        'corrida_cargada', jsonb_build_object('origen', ${lit(SELLO)}));`);
      const despues = Number(escalar(DB_QA, `
        select count(*) from forense.bitacora
         where corrida_id = ${lit(corrida)} and tipo_evento = 'corrida_cargada'`));
      assert.equal(despues, antes + 1, 'log_corrida no escribió el evento');
    });

    await t.test('estado_corrida lee y no escribe; verificar_integridad_corrida muta y deja evento', () => {
      // estado_corrida es lectura pura: si escribiera, cada refresco de la UI
      // metería ruido en la bitácora y el timeline dejaría de ser el pipeline.
      const antes = Number(escalar(DB_QA,
        `select count(*) from forense.bitacora where corrida_id = ${lit(corrida)}`));
      const estado = json(DB_QA, `(select to_jsonb(t) from forense.estado_corrida(${lit(corrida)}::uuid) t)`);
      assert.ok(estado && typeof estado === 'object', 'estado_corrida no devolvió fila');
      assert.equal(
        Number(escalar(DB_QA, `select count(*) from forense.bitacora where corrida_id = ${lit(corrida)}`)),
        antes, 'estado_corrida escribió en la bitácora: una lectura no deja rastro de paso');

      // verificar_integridad_corrida SÍ muta (fija el estado de la corrida) y
      // por eso tiene que dejar evento. La corrida recién abierta está vacía:
      // el resultado correcto es `error` con causa, nunca `lista` (regla 10:
      // no se investiga sobre un snapshot que no se validó).
      const integridad = json(DB_QA,
        `(select to_jsonb(t) from forense.verificar_integridad_corrida(${lit(corrida)}::uuid) t)`);
      assert.equal(integridad.estado, 'error',
        `una corrida sin datos no puede quedar ${integridad.estado}`);
      assert.ok(integridad.causa, 'la corrida quedó en error sin causa declarada');
      assert.equal(escalar(DB_QA, `select estado from forense.corridas where id = ${lit(corrida)}`), 'error',
        'la función devolvió error pero no lo persistió en la corrida');
      assert.ok(
        Number(escalar(DB_QA, `select count(*) from forense.bitacora where corrida_id = ${lit(corrida)}`)) > antes,
        'verificar_integridad_corrida mutó la corrida sin dejar evento (regla 2)');
    });
  });
