// =====================================================================
// tests/integration/inyeccion-ensayos-bc.test.mjs — los ensayos (b) y (c) de
// eval/inyecciones sobre gen-v1, con el PROVEEDOR SIMULADO.
//
//   node --test tests/integration/inyeccion-ensayos-bc.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Sólo escribe en forense_qa; la corrida base gen-v1 se
// LEE y se comprueba que queda byte a byte igual (regla 10).
//
// (a) ya lo cubre inyeccion-008.test.mjs. Aquí van los otros dos, que son los
// que miden CRITERIO y no sólo mecánica:
//
//   (b) retorno hacia un EFOS que ya existe. Lo checable no es el nivel —por
//       diseño E1 con estatus definitivo a 0 saltos puede llegar a
//       presuncion_alta— sino el DELTA: `F2` aparece en ASE250301Z86 en el
//       clon y no estaba en la corrida base. Es lo que muestra la pantalla de
//       diff, y es una afirmación que se puede probar sin modelo.
//
//   (c) la trampa legítima. 21 §3.4 y eval/inyecciones/README.md la diseñan
//       para que SÍ entre al selector (R1+F1 ⇒ dos familias): el caso tiene
//       que llegar a investigación y el sistema tiene que explicarlo. Lo que
//       no puede pasar es que el dictamen DETERMINISTA salga `presuncion` o
//       `presuncion_alta`. Se comprueban además los cuatro discriminadores
//       que el README nombra, todos en SQL puro: son el «por qué esta no».
//
// Nada de esto llama al modelo. `dictaminar()` es el Auditor Final
// determinista (regla 4: el LLM no decide el nivel).
//
// Coste: `correr_pistas` sobre gen-v1 tarda ~30 s y aquí se corre dos veces
// (un clon por ensayo). Los timeouts son grandes a propósito.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { dictaminar, NIVELES } from '../../n8n/runtime/auditor-final.mjs';
import { CORRIDA_GEN_V1, DB_QA, RAIZ, correr, correrOk, escalar, filas, hayBase, json } from './_ayudas.mjs';

const saltar = !hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)';

const SELLO = `qa-bc-${process.pid}-${Date.now().toString(36)}`;

/** Tablas que una inyección nunca debe modificar en la corrida base. */
const TABLAS = ['contribuyentes', 'cuentas', 'cfdi', 'complementos_pago',
                'movimientos', 'atributos_entidad', 'listas_sat', 'ground_truth', 'pistas'];

function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function digest(corrida) {
  const partes = TABLAS.map((t) => `
    select ${lit(t)} as tabla, count(*)::text || ':' ||
           coalesce(md5(string_agg(md5(x.*::text), '' order by md5(x.*::text))), 'vacia') as h
      from forense.${t} x where x.corrida_id = ${lit(corrida)}`).join(' union all ');
  return Object.fromEntries(filas(DB_QA, `${partes} order by 1`));
}

/**
 * Ejecuta el camino completo de una inyección: registrar → validar → clonar →
 * pistas → clusters. Devuelve la corrida nueva y los RFC inyectados.
 */
function inyectar(archivo, marca) {
  const payload = JSON.parse(fs.readFileSync(path.join(RAIZ, 'eval/inyecciones', archivo), 'utf8'));
  payload.nota = `${payload.nota} [QA ${SELLO} ${marca}]`;
  delete payload.idempotency_key;
  const texto = JSON.stringify(payload).replace(/\$/g, '');

  const reg = json(DB_QA, `forense.registrar_inyeccion(${lit(CORRIDA_GEN_V1)}::uuid,
    $PAY$${texto}$PAY$::jsonb, 'ensayo', ${lit(crypto.randomUUID())}::uuid, null)`);
  assert.equal(reg.ok, true, `registrar_inyeccion falló: ${JSON.stringify(reg)}`);

  const val = json(DB_QA, `forense.validar_inyeccion(${lit(reg.ingesta_id)}::uuid)`);
  assert.equal(val.ok, true, `validar_inyeccion rechazó el paquete: ${JSON.stringify(val).slice(0, 600)}`);

  const nueva = escalar(DB_QA, `select forense.clonar_corrida_con_inyeccion(
    ${lit(CORRIDA_GEN_V1)}::uuid, ${lit(reg.ingesta_id)}::uuid)::text`);
  assert.ok(nueva, 'clonar_corrida_con_inyeccion no devolvió corrida');

  correrOk(DB_QA, `select forense.correr_pistas(${lit(nueva)}::uuid);`);
  correrOk(DB_QA, `select forense.armar_clusters(${lit(nueva)}::uuid);`);

  const rfcs = (val.rfcs_afectados ?? []).length
    ? val.rfcs_afectados
    : filas(DB_QA, `select unnest(rfcs_afectados) from forense.inyecciones
                     where id = ${lit(reg.inyeccion_id)}`).map((x) => x[0]);

  // `armar_clusters` reconstruye el selector sobre TODO el snapshot y se
  // queda con los mejores egos: sobre gen-v1 (64 candidatos → 3 clusters) los
  // RFC recién inyectados, que traen dos o tres familias pero poco volumen,
  // quedan fuera. El camino de la inyección es `armar_cluster_para` por cada
  // RFC afectado: es lo que hace que exista el cluster que
  // `clusters_afectados` tiene que despachar primero (21 §3.2).
  // Ver QA-004 en reports/qa/INFORME-oleada3.md.
  for (const rfc of rfcs) {
    correrOk(DB_QA, `select forense.armar_cluster_para(${lit(nueva)}::uuid, ${lit(rfc)});`);
  }

  return { inyeccion: reg.inyeccion_id, ingesta: reg.ingesta_id, corrida: nueva, rfcs };
}

