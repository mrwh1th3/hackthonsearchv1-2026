// n8n/tests/presupuesto.test.mjs — presupuesto con reserva real (03, 17 §6). SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearPresupuesto, CUOTA_TOOLS_TAREA, LIMITES_CASO, RESERVA_CIERRE_REQUESTS,
  RESERVA_CIERRE_TOOLS, TOTAL_RESERVA_CIERRE_REQUESTS, TOTAL_RESERVA_CIERRE_TOOLS,
} from '../runtime/presupuesto.mjs';
import { UUID } from './_ayudas.mjs';

test('los números son los de 03: 120/100, reserva 27/34 y cuotas por rol', () => {
  assert.deepEqual(LIMITES_CASO, { tools: 120, requests: 100 });
  assert.equal(TOTAL_RESERVA_CIERRE_TOOLS, 27);
  assert.equal(TOTAL_RESERVA_CIERRE_REQUESTS, 34);
  assert.deepEqual(RESERVA_CIERRE_TOOLS, { auditor: 12, defensor: 15 });
  assert.deepEqual(RESERVA_CIERRE_REQUESTS, { auditor: 13, defensor: 16, replica: 2, redactor: 3 });
  assert.equal(CUOTA_TOOLS_TAREA.documental[1], 8);
  assert.equal(CUOTA_TOOLS_TAREA.documental[2], 4);
  assert.equal(CUOTA_TOOLS_TAREA.temporal[1], 6);
  assert.equal(CUOTA_TOOLS_TAREA.temporal[2], 3);
  assert.equal(CUOTA_TOOLS_TAREA.externo[1], 4);
  assert.equal(CUOTA_TOOLS_TAREA.externo[2], 2);
});

test('la cuota por tarea del especialista se agota en su tope, no en el del caso', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  for (let i = 0; i < 8; i += 1) {
    assert.equal(p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: 't1' }).ok, true, `reserva ${i}`);
  }
  const novena = p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: 't1' });
  assert.equal(novena.ok, false);
  assert.equal(novena.error.codigo, 'presupuesto_agotado');
  // Otra tarea del mismo rol conserva su propia cuota.
  assert.equal(p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: 't2' }).ok, true);
});

test('la reserva de cierre queda intacta tras agotar la bolsa de investigación', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  let concedidas = 0;
  // 93 herramientas de investigación repartidas en tareas de 8.
  for (let tarea = 0; tarea < 20; tarea += 1) {
    for (let i = 0; i < 8; i += 1) {
      if (p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: `t${tarea}` }).ok) concedidas += 1;
    }
  }
  assert.equal(concedidas, LIMITES_CASO.tools - TOTAL_RESERVA_CIERRE_TOOLS, 'la investigación no puede pasar de 93');
  assert.equal(p.instantanea().tools.investigacion_restante, 0);
  for (let i = 0; i < 12; i += 1) {
    assert.equal(p.reservarTool({ rol: 'auditor', ronda: 1, tarea_id: 'aud' }).ok, true, `auditor ${i}`);
  }
  for (let i = 0; i < 15; i += 1) {
    assert.equal(p.reservarTool({ rol: 'defensor', ronda: 1, tarea_id: 'def' }).ok, true, `defensor ${i}`);
  }
  assert.equal(p.instantanea().tools.usadas, 120);
  assert.equal(p.reservarTool({ rol: 'auditor', ronda: 1, tarea_id: 'aud2' }).ok, false);
});

test('la reserva de requests de cierre sobrevive a una investigación que agota los 66', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  let concedidos = 0;
  for (let i = 0; i < 80; i += 1) if (p.reservarRequest({ rol: 'documental' }).ok) concedidos += 1;
  assert.equal(concedidos, LIMITES_CASO.requests - TOTAL_RESERVA_CIERRE_REQUESTS);
  assert.equal(p.reservarRequest({ rol: 'documental' }).ok, false);
  assert.equal(p.reservarRequest({ rol: 'redactor' }).ok, true, 'el Redactor conserva su reserva');
  assert.equal(p.reservarRequest({ rol: 'replica' }).ok, true, 'la Réplica conserva la suya');
});

test('un cache hit consume herramienta igual que una consulta nueva', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: 't1', cache_hit: true });
  const foto = p.instantanea();
  assert.equal(foto.tools.usadas, 1);
  assert.equal(foto.tools.cache_hits, 1);
});

test('una reparación consume request de la bolsa del rol, no de una bolsa aparte', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  const antes = p.instantanea().requests;
  p.reservarRequest({ rol: 'auditor', motivo: 'turno' });
  p.reservarRequest({ rol: 'auditor', motivo: 'reparacion' });
  const despues = p.instantanea().requests;
  assert.equal(despues.usados, antes.usados + 2);
  assert.equal(despues.reparaciones, 1);
  assert.equal(despues.cierre_restante.auditor, RESERVA_CIERRE_REQUESTS.auditor - 2);
});

test('entrar en reintento no concede 100 requests nuevos', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  for (let i = 0; i < 40; i += 1) p.reservarRequest({ rol: 'documental' });
  const antes = p.instantanea().requests.usados;
  const r1 = p.entrarReintento();
  assert.equal(r1.ok, true);
  assert.equal(r1.intento, 1);
  assert.equal(p.instantanea().requests.usados, antes, 'el contador no se reinicia');
  assert.equal(r1.requests_restantes, LIMITES_CASO.requests - antes);
  assert.equal(p.entrarReintento().ok, true);
  const tercero = p.entrarReintento();
  assert.equal(tercero.ok, false, 'máximo dos reintentos forenses');
  assert.equal(tercero.error.codigo, 'reintentos_agotados');
});

test('el presupuesto se rehidrata desde DB sin reiniciar contadores', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  for (let i = 0; i < 5; i += 1) p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: 't1' });
  p.reservarRequest({ rol: 'documental' });
  p.entrarReintento();
  const foto = p.instantanea();
  const q = crearPresupuesto({ caso_id: UUID.caso, consumido: foto });
  assert.deepEqual(q.instantanea(), foto);
});

test('limitesPara alimenta contexto.limites con saldo real', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  const inicial = p.limitesPara({ rol: 'documental', ronda: 1, tarea_id: 't1' });
  assert.equal(inicial.tools_restantes, 8);
  assert.equal(inicial.requests_restantes, 66);
  p.reservarTool({ rol: 'documental', ronda: 1, tarea_id: 't1' });
  assert.equal(p.limitesPara({ rol: 'documental', ronda: 1, tarea_id: 't1' }).tools_restantes, 7);
  assert.equal(p.limitesPara({ rol: 'redactor' }).tools_restantes, 0, 'roles sin tools llevan 0');
});

test('los roles sin herramientas no pueden reservarlas', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  for (const rol of ['replica', 'redactor', 'editor']) {
    const r = p.reservarTool({ rol, ronda: 1 });
    assert.equal(r.ok, false, rol);
  }
});

test('presupuesto_agotado se hace visible en la instantánea', () => {
  const p = crearPresupuesto({ caso_id: UUID.caso });
  for (let i = 0; i < 100; i += 1) p.reservarRequest({ rol: 'documental' });
  for (const rol of ['auditor', 'defensor', 'replica', 'redactor']) {
    for (let i = 0; i < 20; i += 1) p.reservarRequest({ rol });
  }
  assert.equal(p.instantanea().presupuesto_agotado, true);
  assert.equal(p.permiteReintento(), false);
});
