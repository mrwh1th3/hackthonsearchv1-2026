// =====================================================================
// tests/integration/inyeccion-008.test.mjs — la inyección en vivo de 21 §3
// sobre 008_ingesta: registrar → validar → clonar → correr_pistas.
//
//   node --test tests/integration/inyeccion-008.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Sólo escribe en la base forense_qa.
//
// La promesa que se le hace al juez es doble y las dos se prueban aquí:
//   a) su paquete NO toca el snapshot que ya estaba corriendo (regla 10), y
//   b) el sistema REACCIONA: las pistas del clon cubren los RFC inyectados.
// Lo primero se mide con un digest de las tablas de gen-v1 tomado antes y
// después; contar filas no bastaría, porque un UPDATE no cambia el conteo.
//
// correr_pistas sobre las ~8 mil facturas de gen-v1 tarda ~27 s: el timeout
// del test está puesto a 5 min a propósito, no por holgura decorativa.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CORRIDA_GEN_V1, DB_QA, RAIZ, correr, correrOk, escalar, filas, hayBase, json }
  from './_ayudas.mjs';

const saltar = !hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)';

const ENSAYO = path.join(RAIZ, 'eval/inyecciones/a-carrusel-nuevo.json');

/** Tablas de dominio que una inyección nunca debe modificar en la corrida base. */
const TABLAS = ['contribuyentes', 'cuentas', 'cfdi', 'complementos_pago',
                'movimientos', 'atributos_entidad', 'listas_sat', 'ground_truth', 'pistas'];

/** Cita un literal para SQL. */
function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Digest de una corrida: por tabla, número de filas y md5 del contenido
 * ordenado. Detecta altas, bajas y ediciones; un conteo solo detectaría altas.
 */
function digest(corrida) {
  const partes = TABLAS.map((t) => `
    select ${lit(t)} as tabla, count(*)::text || ':' ||
           coalesce(md5(string_agg(md5(x.*::text), '' order by md5(x.*::text))), 'vacia') as h
      from forense.${t} x where x.corrida_id = ${lit(corrida)}`).join(' union all ');
  return Object.fromEntries(filas(DB_QA, `${partes} order by 1`));
}

/** Envía un payload JSON a registrar_inyeccion sin pasarlo por una línea de shell. */
function registrar(payload, { origen = 'ensayo', idempotency = null } = {}) {
  const texto = JSON.stringify(payload).replace(/\$/g, '');  // $ no aparece en los ensayos
  return json(DB_QA, `forense.registrar_inyeccion(
    ${lit(CORRIDA_GEN_V1)}::uuid, $PAY$${texto}$PAY$::jsonb, ${lit(origen)},
    ${idempotency ? `${lit(idempotency)}::uuid` : 'null'}, null)`);
}

// El hash del payload es la clave única de la ingesta cuando no hay
// idempotency_key: sin un sello por ejecución, la segunda corrida de la suite
// chocaría contra la primera (ver QA-003 en reports/qa/INFORME-oleada2.md).
const SELLO = `${process.pid}-${Date.now().toString(36)}`;

function payloadBase(marca) {
  const p = JSON.parse(fs.readFileSync(ENSAYO, 'utf8'));
  p.nota = `${p.nota} [QA ${SELLO}${marca ? ` ${marca}` : ''}]`;
  delete p.idempotency_key;
  return p;
}

// ---------------------------------------------------------------------
// 1. El ensayo (a) completo: no muta gen-v1 y el clon reacciona
// ---------------------------------------------------------------------

