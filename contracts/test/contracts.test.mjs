import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileContracts, contractNames, validateContract, schemaFingerprint } from '../index.mjs';

const root = new URL('../fixtures/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const fixture = file => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));

test('release coincide con schemas y catálogo de contratos', () => {
  const release = JSON.parse(fs.readFileSync(new URL('../release.json', import.meta.url), 'utf8'));
  assert.equal(release.schema_fingerprint_sha256, schemaFingerprint);
  assert.deepEqual(release.definitions, contractNames);
});

test('compila todos los contratos y referencias en modo estricto', () => {
  assert.equal(compileContracts(), contractNames.length);
  assert.match(schemaFingerprint, /^[a-f0-9]{64}$/);
});

for (const sample of manifest.samples) {
  test(`acepta ${sample.file} (${sample.schema}) sin mutar`, () => {
    const value = fixture(sample.file);
    const before = structuredClone(value);
    const result = validateContract(sample.schema, value);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(value, before);
  });
}
for (const sample of manifest.invalid) {
  test(`rechaza ${sample.file} (${sample.schema})`, () => {
    const value = fixture(sample.file);
    const before = structuredClone(value);
    assert.equal(validateContract(sample.schema, value).ok, false);
    assert.deepEqual(value, before);
  });
}

test('todos los roles tienen fixtures de salida y no existe prompt de Auditor Final', () => {
  for (const role of ['especialista', 'auditor', 'defensor', 'replica', 'redactor', 'editor']) {
    assert.ok(manifest.samples.some(s => s.schema === `agents.${role}`));
  }
  assert.ok(!contractNames.includes('agents.auditor_final'));
});

test('once herramientas y ninguna identidad elegida por el LLM', () => {
  assert.equal(contractNames.filter(n => n.startsWith('tools.forense_')).length, 11);
  assert.ok(!contractNames.includes('tools.forense_validar_evidencia'));
});

test('los tres casos de UI pertenecen a la misma corrida fixture', () => {
  const corrida = fixture('valid/corrida.json');
  assert.equal(corrida.modo, 'fixture');
  const levels = [];
  for (let i = 0; i < 3; i++) {
    const caso = fixture(`valid/caso-${i}.json`);
    assert.equal(caso.corrida_id, corrida.id);
    levels.push(caso.nivel);
  }
  assert.deepEqual(levels, ['presuncion', 'anomalia_explicada', 'no_concluyente']);
});

test('IDs de tarea, señal, evidencia, defensa y reporte enlazan', () => {
  const caso = fixture('valid/caso-0.json');
  const tarea = fixture('valid/tarea.json');
  const senal = fixture('valid/senal.json');
  const ev = fixture('valid/evidencia-validada.json');
  const defensa = fixture('valid/argumento.json');
  const reporte = fixture('valid/reporte.json');
  assert.equal(tarea.caso_id, caso.id);
  assert.equal(senal.tarea_id, tarea.id);
  assert.equal(senal.caso_id, caso.id);
  assert.equal(ev.caso_id, caso.id);
  assert.equal(ev.pista_id, senal.detalle.pista_id);
  assert.ok(defensa.evidencia_objetivo_ids.includes(ev.id));
  assert.equal(reporte.caso_id, caso.id);
});

test('reporte JSON conserva ocho encabezados y sus bloques de selección', () => {
  const reporte = fixture('valid/reporte.json');
  const headings = reporte.contenido_json.content.filter(n => n.type === 'heading');
  assert.equal(headings.length, 8);
  assert.equal(new Set(reporte.contenido_json.content.map(n => n.attrs.id)).size, 16);
  const request = fixture('valid/solicitud-edicion.json');
  for (const id of request.seleccion.block_ids) {
    assert.ok(reporte.contenido_json.content.some(n => n.attrs.id === id));
  }
});

test('fixture nunca habilita llamadas y correlaciona el aviso con su perfil', () => {
  assert.equal(manifest.external_calls_allowed, false);
  const profile = fixture('valid/perfil.json');
  const event = fixture('valid/evento-completa.json');
  const notification = fixture('valid/notificacion.json');
  assert.equal(profile.llamadas_activadas, false);
  assert.equal(profile.telefono_e164, null);
  assert.equal(event.perfil_id, profile.id);
  assert.equal(notification.event_id, event.event_id);
});

test('un nombre desconocido falla explícitamente', () => {
  assert.throws(() => validateContract('inventado', {}), /Contrato desconocido/);
});
