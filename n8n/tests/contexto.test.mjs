// n8n/tests/contexto.test.mjs — paquetes de contexto (17 §7). Todo SIMULADO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract } from '../../contracts/index.mjs';
import { construirContexto, acotarDatos, hashContexto, esEspecialistaR1 } from '../runtime/contexto.mjs';
import { TECHO_TOKENS_ENTRADA, TECHO_CARACTERES_PAQUETE } from '../runtime/config.mjs';
import { UUID, HASH, DEADLINE, coberturaSimulada, entradaContextoEspecialista, evidenciaValidadaSimulada, pistaSimulada } from './_ayudas.mjs';

test('R1 produce un envelope que valida contra runtime.contexto', () => {
  const r = construirContexto(entradaContextoEspecialista());
  assert.equal(r.ok, true, JSON.stringify(r.errores ?? []));
  assert.equal(validateContract('runtime.contexto', r.contexto).ok, true);
  assert.equal(r.contexto.schema_version, 'contexto.v1');
  // 22 campos exactos: el contrato no admite extras ni omisiones.
  assert.equal(Object.keys(r.contexto).length, 22);
});

test('R1 no recibe señales ajenas: titulares vacío, no ausente', () => {
  const entrada = entradaContextoEspecialista({
    datos: {
      rfcs: ['DEMO:ENTIDAD-0'],
      pistas: [pistaSimulada()],
      titulares: [{ id: '602', familia: 'F', titular: 'Titular de otra familia que NO debe llegar a R1' }],
    },
  });
  const r = construirContexto(entrada);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.contexto.datos.titulares), 'titulares es obligatorio en el contrato');
  assert.equal(r.contexto.datos.titulares.length, 0, 'R1 no puede ver titulares ajenos');
  assert.ok(!JSON.stringify(r.contexto).includes('NO debe llegar a R1'));
  assert.equal(esEspecialistaR1({ rol: 'documental', ronda: 1, intento: 0 }), true);
});

test('R1 solo ve pistas de su familia; las ajenas se declaran como limitación', () => {
  const entrada = entradaContextoEspecialista({
    datos: {
      rfcs: ['DEMO:ENTIDAD-0'],
      pistas: [pistaSimulada(), pistaSimulada({ id: '502', codigo: 'F1', familia: 'F' })],
      titulares: [],
    },
  });
  const r = construirContexto(entrada);
  assert.equal(r.ok, true);
  assert.equal(r.contexto.datos.pistas.length, 1);
  assert.equal(r.contexto.datos.pistas[0].familia, 'D');
  assert.equal(r.contexto.cobertura.completa, false);
  assert.ok(r.limitaciones.some((l) => l.codigo === 'cobertura_incompleta'));
});

test('R2 sí recibe titulares del snapshot de barrera', () => {
  const entrada = entradaContextoEspecialista({
    ronda: 2,
    datos: {
      rfcs: ['DEMO:ENTIDAD-0'],
      pistas: [pistaSimulada()],
      titulares: [{ id: '602', familia: 'F', titular: 'Dispersa 93% a personas físicas en 3 días' }],
    },
  });
  const r = construirContexto(entrada);
  assert.equal(r.ok, true);
  assert.equal(r.contexto.datos.titulares.length, 1);
  assert.equal(r.contexto.datos.titulares[0].familia, 'F');
});

test('Redactor solo recibe hechos validados y sin hipótesis libre', () => {
  const entrada = {
    ...entradaContextoEspecialista(),
    rol: 'redactor',
    limites: { tools_restantes: 0, requests_restantes: 3, deadline_at: DEADLINE, input_tokens_max: 24000 },
    datos: {
      senal_ids: ['601'],
      evidencia: [
        evidenciaValidadaSimulada(),
        evidenciaValidadaSimulada({ id: '702', validada: false, refutada: true }),
      ],
      argumentos: [],
      resoluciones: [],
      hipotesis: 'Hipótesis libre que el Redactor no debe recibir',
      // El dictamen determinista sí viaja (lo calcula código, no el LLM).
      dictamen: {
        nivel: 'presuncion', familias: ['D', 'F'], monto_en_riesgo_centavos: '100000',
        moneda: 'MXN', regla: '2 familia(s) sustentadas: D, F → presuncion', limitaciones: [],
      },
      version_base: null,
      documento: null,
      seleccion: null,
      limitaciones: [],
    },
  };
  const r = construirContexto(entrada);
  assert.equal(r.ok, true, JSON.stringify(r.errores ?? []));
  assert.equal(r.contexto.datos.evidencia.length, 1);
  assert.equal(r.contexto.datos.evidencia[0].validada, true);
  assert.equal(r.contexto.datos.hipotesis, null);
  assert.deepEqual(r.contexto.datos.senal_ids, []);
  assert.ok(!JSON.stringify(r.contexto).includes('Hipótesis libre'));
  assert.equal(r.contexto.datos.dictamen.nivel, 'presuncion');
  assert.equal(r.contexto.limites.tools_restantes, 0, 'el Redactor no usa herramientas');
});