test('a-carrusel-nuevo: clona sin tocar gen-v1 y las pistas cubren los RFC inyectados',
  { skip: saltar, timeout: 300000 }, async (t) => {

  const payload = payloadBase('ensayo-a');
  assert.equal(payload.corrida_base_id, CORRIDA_GEN_V1,
    'el ensayo apunta a otra corrida base: la prueba mediría otra cosa');
  const rfcsInyectados = payload.tablas.contribuyentes.map((c) => c.rfc);
  assert.ok(rfcsInyectados.length >= 3, 'el ensayo (a) debía traer al menos 3 RFC');

  const antes = digest(CORRIDA_GEN_V1);
  let ingesta; let inyeccion; let clon;

  await t.test('registrar_inyeccion deja el paquete en staging, no en el dominio', () => {
    const r = registrar(payload);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.creada, true);
    assert.equal(r.estado, 'recibida');
    ingesta = r.ingesta_id;
    inyeccion = r.inyeccion_id;

    // Nada del paquete ha entrado todavía al dominio de la corrida base.
    const enBase = Number(escalar(DB_QA, `
      select count(*) from forense.contribuyentes
       where corrida_id = ${lit(CORRIDA_GEN_V1)} and rfc = any(array[${rfcsInyectados.map(lit).join(',')}])`));
    assert.equal(enBase, 0, 'registrar_inyeccion escribió en la corrida base');

    const n = Number(escalar(DB_QA,
      `select count(*) from forense.staging_filas where ingesta_id = ${lit(ingesta)}`));
    assert.ok(n >= 18, `staging quedó con ${n} filas`);
  });

  await t.test('validar_inyeccion acepta el paquete y nombra los RFC afectados', () => {
    const v = json(DB_QA, `forense.validar_inyeccion(${lit(ingesta)}::uuid)`);
    assert.equal(v.ok, true, JSON.stringify(v.diagnostico));
    assert.equal(v.estado, 'validada');
    assert.equal(v.rechazadas, 0, `rechazos inesperados: ${JSON.stringify(v.diagnostico.errores)}`);
    assert.deepEqual(v.rfcs_afectados.slice().sort(), rfcsInyectados.slice().sort());
  });

  await t.test('clonar_corrida_con_inyeccion crea corrida nueva y deja intacta la base', () => {
    clon = escalar(DB_QA,
      `select forense.clonar_corrida_con_inyeccion(${lit(CORRIDA_GEN_V1)}::uuid, ${lit(ingesta)}::uuid)::text`);
    assert.ok(clon && clon !== CORRIDA_GEN_V1, `clon inválido: ${clon}`);

    const origen = escalar(DB_QA,
      `select corrida_origen_id::text from forense.corridas where id = ${lit(clon)}`);
    assert.equal(origen, CORRIDA_GEN_V1, 'la corrida nueva no declara de qué snapshot salió');

    // (a) el snapshot que ya estaba corriendo no cambió ni una fila
    assert.deepEqual(digest(CORRIDA_GEN_V1), antes,
      'la inyección modificó gen-v1: una corrida en curso dejó de ser reproducible');

    // (b) el clon trae lo de la base MÁS lo inyectado
    const nClon = Number(escalar(DB_QA,
      `select count(*) from forense.contribuyentes where corrida_id = ${lit(clon)}`));
    const nBase = Number(antes.contribuyentes.split(':')[0]);
    assert.equal(nClon, nBase + rfcsInyectados.length);

    // Las filas del juez llegan SIN etiqueta: si vinieran etiquetadas, la
    // métrica de la inyección en vivo se la estaría regalando el propio juez.
    const etiquetados = Number(escalar(DB_QA, `
      select count(*) from forense.ground_truth
       where corrida_id = ${lit(clon)} and rfc = any(array[${rfcsInyectados.map(lit).join(',')}])`));
    assert.equal(etiquetados, 0, 'las filas inyectadas llegaron con ground_truth');
  });

  await t.test('correr_pistas sobre el clon produce pistas de los RFC inyectados', () => {
    const r = json(DB_QA, `forense.correr_pistas(${lit(clon)}::uuid)`);
    assert.ok(r && typeof r === 'object');

    const porRfc = filas(DB_QA, `
      select rfc, count(*)::text from forense.pistas
       where corrida_id = ${lit(clon)} and rfc = any(array[${rfcsInyectados.map(lit).join(',')}])
       group by rfc order by rfc`);
    const cubiertos = porRfc.map(([rfc]) => rfc);
    assert.deepEqual(cubiertos.sort(), rfcsInyectados.slice().sort(),
      `RFC inyectados sin ninguna pista: ${rfcsInyectados.filter((r2) => !cubiertos.includes(r2))}`);

    // El carrusel del ensayo (a) es relacional: R1 o R2 tienen que aparecer,
    // o la reacción sería un número sin significado.
    const familias = filas(DB_QA, `
      select distinct codigo from forense.pistas
       where corrida_id = ${lit(clon)} and rfc = any(array[${rfcsInyectados.map(lit).join(',')}])
       order by 1`).map((x) => x[0]);
    assert.ok(familias.some((c) => c.startsWith('R')),
      `el carrusel inyectado no disparó ninguna pista relacional: ${familias.join(',')}`);

    // gen-v1 sigue sin enterarse: correr_pistas no reescribe el snapshot base.
    assert.deepEqual(digest(CORRIDA_GEN_V1), antes,
      'correr_pistas sobre el clon alteró la corrida base');
  });

  await t.test('cada paso dejó su evento en forense.bitacora (regla 2)', () => {
    const eventos = filas(DB_QA, `
      select distinct payload->>'evento_real' from forense.bitacora
       where payload->>'inyeccion_id' = ${lit(inyeccion)}
          or payload->>'ingesta_id' = ${lit(ingesta)}
          or corrida_id = ${lit(clon)}
       order by 1`).map((x) => x[0]).filter(Boolean);
    for (const esperado of ['inyeccion_recibida', 'correr_pistas']) {
      assert.ok(eventos.includes(esperado),
        `falta el evento ${esperado} en bitácora; los que hay: ${eventos.join(', ')}`);
    }
  });
});

