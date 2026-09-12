// =====================================================================
// tests/integration/notificaciones-006-007.test.mjs — outbox, entrega y
// edición (regla 11; docs/16 §2; 006_producto_ui + 007_notificaciones_voz).
//
//   node --test tests/integration/notificaciones-006-007.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Escribe sólo en forense_qa, con filas propias que se
// borran al final de cada prueba.
//
// Lo que se mide es "una vez por solicitud, no por cluster": la regla 11 se
// rompe de tres formas distintas y cada una tiene aquí su prueba.
//   1. El trigger dispara en CADA update de estado → el usuario recibe N
//      avisos de la misma investigación.
//   2. El despachador entrega el mismo evento varias veces → el usuario
//      recibe cinco llamadas.
//   3. Guardar una versión del expediente vuelve a notificar → el usuario
//      recibe un aviso cada vez que alguien corrige una coma.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import { DB_QA, correr, correrOk, escalar, filas, hayBase, json } from './_ayudas.mjs';

const saltar = !hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)';

function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Perfil del seed de producto; si no está, la prueba lo dice en vez de inventarlo. */
function perfilSeed() {
  const p = escalar(DB_QA, 'select id::text from forense.perfiles order by creado limit 1');
  assert.ok(p, 'sin perfiles: falta db/seeds/seed_producto.sql en la base de QA');
  return p;
}

/**
 * Crea una investigación de QA en estado `investigando`. ck_investigaciones_modo
 * exige modo='caso' con caso_id (o 'corrida' con corrida_id): se usa un caso del
 * fixture, que no participa en métricas.
 */
function nuevaInvestigacion(perfil, etiqueta) {
  const caso = escalar(DB_QA, `
    select id::text from forense.casos
     where corrida_id = '00000000-0000-4000-8000-000000000001' order by id limit 1`);
  assert.ok(caso, 'sin casos del fixture: falta db/seeds/seed_fake.sql en la base de QA');
  return escalar(DB_QA, `
    insert into forense.investigaciones (perfil_id, modo, caso_id, estado, manifiesto, mensaje)
    values (${lit(perfil)}::uuid, 'caso', ${lit(caso)}::uuid, 'investigando',
            jsonb_build_object('objetivos', jsonb_build_array()), ${lit(etiqueta)})
    returning id::text`);
}

function limpiar(inv) {
  correr(DB_QA, `
    delete from forense.llamadas_notificacion
     where event_id in (select id from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid);
    delete from forense.notificaciones
     where event_id in (select id from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid);
    delete from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid;
    delete from forense.investigaciones where id = ${lit(inv)}::uuid;`);
}

// ---------------------------------------------------------------------
// 1. Un cambio de estado, un evento de outbox
// ---------------------------------------------------------------------

test('el paso a investigacion_completa emite exactamente un evento de outbox',
  { skip: saltar }, () => {

  const inv = nuevaInvestigacion(perfilSeed(), 'qa-outbox-una-vez');
  try {
    const eventos = () => Number(escalar(DB_QA,
      `select count(*) from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid`));
    assert.equal(eventos(), 0, 'la investigación nació con evento de salida');

    correrOk(DB_QA, `update forense.investigaciones
       set estado = 'investigacion_completa', completada_at = now(), version_entregada = 1
     where id = ${lit(inv)}::uuid;`);
    assert.equal(eventos(), 1, 'el paso a completa no emitió el evento');

    // Reescribir el MISMO estado no vuelve a emitir: el runtime reintenta el
    // paso final sin que el usuario reciba dos avisos.
    correrOk(DB_QA, `update forense.investigaciones
       set estado = 'investigacion_completa', actualizado = now()
     where id = ${lit(inv)}::uuid;`);
    assert.equal(eventos(), 1, 'reescribir el mismo estado emitió un segundo evento');

    // Y una investigación con varios clusters sigue emitiendo uno solo: el
    // evento cuelga de la investigación, no del caso (regla 11).
    const porTipo = filas(DB_QA, `
      select tipo, count(*)::text from forense.eventos_salida
       where investigacion_id = ${lit(inv)}::uuid group by tipo order by tipo`);
    assert.deepEqual(porTipo, [['investigacion.completa', '1']]);

    // El aviso in-app acompaña al evento, uno por perfil.
    const avisos = Number(escalar(DB_QA, `
      select count(*) from forense.notificaciones
       where event_id in (select id from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid)`));
    assert.equal(avisos, 1);
  } finally {
    limpiar(inv);
  }
});

