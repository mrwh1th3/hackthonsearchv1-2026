// ACL del paquete de contexto (06 §ACL, 17 §7): qué NO puede ver cada rol.
//
// Defensa en profundidad: el contrato `runtime.contexto` ya rechaza estos paquetes con
// errores de schema, y el ensamblador los rechaza antes, con un código tipificado que el
// runtime puede registrar en bitácora. Cada caso comprueba las dos capas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract } from '../../contracts/index.mjs';
import { ensamblar, ErrorEnsamblado } from '../../n8n/prompts/ensamblar.mjs';
import { fixtureContrato, fixtureLocal, contextoEspecialista } from './ayuda.mjs';

/** Comprueba que el ensamblador falla con `codigo` y que el contrato también lo rechaza. */
function rechazado(rol, paquete, codigo, { contratoValido = false } = {}) {
  assert.throws(
    () => ensamblar(rol, paquete),
    e => {
      assert.ok(e instanceof ErrorEnsamblado, `se esperaba ErrorEnsamblado y llegó ${e?.name}`);
      assert.equal(e.codigo, codigo, `código de error: ${e.codigo}`);
      return true;
    },
  );
  const r = validateContract('runtime.contexto', paquete);
  assert.equal(
    r.ok, contratoValido,
    contratoValido
      ? 'el fixture debía cumplir el contrato: el fallo tiene que venir de la ACL, no del formato'
      : 'el contrato también debe rechazarlo (defensa en profundidad)',
  );
}

test('un especialista en ronda 1 no recibe titulares de señales ajenas', () => {
  rechazado('documental', fixtureLocal('contexto-r1-senal-ajena'), 'senal_ajena_en_r1');
});

test('un especialista en ronda 1 no recibe evidencia, argumentos ni dictamen de otros roles', () => {
  // El paquete de cierre (auditor) con identidad de especialista R1: fuga de la capa
  // de correlaciones hacia la ronda ciega.
  const fuga = fixtureContrato('contexto-auditor');
  fuga.rol = 'documental';
  rechazado('documental', fuga, 'senal_ajena_en_r1');
});

test('un especialista en ronda 2 sí puede recibir titulares del snapshot de barrera', () => {
  const r = ensamblar('documental', fixtureContrato('contexto-r2'));
  assert.equal(r.meta.ronda, 2);
  assert.ok(
    r.messages_iniciales[0].content.includes('[TITULAR senal_id=602'),
    'el titular autorizado de ronda 2 debe llegar al paquete',
  );
});

test('un especialista sólo investiga pistas de su familia', () => {
  const paquete = fixtureLocal('contexto-r1-familia-ajena');
  rechazado('documental', paquete, 'pista_de_familia_ajena');

  // Y al revés: cada familia acepta la suya.
  for (const rol of ['documental', 'financiero', 'relacional', 'temporal', 'externo']) {
    assert.doesNotThrow(() => ensamblar(rol, contextoEspecialista(rol)), rol);
  }
});

test('el Redactor no recibe la hipótesis libre del Auditor (17 §7)', () => {
  rechazado('redactor', fixtureLocal('contexto-redactor-hipotesis'), 'hipotesis_libre');
});

test('el Redactor no recibe evidencia sin validar ni refutada', () => {
  rechazado('redactor', fixtureLocal('contexto-redactor-evidencia-no-validada'), 'evidencia_no_validada');

  const refutada = fixtureContrato('contexto-redactor');
  refutada.datos.evidencia[0].refutada = true;
  rechazado('redactor', refutada, 'evidencia_no_validada');
});

test('el Redactor no escribe sin el dictamen determinista: el nivel no lo decide el modelo', () => {
  rechazado('redactor', fixtureLocal('contexto-redactor-sin-dictamen'), 'dictamen_ausente');
});

test('los roles sin herramientas exigen tools_restantes=0', () => {
  for (const [rol, fixture] of [['replica', 'contexto-replica'], ['redactor', 'contexto-redactor'], ['editor', 'contexto-editor']]) {
    const paquete = fixtureContrato(fixture);
    assert.equal(paquete.limites.tools_restantes, 0, `${rol}: el fixture publicado ya viene sin cuota de tools`);
    paquete.limites.tools_restantes = 4;
    rechazado(rol, paquete, 'tools_no_permitidas');
  }
});

test('el Auditor y el Defensor sí reciben el paquete de cierre completo del mismo caso', () => {
  for (const [rol, fixture] of [['auditor', 'contexto-auditor'], ['defensor', 'contexto-defensor']]) {
    const r = ensamblar(rol, fixtureContrato(fixture));
    const contenido = r.messages_iniciales[0].content;
    assert.ok(contenido.includes('[EVIDENCIA id=701'), `${rol}: falta la evidencia`);
    assert.ok(contenido.includes('[DEFENSA defensa_id=801'), `${rol}: falta el argumento de defensa`);
    assert.ok(contenido.includes('Señales vigentes del caso'), `${rol}: faltan las señales vigentes`);
    assert.ok(
      contenido.includes('Pide el detalle con forense_leer_senal'),
      `${rol}: el detalle de señal se pide por herramienta, no se carga`,
    );
  }
});

test('la Réplica recibe argumentos y evidencia verificada, y las señales sólo como referencia', () => {
  const r = ensamblar('replica', fixtureContrato('contexto-replica'));
  const contenido = r.messages_iniciales[0].content;
  assert.ok(contenido.includes('[DEFENSA defensa_id=801'));
  assert.ok(
    contenido.includes('no son hechos validados y no se citan en el expediente'),
    'la Réplica no tiene herramientas: las señales llegan marcadas como referencia de bitácora',
  );
  assert.deepEqual(r.tools_permitidas, []);
});

test('el dictamen determinista viaja etiquetado como calculado por código', () => {
  for (const [rol, fixture] of [['redactor', 'contexto-redactor'], ['auditor', 'contexto-auditor']]) {
    const contenido = ensamblar(rol, fixtureContrato(fixture)).messages_iniciales[0].content;
    assert.ok(contenido.includes('Dictamen determinista (calculado por código)'), rol);
    assert.ok(contenido.includes('nivel=presuncion'), `${rol}: el nivel recibido debe viajar tal cual`);
  }
});

test('el Editor recibe el documento por bloques con su id y la selección del usuario', () => {
  const contenido = ensamblar('editor', fixtureContrato('contexto-editor')).messages_iniciales[0].content;
  assert.ok(contenido.includes('[BLOQUE id=section-1 tipo=heading]'));
  assert.ok(contenido.includes('[BLOQUE id=body-1 tipo=paragraph]'));
  assert.ok(contenido.includes('Selección del usuario'));
  assert.ok(contenido.includes('bloques: body-1'));
});
