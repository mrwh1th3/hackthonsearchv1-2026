// n8n/tests/voz.test.mjs — interfaz del adaptador de voz (16).
//
// TODO SIMULADO. No hay llamada, ni credencial, ni número: la cuenta ElevenLabs
// tiene cero números salientes (21 §5). Esto prueba el CONTRATO del lado del
// runtime: qué se envía, qué nunca se envía, y que un callback sin verificador
// se rechaza en vez de aceptarse.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  construirLlamada, verificarFirma, estadoDesdeCallback,
  ESTADOS_LLAMADA, VARIABLES_PERMITIDAS, ErrorVoz,
} from '../runtime/voz-adaptador.mjs';

const base = {
  agent_id: 'agent_x',
  agent_phone_number_id: 'phone_x',
  to_number: '+525512345678',
};

test('[SIMULADO] el cuerpo de la llamada es el de 16 §3', () => {
  const cuerpo = construirLlamada({
    ...base,
    variables: {
      nombre_usuario: 'Víctor',
      referencia_corta: 'INV-2026-0007',
      ruta_reporte: 'Historial de investigaciones',
      completion_event_id: '5f1c0a1e-0000-4000-8000-000000000001',
    },
  });
  assert.equal(cuerpo.to_number, base.to_number);
  assert.deepEqual(
    Object.keys(cuerpo.conversation_initiation_client_data.dynamic_variables).sort(),
    [...VARIABLES_PERMITIDAS].sort(),
  );
});

test('[SIMULADO] el agente telefónico nunca recibe RFC, montos ni variables ajenas', () => {
  assert.throws(
    () => construirLlamada({ ...base, variables: { referencia_corta: 'AAA010101AAA' } }),
    (e) => e instanceof ErrorVoz && e.codigo === 'fuga_rfc',
  );
  assert.throws(
    () => construirLlamada({ ...base, variables: { referencia_corta: '$1,200,000 MXN' } }),
    (e) => e instanceof ErrorVoz && e.codigo === 'fuga_monto',
  );
  assert.throws(
    () => construirLlamada({ ...base, variables: { hipotesis: 'carrusel de facturas' } }),
    (e) => e instanceof ErrorVoz && e.codigo === 'variable_no_permitida',
  );
});

test('[SIMULADO] el teléfono debe venir del perfil en E.164', () => {
  assert.throws(
    () => construirLlamada({ ...base, to_number: '5512345678', variables: {} }),
    (e) => e.codigo === 'telefono_invalido',
  );
});

test('[SIMULADO] sin verificador instalado, el callback se RECHAZA (no se acepta a ciegas)', () => {
  // Firma dentro de la ventana: el rechazo NO es por la marca temporal.
  const r = verificarFirma({ crudo: '{"type":"completed"}', firma: 't=1757640000,v0=abc', ahora_ms: 1757640000_000 });
  assert.equal(r.valido, false);
  assert.equal(r.implementado, false);
  assert.equal(r.motivo, 'verificador_no_instalado');
  // Cuerpo reserializado (no crudo) o sin firma: también rechaza.
  assert.equal(verificarFirma({ crudo: { type: 'completed' }, firma: 'x' }).motivo, 'cuerpo_no_crudo');
  assert.equal(verificarFirma({ crudo: '{}', firma: null }).motivo, 'sin_firma');
  // Fuera de la ventana temporal.
  assert.equal(
    verificarFirma({ crudo: '{}', firma: 't=1000,v0=abc', ahora_ms: 10_000_000_000 }).motivo,
    'fuera_de_ventana',
  );
});

test('[SIMULADO] solo se mapean hechos recibidos: «finalizada» no es «aviso entregado»', () => {
  assert.deepEqual(estadoDesdeCallback({ type: 'completed' }), { estado: 'finalizada', aviso_entregado: false });
  assert.deepEqual(
    estadoDesdeCallback({ type: 'completed', analysis: { aviso_confirmado: true } }),
    { estado: 'finalizada', aviso_entregado: true },
  );
  assert.equal(estadoDesdeCallback({ type: 'no_answer' }).estado, 'sin_respuesta');
  // Un tipo desconocido no se inventa: queda como resultado desconocido.
  assert.equal(estadoDesdeCallback({ type: 'lo_que_sea' }).estado, 'resultado_desconocido');
  for (const e of ['finalizada', 'sin_respuesta', 'resultado_desconocido']) {
    assert.ok(ESTADOS_LLAMADA.includes(e));
  }
});
