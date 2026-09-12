// Variantes de reintento (03 §bucle de reintento, 17 §8). Cuando el auditor de proceso
// rechaza un intento, el siguiente lleva un motivo TIPIFICADO y instrucciones para ese motivo
// y sólo ese. Lo que cambia es el texto: el contrato de salida, la allowlist y los techos son
// los mismos, y reintentar nunca sube el nivel (reglas 4 y 10).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensamblar, ErrorEnsamblado, MOTIVOS_REINTENTO, ROLES_CON_REINTENTO, ROLES_ESPECIALISTA,
  ROLES_LLM, TECHO_CARACTERES, VARIANTE_REINTENTO_SIN_MOTIVO,
} from '../../n8n/prompts/ensamblar.mjs';
import { leerManifest } from '../../n8n/prompts/manifest.mjs';
import { fixtureContrato, contextoEspecialista, fixtureLocal, plano } from './ayuda.mjs';

/** Paquete del rol con el número de intento pedido. */
function paqueteDe(rol, intento) {
  const fx = ROLES_ESPECIALISTA.includes(rol)
    ? contextoEspecialista(rol)
    : fixtureContrato(`contexto-${rol}`);
  fx.intento = intento;
  return fx;
}

test('los motivos son los cinco tipificados y los roles que reintentan, los siete que investigan', () => {
  assert.deepEqual([...MOTIVOS_REINTENTO], [
    'evidencia_insuficiente', 'cadena_incompleta', 'defensa_no_considerada',
    'evidencia_invalida', 'contradiccion',
  ]);
  assert.deepEqual([...ROLES_CON_REINTENTO], [...ROLES_ESPECIALISTA, 'auditor', 'defensor']);
  for (const rol of ['replica', 'redactor', 'editor']) {
    assert.ok(!ROLES_CON_REINTENTO.includes(rol), `${rol} no reintenta con motivo`);
  }
});

test('en intento 1 y 2 el texto cambia con el motivo, y el contrato no', () => {
  for (const rol of ROLES_CON_REINTENTO) {
    const base = ensamblar(rol, paqueteDe(rol, 0));
    const textos = new Set();

    for (const intento of [1, 2]) {
      for (const motivo of MOTIVOS_REINTENTO) {
        const r = ensamblar(rol, paqueteDe(rol, intento), { motivo_reintento: motivo });
        const contenido = r.messages_iniciales[0].content;

        // Lo que cambia: el mensaje declara el intento y el motivo tipificado.
        assert.ok(contenido.includes(`## Reintento: intento ${intento}`), `${rol}/${motivo}`);
        assert.ok(contenido.includes(`\`${motivo}\``), `${rol}/${motivo}: no nombra el motivo`);
        assert.ok(contenido !== base.messages_iniciales[0].content, `${rol}/${motivo}: texto idéntico`);
        textos.add(contenido.split('## Paquete de contexto')[0]);

        // Lo que NO cambia: el system salvo el número de intento que declara el runner en
        // el bloque de identidad, la allowlist, el contrato de salida y el techo.
        assert.equal(
          r.system.replace(`intento=${intento}`, 'intento=0'), base.system,
          `${rol}/${motivo}: el reintento no puede cambiar las reglas del rol`,
        );
        assert.ok(r.system.includes(`intento=${intento}`), `${rol}/${motivo}: identidad sin intento`);
        assert.deepEqual(r.tools_permitidas, base.tools_permitidas, `${rol}/${motivo}`);
        assert.equal(r.schema_salida, base.schema_salida, `${rol}/${motivo}`);
        assert.equal(r.meta.techo_caracteres, TECHO_CARACTERES[rol]);
        assert.ok(r.meta.caracteres_paquete <= TECHO_CARACTERES[rol], `${rol}/${motivo}: techo`);

        // Y queda nombrado para el loop de 10: variante, intento y motivo en meta.
        assert.equal(r.meta.variante_prompt, `${rol}+reintento:${motivo}`);
        assert.equal(r.meta.motivo_reintento, motivo);
        assert.equal(r.meta.intento, intento);
      }
    }

    // Cinco motivos × 2 intentos = 10 cabeceras distintas: ningún motivo dice lo mismo.
    assert.equal(textos.size, MOTIVOS_REINTENTO.length * 2, `${rol}: hay motivos con el mismo texto`);
  }
});