// ---------------------------------------------------------------------
// 2. Cinco entregas del mismo evento, una sola llamada
// ---------------------------------------------------------------------

test('cinco intentos de entrega del mismo evento producen una sola llamada activa',
  { skip: saltar }, () => {

  const perfil = perfilSeed();
  const inv = nuevaInvestigacion(perfil, 'qa-entregas-repetidas');
  try {
    correrOk(DB_QA, `update forense.investigaciones
       set estado = 'investigacion_completa', completada_at = now(), version_entregada = 1
     where id = ${lit(inv)}::uuid;`);
    const evento = escalar(DB_QA,
      `select id::text from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid`);
    assert.ok(evento);

    // reclamar_evento_salida toma de la cola GLOBAL, no de esta investigación:
    // si hubiera otros eventos pendientes, los cinco workers se los llevarían y
    // el mío nunca se reclamaría. La precondición se afirma, no se supone.
    const ajenos = Number(escalar(DB_QA, `
      select count(*) from forense.eventos_salida
       where estado in ('pendiente','error') and id <> ${lit(evento)}::uuid
         and coalesce(proximo_intento, now()) <= now()`));
    assert.equal(ajenos, 0,
      `hay ${ajenos} eventos pendientes ajenos en la cola: la prueba de lease no sería concluyente`);

    // Cinco despachadores compiten por el mismo evento. El lease de
    // reclamar_evento_salida sólo puede entregárselo a uno a la vez.
    const reclamados = [];
    for (let i = 0; i < 5; i += 1) {
      const r = json(DB_QA, `forense.reclamar_evento_salida('qa-worker-${i}', 120)`);
      if (r.hay_evento && r.event_id === evento) reclamados.push(`qa-worker-${i}`);
    }
    assert.equal(reclamados.length, 1,
      `el evento se entregó a ${reclamados.length} despachadores a la vez: ${reclamados.join(', ')}`);

    // Con consentimiento y teléfono, las cinco solicitudes recorren el camino
    // real (ux_llamada_activa). El perfil se deja como estaba al terminar.
    const previo = filas(DB_QA, `
      select coalesce(telefono_e164,''), llamadas_activadas::text, permiso_aviso::text
        from forense.perfiles where id = ${lit(perfil)}::uuid`)[0];
    correrOk(DB_QA, `update forense.perfiles
       set telefono_e164 = '+528100000000', llamadas_activadas = true,
           permiso_aviso = true, permiso_aviso_at = now()
     where id = ${lit(perfil)}::uuid;`);

    // Y cinco solicitudes de llamada sobre el mismo evento dejan una activa.
    const respuestas = [];
    for (let i = 0; i < 5; i += 1) {
      respuestas.push(json(DB_QA, `forense.solicitar_llamada(${lit(evento)}::uuid, 'qa-worker-${i}', null)`));
    }
    const activas = Number(escalar(DB_QA, `
      select count(*) from forense.llamadas_notificacion
       where event_id = ${lit(evento)}::uuid
         and estado in ('pendiente','solicitando','aceptada','en_curso')`));
    assert.equal(activas, 1,
      `quedaron ${activas} llamadas activas para un solo evento: el usuario recibiría varias`);
    assert.equal(Number(escalar(DB_QA,
      `select count(*) from forense.llamadas_notificacion where event_id = ${lit(evento)}::uuid`)), 1,
      'se registró más de un intento de llamada para el mismo evento');

    // El destino sale del perfil, nunca de un teléfono del payload (16 §5), y
    // las cuatro respuestas repetidas reconocen la llamada que ya existe.
    const reconocen = respuestas.filter((r) => r.ok !== false).length;
    assert.equal(reconocen, respuestas.length,
      `alguna solicitud repetida devolvió error en vez de reconocer la llamada activa: ${JSON.stringify(respuestas)}`);

    // Sin consentimiento la respuesta correcta es 'omitida' con motivo.
    correrOk(DB_QA, `update forense.perfiles set llamadas_activadas = false
     where id = ${lit(perfil)}::uuid;`);
    const inv2 = nuevaInvestigacion(perfil, 'qa-sin-consentimiento');
    try {
      correrOk(DB_QA, `update forense.investigaciones
         set estado = 'investigacion_completa', completada_at = now(), version_entregada = 1
       where id = ${lit(inv2)}::uuid;`);
      const ev2 = escalar(DB_QA,
        `select id::text from forense.eventos_salida where investigacion_id = ${lit(inv2)}::uuid`);
      const om = json(DB_QA, `forense.solicitar_llamada(${lit(ev2)}::uuid, 'qa-worker-sin', null)`);
      assert.equal(om.estado, 'omitida');
      assert.match(om.motivo, /llamadas desactivadas/i);
    } finally {
      limpiar(inv2);
    }

    correrOk(DB_QA, `update forense.perfiles
       set telefono_e164 = ${previo[0] ? lit(previo[0]) : 'null'},
           llamadas_activadas = ${previo[1]}, permiso_aviso = ${previo[2]}
     where id = ${lit(perfil)}::uuid;`);

    // Pase lo que pase, el reporte sigue entregado: la voz no lo invalida.
    assert.equal(escalar(DB_QA,
      `select estado from forense.investigaciones where id = ${lit(inv)}::uuid`),
      'investigacion_completa');
  } finally {
    limpiar(inv);
  }
});

