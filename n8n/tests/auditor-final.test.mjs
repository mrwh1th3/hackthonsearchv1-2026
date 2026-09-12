// n8n/tests/auditor-final.test.mjs — dictamen determinista y generación del Code node (03, 07). SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '../../contracts/index.mjs';
import { dictaminar } from '../runtime/auditor-final.mjs';
import { construirArchivo, GENERADOS } from '../runtime/generar-code-nodes.mjs';
import { evidenciaValidadaSimulada, UUID } from './_ayudas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function entrada(overrides = {}) {
  return {
    caso: { id: UUID.caso, n_reintentos: 0 },
    presupuesto: { permite_reintento: true },
    cobertura_completa: true,
    pistas: [],
    evidencia: [],
    pendientes: [],
    ...overrides,
  };
}

const ev = (familia, overrides = {}) => evidenciaValidadaSimulada({
  familia,
  pista_codigo: `${familia}1`,
  ref_id: `ref-${familia}`,
  ...overrides,
});

test('dos familias validadas → presuncion', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'disparada' }],
    evidencia: [ev('D'), ev('F')],
  }));
  assert.equal(r.nivel, 'presuncion');
  assert.deepEqual(r.familias, ['D', 'F']);
  assert.equal(r.rechazo, null);
});

test('tres familias → presuncion_alta; nunca "definitivo" como nivel', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'disparada' }],
    evidencia: [ev('D'), ev('F'), ev('R')],
  }));
  assert.equal(r.nivel, 'presuncion_alta');
  assert.notEqual(r.nivel, 'definitivo');
});

test('dos familias + E1 directo de lista 69-B → presuncion_alta', () => {
  const e1 = ev('E', {
    pista_codigo: 'E1',
    hecho_validado: { comprobacion: 'E1', descripcion: 'simulado', estatus: 'definitivo', saltos: 0 },
    tipo: 'lista',
  });
  const r = dictaminar(entrada({ pistas: [{ id: '1', estado: 'disparada' }], evidencia: [ev('D'), e1] }));
  assert.equal(r.nivel, 'presuncion_alta');
  // `definitivo` aquí es el ESTATUS de la lista del SAT en el dato de entrada,
  // jamás un nivel de salida del sistema.
  assert.equal(r.familias.join(','), 'D,E');
});

test('E1 directo sin segunda familia no sustituye la regla de dos familias', () => {
  const e1 = ev('E', {
    pista_codigo: 'E1',
    hecho_validado: { comprobacion: 'E1', descripcion: 'simulado', estatus: 'definitivo', saltos: 0 },
    tipo: 'lista',
  });
  const r = dictaminar(entrada({ pistas: [{ id: '1', estado: 'disparada' }], evidencia: [e1] }));
  assert.equal(r.nivel, 'no_concluyente');
});

// H11-b: `estado: 'refutada'` NO EXISTE. `forense.pistas.estado` sólo admite
// 'disparada'|'no_evaluable' (001) y el contrato entities.pista declara ese
// mismo par. La versión anterior de estas pruebas alimentaba ese valor
// imposible, así que pasaban mientras `anomalia_explicada` era inalcanzable
// con datos reales. El resultado de la defensa llega por `evaluacion_caso`
// (casos.evaluacion_pistas, indexado por id de pista; db/017).
const descartada = (id) => ({ id, estado: 'disparada',
  evaluacion_caso: { resultado: 'descartada', defensa_id: Number(id), trampa_codigo: 'margen_delgado' } });
const sostenida = (id) => ({ id, estado: 'disparada',
  evaluacion_caso: { resultado: 'sostenida', defensa_id: Number(id) } });

test('todas las pistas evaluables descartadas por la defensa → anomalia_explicada', () => {
  const r = dictaminar(entrada({
    pistas: [descartada('1'), descartada('2')],
    evidencia: [],
  }));
  assert.equal(r.nivel, 'anomalia_explicada');
});

test('una pista no_evaluable no bloquea el descarte: nunca sostuvo nada', () => {
  const r = dictaminar(entrada({
    pistas: [descartada('1'), { id: '2', estado: 'no_evaluable' }],
    evidencia: [],
  }));
  assert.equal(r.nivel, 'anomalia_explicada');
});

