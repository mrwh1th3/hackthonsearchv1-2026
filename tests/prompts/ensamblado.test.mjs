// Ensamblado por rol: forma del resultado, bloques obligatorios del system y contrato de
// salida renderizado desde los schemas de contracts (no copiado a mano en el .md).
//
//   node --test "tests/prompts/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract, contractVersion } from '../../contracts/index.mjs';
import {
  ensamblar, ensamblarMapper, renderContratoCompacto, ErrorEnsamblado,
  ROLES_LLM, ROLES_ESPECIALISTA, ARCHIVO_POR_ROL, SCHEMA_SALIDA_POR_ROL,
  TECHO_CARACTERES, MODELO_PROPUESTO_POR_ROL,
} from '../../n8n/prompts/ensamblar.mjs';
import {
  CASOS_ROL, contextoEspecialista, fixtureContrato, fixtureLocal, leerArchivoPrompt,
  nodoDeContrato, contar,
} from './ayuda.mjs';

const COMUN = leerArchivoPrompt('comun.md');

test('los fixtures de contexto de contracts siguen siendo válidos (base de todo lo demás)', () => {
  for (const { fixture } of CASOS_ROL) {
    const r = validateContract('runtime.contexto', fixtureContrato(fixture));
    assert.equal(r.ok, true, `${fixture}: ${JSON.stringify(r.errors)}`);
  }
});

test('cada rol con fixture publicado ensambla y devuelve el contrato de salida esperado', () => {
  for (const { rol, fixture, ronda } of CASOS_ROL) {
    const paquete = fixtureContrato(fixture);
    const r = ensamblar(rol, paquete);

    assert.equal(typeof r.system, 'string', `${rol}: system`);
    assert.ok(r.system.length > 1000, `${rol}: system demasiado corto`);
    assert.equal(r.messages_iniciales.length, 1, `${rol}: un único mensaje inicial`);
    assert.equal(r.messages_iniciales[0].role, 'user');
    assert.ok(r.messages_iniciales[0].content.includes(paquete.objetivo), `${rol}: falta el objetivo`);
    assert.ok(Array.isArray(r.tools_permitidas), `${rol}: tools_permitidas`);
    assert.equal(r.schema_salida, SCHEMA_SALIDA_POR_ROL[rol], `${rol}: schema_salida`);
    assert.equal(r.meta.rol, rol);
    assert.equal(r.meta.ronda, ronda);
    assert.equal(r.meta.modelo_propuesto, MODELO_PROPUESTO_POR_ROL[rol]);
    assert.equal(r.truncado, false, `${rol}: el fixture chico no debe truncarse`);

    // El bloque común va siempre primero y el archivo del rol después (08 §Notas).
    assert.ok(r.system.startsWith(COMUN.trimEnd().slice(0, 120)), `${rol}: el bloque común no abre el system`);
    const propio = leerArchivoPrompt(ARCHIVO_POR_ROL[rol]);
    assert.ok(r.system.includes(propio.trimEnd().slice(0, 80)), `${rol}: falta el archivo del rol`);
    assert.ok(r.system.includes('## Contrato de salida'), `${rol}: falta el contrato de salida`);
    assert.ok(r.system.includes('## Herramientas permitidas en esta tarea'), `${rol}: falta la allowlist`);
    assert.ok(r.system.includes('## Identidad y límites'), `${rol}: falta identidad`);

    // Identidad y cuotas las fija el runner: deben viajar en el system, no en el mensaje.
    assert.ok(r.system.includes(`rol=${rol} ronda=${paquete.ronda}`), `${rol}: identidad incompleta`);
    assert.ok(r.system.includes(`corrida=${paquete.corrida_id}`), `${rol}: falta corrida`);
    assert.ok(r.system.includes(`fecha_corte=${paquete.fecha_corte}`), `${rol}: falta fecha_corte`);
    assert.ok(
      r.system.includes(`tools_restantes=${paquete.limites.tools_restantes}`),
      `${rol}: faltan los límites`,
    );
    assert.ok(
      r.messages_iniciales[0].content.includes(`context_hash=${paquete.context_hash}`),
      `${rol}: falta la trazabilidad del paquete`,
    );
  }
});

test('los cinco especialistas ensamblan con su propia familia de pistas', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const r = ensamblar(rol, contextoEspecialista(rol));
    assert.equal(r.schema_salida, 'agents.especialista');
    assert.ok(r.system.includes(leerArchivoPrompt(ARCHIVO_POR_ROL[rol]).trimEnd().slice(0, 60)), rol);
  }
  assert.equal(ROLES_ESPECIALISTA.length, 5);
});

test('ROLES_LLM cubre exactamente el enum common.rol de contracts', () => {
  const enumRol = nodoDeContrato('common.rol').enum;
  assert.deepEqual([...ROLES_LLM].sort(), [...enumRol].sort());
  // El mapper es de ingesta (19) y no está en common.rol: no se ensambla con runtime.contexto.
  assert.ok(!enumRol.includes('mapper'));
});

test('el contrato de salida se renderiza desde el schema JSON, no se copia en el .md', () => {
  for (const rol of ROLES_LLM) {
    const nombre = SCHEMA_SALIDA_POR_ROL[rol];
    const nodo = nodoDeContrato(nombre);
    const render = renderContratoCompacto(nombre);
    const requeridos = nodo.required ?? [];
    for (const campo of requeridos) {
      assert.ok(render.includes(`${campo} (requerido)`), `${rol}: el render omite ${campo}`);
    }
    for (const campo of Object.keys(nodo.properties ?? {})) {
      assert.ok(render.includes(`- ${campo} (`), `${rol}: el render omite la propiedad ${campo}`);
    }
    assert.ok(render.includes(nombre), `${rol}: el render no nombra el contrato`);

    // Y el archivo del rol NO enumera el contrato a mano: si lo hiciera, un cambio de
    // schema dejaría el prompt mintiendo. Se permite nombrar el contrato, no copiarlo.
    const md = leerArchivoPrompt(ARCHIVO_POR_ROL[rol]);
    const copiados = Object.keys(nodo.properties ?? {}).filter(c => md.includes(`- ${c} (requerido)`));
    assert.deepEqual(copiados, [], `${rol}: el .md copia campos del contrato`);
  }
});

