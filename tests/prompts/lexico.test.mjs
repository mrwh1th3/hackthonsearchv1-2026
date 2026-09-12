// Léxico obligatorio de los prompts (CLAUDE.md regla 7 y regla 4).
//
// "definitivo" NO es un nivel de este sistema: es el estatus que publica la autoridad en la
// lista 69-B. La palabra puede aparecer —el especialista externo tiene que reconocer ese
// estatus— pero sólo atada al 69-B/SAT/autoridad, nunca como conclusión ni como nivel.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES_LLM, SCHEMA_SALIDA_POR_ROL, ARCHIVO_POR_ROL, ensamblar, ensamblarMapper,
} from '../../n8n/prompts/ensamblar.mjs';
import {
  archivosPrompt, leerArchivoPrompt, nodoDeContrato, CASOS_ROL, fixtureContrato,
  fixtureLocal, contextoEspecialista, plano,
} from './ayuda.mjs';

const NIVELES = nodoDeContrato('common.nivel').enum;
// La regla 5 del bloque común prohíbe la palabra y explica al final de la regla de dónde
// viene: la ventana tiene que abarcar la regla completa.
const VENTANA = 400; // caracteres a cada lado de la ocurrencia
const ANCLAS = ['69-B', '69 B', 'SAT', 'autoridad', 'no es un nivel'];

test('ningún prompt usa "definitivo" como nivel o conclusión del sistema', () => {
  const sospechosas = [];
  for (const archivo of archivosPrompt()) {
    const texto = plano(leerArchivoPrompt(archivo));
    const rx = /definitiv[oa]s?/gi;
    let m;
    while ((m = rx.exec(texto)) !== null) {
      const ctx = texto.slice(Math.max(0, m.index - VENTANA), m.index + VENTANA);
      if (!ANCLAS.some(a => ctx.includes(a))) {
        sospechosas.push(`${archivo}: "...${ctx.slice(VENTANA - 60, VENTANA + 60)}..."`);
      }
    }
  }
  assert.deepEqual(
    sospechosas, [],
    'cada mención de "definitivo" debe estar atada al estatus 69-B de la autoridad',
  );
});

test('ningún prompt ofrece "definitivo" como valor de un campo de salida', () => {
  for (const archivo of archivosPrompt()) {
    const texto = leerArchivoPrompt(archivo);
    for (const patron of ['nivel: definitivo', 'nivel definitivo', 'nivel="definitivo"', '"nivel": "definitivo"', '| definitivo |']) {
      assert.ok(!texto.toLowerCase().includes(patron), `${archivo}: aparece "${patron}"`);
    }
    // Y nunca dentro de un ejemplo de salida JSON.
    for (const bloque of texto.split('```json').slice(1).map(b => b.split('```')[0])) {
      assert.ok(!/definitiv/i.test(bloque), `${archivo}: el ejemplo JSON contiene "definitivo"`);
    }
  }
  // `definitivo` sí puede citarse como estatus: el externo lo necesita.
  assert.ok(leerArchivoPrompt('esp-externo.md').includes('`definitivo`'));
});

test('el bloque común enumera exactamente los niveles del contrato y dice quién los calcula', () => {
  const comun = plano(leerArchivoPrompt('comun.md'));
  for (const nivel of NIVELES) {
    assert.ok(comun.includes(`\`${nivel}\``), `el bloque común no enumera ${nivel}`);
  }
  assert.ok(
    comun.includes('los calcula código determinista, no tú'),
    'el bloque común debe decir que el nivel no lo decide el modelo (regla 4)',
  );
  assert.equal(NIVELES.includes('definitivo'), false);
});

test('el nivel máximo que puede aparecer en los prompts es presuncion_alta', () => {
  for (const archivo of archivosPrompt()) {
    const texto = leerArchivoPrompt(archivo);
    assert.ok(!/nivel\s+m[áa]ximo[^.]*definitiv/i.test(texto), `${archivo}`);
  }
  assert.equal(NIVELES[NIVELES.length - 1], 'presuncion_alta');
});

test('el Redactor tiene las diez secciones fijas, con Trayectoria y Cadena de explicación (21 §4)', () => {
  const redactor = plano(leerArchivoPrompt('redactor.md'));
  const secciones = [
    'Resumen', 'Contribuyente', 'Hipótesis', 'Pistas', 'Evidencia',
    'Análisis del Defensor', 'Dictamen', 'Anexo', 'Trayectoria', 'Cadena de explicación',
  ];
  secciones.forEach((seccion, i) => {
    assert.ok(redactor.includes(`${i + 1}. **${seccion}**`), `falta la sección ${i + 1} ${seccion}`);
  });

  // La Trayectoria se redacta desde la serie recibida; si no llega, se dice, no se inventa.
  assert.ok(
    redactor.includes('Serie de trayectoria no disponible en el paquete recibido.'),
    'falta la frase exacta para cuando el paquete no trae la serie',
  );
  assert.ok(redactor.includes('No la reconstruyas de memoria'), 'la serie no se estima');

  // La cadena de explicación son cinco pasos citados (21 §4).
  for (const paso of ['qué cambió o qué pista disparó', 'a dónde fue el dinero']) {
    assert.ok(redactor.includes(paso), `falta el paso "${paso}"`);
  }
  assert.ok(redactor.includes('sin evidencia'), 'cada paso cita un ID o declara "sin evidencia"');
});