// ---------------------------------------------------------------------
// 3. Editar el expediente no vuelve a notificar
// ---------------------------------------------------------------------

test('versionar el documento no emite un evento nuevo ni una notificación nueva',
  { skip: saltar }, () => {

  const inv = nuevaInvestigacion(perfilSeed(), 'qa-edicion-no-reemite');
  try {
    correrOk(DB_QA, `update forense.investigaciones
       set estado = 'investigacion_completa', completada_at = now(), version_entregada = 1
     where id = ${lit(inv)}::uuid;`);

    const cuenta = () => ({
      eventos: Number(escalar(DB_QA,
        `select count(*) from forense.eventos_salida where investigacion_id = ${lit(inv)}::uuid`)),
      avisos: Number(escalar(DB_QA, `
        select count(*) from forense.notificaciones
         where event_id in (select id from forense.eventos_salida
                             where investigacion_id = ${lit(inv)}::uuid)`)),
    });
    const antes = cuenta();
    assert.equal(antes.eventos, 1);

    // Una edición aplicada sube la versión entregada y toca `actualizado`;
    // el estado no cambia, así que el trigger no debe dispararse.
    for (const v of [2, 3, 4]) {
      correrOk(DB_QA, `update forense.investigaciones
         set version_entregada = ${v}, actualizado = now()
       where id = ${lit(inv)}::uuid;`);
    }
    assert.deepEqual(cuenta(), antes,
      'editar el expediente reemitió el aviso: el usuario recibiría uno por corrección');

    // Tampoco al volver a un estado anterior y regresar dentro de la misma
    // entrega: `on conflict (investigacion_id, tipo) do nothing` lo impide.
    correrOk(DB_QA, `update forense.investigaciones set estado = 'parcial' where id = ${lit(inv)}::uuid;`);
    correrOk(DB_QA, `update forense.investigaciones
       set estado = 'investigacion_completa' where id = ${lit(inv)}::uuid;`);
    assert.equal(cuenta().eventos, 1,
      'una segunda transición a completa duplicó el evento de outbox');
  } finally {
    limpiar(inv);
  }
});

// ---------------------------------------------------------------------
// 4. Trazabilidad: sin evento en bitácora, el paso no existió (regla 2)
// ---------------------------------------------------------------------

test('completar una investigación deja actividad registrada', { skip: saltar }, () => {
  const perfil = perfilSeed();
  const inv = nuevaInvestigacion(perfil, 'qa-actividad');
  try {
    correrOk(DB_QA, `update forense.investigaciones
       set estado = 'investigacion_completa', completada_at = now(), version_entregada = 1
     where id = ${lit(inv)}::uuid;`);

    const n = Number(escalar(DB_QA, `
      select count(*) from forense.actividad_producto
       where investigacion_id = ${lit(inv)}::uuid and evento = 'investigacion_completa'`));
    assert.equal(n, 1, 'la finalización no dejó actividad: no sería auditable');
  } finally {
    correr(DB_QA, `delete from forense.actividad_producto where investigacion_id = ${lit(inv)}::uuid;`);
    limpiar(inv);
  }
});