test('el render del contrato traduce enums y uniones del schema (auditor, mapper, editor)', () => {
  // Enums que vienen de common.*: si contracts añade una tipología, el prompt la refleja
  // sin tocar ningún .md.
  const auditor = renderContratoCompacto('agents.auditor');
  const tipologias = nodoDeContrato('common.tipologia').enum;
  assert.ok(auditor.includes(`enum(${tipologias.join('|')})`), 'el enum de tipología no viaja al prompt');

  const mapper = renderContratoCompacto('ingesta.mapper');
  const codigos = nodoDeContrato('common.pista_codigo').enum;
  assert.ok(mapper.includes(`enum(${codigos.join('|')})`), 'el enum de códigos de pista no viaja al prompt');

  // El editor es un oneOf: el render enumera las dos formas, no una sola.
  const editor = renderContratoCompacto('agents.editor');
  assert.ok(editor.includes('Devuelve exactamente una de estas formas:'), 'el oneOf del editor no se rinde');
  assert.ok(editor.includes('- forma 1:') && editor.includes('- forma 2:'), 'faltan las formas del editor');
  assert.ok(/enum\([^)]*fragmento[^)]*\)/.test(editor), 'el enum de modo del editor no viaja al prompt');

  for (const render of [auditor, mapper, editor]) {
    assert.ok(render.includes('Sólo el JSON, sin texto alrededor.'));
  }
});

test('el contrato de salida no ofrece "definitivo" como nivel al modelo', () => {
  const niveles = nodoDeContrato('common.nivel').enum;
  assert.ok(!niveles.includes('definitivo'), 'contracts no debe tener el nivel definitivo');
  assert.equal(niveles[niveles.length - 1], 'presuncion_alta', 'el nivel máximo es presuncion_alta');
});

test('el mapper no se ensambla con runtime.contexto y sí con su perfil de ingesta (19)', () => {
  assert.throws(
    () => ensamblar('mapper', fixtureContrato('contexto-r1')),
    e => e instanceof ErrorEnsamblado && e.codigo === 'rol_sin_contexto_v1',
  );

  const r = ensamblarMapper(fixtureLocal('perfil-ingesta-inyeccion'));
  assert.equal(r.schema_salida, 'ingesta.mapper');
  assert.deepEqual(r.tools_permitidas, []);
  assert.equal(r.truncado, false);
  assert.ok(r.system.includes('Mapeador de ingesta'), 'falta el archivo del mapper');
  assert.ok(r.system.includes(COMUN.trimEnd().slice(0, 120)), 'el mapper también lleva el bloque común');
  assert.ok(r.meta.caracteres <= TECHO_CARACTERES.mapper);

  // El perfil entero viaja como dato no confiable, en un solo bloque marcado.
  const contenido = r.messages_iniciales[0].content;
  assert.equal(contar(contenido, '<<<DATO_NO_CONFIABLE'), 1);
  assert.equal(contar(contenido, '<<<FIN_DATO_NO_CONFIABLE>>>'), 1);
});

test('el mapper rechaza un perfil con filas crudas (la sanitización es previa y local, 19)', () => {
  const perfil = { ...fixtureLocal('perfil-ingesta-inyeccion'), filas_crudas: [['1', '2']] };
  assert.throws(
    () => ensamblarMapper(perfil),
    e => e instanceof ErrorEnsamblado && e.codigo === 'perfil_sin_sanitizar',
  );
});

test('el ensamblado es puro: mismo paquete → mismo resultado', () => {
  for (const { rol, fixture } of CASOS_ROL) {
    const a = ensamblar(rol, fixtureContrato(fixture));
    const b = ensamblar(rol, fixtureContrato(fixture));
    assert.equal(a.system, b.system, `${rol}: system no determinista`);
    assert.equal(a.messages_iniciales[0].content, b.messages_iniciales[0].content, `${rol}: mensaje no determinista`);
  }
});

test('un paquete cuyo rol no coincide con el pedido se rechaza', () => {
  assert.throws(
    () => ensamblar('auditor', fixtureContrato('contexto-r1')),
    e => e instanceof ErrorEnsamblado && e.codigo === 'rol_no_coincide',
  );
  assert.throws(
    () => ensamblar('inventado', fixtureContrato('contexto-r1')),
    e => e instanceof ErrorEnsamblado && e.codigo === 'rol_desconocido',
  );
  assert.throws(
    () => ensamblar('documental', null),
    e => e instanceof ErrorEnsamblado && e.codigo === 'contexto_invalido',
  );
});

test('un paquete que no cumple runtime.contexto se rechaza antes de llamar al modelo', () => {
  const roto = fixtureContrato('contexto-r1');
  roto.dataset_hash = 'no-es-un-sha256';
  assert.throws(
    () => ensamblar('documental', roto),
    e => e instanceof ErrorEnsamblado && e.codigo === 'contexto_invalido' && Array.isArray(e.detalles),
  );
});

test('el manifest de contratos que usa el ensamblador es el publicado por el coordinador', () => {
  // No se fija la versión a mano: si el coordinador publica 1.1.0, el test sigue vigente.
  assert.match(contractVersion, /^\d+\.\d+\.\d+$/);
});
