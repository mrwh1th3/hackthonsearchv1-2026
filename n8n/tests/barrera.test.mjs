// n8n/tests/barrera.test.mjs — barrera de ronda y despertar dirigido (03, 07). SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearBarrera, esTerminalTarea, ESTADOS_TERMINALES_TAREA } from '../runtime/barrera.mjs';
import { calcularDespertados, conjuntoRonda2, evaluarFrontera, TABLA_DISPARO } from '../runtime/despertar.mjs';
import { UUID, AHORA, DEADLINE } from './_ayudas.mjs';

const fila = (id, estado, extra = {}) => ({ id, caso_id: UUID.caso, ronda: 1, intento: 0, estado, ...extra });

test('terminal es completada|error|timeout|omitida', () => {
  assert.deepEqual(ESTADOS_TERMINALES_TAREA, ['completada', 'error', 'timeout', 'omitida']);
  assert.equal(esTerminalTarea('en_proceso'), false);
  assert.equal(esTerminalTarea('omitida'), true);
});

test('una barrera de dos tareas no espera cinco', () => {
  const b = crearBarrera({ caso_id: UUID.caso, ronda: 1, tarea_ids: ['t1', 't2'], deadline_at: DEADLINE });
  const evaluacion = b.evaluar([fila('t1', 'completada'), fila('t2', 'omitida')], AHORA);
  assert.equal(evaluacion.completa, true);
  assert.deepEqual(evaluacion.faltantes, []);
  assert.equal(b.avanzar(evaluacion).avanza, true);
});

test('la barrera ignora filas ajenas al conjunto despachado', () => {
  const b = crearBarrera({ caso_id: UUID.caso, ronda: 1, tarea_ids: ['t1', 't2'], deadline_at: DEADLINE });
  const evaluacion = b.evaluar([
    fila('t1', 'completada'),
    fila('t9', 'completada'), // de otro cluster
    fila('t2', 'completada', { caso_id: 'otro-caso' }),
    fila('t2', 'completada', { ronda: 2 }),
  ], AHORA);
  assert.equal(evaluacion.ajenas_ignoradas, 3);
  assert.equal(evaluacion.completa, false);
  assert.deepEqual(evaluacion.faltantes, ['t2']);
});

test('error y timeout son terminales: la barrera pasa y lo registra como limitación', () => {
  const b = crearBarrera({ caso_id: UUID.caso, ronda: 1, tarea_ids: ['t1', 't2', 't3'], deadline_at: DEADLINE });
  const evaluacion = b.evaluar([fila('t1', 'completada'), fila('t2', 'error'), fila('t3', 'timeout')], AHORA);
  assert.equal(evaluacion.completa, true);
  assert.equal(evaluacion.terminales.length, 3);
});

test('la barrera vencida avanza con limitación explícita, no se cuelga', () => {
  const b = crearBarrera({ caso_id: UUID.caso, ronda: 1, tarea_ids: ['t1', 't2'], deadline_at: DEADLINE });
  const evaluacion = b.evaluar([fila('t1', 'completada')], Date.parse(DEADLINE) + 1);
  assert.equal(evaluacion.completa, false);
  assert.equal(evaluacion.vencida, true);
  const avance = b.avanzar(evaluacion);
  assert.equal(avance.avanza, true);
  assert.equal(avance.motivo, 'deadline_barrera');
  assert.equal(avance.limitaciones[0].codigo, 'cobertura_incompleta');
});

test('ausencia de despertados avanza una sola vez', () => {
  const b = crearBarrera({ caso_id: UUID.caso, ronda: 2, tarea_ids: [], deadline_at: DEADLINE });
  const evaluacion = b.evaluar([], AHORA);
  assert.equal(evaluacion.completa, true);
  assert.equal(b.avanzar(evaluacion).avanza, true);
  assert.equal(b.avanzar(evaluacion).avanza, false, 'dos callbacks no disparan dos auditores');
  assert.equal(b.avanzar(evaluacion).motivo, 'ya_avanzada');
});

test('la barrera no avanza mientras falten tareas', () => {
  const b = crearBarrera({ caso_id: UUID.caso, ronda: 1, tarea_ids: ['t1', 't2'], deadline_at: DEADLINE });
  const avance = b.avanzar(b.evaluar([fila('t1', 'completada')], AHORA));
  assert.equal(avance.avanza, false);
  assert.equal(avance.motivo, 'incompleta');
});

test('los titulares del snapshot son una línea por señal', () => {
  const b = crearBarrera({
    caso_id: UUID.caso, ronda: 1, tarea_ids: ['t1'], deadline_at: DEADLINE,
    snapshot_senales: [{ id: 601, familia: 'F', titular: 'Dispersa 93% en 3 días', detalle: { enorme: 'x'.repeat(5000) } }],
  });
  const titulares = b.titulares();
  assert.deepEqual(titulares, [{ id: '601', familia: 'F', titular: 'Dispersa 93% en 3 días' }]);
  assert.ok(!JSON.stringify(titulares).includes('enorme'), 'el detalle se pide con leer_senal, no viaja');
});