test('el reintento no autoriza subir el nivel ni rellenar la falta de pruebas', () => {
  const r = ensamblar('auditor', paqueteDe('auditor', 2), { motivo_reintento: 'evidencia_insuficiente' });
  const texto = plano(r.messages_iniciales[0].content);
  assert.ok(texto.includes('Reintentar no sube el nivel'), 'falta la regla 4 en el bloque de reintento');
  assert.ok(
    texto.includes('lo calcula código determinista'),
    'el bloque debe recordar quién calcula el nivel',
  );
  assert.ok(!/definitiv/i.test(texto), 'la palabra prohibida no aparece en ningún reintento');
});

test('cada motivo trae la instrucción de su propio fallo', () => {
  const esperado = {
    evidencia_insuficiente: 'piezas citables por ID',
    cadena_incompleta: 'Cierra el eslabón que falta',
    defensa_no_considerada: 'explicación legítima del Defensor',
    evidencia_invalida: 'El Validador rechazó piezas que citaste',
    contradiccion: 'Reconcilia las dos afirmaciones citando',
  };
  for (const [motivo, aguja] of Object.entries(esperado)) {
    const r = ensamblar('documental', paqueteDe('documental', 1), { motivo_reintento: motivo });
    assert.ok(plano(r.messages_iniciales[0].content).includes(aguja), `${motivo}: falta su instrucción`);
  }
});

test('el reintento mal declarado se rechaza con código tipificado, no se ignora', () => {
  // Motivo inventado.
  assert.throws(
    () => ensamblar('documental', paqueteDe('documental', 1), { motivo_reintento: 'porque_si' }),
    e => e instanceof ErrorEnsamblado && e.codigo === 'motivo_reintento_invalido',
  );
  // Rol que no reintenta con motivo.
  for (const rol of ['replica', 'redactor', 'editor']) {
    const fx = fixtureContrato(`contexto-${rol}`);
    fx.intento = 1;
    assert.throws(
      () => ensamblar(rol, fx, { motivo_reintento: 'contradiccion' }),
      e => e instanceof ErrorEnsamblado && e.codigo === 'reintento_no_disponible',
      rol,
    );
  }
  // Motivo sin intento previo: el prompt mentiría al modelo.
  assert.throws(
    () => ensamblar('auditor', paqueteDe('auditor', 0), { motivo_reintento: 'contradiccion' }),
    e => e instanceof ErrorEnsamblado && e.codigo === 'reintento_sin_intento',
  );
  // Intento sin motivo YA NO lanza (H7): se degrada. Ver el test siguiente.
  for (const rol of ROLES_CON_REINTENTO) {
    assert.doesNotThrow(() => ensamblar(rol, paqueteDe(rol, 1)), rol);
  }
});

test('intento>=1 sin motivo se degrada a la variante reintento:sin_motivo, no lanza (H7)', () => {
  // El runtime no siempre recupera el motivo del intento anterior (un checkpoint reanudado
  // tras un fallo lo pierde). Abortar el ensamblado convertía un dato faltante en un caso sin
  // investigar; degradarlo deja el caso vivo y el hueco visible en bitácora.
  for (const rol of ROLES_CON_REINTENTO) {
    for (const intento of [1, 2]) {
      const r = ensamblar(rol, paqueteDe(rol, intento));
      assert.equal(r.meta.intento, intento, rol);
      assert.equal(r.meta.variante_prompt, `${rol}+${VARIANTE_REINTENTO_SIN_MOTIVO}`, rol);
      // `sin_motivo` no es un motivo: no entra en la lista tipificada ni en meta.
      assert.equal(r.meta.motivo_reintento, null, rol);
      assert.ok(!MOTIVOS_REINTENTO.includes('sin_motivo'));
      // El aviso va en meta para que el runtime lo registre, no en un console.
      assert.match(r.meta.aviso_reintento, /^motivo_reintento_ausente: /, rol);
      assert.ok(r.meta.aviso_reintento.includes(`intento=${intento}`), rol);

      const texto = r.messages_iniciales[0].content;
      assert.ok(texto.includes(`## Reintento: intento ${intento}`), rol);
      // El bloque genérico dice lo que no se sabe en vez de fingir un motivo.
      assert.ok(texto.includes('el motivo tipificado no llegó a este ensamblado'), rol);
      assert.ok(texto.includes('No lo supongas ni lo inventes'), rol);
      for (const m of MOTIVOS_REINTENTO) {
        assert.ok(!texto.includes(`\`${m}\``), `${rol}: el bloque genérico no cita ${m} como si fuera el motivo`);
      }
      // Reintentar no sube el nivel, tampoco a ciegas (reglas 4 y 10).
      assert.ok(texto.includes('no sube el nivel'), rol);
    }
  }
});