/**
 * Borra la corrida clonada al terminar el ensayo. Cada clon copia el dominio
 * entero de gen-v1 (~8 mil CFDI); dejarlos acumulados hace que la siguiente
 * corrida del banco tarde el doble y que un `psql` con timeout parezca un
 * fallo de la prueba. No es cosmético: es la regla 10 aplicada al banco.
 * No detiene la prueba si falla (la base de QA es desechable).
 */
function limpiar(corrida) {
  const r = correr(DB_QA, `delete from forense.corridas where id = '${corrida}';`);
  if (r.code !== 0) console.log(`[limpieza] no se pudo borrar la corrida ${corrida}: ${r.error.slice(0, 200)}`);
}

/** Códigos de pista disparados para un RFC en una corrida. */
function codigos(corrida, rfc) {
  return filas(DB_QA, `select codigo from forense.pistas
     where corrida_id = ${lit(corrida)} and rfc = ${lit(rfc)} order by codigo`).map((x) => x[0]);
}

// ---------------------------------------------------------------------
// (b) retorno hacia un EFOS existente: el DELTA frente a la corrida base
// ---------------------------------------------------------------------

test('(b) retorno-efos: la base queda intacta y F2 aparece en el EFOS sólo en el clon',
  { skip: saltar, timeout: 900000 }, async (t) => {
    const antes = digest(CORRIDA_GEN_V1);
    const EFOS = 'ASE250301Z86';
    const NUEVA = 'RET251001DD4';
    const enBase = codigos(CORRIDA_GEN_V1, EFOS);

    const r = inyectar('b-retorno-efos-existente.json', 'b');

    await t.test('gen-v1 no cambió ni una fila (regla 10)', () => {
      assert.deepEqual(digest(CORRIDA_GEN_V1), antes,
        'la inyección modificó la corrida base: el juez perdería su corrida de referencia');
    });

    await t.test('la entidad nueva dispara E1 y T1: dos familias, entra al selector', () => {
      const c = codigos(r.corrida, NUEVA);
      assert.ok(c.includes('E1'), `${NUEVA} no disparó E1 (contraparte con estatus definitivo a 1 salto): ${c}`);
      assert.ok(c.includes('T1'), `${NUEVA} no disparó T1: ${c}`);
      const familias = new Set(c.map((x) => x[0]));
      assert.ok(familias.size >= 2, `${NUEVA} sólo tiene la familia ${[...familias]}: no entraría al selector`);

      const enCluster = Number(escalar(DB_QA, `
        select count(*) from forense.clusters
         where corrida_id = ${lit(r.corrida)} and ${lit(NUEVA)} = any(rfcs)`));
      assert.ok(enCluster >= 1, `${NUEVA} tiene dos familias y no quedó en ningún cluster`);
    });

    await t.test('F2 es NUEVA en el EFOS: ese delta es lo que muestra el diff', () => {
      const enClon = codigos(r.corrida, EFOS);
      assert.ok(!enBase.includes('F2'),
        `F2 ya estaba en ${EFOS} en la corrida base: el ensayo no mediría ningún delta`);
      assert.ok(enClon.includes('F2'),
        `${EFOS} no ganó F2 con la inyección (pass-through hacia persona física). En el clon: ${enClon}`);
      const nuevas = enClon.filter((x) => !enBase.includes(x));
      assert.ok(nuevas.length >= 1, 'el EFOS no ganó ninguna pista: no hay diff que enseñar');
    });

    t.after(() => limpiar(r.corrida));

    await t.test('cada paso dejó evento en la bitácora de la corrida nueva (regla 2)', () => {
      const eventos = filas(DB_QA, `
        select distinct tipo_evento from forense.bitacora
         where corrida_id = ${lit(r.corrida)} or payload->>'inyeccion_id' = ${lit(r.inyeccion)}
         order by 1`).map((x) => x[0]);
      assert.ok(eventos.length > 0,
        'la inyección (b) no dejó ningún evento: sin evento el paso no existió');
    });
  });