test('una sola pista sostenida impide anomalia_explicada', () => {
  const r = dictaminar(entrada({
    pistas: [descartada('1'), sostenida('2')],
    evidencia: [],
  }));
  assert.notEqual(r.nivel, 'anomalia_explicada');
});

test('sin defensa aplicada no hay descarte: evaluacion_caso ausente o null', () => {
  for (const pista of [{ id: '1', estado: 'disparada' },
                       { id: '1', estado: 'disparada', evaluacion_caso: null }]) {
    const r = dictaminar(entrada({ pistas: [pista], evidencia: [] }));
    assert.notEqual(r.nivel, 'anomalia_explicada');
  }
});

test('todas no_evaluables no es un descarte: no hay nada que descartar', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'no_evaluable' }, { id: '2', estado: 'no_evaluable' }],
    evidencia: [],
  }));
  assert.notEqual(r.nivel, 'anomalia_explicada');
});

test('cero hallazgos con cobertura completa → sin_hallazgos', () => {
  const r = dictaminar(entrada({ pistas: [], evidencia: [] }));
  assert.equal(r.nivel, 'sin_hallazgos');
  assert.deepEqual(r.familias, []);
  assert.equal(r.monto_en_riesgo_centavos, '0');
});

test('cobertura incompleta o pendientes → no_concluyente, nunca presunción forzada', () => {
  const r = dictaminar(entrada({
    cobertura_completa: false,
    pistas: [{ id: '1', estado: 'disparada' }],
    evidencia: [ev('D'), ev('F'), ev('R')],
  }));
  assert.equal(r.nivel, 'no_concluyente');
});

test('el rechazo solo sale con motivo reparable, objetivo y n_reintentos < 2', () => {
  const pendientes = [{ motivo: 'evidencia_insuficiente', reparable: true, objetivo: 'probar F2 en DEMO:ENTIDAD-0' }];
  const conCupo = dictaminar(entrada({ pendientes, evidencia: [ev('D')] }));
  assert.deepEqual(conCupo.rechazo, { motivo: 'evidencia_insuficiente', objetivo: 'probar F2 en DEMO:ENTIDAD-0' });

  const agotado = dictaminar(entrada({ pendientes, caso: { n_reintentos: 2 }, evidencia: [ev('D')] }));
  assert.equal(agotado.rechazo, null);
  assert.equal(agotado.nivel, 'no_concluyente');

  const sinPresupuesto = dictaminar(entrada({ pendientes, presupuesto: { permite_reintento: false }, evidencia: [ev('D')] }));
  assert.equal(sinPresupuesto.rechazo, null);
});

test('un pendiente no reparable o sin objetivo no genera reintento', () => {
  const a = dictaminar(entrada({ pendientes: [{ motivo: 'contradiccion', reparable: false, objetivo: 'x' }] }));
  assert.equal(a.rechazo, null);
  const b = dictaminar(entrada({ pendientes: [{ motivo: 'contradiccion', reparable: true }] }));
  assert.equal(b.rechazo, null);
});

test('prioridad de motivos: evidencia_invalida antes que evidencia_insuficiente', () => {
  const r = dictaminar(entrada({
    pendientes: [
      { motivo: 'evidencia_insuficiente', reparable: true, objetivo: 'a' },
      { motivo: 'evidencia_invalida', reparable: true, objetivo: 'b' },
    ],
  }));
  assert.equal(r.rechazo.motivo, 'evidencia_invalida');
});

test('el mismo CFDI citado por varias familias cuenta una vez', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'disparada' }],
    evidencia: [
      ev('D', { ref_id: UUID.cfdi, tipo: 'cfdi' }),
      ev('F', { ref_id: UUID.cfdi, tipo: 'cfdi' }),
      ev('R', { ref_id: 'otro-cfdi', tipo: 'cfdi', hecho_validado: { comprobacion: 'R1', descripcion: 's', monto_centavos: '250000', moneda: 'MXN' } }),
    ],
  }));
  assert.equal(r.monto_en_riesgo_centavos, '350000');
});

