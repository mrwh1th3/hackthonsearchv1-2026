// La gramática de `meta.variante_prompt` es un contrato publicado: el runtime la usa para
// componer `prompt_hash` y 10 compara corridas por ese nombre. Aquí se fija el orden de las
// partes (no sólo el conjunto), la forma del separador y que el README diga lo mismo que
// produce el código. Prosa y código que se contradicen son peores que no documentar.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensamblar, ensamblarMapper, ROLES_LLM, ROLES_ESPECIALISTA, MOTIVOS_REINTENTO,
  ROLES_CON_REINTENTO, FEWSHOT_POR_ROL, VARIANTE_REINTENTO_SIN_MOTIVO,
} from '../../n8n/prompts/ensamblar.mjs';
import { leerManifest } from '../../n8n/prompts/manifest.mjs';
import {
  fixtureContrato, contextoEspecialista, leerArchivoPrompt, plano,
} from './ayuda.mjs';

/** Paquete del rol con el número de intento pedido. */
function paqueteDe(rol, intento = 0) {
  const fx = ROLES_ESPECIALISTA.includes(rol)
    ? contextoEspecialista(rol)
    : fixtureContrato(`contexto-${rol}`);
  fx.intento = intento;
  return fx;
}

// variante_prompt := <rol> [ "+fewshot" ] [ "+reintento:" <motivo> | "+reintento:sin_motivo" ]
const GRAMATICA = new RegExp(
  `^(${[...ROLES_LLM, 'mapper'].join('|')})(\\+fewshot)?(\\+reintento:(${MOTIVOS_REINTENTO.join('|')}|sin_motivo))?$`,
);

test('toda variante que produce el ensamblador cabe en la gramática publicada', () => {
  const vistas = new Set();
  const registrar = (r) => {
    assert.match(r.meta.variante_prompt, GRAMATICA, r.meta.variante_prompt);
    vistas.add(r.meta.variante_prompt);
  };

  for (const rol of ROLES_LLM) registrar(ensamblar(rol, paqueteDe(rol)));
  for (const rol of Object.keys(FEWSHOT_POR_ROL)) {
    registrar(ensamblar(rol, paqueteDe(rol), { fewshot: true }));
  }
  for (const rol of ROLES_CON_REINTENTO) {
    registrar(ensamblar(rol, paqueteDe(rol, 1)));              // degradada (H7)
    for (const motivo of MOTIVOS_REINTENTO) {
      registrar(ensamblar(rol, paqueteDe(rol, 1), { motivo_reintento: motivo }));
    }
  }
  // 10 base + 5 fewshot + 7 sin_motivo + 35 con motivo = 57 nombres distintos.
  assert.equal(vistas.size, 57);
});

test('el orden de las partes es fijo: rol, fewshot, reintento', () => {
  const r = ensamblar('documental', paqueteDe('documental', 1), {
    fewshot: true, motivo_reintento: 'contradiccion',
  });
  // El conjunto de partes no basta: este nombre exacto es el contrato.
  assert.equal(r.meta.variante_prompt, 'documental+fewshot+reintento:contradiccion');
  assert.notEqual(r.meta.variante_prompt, 'documental+reintento:contradiccion+fewshot');

  const degradada = ensamblar('documental', paqueteDe('documental', 2), { fewshot: true });
  assert.equal(degradada.meta.variante_prompt, `documental+fewshot+${VARIANTE_REINTENTO_SIN_MOTIVO}`);

  // Sin variante no hay sufijo: el nombre base es el rol a secas.
  assert.equal(ensamblar('redactor', paqueteDe('redactor')).meta.variante_prompt, 'redactor');
});

test('el mapper también nombra su variante: la gramática lo incluye como rol', () => {
  const m = ensamblarMapper({ profile_hash: 'ph', columnas: [{ nombre: 'rfc', tipo: 'texto' }] });
  assert.equal(m.meta.variante_prompt, 'mapper');
  assert.match(m.meta.variante_prompt, GRAMATICA);
  // No tiene ejes: ni fewshot ni reintento existen para él.
  assert.ok(!FEWSHOT_POR_ROL.mapper);
  assert.ok(!ROLES_CON_REINTENTO.includes('mapper'));
});

test('los dos sufijos de reintento son excluyentes', () => {
  for (const rol of ROLES_CON_REINTENTO) {
    const conMotivo = ensamblar(rol, paqueteDe(rol, 1), { motivo_reintento: 'cadena_incompleta' });
    assert.ok(!conMotivo.meta.variante_prompt.includes('sin_motivo'), rol);
    const sinMotivo = ensamblar(rol, paqueteDe(rol, 1));
    assert.equal(sinMotivo.meta.variante_prompt.split('+reintento:').length, 2, rol);
  }
});

test('el README publica la gramática y la composición de prompt_hash', () => {
  const readme = plano(leerArchivoPrompt('README.md'));

  assert.ok(readme.includes('variante_prompt := <rol>'), 'falta la producción de la gramática');
  assert.ok(readme.includes('prompt_hash := <version_prompts> ":" <variante_prompt>'), 'falta la regla de prompt_hash');
  // El ejemplo usa una version_prompts inventada a propósito: si alguien la "actualiza" a la
  // vigente, este test lo para, porque el README entra en el hash y la haría obsoleta al
  // instante.
  assert.ok(readme.includes('0123456789ab:documental+fewshot'), 'falta el ejemplo de prompt_hash');
  // El ejemplo se declara como ejemplo: este README entra en el hash, así que ninguna
  // version_prompts literal puede ser la vigente. El valor vigente sale del manifest.
  assert.ok(readme.includes("require('./n8n/prompts/manifest.json').version_prompts"), 'falta cómo obtener la version_prompts vigente');

  for (const motivo of MOTIVOS_REINTENTO) {
    assert.ok(readme.includes(motivo), `el README no lista el motivo ${motivo}`);
  }
  assert.ok(readme.includes(VARIANTE_REINTENTO_SIN_MOTIVO), 'falta la variante degradada');
  assert.ok(readme.includes('no es un motivo'), 'el README debe decir que sin_motivo no es un motivo');
  // El hueco del runtime se documenta como hueco, no como si ya estuviera hecho.
  assert.ok(readme.includes('construir-cuerpo.mjs'), 'falta el hueco conocido del runtime');
});

test('el manifest publica los ejes de la gramática y no inventa sin_motivo como motivo', () => {
  const manifest = leerManifest();
  assert.deepEqual(manifest.motivos_reintento, [...MOTIVOS_REINTENTO]);
  assert.deepEqual(manifest.roles_con_reintento, [...ROLES_CON_REINTENTO]);
  assert.equal(manifest.sufijo_variante_reintento, 'reintento:<motivo>');
  assert.equal(manifest.variante_reintento_sin_motivo, VARIANTE_REINTENTO_SIN_MOTIVO);
  assert.ok(!manifest.motivos_reintento.includes('sin_motivo'));
  // Las variantes listadas son sólo las que no tienen ejes: rol y rol+fewshot.
  for (const v of manifest.variantes) {
    assert.match(v, GRAMATICA, v);
    assert.ok(!v.includes('reintento'), `variantes no enumera reintentos: ${v}`);
  }
});
