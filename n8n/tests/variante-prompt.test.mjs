// n8n/tests/variante-prompt.test.mjs — el Code node «Construir cuerpo Messages»
// deriva `variante_prompt` y `aviso_reintento` cuando el system se arma desde el
// catálogo embebido (no hubo `ensamblar()` en el backend). Esa derivación es una
// SEGUNDA implementación de la misma gramática: si se separa del ensamblador, el
// `prompt_hash` de respaldo cambia en silencio y 10 acaba comparando corridas que
// no son comparables.
//
// Este archivo no reimplementa la gramática: la CRUZA contra
// `ensamblar().meta.variante_prompt` en el producto rol × fewshot × intento ×
// motivo, que es lo que de verdad falla cuando alguien toca uno de los dos lados.
//
// Decisión H9 07:33 (reports/handoff/DECISIONES.md): con intento≥1 y sin motivo
// tipificado se degrada a la variante `reintento:sin_motivo` y el hueco se declara
// en `meta.aviso_reintento`; el runtime lo escribe en `forense.bitacora`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { construirCuerpoNodo } from '../runtime/nodos/construir-cuerpo.mjs';
import {
  ensamblar, ROLES_LLM, ROLES_ESPECIALISTA, MOTIVOS_REINTENTO, ROLES_CON_REINTENTO,
  FEWSHOT_POR_ROL, VARIANTE_REINTENTO_SIN_MOTIVO,
} from '../prompts/ensamblar.mjs';
import { fixtureContrato, contextoEspecialista } from '../../tests/prompts/ayuda.mjs';
import { catalogoPrompts } from '../runtime/generar-workflows.mjs';

const CATALOGO = catalogoPrompts();

/** Paquete del rol con el número de intento pedido (mismo criterio que tests/prompts). */
function paqueteDe(rol, intento = 0) {
  const fx = ROLES_ESPECIALISTA.includes(rol)
    ? contextoEspecialista(rol)
    : fixtureContrato(`contexto-${rol}`);
  fx.intento = intento;
  return fx;
}

/**
 * Entrada mínima del Code node para el mismo caso: sin `system` (fuerza el camino
 * del catálogo embebido, que es donde vive la derivación) y sin `meta`.
 */
function entradaNodo(rol, paquete, { fewshot = false, motivo = null } = {}) {
  return {
    rol,
    modelo: 'claude-sonnet-4-5',
    catalogo_prompts: CATALOGO,
    paquete,
    intento: paquete.intento,
    motivo_reintento: motivo,
    fewshot,
    mensajes: [{ role: 'user', content: 'paquete de contexto' }],
    techo_caracteres: 0,
  };
}

test('la variante derivada por el nodo coincide con la del ensamblador en todo el producto', () => {
  let comparadas = 0;
  for (const rol of ROLES_LLM) {
    const conFewshot = Boolean(FEWSHOT_POR_ROL[rol]);
    for (const fewshot of conFewshot ? [false, true] : [false]) {
      for (const intento of [0, 1, 2]) {
        const motivos = intento >= 1 && ROLES_CON_REINTENTO.includes(rol)
          ? [null, ...MOTIVOS_REINTENTO]
          : [null];
        for (const motivo of motivos) {
          const paquete = paqueteDe(rol, intento);
          const esperado = ensamblar(rol, paquete, { fewshot, motivo_reintento: motivo });
          const obtenido = construirCuerpoNodo(entradaNodo(rol, paquete, { fewshot, motivo }));
          assert.equal(
            obtenido.variante_prompt, esperado.meta.variante_prompt,
            `variante distinta para rol=${rol} fewshot=${fewshot} intento=${intento} motivo=${motivo}`,
          );
          assert.equal(
            obtenido.aviso_reintento, esperado.meta.aviso_reintento,
            `aviso distinto para rol=${rol} intento=${intento} motivo=${motivo}`,
          );
          assert.equal(obtenido.motivo_reintento, esperado.meta.motivo_reintento);
          comparadas += 1;
        }
      }
    }
  }
  assert.ok(comparadas >= 40, `se compararon pocas combinaciones: ${comparadas}`);
});