test('sin reintento no hay aviso ni sufijo; con motivo tipificado el aviso sigue vacío', () => {
  const base = ensamblar('documental', paqueteDe('documental', 0));
  assert.equal(base.meta.aviso_reintento, null);
  assert.equal(base.meta.variante_prompt, 'documental');

  const conMotivo = ensamblar('documental', paqueteDe('documental', 1), { motivo_reintento: 'contradiccion' });
  assert.equal(conMotivo.meta.aviso_reintento, null);
  assert.equal(conMotivo.meta.variante_prompt, 'documental+reintento:contradiccion');
  assert.equal(conMotivo.meta.motivo_reintento, 'contradiccion');
});

test('los roles sin reintento ensamblan igual aunque el paquete declare intento', () => {
  for (const rol of ROLES_LLM.filter(r => !ROLES_CON_REINTENTO.includes(r))) {
    const fx = fixtureContrato(`contexto-${rol}`);
    fx.intento = 2;
    const r = ensamblar(rol, fx);
    assert.equal(r.meta.motivo_reintento, null, rol);
    assert.equal(r.meta.variante_prompt, rol, rol);
    assert.equal(r.meta.aviso_reintento, null, rol);
    assert.ok(!r.messages_iniciales[0].content.includes('## Reintento'), rol);
  }
});

test('el reintento ocupa presupuesto: con el peor caso se trunca, no se rebasa el techo', () => {
  const paquete = fixtureLocal('contexto-r1-techo');
  paquete.intento = 2;
  const sinReintento = ensamblar('documental', { ...paquete, intento: 0 });
  const r = ensamblar('documental', paquete, { motivo_reintento: 'cadena_incompleta' });

  assert.ok(r.meta.caracteres_paquete <= TECHO_CARACTERES.documental);
  assert.equal(r.truncado, true);
  assert.ok(
    r.meta.bloques_incluidos <= sinReintento.meta.bloques_incluidos,
    'el bloque de reintento debe competir por el presupuesto, no vivir fuera de él',
  );
  assert.ok(r.messages_iniciales[0].content.includes('## Reintento: intento 2'));
});

test('la variante combinada con fewshot se nombra sin ambigüedad', () => {
  const r = ensamblar('documental', paqueteDe('documental', 1), {
    fewshot: true, motivo_reintento: 'evidencia_invalida',
  });
  assert.equal(r.meta.variante_prompt, 'documental+fewshot+reintento:evidencia_invalida');
});

test('el manifest publica los ejes del reintento para que el runtime nombre la variante', () => {
  const manifest = leerManifest();
  assert.deepEqual(manifest.motivos_reintento, [...MOTIVOS_REINTENTO]);
  assert.deepEqual(manifest.roles_con_reintento, [...ROLES_CON_REINTENTO]);
  assert.equal(manifest.sufijo_variante_reintento, 'reintento:<motivo>');
  // La variante degradada se publica aparte y no contamina la lista de motivos.
  assert.equal(manifest.variante_reintento_sin_motivo, VARIANTE_REINTENTO_SIN_MOTIVO);
  assert.ok(!manifest.motivos_reintento.includes('sin_motivo'));
});
