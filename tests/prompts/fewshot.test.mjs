// Variante `fewshot`: ejemplo adversarial por familia con la trampa legítima de 02.
//
// Lo que se comprueba: que existe uno por familia, que enseña la trampa (no el fraude), que
// su salida de ejemplo cumple los contratos reales, que activar la variante cambia el system
// y `meta.variante_prompt` sin tocar la allowlist ni el contrato de salida, y que los techos
// siguen respetados en los dos ámbitos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract } from '../../contracts/index.mjs';
import {
  ensamblar, ErrorEnsamblado, ROLES_ESPECIALISTA, ROLES_LLM, FEWSHOT_POR_ROL,
  FEWSHOT_POR_DEFECTO, FAMILIA_POR_ROL, AMBITOS_TECHO, TECHO_CARACTERES,
} from '../../n8n/prompts/ensamblar.mjs';
import { leerManifest } from '../../n8n/prompts/manifest.mjs';
import { leerArchivoPrompt, contextoEspecialista, fixtureContrato, plano } from './ayuda.mjs';

/** Bloques ```json de un archivo de prompt, ya parseados. */
function jsonDe(archivo) {
  return leerArchivoPrompt(archivo)
    .split('```json').slice(1)
    .map(b => JSON.parse(b.split('```')[0]));
}

test('hay un ejemplo adversarial por familia y ninguno para los roles de cierre', () => {
  assert.deepEqual(Object.keys(FEWSHOT_POR_ROL).sort(), [...ROLES_ESPECIALISTA].sort());
  for (const rol of ROLES_LLM) {
    if (!ROLES_ESPECIALISTA.includes(rol)) {
      assert.equal(FEWSHOT_POR_ROL[rol], undefined, `${rol} no tiene trampas de familia en 02`);
    }
  }
  assert.equal(FEWSHOT_POR_DEFECTO, false, 'la variante está apagada por defecto');
});

test('cada ejemplo enseña la trampa legítima de su familia, no el fraude', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const texto = plano(leerArchivoPrompt(FEWSHOT_POR_ROL[rol]));
    const familia = FAMILIA_POR_ROL[rol];
    assert.ok(
      new RegExp(`familia ${familia}`).test(texto),
      `${rol}: el ejemplo no declara su familia`,
    );
    assert.ok(/trampa legítima/i.test(texto), `${rol}: no dice que ilustra una trampa legítima`);
    assert.ok(texto.includes('DEMO:'), `${rol}: el ejemplo debe usar entidades sintéticas`);
    assert.ok(
      texto.includes('semilla reservada'),
      `${rol}: el ejemplo debe declararse separado de la semilla reservada (10)`,
    );
    assert.ok(
      texto.includes('Error a no cometer') || texto.includes('no sería'),
      `${rol}: falta el error que el ejemplo previene`,
    );
    // La conclusión del ejemplo es refutar, que es lo que baja la FPR sobre trampas (10).
    assert.ok(/refuta/i.test(texto), `${rol}: el ejemplo debe terminar en una señal con refuta`);
  }
});

test('las llamadas y salidas de los ejemplos cumplen los contratos reales', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const bloques = jsonDe(FEWSHOT_POR_ROL[rol]);
    assert.equal(bloques.length, 2, `${rol}: se esperan la llamada a la herramienta y la salida final`);

    const [llamada, salida] = bloques;
    const rLlamada = validateContract('tools.forense_escribir_senal', llamada);
    assert.equal(rLlamada.ok, true, `${rol}: ${JSON.stringify(rLlamada.errors)}`);
    assert.equal(llamada.p_familia, FAMILIA_POR_ROL[rol], `${rol}: familia de la señal`);
    assert.equal(llamada.p_refuta, true, `${rol}: el ejemplo persiste el contradato`);

    const rSalida = validateContract('agents.especialista', salida);
    assert.equal(rSalida.ok, true, `${rol}: ${JSON.stringify(rSalida.errors)}`);
    assert.ok(salida.senal_ids.length > 0, `${rol}: refutar también deja señal (08 regla 8)`);
  }
});

test('activar la variante cambia el system y lo declara en meta', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const paquete = contextoEspecialista(rol);
    const base = ensamblar(rol, paquete);
    const con = ensamblar(rol, paquete, { fewshot: true });

    assert.equal(base.meta.fewshot, false);
    assert.equal(base.meta.variante_prompt, rol);
    assert.equal(con.meta.fewshot, true);
    assert.equal(con.meta.variante_prompt, `${rol}+fewshot`);
    assert.notEqual(con.system, base.system, `${rol}: el system debe cambiar`);
    assert.ok(con.system.length > base.system.length);
    assert.ok(
      con.system.includes(leerArchivoPrompt(FEWSHOT_POR_ROL[rol]).trimEnd().slice(0, 60)),
      `${rol}: el ejemplo no llegó al system`,
    );

    // La variante no toca nada más: mismas herramientas, mismo contrato, mismo mensaje.
    assert.deepEqual(con.tools_permitidas, base.tools_permitidas, rol);
    assert.equal(con.schema_salida, base.schema_salida, rol);
    assert.equal(con.messages_iniciales[0].content, base.messages_iniciales[0].content, rol);
  }
});

test('la variante no existe para los roles de cierre y se rechaza explícitamente', () => {
  assert.throws(
    () => ensamblar('redactor', fixtureContrato('contexto-redactor'), { fewshot: true }),
    e => e instanceof ErrorEnsamblado && e.codigo === 'fewshot_no_disponible',
  );
});

test('con la variante activa se siguen respetando los techos en los dos ámbitos', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    for (const ambito of AMBITOS_TECHO) {
      const r = ensamblar(rol, contextoEspecialista(rol), { fewshot: true, ambito_techo: ambito });
      const usado = ambito === 'total' ? r.meta.caracteres : r.meta.caracteres_paquete;
      assert.ok(usado <= TECHO_CARACTERES[rol], `${rol}/${ambito}: ${usado} > ${TECHO_CARACTERES[rol]}`);
    }
  }
});

test('el manifest registra la variante y sus archivos, y los hashea', () => {
  const manifest = leerManifest();
  assert.deepEqual(manifest.fewshot_por_rol, { ...FEWSHOT_POR_ROL });
  assert.equal(manifest.fewshot_por_defecto, FEWSHOT_POR_DEFECTO);
  for (const rol of ROLES_ESPECIALISTA) {
    assert.ok(manifest.variantes.includes(`${rol}+fewshot`), `${rol}: falta la variante`);
    assert.ok(
      manifest.archivos.some(a => a.name === FEWSHOT_POR_ROL[rol]),
      `${rol}: el ejemplo no entra en version_prompts`,
    );
  }
  assert.equal(manifest.variantes.length, ROLES_LLM.length + 1 + ROLES_ESPECIALISTA.length);
});

test('el README documenta el versionado y el procedimiento de comparación (10)', () => {
  const readme = plano(leerArchivoPrompt('README.md'));
  assert.ok(readme.includes('node n8n/prompts/manifest.mjs --write'), 'falta cómo regenerar');
  assert.ok(readme.includes('una cosa por corrida'), 'falta la regla de 10');
  assert.ok(readme.includes('FPR sobre trampas'), 'falta la métrica que manda');
  assert.ok(readme.includes('version_prompts'), 'falta el identificador de la corrida');
  assert.ok(readme.includes('meta.variante_prompt'), 'falta cómo se nombra la variante');
  assert.ok(readme.includes('corrida_origen_id'), 'falta el encadenado de corridas');
  assert.ok(readme.includes('presuncion_alta'), 'el README debe recordar el nivel máximo');
});