test('el Redactor sólo escribe hechos validados y el nivel que recibió', () => {
  const redactor = plano(leerArchivoPrompt('redactor.md'));
  assert.ok(redactor.includes('NO recibes la hipótesis libre del Auditor'));
  assert.ok(redactor.includes('Si algo no está en lo que recibiste, **no existe**'));
  assert.ok(redactor.includes('No lo traduzcas, no lo suavices y no lo subas'));
});

test('el Editor no puede eliminar Defensor, Trayectoria ni Cadena de explicación (21 §4)', () => {
  const editor = plano(leerArchivoPrompt('editor.md'));
  assert.ok(
    editor.includes('No eliminas la sección "Análisis del Defensor", la "Trayectoria" ni la "Cadena de explicación"'),
    'el Editor debe tener prohibido borrar las secciones fijas',
  );
  assert.ok(editor.includes('No cambias el nivel del dictamen, ni los montos, ni los IDs existentes'));
  assert.ok(editor.includes('**Propones**'), 'el Editor propone; versionar es del backend');
});

test('cada archivo de rol trae objetivo, contraejemplos y ejemplo pequeño (17 §8)', () => {
  for (const rol of [...ROLES_LLM, 'mapper']) {
    const texto = leerArchivoPrompt(ARCHIVO_POR_ROL[rol]);
    assert.ok(/(^|\n)(##\s+Objetivo|\*\*Objetivo)/.test(texto), `${rol}: falta Objetivo`);
    assert.ok(/##\s+Contraejemplos?/.test(texto), `${rol}: faltan contraejemplos`);
    assert.ok(texto.includes('```json'), `${rol}: falta el ejemplo pequeño en JSON`);
  }
});

test('el system que recibe cada rol trae cuándo parar, contradatos y su contrato (17 §8)', () => {
  // Varias de estas secciones viven en el bloque común y no se repiten por rol: lo que se
  // comprueba es lo que llega al modelo, no cómo está repartido entre archivos.
  const systems = new Map(CASOS_ROL.map(({ rol, fixture }) => [rol, ensamblar(rol, fixtureContrato(fixture)).system]));
  systems.set('mapper', ensamblarMapper(fixtureLocal('perfil-ingesta-inyeccion')).system);
  for (const rol of ['financiero', 'relacional', 'temporal', 'externo']) {
    systems.set(rol, ensamblar(rol, contextoEspecialista(rol)).system);
  }
  assert.equal(systems.size, [...new Set([...ROLES_LLM, 'mapper'])].length);

  for (const [rol, system] of systems) {
    const texto = plano(system);
    assert.ok(/[Cc]uándo parar/.test(texto), `${rol}: el system no dice cuándo parar`);
    assert.ok(/[Cc]ontradato/.test(texto), `${rol}: el system no exige buscar contradatos`);
    assert.ok(
      texto.includes(SCHEMA_SALIDA_POR_ROL[rol]),
      `${rol}: el system no nombra su contrato ${SCHEMA_SALIDA_POR_ROL[rol]}`,
    );
    assert.ok(texto.includes('Sólo el JSON, sin texto alrededor.'), `${rol}: falta el formato final estricto`);
  }
});

test('los ejemplos pequeños de los prompts usan fuentes sintéticas marcadas (17 §8)', () => {
  // Todos los .md de la carpeta, no sólo los de rol: los ejemplos adversariales también.
  for (const archivo of archivosPrompt()) {
    const texto = leerArchivoPrompt(archivo);
    const bloques = texto.split('```json').slice(1).map(b => b.split('```')[0]);
    for (const bloque of bloques) {
      const rfcs = [...bloque.matchAll(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/g)].map(m => m[0]);
      assert.deepEqual(rfcs, [], `${archivo}: el ejemplo trae un RFC con forma real`);
    }
    if (bloques.some(b => b.includes('ENTIDAD'))) {
      assert.ok(texto.includes('DEMO:'), `${archivo}: las entidades de ejemplo deben ir con prefijo DEMO:`);
    }
  }
});

test('los prompts no prometen calcular montos ni niveles dentro del modelo (regla 4)', () => {
  for (const { rol, fixture } of CASOS_ROL) {
    const system = plano(ensamblar(rol, fixtureContrato(fixture)).system);
    assert.ok(
      system.includes('los calcula código determinista, no tú'),
      `${rol}: el system no recuerda que el nivel es determinista`,
    );
  }
});
