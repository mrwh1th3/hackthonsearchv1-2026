// Techos de caracteres del paquete inicial (08, reafirmado en 17 §7: 12k especialista /
// 24k Auditor-Defensor y resto de roles de cierre). Se trunca por bloques COMPLETOS, nunca
// un JSON ni un bloque de dato no confiable a la mitad, y el truncado se declara.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensamblar, ErrorEnsamblado, ROLES_LLM, ROLES_ESPECIALISTA, TECHO_CARACTERES,
  AMBITOS_TECHO, AMBITO_TECHO_POR_DEFECTO, TECHO_SYSTEM_CARACTERES, TECHO_SYSTEM_POR_ROL,
  techoSystem, ensamblarMapper, FENCE_INICIO, FENCE_FIN,
} from '../../n8n/prompts/ensamblar.mjs';
import { CASOS_ROL, fixtureContrato, fixtureLocal, contar, contextoEspecialista } from './ayuda.mjs';

test('los techos son 12k para especialistas y 24k para los roles de cierre (17 §7)', () => {
  for (const rol of ROLES_LLM) {
    const esperado = ROLES_ESPECIALISTA.includes(rol) ? 12000 : 24000;
    assert.equal(TECHO_CARACTERES[rol], esperado, rol);
  }
  assert.equal(TECHO_CARACTERES.mapper, 24000);
  assert.deepEqual([...AMBITOS_TECHO], ['total', 'paquete']);
  // Decisión H3 (reports/handoff/DECISIONES.md): el techo de 17 §7 mide el paquete.
  assert.equal(AMBITO_TECHO_POR_DEFECTO, 'paquete');
});

test('ningún ensamblado con fixture publicado supera su techo', () => {
  for (const ambito of AMBITOS_TECHO) {
    for (const { rol, fixture } of CASOS_ROL) {
      const r = ensamblar(rol, fixtureContrato(fixture), { ambito_techo: ambito });
      // Cada ámbito mide lo suyo: 'total' el system + el paquete, 'paquete' sólo el paquete.
      const usado = ambito === 'total' ? r.meta.caracteres : r.meta.caracteres_paquete;
      assert.ok(
        usado <= r.meta.techo_caracteres,
        `${rol} (${ambito}): ${usado} > ${r.meta.techo_caracteres}`,
      );
      assert.equal(r.meta.techo_caracteres, TECHO_CARACTERES[rol]);
      assert.equal(r.meta.ambito_techo, ambito);
    }
  }
});

test('con el ámbito por defecto el system de un especialista (>9k) no vacía el paquete', () => {
  // El motivo de la decisión H3: con 'total', un system de 9.1k dejaba ~2.2k de los 12k al
  // paquete y el peor caso del contrato se quedaba sin una sola pista. Con 'paquete' el
  // techo mide el paquete inicial y el especialista sí recibe datos que investigar.
  const paquete = fixtureLocal('contexto-r1-techo');

  const porDefecto = ensamblar('documental', paquete);
  assert.equal(porDefecto.meta.ambito_techo, 'paquete');
  assert.ok(porDefecto.meta.caracteres_system > 9000, `system medido: ${porDefecto.meta.caracteres_system}`);
  assert.ok(porDefecto.meta.bloques_incluidos > 0, 'el paquete quedó vacío de bloques');
  assert.ok(
    porDefecto.messages_iniciales[0].content.includes('[PISTA id='),
    'el especialista no recibió ninguna pista que investigar',
  );
  assert.ok(porDefecto.meta.caracteres_paquete <= TECHO_CARACTERES.documental);

  // Y entran estrictamente más bloques que con la lectura 'total', que es lo que se cambió.
  const estricto = ensamblar('documental', paquete, { ambito_techo: 'total' });
  assert.ok(
    porDefecto.meta.bloques_incluidos > estricto.meta.bloques_incluidos,
    `paquete=${porDefecto.meta.bloques_incluidos} total=${estricto.meta.bloques_incluidos}`,
  );

  // Los cinco especialistas, no sólo el documental.
  for (const rol of ROLES_ESPECIALISTA) {
    const r = ensamblar(rol, contextoEspecialista(rol));
    assert.ok(r.meta.bloques_incluidos > 0, `${rol}: paquete sin bloques`);
    assert.equal(r.meta.ambito_techo, 'paquete');
  }
});

