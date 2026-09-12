// Allowlist de herramientas por rol, contrastada contra los documentos normativos:
//  - 06 §"Las 11 herramientas" y §"Herramientas de sistema (no las llama el LLM)";
//  - 03 §"Los cinco especialistas" (columna "Herramientas principales").
//
// Las tablas se parsean del documento: si alguien añade una RPC en 06 sin reflejarla aquí,
// el test lo dice. Las dos columnas no son equivalentes (03 lista las "principales" y omite
// `escribir_senal`/`leer_senal`, que el ensamblador añade por ronda), así que se comprueba
// inclusión, no igualdad.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  toolsPorRol, TOOLS_DE_SISTEMA, ROLES_LLM, ROLES_ESPECIALISTA,
} from '../../n8n/prompts/ensamblar.mjs';
import { ensamblar } from '../../n8n/prompts/ensamblar.mjs';
import { RAIZ, CASOS_ROL, fixtureContrato, contextoEspecialista } from './ayuda.mjs';

const DOC_06 = fs.readFileSync(path.join(RAIZ, '06-rpc-herramientas.md'), 'utf8');
const DOC_03 = fs.readFileSync(path.join(RAIZ, '03-arquitectura-agentica.md'), 'utf8');

/** Nombres `forense_*` de la primera columna de una tabla markdown, entre dos encabezados. */
function rpcsDeSeccion(doc, encabezado, siguiente) {
  const desde = doc.indexOf(encabezado);
  assert.notEqual(desde, -1, `no se encontró "${encabezado}" en el documento`);
  const hasta = siguiente ? doc.indexOf(siguiente, desde + 1) : doc.length;
  const trozo = doc.slice(desde, hasta === -1 ? doc.length : hasta);
  const nombres = new Set();
  for (const linea of trozo.split('\n')) {
    // La tabla de sistema escribe la firma completa (`forense_validar_evidencia(p_caso)`).
    const m = /^\|\s*`(forense_[a-z_]+)\b/.exec(linea.trim());
    if (m) nombres.add(m[1]);
  }
  return nombres;
}

const RPCS_06 = rpcsDeSeccion(DOC_06, '### Las 11 herramientas', '### Herramientas de sistema');
const SISTEMA_06 = rpcsDeSeccion(DOC_06, '### Herramientas de sistema', '### Reglas de diseño');

/** Columna "Herramientas principales" de la tabla de especialistas de 03. */
function principalesDe03() {
  const desde = DOC_03.indexOf('## Los cinco especialistas');
  assert.notEqual(desde, -1);
  const trozo = DOC_03.slice(desde, DOC_03.indexOf('## ', desde + 5));
  const filas = {};
  const nombrePorEtiqueta = {
    Documental: 'documental', Financiero: 'financiero', Relacional: 'relacional',
    Temporal: 'temporal', Externo: 'externo',
  };
  for (const linea of trozo.split('\n')) {
    const m = /^\|\s*\*\*([A-Za-zá-ú]+)\*\*\s*\|([^|]*)\|([^|]*)\|/.exec(linea.trim());
    if (!m) continue;
    const rol = nombrePorEtiqueta[m[1]];
    if (!rol) continue;
    filas[rol] = [...m[3].matchAll(/`([a-z_]+)`/g)].map(x => `forense_${x[1]}`);
  }
  return filas;
}

const PRINCIPALES_03 = principalesDe03();

test('las tablas normativas se parsearon completas (si no, el resto no prueba nada)', () => {
  assert.equal(RPCS_06.size, 11, `06 debía listar 11 herramientas y se parsearon ${RPCS_06.size}`);
  assert.equal(SISTEMA_06.size, 3, `06 debía listar 3 herramientas de sistema, se parsearon ${SISTEMA_06.size}`);
  assert.deepEqual(Object.keys(PRINCIPALES_03).sort(), [...ROLES_ESPECIALISTA].sort());
  for (const [rol, tools] of Object.entries(PRINCIPALES_03)) {
    assert.ok(tools.length >= 2, `${rol}: la fila de 03 se parseó vacía`);
  }
});

test('toda herramienta de una allowlist existe en la tabla de 11 RPC de 06', () => {
  for (const rol of [...ROLES_LLM, 'mapper']) {
    for (const ronda of [1, 2]) {
      for (const tool of toolsPorRol(rol, ronda)) {
        assert.ok(RPCS_06.has(tool), `${rol} r${ronda}: ${tool} no está en la tabla de 06`);
      }
    }
  }
});

test('ninguna herramienta de sistema aparece en ninguna allowlist (06: no las llama el LLM)', () => {
  assert.deepEqual([...TOOLS_DE_SISTEMA].sort(), [...SISTEMA_06].sort());
  for (const rol of [...ROLES_LLM, 'mapper']) {
    for (const ronda of [1, 2]) {
      const allowlist = toolsPorRol(rol, ronda);
      for (const sistema of SISTEMA_06) {
        assert.ok(!allowlist.includes(sistema), `${rol} r${ronda}: expone la herramienta de sistema ${sistema}`);
      }
    }
  }
});

test('cada especialista incluye sus herramientas principales de 03', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const allowlist = toolsPorRol(rol, 1);
    for (const tool of PRINCIPALES_03[rol]) {
      assert.ok(allowlist.includes(tool), `${rol}: falta ${tool} (03 la marca como principal)`);
    }
  }
});

test('los especialistas escriben señal siempre y sólo leen señales ajenas en ronda 2', () => {
  for (const rol of ROLES_ESPECIALISTA) {
    const r1 = toolsPorRol(rol, 1);
    const r2 = toolsPorRol(rol, 2);
    assert.ok(r1.includes('forense_escribir_senal'), `${rol}: 08 regla 8 exige escribir_senal`);
    assert.ok(!r1.includes('forense_leer_senal'), `${rol}: leer_senal está denegada en ronda 1`);
    assert.ok(r2.includes('forense_leer_senal'), `${rol}: ronda 2 sí lee señales`);
    assert.deepEqual(r2.filter(t => !r1.includes(t)), ['forense_leer_senal']);
  }
});

test('Réplica, Redactor y Editor no tienen herramientas', () => {
  for (const rol of ['replica', 'redactor', 'editor']) {
    assert.deepEqual(toolsPorRol(rol, 1), []);
    assert.deepEqual(toolsPorRol(rol, 2), []);
  }
  assert.deepEqual(toolsPorRol('mapper', 1), [], 'el mapper de ingesta tampoco toca la base');
});

test('Auditor y Defensor no escriben señales; el Defensor tampoco registra evidencia', () => {
  for (const rol of ['auditor', 'defensor']) {
    assert.ok(!toolsPorRol(rol, 1).includes('forense_escribir_senal'), rol);
    assert.ok(toolsPorRol(rol, 1).includes('forense_leer_senal'), `${rol}: lee el detalle de señales de su caso`);
  }
  assert.ok(toolsPorRol('auditor', 1).includes('forense_registrar_evidencia'));
  // El Defensor argumenta; no aporta piezas al expediente (06 §11 herramientas).
  assert.ok(!toolsPorRol('defensor', 1).includes('forense_registrar_evidencia'));
});

test('registrar_evidencia la tienen el Auditor y los cinco especialistas (06, decisión H3)', () => {
  // 06 §"Las 11 herramientas" asigna `forense_registrar_evidencia` a «auditor, especialistas»;
  // 03 sólo lista las "principales" de cada familia y por eso no la menciona.
  const fila = DOC_06.split('\n').find(l => l.includes('`forense_registrar_evidencia`'));
  assert.ok(fila, '06 ya no lista forense_registrar_evidencia');
  assert.ok(/auditor/.test(fila) && /especialistas/.test(fila), `06 cambió el ACL: ${fila}`);

  for (const rol of [...ROLES_ESPECIALISTA, 'auditor']) {
    for (const ronda of [1, 2]) {
      assert.ok(
        toolsPorRol(rol, ronda).includes('forense_registrar_evidencia'),
        `${rol} r${ronda}: falta forense_registrar_evidencia`,
      );
    }
  }
  for (const rol of ['defensor', 'replica', 'redactor', 'editor', 'mapper']) {
    assert.ok(!toolsPorRol(rol, 1).includes('forense_registrar_evidencia'), rol);
  }

  // Registrar no es validar: ningún prompt de especialista puede sugerir que él valida.
  // `forense_validar_evidencia` es herramienta de sistema y sigue fuera de toda allowlist.
  for (const rol of ROLES_ESPECIALISTA) {
    const r = ensamblar(rol, contextoEspecialista(rol));
    assert.ok(r.system.includes('- forense_registrar_evidencia'), `${rol}: no la ofrece en el system`);
    assert.ok(!r.tools_permitidas.includes('forense_validar_evidencia'), rol);
    assert.ok(
      /Registrar no es validar/.test(r.system),
      `${rol}: el system debe decir que registrar no es validar (regla 4)`,
    );
  }
});

test('la allowlist del system coincide exactamente con tools_permitidas', () => {
  for (const { rol, fixture } of CASOS_ROL) {
    const r = ensamblar(rol, fixtureContrato(fixture));
    assert.deepEqual(r.tools_permitidas, toolsPorRol(rol, fixtureContrato(fixture).ronda), rol);
    if (r.tools_permitidas.length === 0) {
      assert.ok(r.system.includes('Ninguna. No tienes herramientas'), `${rol}: debe decir que no tiene herramientas`);
    }
    for (const tool of r.tools_permitidas) {
      assert.ok(r.system.includes(`- ${tool}`), `${rol}: ${tool} no aparece en el system`);
    }
    // Ninguna herramienta no autorizada se menciona como disponible en la allowlist.
    const seccion = r.system.split('## Herramientas permitidas en esta tarea')[1];
    for (const tool of RPCS_06) {
      if (!r.tools_permitidas.includes(tool)) {
        assert.ok(!seccion.includes(`- ${tool}`), `${rol}: ofrece ${tool} sin tenerla autorizada`);
      }
    }
    assert.ok(seccion.includes('queda en bitácora'), `${rol}: el intento denegado debe dejar rastro (regla 2)`);
  }
});

test('el especialista sólo ve en su system las herramientas de su familia', () => {
  const vistos = new Map();
  for (const rol of ROLES_ESPECIALISTA) {
    const r = ensamblar(rol, contextoEspecialista(rol));
    vistos.set(rol, r.tools_permitidas);
  }
  assert.ok(!vistos.get('externo').includes('forense_facturas'), 'E no pagina facturas (03)');
  assert.ok(!vistos.get('documental').includes('forense_seguir_dinero'), 'D no sigue dinero (03)');
  assert.ok(!vistos.get('financiero').includes('forense_ciclos'), 'F no recorre ciclos (03)');
  assert.ok(!vistos.get('relacional').includes('forense_conciliar'), 'R no concilia pagos (03)');
});