test('el prompt_hash de respaldo lleva la variante, no el rol', () => {
  const rol = 'documental';
  const base = construirCuerpoNodo(entradaNodo(rol, paqueteDe(rol, 0)));
  assert.equal(base.prompt_hash, `${CATALOGO.version_prompts}:${rol}`);

  const conMotivo = construirCuerpoNodo(
    entradaNodo(rol, paqueteDe(rol, 1), { motivo: 'cadena_incompleta' }),
  );
  assert.equal(conMotivo.prompt_hash, `${CATALOGO.version_prompts}:${rol}+reintento:cadena_incompleta`);
  assert.notEqual(conMotivo.prompt_hash, base.prompt_hash);

  const sinMotivo = construirCuerpoNodo(entradaNodo(rol, paqueteDe(rol, 1)));
  assert.equal(
    sinMotivo.prompt_hash,
    `${CATALOGO.version_prompts}:${rol}+${VARIANTE_REINTENTO_SIN_MOTIVO}`,
  );
  assert.notEqual(sinMotivo.prompt_hash, conMotivo.prompt_hash);
});

test('un prompt_hash impuesto por el backend gana sobre el respaldo', () => {
  const rol = 'financiero';
  const entrada = entradaNodo(rol, paqueteDe(rol, 1));
  entrada.prompt_hash = 'sha256:impuesto-por-backend';
  const salida = construirCuerpoNodo(entrada);
  assert.equal(salida.prompt_hash, 'sha256:impuesto-por-backend');
  // La variante se sigue calculando: la bitácora la necesita aunque el hash venga hecho.
  assert.equal(salida.variante_prompt, `${rol}+${VARIANTE_REINTENTO_SIN_MOTIVO}`);
});

test('`meta` del ensamblado manda sobre la derivación del nodo', () => {
  const rol = 'auditor';
  const entrada = entradaNodo(rol, paqueteDe(rol, 1));
  entrada.meta = { variante_prompt: 'auditor+reintento:contradiccion', aviso_reintento: null };
  const salida = construirCuerpoNodo(entrada);
  assert.equal(salida.variante_prompt, 'auditor+reintento:contradiccion');
  assert.equal(salida.aviso_reintento, null);
});

test('el aviso de reintento viaja como hueco declarado, nunca como excepción', () => {
  const rol = 'relacional';
  const salida = construirCuerpoNodo(entradaNodo(rol, paqueteDe(rol, 2)));
  assert.match(salida.aviso_reintento, /^motivo_reintento_ausente:/);
  assert.match(salida.aviso_reintento, /intento=2/);
  assert.ok(salida.aviso_reintento.includes(VARIANTE_REINTENTO_SIN_MOTIVO));
  // El paso no se cae: el cuerpo para el proveedor sigue siendo válido.
  assert.equal(salida.cuerpo.model, 'claude-sonnet-4-5');
});

test('un motivo no tipificado no se cuela en la variante', () => {
  const rol = 'temporal';
  const salida = construirCuerpoNodo(
    entradaNodo(rol, paqueteDe(rol, 1), { motivo: 'porque_si' }),
  );
  assert.equal(salida.motivo_reintento, null);
  assert.equal(salida.variante_prompt, `${rol}+${VARIANTE_REINTENTO_SIN_MOTIVO}`);
});

test('los roles sin reintento no degradan aunque el paquete traiga intento≥1', () => {
  for (const rol of ROLES_LLM.filter((r) => !ROLES_CON_REINTENTO.includes(r))) {
    const salida = construirCuerpoNodo(entradaNodo(rol, paqueteDe(rol, 3)));
    assert.equal(salida.variante_prompt, rol, `${rol} no debe degradar`);
    assert.equal(salida.aviso_reintento, null);
  }
});