test('un monto inconsistente para el mismo CFDI rompe con error, no se promedia', () => {
  assert.throws(() => dictaminar(entrada({
    evidencia: [
      ev('D', { ref_id: UUID.cfdi, tipo: 'cfdi' }),
      ev('F', { ref_id: UUID.cfdi, tipo: 'cfdi', hecho_validado: { comprobacion: 'F1', descripcion: 's', monto_centavos: '999', moneda: 'MXN' } }),
    ],
  })), /Monto inconsistente/);
});

test('un monto ausente o no numérico rompe con error tipificado', () => {
  assert.throws(() => dictaminar(entrada({
    evidencia: [ev('D', { tipo: 'cfdi', hecho_validado: { comprobacion: 'D2', descripcion: 's', moneda: 'MXN' } })],
  })), /Monto validado ausente/);
});

test('la evidencia refutada o sin validar no suma familia', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'disparada' }],
    evidencia: [ev('D'), ev('F', { refutada: true }), ev('R', { valida_tecnica: false, validada: false })],
  }));
  assert.deepEqual(r.familias, ['D']);
  assert.equal(r.nivel, 'no_concluyente');
});

// resultado_por_rfc: nadie lo emitía y `guardar_dictamen` persistía [] siempre,
// así que 13 §2:00-2:45 ("cada RFC lleva el suyo") no se cumplía y el panel
// Contraste (db/018) no tenía niveles de vecinos que comparar.
const conCluster = (overrides = {}) => entrada({
  caso: { id: UUID.caso, n_reintentos: 0, rfc_principal: 'AAA', rfcs_satelite: ['BBB'],
          rfcs_cluster: ['AAA', 'BBB', 'CCC'], tipologia: 'carrusel' },
  ...overrides,
});

test('resultado_por_rfc no atribuye el resultado del caso a todo el cluster', () => {
  const r = dictaminar(conCluster({
    pistas: [{ id: '1', rfc: 'AAA', estado: 'disparada' }, { id: '2', rfc: 'BBB', estado: 'disparada' }],
    evidencia: [ev('F', { rfcs_afectados: ['AAA'] }), ev('R', { rfcs_afectados: ['AAA', 'BBB'] })],
  }));
  assert.equal(r.nivel, 'presuncion');
  const porRfc = Object.fromEntries(r.resultado_por_rfc.map(x => [x.rfc, x.nivel]));
  // AAA tiene dos familias; BBB sólo R; CCC no tiene nada.
  assert.deepEqual(porRfc, { AAA: 'presuncion', BBB: 'no_concluyente', CCC: 'sin_hallazgos' });
});

test('la tipología del caso no se hereda a un RFC que no llegó a presunción', () => {
  const r = dictaminar(conCluster({
    pistas: [{ id: '1', rfc: 'AAA', estado: 'disparada' }],
    evidencia: [ev('F', { rfcs_afectados: ['AAA'] }), ev('R', { rfcs_afectados: ['AAA'] })],
  }));
  const porRfc = Object.fromEntries(r.resultado_por_rfc.map(x => [x.rfc, x.tipologia]));
  assert.equal(porRfc.AAA, 'carrusel');
  assert.equal(porRfc.BBB, null);
  assert.equal(porRfc.CCC, null);
});

test('resultado_por_rfc cae a principal + satélites cuando el paquete no trae rfcs_cluster', () => {
  const r = dictaminar(entrada({
    caso: { id: UUID.caso, n_reintentos: 0, rfc_principal: 'AAA', rfcs_satelite: ['BBB'] },
  }));
  assert.deepEqual(r.resultado_por_rfc.map(x => x.rfc), ['AAA', 'BBB']);
});

