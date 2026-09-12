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
    pistas: [{ id: '1', estado: 'confirmada' }],
    evidencia: [ev('D'), ev('F')],
  }));
  assert.equal(r.nivel, 'presuncion');
  assert.deepEqual(r.familias, ['D', 'F']);
  assert.equal(r.rechazo, null);
});

test('tres familias → presuncion_alta; nunca "definitivo" como nivel', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'confirmada' }],
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
  const r = dictaminar(entrada({ pistas: [{ id: '1', estado: 'confirmada' }], evidencia: [ev('D'), e1] }));
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
  const r = dictaminar(entrada({ pistas: [{ id: '1', estado: 'confirmada' }], evidencia: [e1] }));
  assert.equal(r.nivel, 'no_concluyente');
});

test('todas las pistas refutadas → anomalia_explicada', () => {
  const r = dictaminar(entrada({
    pistas: [{ id: '1', estado: 'refutada' }, { id: '2', estado: 'refutada' }],
    evidencia: [],
  }));
  assert.equal(r.nivel, 'anomalia_explicada');
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
    pistas: [{ id: '1', estado: 'confirmada' }],
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
    pistas: [{ id: '1', estado: 'confirmada' }],
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
    pistas: [{ id: '1', estado: 'confirmada' }],
    evidencia: [ev('D'), ev('F', { refutada: true }), ev('R', { valida_tecnica: false, validada: false })],
  }));
  assert.deepEqual(r.familias, ['D']);
  assert.equal(r.nivel, 'no_concluyente');
});

test('ningún camino devuelve "definitivo" como nivel', () => {
  const casos = [
    entrada(),
    entrada({ cobertura_completa: false }),
    entrada({ pistas: [{ id: '1', estado: 'refutada' }] }),
    entrada({ pistas: [{ id: '1', estado: 'confirmada' }], evidencia: [ev('D'), ev('F'), ev('R'), ev('T'), ev('E')] }),
  ];
  for (const c of casos) assert.notEqual(dictaminar(c).nivel, 'definitivo');
});

test('la salida alimenta entities.dictamen sin que el LLM toque el nivel', () => {
  const r = dictaminar(entrada({ pistas: [{ id: '1', estado: 'confirmada' }], evidencia: [ev('D'), ev('F')] }));
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
  const x = entrada({ pistas: [{ id: '1', estado: 'confirmada' }], evidencia: [ev('D'), ev('F')] });
  const salidaNodo = ejecutar({ first: () => ({ json: x }) });
  assert.ok(Array.isArray(salidaNodo));
  assert.deepEqual(salidaNodo[0].json, dictaminar(x));
});
