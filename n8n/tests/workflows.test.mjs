// n8n/tests/workflows.test.mjs — forma de los JSON de n8n/workflows.
//
// LO QUE ESTO PRUEBA: que el archivo exportado es estructuralmente coherente y
// no lleva secretos ni IDs inventados.
// LO QUE NO PRUEBA: que n8n lo importe, que los typeVersion existan en la
// instancia, que la SQL referenciada exista, ni nada de conectividad. Eso es el
// smoke del coordinador (17 §9: «el mock no acredita conectividad»).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIPOS_PERMITIDOS, CREDENCIALES, generar } from '../runtime/generar-workflows.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(RAIZ, 'workflows');

const NOMBRES_CREDENCIAL = new Set(
  Object.values(CREDENCIALES).flatMap((c) => Object.values(c).map((v) => v.name)),
);

const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const cargar = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

test('hay JSON exportados que revisar', () => {
  assert.ok(archivos.length >= 2, `se esperaban al menos 2 workflows, hay ${archivos.length}`);
});

test('los JSON no tienen deriva respecto del generador', () => {
  const informe = generar({ check: true });
  const deriva = informe.filter((r) => !r.igual).map((r) => path.basename(r.destino));
  assert.deepEqual(deriva, [], 'regenera con node n8n/runtime/generar-workflows.mjs');
});