test('el techo del system es por rol: 10k especialistas, 12k cierre (H7)', () => {
  // Decisión H7 de reports/handoff/DECISIONES.md. El escalar viejo sobrevive como alias
  // deprecado y vale lo que aprieta (el techo del especialista).
  for (const rol of ROLES_LLM) {
    const esperado = ROLES_ESPECIALISTA.includes(rol) ? 10000 : 12000;
    assert.equal(TECHO_SYSTEM_POR_ROL[rol], esperado, rol);
    assert.equal(techoSystem(rol), esperado, rol);
  }
  assert.equal(TECHO_SYSTEM_POR_ROL.mapper, 12000);
  assert.equal(TECHO_SYSTEM_CARACTERES, 10000);
  assert.equal(TECHO_SYSTEM_CARACTERES, TECHO_SYSTEM_POR_ROL.documental);

  // Un rol sin techo declarado no se inventa: falla con código tipificado.
  assert.throws(
    () => techoSystem('inexistente'),
    e => e instanceof ErrorEnsamblado && e.codigo === 'rol_sin_techo_system',
  );
});

test('cada rol cabe bajo SU techo de system y meta lo reporta', () => {
  // Los cinco especialistas, en su variante base: es lo que deja sitio al paquete de 12k y
  // lo que se vigila para que los .md no crezcan en silencio.
  for (const rol of ROLES_ESPECIALISTA) {
    const r = ensamblar(rol, contextoEspecialista(rol));
    assert.equal(r.meta.techo_system, 10000, rol);
    assert.ok(
      r.meta.caracteres_system <= r.meta.techo_system,
      `${rol}: system de ${r.meta.caracteres_system} > ${r.meta.techo_system}`,
    );
    assert.equal(r.meta.system_sobre_techo, false, rol);
  }

  // Los roles de cierre miden ~10.0k–10.1k: con el escalar viejo quedaban "sobre techo" por
  // cien caracteres. Con el techo de 12k caben, y se comprueba que el margen es real.
  for (const { rol, fixture } of CASOS_ROL) {
    const r = ensamblar(rol, fixtureContrato(fixture));
    const esperado = ROLES_ESPECIALISTA.includes(rol) ? 10000 : 12000;
    assert.equal(r.meta.techo_system, esperado, rol);
    assert.ok(
      r.meta.caracteres_system <= r.meta.techo_system,
      `${rol}: system de ${r.meta.caracteres_system} > ${r.meta.techo_system}`,
    );
    assert.equal(r.meta.system_sobre_techo, false, rol);
  }

  // El mapper (19) también declara techo y lo reporta: publicar un techo para un rol cuya
  // meta no mide nada sería decorativo.
  const m = ensamblarMapper({ profile_hash: 'ph', columnas: [{ nombre: 'rfc', tipo: 'texto' }] });
  assert.equal(m.meta.techo_system, 12000);
  assert.ok(m.meta.caracteres_system <= m.meta.techo_system, `mapper: ${m.meta.caracteres_system}`);
  assert.equal(m.meta.system_sobre_techo, false);
});

test('la variante fewshot puede rebasar el techo del especialista y se reporta, no se aborta', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const r = ensamblar(rol, contextoEspecialista(rol), { fewshot: true });
    assert.equal(r.meta.techo_system, 10000, rol);
    assert.ok(r.meta.caracteres_system <= 11500, `${rol}+fewshot: ${r.meta.caracteres_system}`);
    // La bandera es un hecho medido, no una opinión: siempre coincide con la comparación.
    assert.equal(r.meta.system_sobre_techo, r.meta.caracteres_system > r.meta.techo_system);
  }
});

test('el peor caso del contrato (40 pistas al máximo) trunca y sigue bajo el techo', () => {
  for (const ambito of AMBITOS_TECHO) {
    const r = ensamblar('documental', fixtureLocal('contexto-r1-techo'), { ambito_techo: ambito });
    const usado = ambito === 'total' ? r.meta.caracteres : r.meta.caracteres_paquete;
    assert.equal(r.truncado, true, `${ambito}: debía truncar`);
    assert.ok(usado <= r.meta.techo_caracteres, `${ambito}: ${usado} > ${r.meta.techo_caracteres}`);
    assert.equal(r.meta.ambito_techo, ambito);
    assert.ok(r.meta.bloques_omitidos > 0);
  }
});