// ---------------------------------------------------------------------
// (c) la trampa legítima: entra al selector y NO puede salir presuncion
// ---------------------------------------------------------------------

test('(c) trampa-comercializadora: entra al selector y el dictamen determinista no sube a presuncion',
  { skip: saltar, timeout: 900000 }, async (t) => {
    const TRB = ['TRB190311FF6', 'TRB200714GG7', 'TRB180205HH8'];
    const antes = digest(CORRIDA_GEN_V1);

    const r = inyectar('c-trampa-comercializadora.json', 'c');
    assert.deepEqual(digest(CORRIDA_GEN_V1), antes, 'la inyección (c) modificó la corrida base');

    let cluster = null;
    t.after(() => limpiar(r.corrida));

    await t.test('dispara R1 y F1 — dos familias — y por eso SÍ entra al selector', () => {
      const porRfc = Object.fromEntries(TRB.map((rfc) => [rfc, codigos(r.corrida, rfc)]));
      const todas = new Set(Object.values(porRfc).flat());
      assert.ok(todas.has('R1'), `ninguna de las TRB disparó R1 (domicilio compartido): ${JSON.stringify(porRfc)}`);
      assert.ok(todas.has('F1'), `ninguna de las TRB disparó F1 (facturas sin conciliar): ${JSON.stringify(porRfc)}`);

      cluster = escalar(DB_QA, `
        select id::text from forense.clusters
         where corrida_id = ${lit(r.corrida)} and rfcs && array[${TRB.map(lit).join(',')}]::text[]
         order by id limit 1`);
      assert.ok(cluster,
        'la trampa no entró a ningún cluster: 21 §3.4 la quiere DENTRO, para que el sistema tenga que explicarla');
    });

    await t.test('discriminador 1: comparten domicilio pero no se facturan entre sí', () => {
      const r1 = filas(DB_QA, `
        select rfc, (detalle->>'se_facturan_entre_si'), (detalle->>'pct_monto_interno')
          from forense.pistas
         where corrida_id = ${lit(r.corrida)} and codigo = 'R1'
           and rfc = any(array[${TRB.map(lit).join(',')}]::text[]) order by rfc`);
      assert.ok(r1.length > 0, 'no hay R1 de las TRB que examinar');
      for (const [rfc, facturan, pct] of r1) {
        assert.equal(facturan, 'false',
          `${rfc}: R1 dice que el grupo se factura entre sí; entonces no sería un coworking`);
        assert.equal(Number(pct), 0,
          `${rfc}: pct_monto_interno = ${pct}; la trampa exige 0 monto interno`);
      }
    });

    await t.test('discriminador 2: las facturas sin conciliar son PPD sin complemento (crédito comercial)', () => {
      const [[ppd, pue]] = filas(DB_QA, `
        select count(*) filter (where metodo_pago = 'PPD'), count(*) filter (where metodo_pago = 'PUE')
          from forense.cfdi
         where corrida_id = ${lit(r.corrida)} and emisor_rfc = any(array[${TRB.map(lit).join(',')}]::text[])`);
      assert.ok(Number(ppd) >= 3,
        `la trampa debía emitir al menos 3 PPD y emitió ${ppd} (PUE: ${pue})`);
      const sinComplemento = Number(escalar(DB_QA, `
        select count(*) from forense.cfdi f
         where f.corrida_id = ${lit(r.corrida)} and f.metodo_pago = 'PPD'
           and f.emisor_rfc = any(array[${TRB.map(lit).join(',')}]::text[])
           and not exists (select 1 from forense.complementos_pago c
                            where c.corrida_id = f.corrida_id and c.uuid_cfdi = f.uuid)`));
      assert.ok(sinComplemento >= 3,
        `sólo ${sinComplemento} PPD sin complemento: el discriminador de crédito comercial no se sostiene`);
    });

    await t.test('discriminador 3: el dinero sale hacia personas morales, no hay pass-through (F2 no dispara)', () => {
      const conF2 = filas(DB_QA, `
        select rfc from forense.pistas
         where corrida_id = ${lit(r.corrida)} and codigo = 'F2'
           and rfc = any(array[${TRB.map(lit).join(',')}]::text[])`).map((x) => x[0]);
      assert.deepEqual(conF2, [],
        `F2 disparó en ${conF2.join(', ')}: la trampa no debería parecer pass-through`);

      const fisicas = Number(escalar(DB_QA, `
        select count(*) from forense.movimientos m
          join forense.cuentas cu on cu.corrida_id = m.corrida_id and cu.clabe = m.cuenta_destino
          join forense.contribuyentes c on c.corrida_id = m.corrida_id and c.rfc = cu.rfc_titular
         where m.corrida_id = ${lit(r.corrida)} and c.tipo_persona = 'fisica'
           and m.cuenta_origen in (select clabe from forense.cuentas
                                   where corrida_id = ${lit(r.corrida)}
                                     and rfc_titular = any(array[${TRB.map(lit).join(',')}]::text[]))`));
      assert.equal(fisicas, 0,
        `${fisicas} salidas de la trampa van a personas físicas: el discriminador de 21 §3.4 dejaría de valer`);
    });

    await t.test('discriminador 4: hay nómina, así que D2 no dispara', () => {
      const conD2 = filas(DB_QA, `
        select rfc from forense.pistas
         where corrida_id = ${lit(r.corrida)} and codigo = 'D2'
           and rfc = any(array[${TRB.map(lit).join(',')}]::text[])`).map((x) => x[0]);
      assert.deepEqual(conD2, [], `D2 (sin nómina / sin empleados) disparó en ${conD2.join(', ')}`);
    });

    await t.test('el dictamen DETERMINISTA del caso no es presuncion ni presuncion_alta', () => {
      const caso = json(DB_QA, `forense.crear_caso(${lit(r.corrida)}::uuid, ${lit(cluster)}::uuid,
        'qa', ${lit(`${SELLO}-c`)}, ${lit(`${SELLO}-c`)})`);
      assert.equal(caso.ok, true, `crear_caso falló: ${JSON.stringify(caso)}`);

      // El paquete se LEE de la base; el nivel lo calcula el Auditor Final
      // determinista. No se fabrica evidencia: inventar una fila por familia
      // aquí decidiría el resultado desde la prueba y no desde la trampa.
      const paquete = json(DB_QA,
        `(select to_jsonb(t) from forense.paquete_auditor_final(${lit(caso.caso_id)}::uuid) t)`);
      const dictamen = dictaminar(paquete);

      assert.ok(NIVELES.includes(dictamen.nivel),
        `nivel fuera del catálogo: ${dictamen.nivel} (el máximo es presuncion_alta, regla 7)`);
      assert.ok(!['presuncion', 'presuncion_alta'].includes(dictamen.nivel),
        `la trampa legítima salió ${dictamen.nivel}: es un FALSO POSITIVO y cuenta como tal en la FPR ` +
        `(docs/10). cobertura_completa=${paquete.cobertura_completa}, ` +
        `pendientes=${(paquete.pendientes ?? []).length}, evidencia=${(paquete.evidencia ?? []).length}`);
      assert.ok(['anomalia_explicada', 'no_concluyente', 'sin_hallazgos'].includes(dictamen.nivel),
        `nivel inesperado para la trampa: ${dictamen.nivel}`);

      // Y se deja dicho POR QUÉ salió ese nivel, que es lo que hay que
      // volver a mirar cuando el caso se investigue de verdad con el modelo:
      // sin evidencia validada el camino determinista es `no_concluyente`,
      // que es correcto pero no es todavía «anomalía explicada».
      assert.equal(typeof paquete.cobertura_completa, 'boolean',
        'paquete_auditor_final no declara cobertura_completa');
      console.log(`[ensayo c] nivel=${dictamen.nivel} cobertura_completa=${paquete.cobertura_completa} ` +
        `pistas=${(paquete.pistas ?? []).length} evidencia=${(paquete.evidencia ?? []).length}`);
    });
  });