for (const archivo of archivos) {
  const wf = cargar(archivo);

  test(`${archivo}: forma mínima de importación e inactivo`, () => {
    assert.equal(typeof wf.name, 'string');
    assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
    assert.equal(typeof wf.connections, 'object');
    assert.equal(wf.active, false, 'ningún workflow se activa antes del smoke (17 §2)');
    assert.equal(wf.settings.executionOrder, 'v1', '07 depende del orden v1');
    // IDs y revisiones las regenera n8n al importar: inventarlas colisiona.
    for (const clave of ['id', 'versionId', 'meta', 'pinData', 'staticData']) {
      assert.equal(clave in wf, false, `${clave} no debe exportarse`);
    }
  });

  test(`${archivo}: nombres de nodo únicos`, () => {
    const nombres = wf.nodes.map((n) => n.name);
    assert.deepEqual([...new Set(nombres)].length, nombres.length, 'hay nombres repetidos');
    assert.ok(nombres.every((n) => typeof n === 'string' && n.length > 0));
  });

  test(`${archivo}: las conexiones referencian nombres de nodo existentes`, () => {
    const nombres = new Set(wf.nodes.map((n) => n.name));
    for (const [origen, salidas] of Object.entries(wf.connections)) {
      assert.ok(nombres.has(origen), `clave de conexión "${origen}" no es un nodo (¿se usó un id?)`);
      for (const rama of salidas.main) {
        for (const destino of rama) {
          assert.ok(nombres.has(destino.node), `destino "${destino.node}" no existe`);
          assert.equal(destino.type, 'main');
          assert.equal(Number.isInteger(destino.index), true);
        }
      }
    }
  });

  test(`${archivo}: todo nodo salvo los triggers y notas es alcanzable`, () => {
    const alcanzados = new Set();
    for (const salidas of Object.values(wf.connections)) {
      for (const rama of salidas.main) for (const d of rama) alcanzados.add(d.node);
    }
    const huerfanos = wf.nodes
      .filter((n) => !alcanzados.has(n.name))
      .filter((n) => !/Trigger|trigger|webhook|stickyNote/.test(n.type))
      .map((n) => n.name);
    assert.deepEqual(huerfanos, [], 'nodos sin entrada que no son triggers ni notas');
  });

  test(`${archivo}: solo tipos y typeVersion de la tabla verificada`, () => {
    for (const n of wf.nodes) {
      assert.ok(n.type in TIPOS_PERMITIDOS, `tipo no permitido: ${n.type}`);
      assert.equal(n.typeVersion, TIPOS_PERMITIDOS[n.type], `${n.name}: typeVersion fuera de la tabla`);
      assert.ok(Array.isArray(n.position) && n.position.length === 2);
    }
  });

  test(`${archivo}: no hay nodos AI Agent ni $fromAI`, () => {
    const texto = JSON.stringify(wf);
    assert.equal(/n8n-nodes-langchain/.test(texto), false, '17 §5 sustituye el nodo AI Agent');
    assert.equal(/\$fromAI/.test(texto), false, 'los argumentos salen de tool_use parseado, no de $fromAI');
  });

  test(`${archivo}: credenciales por nombre, nunca por id`, () => {
    for (const n of wf.nodes) {
      if (!n.credentials) continue;
      for (const [tipo, cred] of Object.entries(n.credentials)) {
        assert.equal('id' in cred, false, `${n.name}/${tipo}: no se exportan IDs de credencial`);
        assert.ok(NOMBRES_CREDENCIAL.has(cred.name), `${n.name}/${tipo}: credencial desconocida "${cred.name}"`);
      }
    }
  });

  test(`${archivo}: ningún secreto embebido`, () => {
    const texto = JSON.stringify(wf);
    for (const patron of [/sk-ant-[A-Za-z0-9]/, /service_role\s*[:=]\s*["'][A-Za-z0-9]/, /eyJ[A-Za-z0-9_-]{10,}\./]) {
      assert.equal(patron.test(texto), false, `patrón de secreto encontrado: ${patron}`);
    }
    for (const n of wf.nodes) {
      const cabeceras = n.parameters?.headerParameters?.parameters ?? [];
      for (const h of cabeceras) {
        assert.equal(
          /^(x-api-key|apikey|authorization|xi-api-key)$/i.test(h.name),
          false,
          `${n.name}: la cabecera ${h.name} debe venir de la credencial, no del JSON`,
        );
      }
    }
  });

  test(`${archivo}: los subworkflows quedan como PENDIENTE_* a resolver tras importar`, () => {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.executeWorkflow')) {
      const valor = n.parameters.workflowId?.value ?? '';
      assert.match(valor, /^PENDIENTE_FORENSE_/, `${n.name}: no inventar un ID de workflow`);
      assert.ok(n.parameters.workflowId.cachedResultName, `${n.name}: falta el nombre legible del destino`);
    }
  });
}

// -------------------------------------------------- comprobaciones específicas

function grafo(wf) {
  const salientes = new Map();
  for (const [origen, salidas] of Object.entries(wf.connections)) {
    const destinos = salidas.main.flat().map((d) => d.node);
    salientes.set(origen, destinos);
  }
  return salientes;
}

function alcanza(wf, desde, hasta) {
  const salientes = grafo(wf);
  const vistos = new Set([desde]);
  const pila = [desde];
  while (pila.length > 0) {
    const actual = pila.pop();
    for (const siguiente of salientes.get(actual) ?? []) {
      if (siguiente === hasta) return true;
      if (!vistos.has(siguiente)) { vistos.add(siguiente); pila.push(siguiente); }
    }
  }
  return false;
}

test('worker: la reserva del request precede al HTTP del proveedor (17 §5.3)', () => {
  const wf = cargar('FORENSE_ejecutar_agente.json');
  // El HTTP tiene UNA sola entrada, y viene de la reserva: no hay forma de
  // enviar un request sin haberlo reservado antes, ni siquiera en el reintento.
  assert.equal(alcanza(wf, 'Reservar request', 'POST /v1/messages'), true, 'reservar → HTTP');
  const entradasHttp = Object.entries(wf.connections)
    .filter(([, s]) => s.main.flat().some((d) => d.node === 'POST /v1/messages'))
    .map(([origen]) => origen).sort();
  assert.deepEqual(entradasHttp, ['Construir cuerpo Messages']);
  // El único camino de vuelta desde el HTTP a la reserva es el backoff, y
  // reservar otra vez con el MISMO request_id es lo que pide 17 §4 («cada HTTP
  // nuevo es un intento registrado, aunque sea retry»): incrementa
  // intento_transporte sin consumir cuota. Lo prohibido sería enviar sin
  // reservar, no re-reservar antes de reenviar.
  const entradasReserva = Object.entries(wf.connections)
    .filter(([, s]) => s.main.flat().some((d) => d.node === 'Reservar request'))
    .map(([origen]) => origen).sort();
  assert.deepEqual(entradasReserva, ['Backoff', 'Ruta del paso']);
});

test('worker: las cuatro rutas de transporte son excluyentes y llevan a un solo destino', () => {
  const wf = cargar('FORENSE_ejecutar_agente.json');
  const salidas = wf.connections['Ruta de transporte'].main.map((rama) => rama.map((d) => d.node));
  assert.deepEqual(salidas, [
    ['Interpretar respuesta'],
    ['Backoff'],
    ['Marcar desconocido'],
    ['Marcar error de request'],
  ], 'una respuesta correcta no puede caer además en la rama de desconocido');
  const conmutador = wf.nodes.find((n) => n.name === 'Ruta de transporte');
  assert.equal(conmutador.parameters.options.fallbackOutput, 'none', 'un valor no previsto no avanza en silencio');
  assert.deepEqual(
    conmutador.parameters.rules.values.map((v) => v.outputKey),
    ['continuar', 'reintentar', 'desconocido', 'error'],
  );
});

test('worker: el paso siempre pasa por Guardar checkpoint antes de cerrar', () => {
  const wf = cargar('FORENSE_ejecutar_agente.json');
  for (const rama of ['Interpretar respuesta', 'Armar tool_results', 'Marcar desconocido', 'Marcar error de request']) {
    assert.equal(alcanza(wf, rama, 'Guardar checkpoint'), true, `${rama} debe llegar al checkpoint`);
  }
  assert.equal(alcanza(wf, 'Guardar checkpoint', 'Finalizar paso'), true);
  assert.equal(alcanza(wf, 'Finalizar paso', 'Avanzar caso si listo'), true, 'la barrera la cierra advance_case_if_ready');
});

test('worker: el HTTP del proveedor no reintenta por su cuenta (Retry-After lo maneja el nodo)', () => {
  const wf = cargar('FORENSE_ejecutar_agente.json');
  const http = wf.nodes.find((n) => n.name === 'POST /v1/messages');
  assert.equal(http.retryOnFail, false);
  assert.equal(http.parameters.options.response.response.neverError, true, '429/5xx deben llegar como dato');
  assert.equal(http.parameters.options.timeout, 45000, 'deadline de request propuesto en 17 §4');
  assert.equal(http.parameters.nodeCredentialType, 'anthropicApi');
});

test('worker: la RPC de herramientas no fija Content-Profile: forense (07)', () => {
  const wf = cargar('FORENSE_ejecutar_agente.json');
  const rpc = wf.nodes.find((n) => n.name === 'Llamar RPC forense');
  assert.equal(rpc.parameters.nodeCredentialType, 'supabaseApi');
  assert.equal(JSON.stringify(rpc.parameters).includes('Content-Profile'), false);
  assert.match(rpc.parameters.url, /\/rpc\//);
});

test('investigación: el Code node del Auditor Final es el archivo generado, sin deriva', () => {
  const wf = cargar('FORENSE_investigar_cluster.json');
  const nodoAuditor = wf.nodes.find((n) => n.name === 'Auditor Final');
  const generado = fs.readFileSync(path.join(RAIZ, 'code', 'auditor-final.js'), 'utf8').replace(/\s+$/, '');
  assert.equal(nodoAuditor.parameters.jsCode, generado, 'el cuerpo del Code node debe salir del generador');
  assert.match(nodoAuditor.parameters.jsCode, /presuncion_alta/);
  assert.equal(/nivel = 'definitivo'/.test(nodoAuditor.parameters.jsCode), false, 'nunca «definitivo» como nivel de salida');
});

test('investigación: el webhook responde por nodo (202 diferido), no de inmediato', () => {
  const wf = cargar('FORENSE_investigar_cluster.json');
  const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  assert.equal(webhook.parameters.responseMode, 'responseNode');
  assert.equal(webhook.parameters.authentication, 'headerAuth');
  const responder = wf.nodes.find((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  assert.equal(responder.parameters.options.responseCode, 202);
});

test('investigación: la barrera se registra con el conjunto de tarea_id y se consulta, no se hace Merge', () => {
  const wf = cargar('FORENSE_investigar_cluster.json');
  const registrar = wf.nodes.find((n) => n.name === 'Registrar barrera R1');
  assert.match(registrar.parameters.query, /tareas_esperadas/);
  assert.equal(wf.nodes.some((n) => /merge/i.test(n.type)), false, 'nada de Merge esperando cinco ramas');
  assert.equal(alcanza(wf, 'Esperar barrera R1', 'Ronda fin R1'), true);
});

test('investigación: sin ronda 2 se pasa directo a Auditoría', () => {
  const wf = cargar('FORENSE_investigar_cluster.json');
  const decision = wf.connections['¿Hay ronda 2?'];
  const ramaFalsa = decision.main[1].map((d) => d.node);
  assert.deepEqual(ramaFalsa, ['Auditoría'], 'conjunto vacío de despertados → Auditoría (07 §2.7)');
});