test('tabla de disparo de 03, literal', () => {
  assert.deepEqual(TABLA_DISPARO.R, ['documental', 'financiero']);
  assert.deepEqual(TABLA_DISPARO.F, ['documental', 'temporal']);
  assert.deepEqual(TABLA_DISPARO.D, ['financiero']);
  assert.deepEqual(TABLA_DISPARO.T, ['relacional']);
});

test('despertar dirigido: R despierta D y F', () => {
  const { despertados, saltar_ronda2 } = calcularDespertados([{ id: 1, familia: 'R' }]);
  assert.deepEqual(despertados, ['documental', 'financiero']);
  assert.equal(saltar_ronda2, false);
});

test('una señal con refuta:true despierta al emisor de la señal refutada', () => {
  const senales = [
    { id: 1, familia: 'D' },
    { id: 2, familia: 'F', refuta: true, refuta_senal_id: 1 },
  ];
  const { despertados, motivos } = calcularDespertados(senales);
  assert.ok(despertados.includes('documental'));
  assert.ok(motivos.documental.some((m) => m.startsWith('refuta:')));
  assert.ok(!despertados.includes('temporal'), 'la señal refutadora no aplica la tabla general');
});

test('E despierta a los especialistas evaluables afectados', () => {
  const { despertados } = calcularDespertados([{ id: 1, familia: 'E', familias_afectadas: ['D', 'R'] }]);
  assert.deepEqual(despertados, ['documental', 'relacional']);
});

test('las familias no evaluables no se despiertan', () => {
  const { despertados } = calcularDespertados([{ id: 1, familia: 'R' }], { familias_evaluables: ['R', 'D'] });
  assert.deepEqual(despertados, ['documental'], 'financiero no es evaluable en este dataset');
});

test('si nadie dispara a nadie, la ronda 2 se salta', () => {
  const { saltar_ronda2 } = calcularDespertados([]);
  assert.equal(saltar_ronda2, true);
  assert.equal(conjuntoRonda2({ despertados: [], por_expansion: [] }).saltar_ronda2, true);
});

test('frontera: ≥2 RFC nuevos con facturación relevante expanden e incrementan version_contexto', () => {
  const r = evaluarFrontera({
    senales: [{ id: 1, familia: 'F', frontera: ['DEMO:PF-221', 'DEMO:PF-222', 'DEMO:ENTIDAD-0'] }],
    rfcs_cluster: ['DEMO:ENTIDAD-0'],
    metricas_frontera: {
      'DEMO:PF-221': { facturacion_centavos: '500000' },
      'DEMO:PF-222': { facturacion_centavos: '900000' },
    },
    expansiones_previas: 0,
    version_contexto: 1,
  });
  assert.equal(r.expandir, true);
  assert.deepEqual(r.rfcs_nuevos, ['DEMO:PF-221', 'DEMO:PF-222']);
  assert.equal(r.version_contexto_nueva, 2);
});

test('máximo una expansión por cluster; después queda como limitación honesta', () => {
  const base = {
    senales: [{ id: 1, familia: 'F', frontera: ['DEMO:PF-221', 'DEMO:PF-222'] }],
    rfcs_cluster: ['DEMO:ENTIDAD-0'],
    metricas_frontera: { 'DEMO:PF-221': { relevante: true }, 'DEMO:PF-222': { relevante: true } },
    version_contexto: 2,
  };
  const r = evaluarFrontera({ ...base, expansiones_previas: 1 });
  assert.equal(r.expandir, false);
  assert.equal(r.motivo, 'cuota_expansion_agotada');
  assert.equal(r.version_contexto_nueva, 2);
  assert.match(r.limitaciones[0].descripcion, /continúa hacia 2 RFC/);
});

test('un solo RFC sin ruta material no justifica expansión, pero se declara', () => {
  const r = evaluarFrontera({
    senales: [{ id: 1, familia: 'F', frontera: ['DEMO:PF-221'] }],
    rfcs_cluster: ['DEMO:ENTIDAD-0'],
    metricas_frontera: { 'DEMO:PF-221': { relevante: true } },
    expansiones_previas: 0,
    version_contexto: 1,
  });
  assert.equal(r.expandir, false);
  assert.equal(r.motivo, 'frontera_no_significativa');
  assert.equal(r.limitaciones.length, 1);
});

test('una ruta material cortada por un solo RFC sí consume la cuota de expansión', () => {
  const r = evaluarFrontera({
    senales: [{ id: 1, familia: 'F', frontera: ['DEMO:PF-221'] }],
    rfcs_cluster: ['DEMO:ENTIDAD-0'],
    metricas_frontera: {},
    rutas_materiales_cortadas: ['DEMO:PF-221'],
    expansiones_previas: 0,
    version_contexto: 1,
  });
  assert.equal(r.expandir, true);
  assert.equal(r.motivo, 'ruta_material_cortada');
  assert.equal(r.version_contexto_nueva, 2);
});

test('el conjunto de ronda 2 une despertados y afectados por la expansión, sin duplicar', () => {
  const r = conjuntoRonda2({ despertados: ['documental', 'financiero'], por_expansion: ['financiero', 'relacional'] });
  assert.deepEqual(r.roles, ['documental', 'financiero', 'relacional']);
  assert.equal(r.saltar_ronda2, false);
});