// ---------------------------------------------------------------------
// 2. UUID duplicado: rechazo con motivo, no excepción ni silencio
// ---------------------------------------------------------------------

test('un CFDI con UUID ya existente se rechaza con tabla, fila, código y mensaje',
  { skip: saltar, timeout: 120000 }, () => {

  const payload = payloadBase('uuid-duplicado');
  const uuidExistente = escalar(DB_QA,
    `select uuid::text from forense.cfdi where corrida_id = ${lit(CORRIDA_GEN_V1)} order by fecha limit 1`);
  assert.ok(uuidExistente, 'gen-v1 no tiene CFDI: nada que duplicar');

  const uuidOriginal = payload.tablas.cfdi[0].uuid;
  payload.tablas.cfdi[0].uuid = uuidExistente;

  const r = registrar(payload);
  assert.equal(r.ok, true, 'registrar_inyeccion debe aceptar el paquete y rechazar en validación');

  const v = json(DB_QA, `forense.validar_inyeccion(${lit(r.ingesta_id)}::uuid)`);
  assert.equal(v.rechazadas >= 1, true, 'el UUID duplicado pasó la validación');
  assert.notEqual(v.estado, 'validada', `estado tras un rechazo: ${v.estado}`);

  const errores = v.diagnostico.errores;
  const dup = errores.find((e) => e.tabla === 'cfdi' && /duplicad/i.test(e.codigo ?? ''));
  assert.ok(dup, `no hay error de duplicado en cfdi: ${JSON.stringify(errores).slice(0, 500)}`);
  assert.equal(typeof dup.fila, 'number', 'el rechazo no dice qué fila fue');
  assert.match(dup.mensaje, /UUID ya existe/i);
  assert.ok(dup.mensaje.length > 10, 'el motivo tiene que ser legible por una persona');

  // Y una inyección no validada no se puede clonar: la puerta está cerrada
  // en la función, no sólo en el caller.
  const intento = correr(DB_QA,
    `select forense.clonar_corrida_con_inyeccion(${lit(CORRIDA_GEN_V1)}::uuid, ${lit(r.ingesta_id)}::uuid);`,
    { detener: true });
  assert.notEqual(intento.code, 0, 'se clonó una inyección rechazada');
  assert.match(intento.error, /no está validada/i);

  // El RFC del ensayo no entró a gen-v1 por la puerta de atrás.
  const fuga = Number(escalar(DB_QA, `
    select count(*) from forense.cfdi
     where corrida_id = ${lit(CORRIDA_GEN_V1)} and uuid = ${lit(uuidOriginal)}::uuid`));
  assert.equal(fuga, 0);
});

// ---------------------------------------------------------------------
// 3. Idempotencia del paquete: el mismo idempotency_key no duplica inyección
// ---------------------------------------------------------------------

test('reenviar el mismo paquete con el mismo idempotency_key no crea otra inyección',
  { skip: saltar, timeout: 120000 }, () => {

  const payload = payloadBase('idempotencia');
  const clave = escalar(DB_QA, 'select gen_random_uuid()::text');

  const a = registrar(payload, { idempotency: clave });
  const b = registrar(payload, { idempotency: clave });

  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.creada, true);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.creada, false, 'el reenvío creó una inyección nueva');
  assert.equal(b.inyeccion_id, a.inyeccion_id);

  const n = Number(escalar(DB_QA,
    `select count(*) from forense.inyecciones where idempotency_key = ${lit(clave)}`));
  assert.equal(n, 1);
});

// ---------------------------------------------------------------------
// 4. QA-003 (abierto, dueño forense-db): el mismo payload sin
//    idempotency_key revienta en vez de devolver un rechazo con motivo.
// ---------------------------------------------------------------------

test('reenviar el mismo payload SIN idempotency_key devuelve un rechazo, no una excepción',
  { skip: saltar, timeout: 120000, todo: 'QA-003: ux_ingestas_idempotency sale como error SQL crudo (forense-db)' },
  () => {
    const payload = payloadBase('qa-003');
    const a = registrar(payload);
    assert.equal(a.ok, true, JSON.stringify(a));

    // Sin idempotency_key, registrar_inyeccion usa el hash del payload como
    // clave única de la ingesta. El reenvío idéntico —un doble clic del juez—
    // debería devolver ok:false con motivo, como hacen las demás funciones de
    // 008; hoy propaga unique_violation y n8n vería un 500 sin diagnóstico.
    const segunda = correr(DB_QA,
      `select forense.registrar_inyeccion(${lit(CORRIDA_GEN_V1)}::uuid,
         $PAY$${JSON.stringify(payload)}$PAY$::jsonb, 'ensayo', null, null);`, { detener: true });
    assert.equal(segunda.code, 0,
      `registrar_inyeccion lanzó excepción en vez de devolver un envelope: ${segunda.error}`);
  });