test('Defensor no recibe el dictamen como conclusión consumada', () => {
  const entrada = {
    ...entradaContextoEspecialista(),
    rol: 'defensor',
    limites: { tools_restantes: 15, requests_restantes: 16, deadline_at: DEADLINE, input_tokens_max: 16000 },
    datos: {
      senal_ids: ['601'],
      evidencia: [evidenciaValidadaSimulada()],
      argumentos: [],
      resoluciones: [],
      hipotesis: 'Hipótesis candidata simulada.',
      dictamen: {
        nivel: 'presuncion', familias: ['D', 'F'], monto_en_riesgo_centavos: '100000',
        moneda: 'MXN', regla: 'fixture', limitaciones: [],
      },
      version_base: null, documento: null, seleccion: null, limitaciones: [],
    },
  };
  const r = construirContexto(entrada);
  assert.equal(r.ok, true, JSON.stringify(r.errores ?? []));
  assert.equal(r.contexto.datos.dictamen, null);
});

test('techos: tokens 8k/16k/24k y caracteres 12k/24k son distintos y ambos se aplican', () => {
  assert.equal(TECHO_TOKENS_ENTRADA.documental, 8000);
  assert.equal(TECHO_TOKENS_ENTRADA.auditor, 16000);
  assert.equal(TECHO_TOKENS_ENTRADA.redactor, 24000);
  assert.equal(TECHO_CARACTERES_PAQUETE.documental, 12000);
  assert.equal(TECHO_CARACTERES_PAQUETE.auditor, 24000);
});

test('el techo de caracteres recorta filas completas, nunca JSON a la mitad', () => {
  const titulares = Array.from({ length: 80 }, (_, i) => ({
    id: String(700 + i), familia: 'F', titular: `Titular simulado número ${i} `.padEnd(200, 'x'),
  }));
  const { datos, recortes, cabe } = acotarDatos({ rfcs: ['DEMO:ENTIDAD-0'], pistas: [pistaSimulada()], titulares }, 12000);
  assert.equal(cabe, true);
  assert.ok(recortes.length > 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(datos)));
  assert.ok(datos.titulares.length < 80);
});

test('un contexto que no cabe ni recortando se rechaza con motivo, no se trunca', () => {
  // El documento base del Editor no es una fila sacrificable: si excede el
  // techo, el paso termina con limitación en vez de fingir que lo leyó entero.
  const entrada = {
    ...entradaContextoEspecialista(),
    rol: 'editor',
    tarea_id: null,
    editor_operacion_id: UUID.contexto,
    limites: { tools_restantes: 0, requests_restantes: 3, deadline_at: DEADLINE, input_tokens_max: 24000 },
    datos: {
      senal_ids: [], evidencia: [], argumentos: [], resoluciones: [], hipotesis: null,
      dictamen: null, version_base: 1, seleccion: null, limitaciones: [],
      documento: {
        type: 'doc',
        content: Array.from({ length: 400 }, (_, i) => ({
          type: 'paragraph',
          attrs: { id: `b${i}` },
          content: [{ type: 'text', text: `Párrafo simulado ${i} `.padEnd(120, 'x') }],
        })),
      },
    },
  };
  const r = construirContexto(entrada);
  assert.equal(r.ok, false);
  assert.equal(r.error.codigo, 'contexto_invalido');
});

test('context_hash depende del contenido y no de sí mismo', () => {
  const a = construirContexto(entradaContextoEspecialista()).contexto;
  const b = construirContexto(entradaContextoEspecialista({ objetivo: 'Otro objetivo simulado.' })).contexto;
  assert.match(a.context_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(a.context_hash, b.context_hash);
  assert.equal(hashContexto({ ...a, context_hash: 'x' }), a.context_hash);
});

test('el objetivo se acota a 2400 caracteres en vez de romper el contrato', () => {
  const r = construirContexto(entradaContextoEspecialista({ objetivo: 'z'.repeat(5000) }));
  assert.equal(r.ok, true);
  assert.equal(r.contexto.objetivo.length, 2400);
});

test('el contexto no crece con el dataset: 5 o 500 RFC producen el mismo tamaño de paquete', () => {
  // El constructor recibe el RESUMEN del cluster (≤40 RFC), no el dataset. Un
  // dataset mayor no cambia el envelope porque las herramientas alcanzan los
  // datos en vez de cargarlos.
  const pequeno = construirContexto(entradaContextoEspecialista());
  const grande = construirContexto(entradaContextoEspecialista({
    cobertura: coberturaSimulada({ datos_ausentes: [] }),
  }));
  assert.equal(pequeno.caracteres, grande.caracteres);
  assert.ok(pequeno.caracteres < TECHO_CARACTERES_PAQUETE.documental);
});

test('los IDs de identidad los impone el backend, no el paquete de datos', () => {
  const r = construirContexto(entradaContextoEspecialista());
  assert.equal(r.contexto.caso_id, UUID.caso);
  assert.equal(r.contexto.corrida_id, UUID.corrida);
  assert.equal(r.contexto.dataset_hash, HASH);
  assert.equal(r.contexto.prompt_hash, HASH);
});