test('una limitación que nombra un RFC sólo le quita la cobertura a ese RFC', () => {
  const r = dictaminar(conCluster({
    pistas: [{ id: '1', rfc: 'AAA', estado: 'disparada' }, { id: '2', rfc: 'BBB', estado: 'disparada' }],
    evidencia: [ev('F', { rfcs_afectados: ['BBB'] }), ev('R', { rfcs_afectados: ['BBB'] })],
    pendientes: [{ motivo: 'cadena_incompleta', reparable: false, objetivo: { rfcs: ['AAA'] } }],
  }));
  const porRfc = Object.fromEntries(r.resultado_por_rfc.map(x => [x.rfc, x.cobertura_completa]));
  assert.equal(porRfc.AAA, false);
  assert.equal(porRfc.BBB, true);
  // Y BBB sí puede presumir aunque el CASO quede no_concluyente por esa
  // limitación abierta: es el escenario que el panel Contraste compara.
  assert.equal(r.nivel, 'no_concluyente');
  assert.equal(r.resultado_por_rfc.find(x => x.rfc === 'BBB').nivel, 'presuncion');
});

test('una limitación sin RFC nombrado afecta a todos los del cluster', () => {
  const r = dictaminar(conCluster({
    evidencia: [ev('F', { rfcs_afectados: ['AAA'] }), ev('R', { rfcs_afectados: ['AAA'] })],
    pendientes: [{ motivo: 'evidencia_insuficiente', reparable: false }],
  }));
  assert.ok(r.resultado_por_rfc.every(x => x.cobertura_completa === false));
  assert.ok(r.resultado_por_rfc.every(x => x.nivel === 'no_concluyente'));
});

test('el nivel por RFC usa la MISMA regla que el del caso (sin duplicarla)', () => {
  // Cluster de un solo RFC con toda la evidencia: caso y RFC deben coincidir.
  for (const familias of [['F'], ['F', 'R'], ['F', 'R', 'T']]) {
    const r = dictaminar(entrada({
      caso: { id: UUID.caso, n_reintentos: 0, rfc_principal: 'AAA', rfcs_cluster: ['AAA'] },
      pistas: [{ id: '1', rfc: 'AAA', estado: 'disparada' }],
      evidencia: familias.map(f => ev(f, { rfcs_afectados: ['AAA'] })),
    }));
    assert.equal(r.resultado_por_rfc[0].nivel, r.nivel, `familias=${familias.join('')}`);
  }
});

test('ningún camino devuelve "definitivo" como nivel', () => {
  const casos = [
    entrada(),
    entrada({ cobertura_completa: false }),
    entrada({ pistas: [descartada('1')] }),
    entrada({ pistas: [{ id: '1', estado: 'disparada' }], evidencia: [ev('D'), ev('F'), ev('R'), ev('T'), ev('E')] }),
  ];
  for (const c of casos) assert.notEqual(dictaminar(c).nivel, 'definitivo');
});

test('la salida alimenta entities.dictamen sin que el LLM toque el nivel', () => {
  const r = dictaminar(entrada({ pistas: [{ id: '1', estado: 'disparada' }], evidencia: [ev('D'), ev('F')] }));
  const dictamen = {
    nivel: r.nivel,
    familias: r.familias,
    monto_en_riesgo_centavos: r.monto_en_riesgo_centavos,
    moneda: 'MXN',
    regla: r.regla,
    limitaciones: [],
  };
  const v = validateContract('entities.dictamen', dictamen);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('n8n/code/auditor-final.js está generado y no editado a mano', () => {
  for (const definicion of GENERADOS) {
    const esperado = construirArchivo(definicion);
    const actual = fs.readFileSync(definicion.destino, 'utf8');
    assert.equal(actual, esperado, `${path.relative(RAIZ, definicion.destino)} tiene deriva: regenera con node n8n/runtime/generar-code-nodes.mjs`);
  }
});

test('el Code node generado produce el mismo resultado que la función pura', () => {
  const codigo = fs.readFileSync(path.join(RAIZ, 'code', 'auditor-final.js'), 'utf8');
  const ejecutar = new Function('$input', codigo);
  const x = entrada({ pistas: [{ id: '1', estado: 'disparada' }], evidencia: [ev('D'), ev('F')] });
  const salidaNodo = ejecutar({ first: () => ({ json: x }) });
  assert.ok(Array.isArray(salidaNodo));
  assert.deepEqual(salidaNodo[0].json, dictaminar(x));
});