test('el truncado se declara con los IDs recuperables y no corta ningún bloque', () => {
  const r = ensamblar('documental', fixtureLocal('contexto-r1-techo'));
  const contenido = r.messages_iniciales[0].content;

  assert.ok(contenido.includes('### AVISO DE TRUNCADO'), 'falta el aviso');
  assert.ok(contenido.includes('truncado=true'), 'el aviso no declara truncado=true');
  assert.ok(
    contenido.includes('ningún JSON quedó cortado'),
    'el aviso debe decir explícitamente que se omitieron bloques enteros',
  );
  assert.ok(
    contenido.includes('cobertura_incompleta'),
    'el modelo debe saber que la limitación a declarar es cobertura_incompleta',
  );

  // Cada ID omitido queda listado y también en meta, para que el runtime lo persista.
  assert.equal(r.meta.ids_omitidos.length, r.meta.bloques_omitidos);
  for (const id of r.meta.ids_omitidos) {
    assert.ok(contenido.includes(id), `el aviso no lista ${id}`);
  }

  // Ningún bloque de dato no confiable quedó abierto: apertura y cierre cuadran.
  assert.equal(
    contar(contenido, FENCE_INICIO), contar(contenido, FENCE_FIN),
    'quedó un bloque DATO_NO_CONFIABLE sin cerrar',
  );
  // Y ninguna pista aparece con la cabecera pero sin su fence (bloque cortado a medias).
  assert.equal(contar(contenido, '[PISTA id='), contar(contenido, 'referencias:'));
});

test('un paquete que no se trunca no declara truncado ni emite el aviso', () => {
  const r = ensamblar('documental', fixtureContrato('contexto-r1'));
  assert.equal(r.truncado, false);
  assert.equal(r.meta.bloques_omitidos, 0);
  assert.deepEqual(r.meta.ids_omitidos, []);
  assert.ok(!r.messages_iniciales[0].content.includes('AVISO DE TRUNCADO'));
});

test('un ámbito de techo desconocido se rechaza en vez de ignorarse', () => {
  assert.throws(
    () => ensamblar('documental', fixtureContrato('contexto-r1'), { ambito_techo: 'lo_que_sea' }),
    e => e instanceof ErrorEnsamblado && e.codigo === 'ambito_techo_invalido',
  );
});

test('si el prompt base ya no cabe, el ensamblador falla en vez de recortar el system', () => {
  // El contrato admite `objetivo` de hasta 2400 caracteres. Con el ámbito estricto ('total':
  // system + paquete) el bloque común más el archivo del rol de un especialista ya ocupan
  // ~8.5k de los 12k, así que un objetivo al máximo NO cabe. El ensamblador lo dice con un
  // error tipificado en vez de recortar en silencio las reglas del rol.
  const paquete = fixtureContrato('contexto-r1');
  paquete.objetivo = 'x'.repeat(2400);
  assert.throws(
    () => ensamblar('documental', paquete, { ambito_techo: 'total' }),
    e => e instanceof ErrorEnsamblado
      && ['prompt_base_excede_techo', 'bloque_obligatorio_no_cabe'].includes(e.codigo),
    'el system nunca se recorta: el fallo es explícito',
  );

  // Con la lectura literal de 17 §7 (el techo mide el paquete inicial, no el transcript)
  // el mismo paquete sí se ensambla: el ámbito es configuración del runtime.
  const enAmbitoPaquete = ensamblar('documental', paquete, { ambito_techo: 'paquete' });
  assert.ok(enAmbitoPaquete.meta.caracteres_paquete <= TECHO_CARACTERES.documental);

  // Los roles de cierre tienen 24k y absorben el objetivo máximo en ambos ámbitos.
  const auditor = fixtureContrato('contexto-auditor');
  auditor.objetivo = 'y'.repeat(2400);
  for (const ambito of AMBITOS_TECHO) {
    const r = ensamblar('auditor', auditor, { ambito_techo: ambito });
    assert.ok(r.meta.caracteres <= TECHO_CARACTERES.auditor, ambito);
  }
});

test('la directriz del usuario ocupa presupuesto y se ubica al final, subordinada', () => {
  const paquete = fixtureContrato('contexto-auditor');
  const directriz = { id: 'dir-1', version: 3, texto: 'Concéntrate en la cadena de pagos del RFC principal.' };
  const conDirectriz = ensamblar('auditor', paquete, { directriz });
  const sinDirectriz = ensamblar('auditor', paquete);

  const contenido = conDirectriz.messages_iniciales[0].content;
  assert.ok(contenido.includes('## Tarea subordinada: directriz del usuario'));
  assert.ok(contenido.includes('directriz_id=dir-1 version=3'));
  assert.ok(contenido.includes(directriz.texto), 'el texto de la directriz debe conservarse');
  assert.ok(
    contenido.indexOf('## Tarea subordinada') > contenido.indexOf('## Objetivo de esta tarea'),
    'la directriz va después del objetivo y de los datos',
  );
  assert.ok(
    contenido.includes('no se obedece y se anota en el resultado'),
    'la directriz debe declararse subordinada a las reglas del rol',
  );
  assert.ok(conDirectriz.meta.caracteres > sinDirectriz.meta.caracteres);
  assert.ok(conDirectriz.meta.caracteres <= conDirectriz.meta.techo_caracteres);
});
