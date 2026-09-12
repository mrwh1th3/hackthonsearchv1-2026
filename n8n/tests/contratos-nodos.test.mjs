// n8n/tests/contratos-nodos.test.mjs — contrato de datos ENTRE nodos.
//
// LO QUE ESTO PRUEBA: que la salida de un nodo es la entrada del siguiente. El
// grafo se recorre de verdad: para cada `$json.campo` de un nodo se exige que
// algún antecesor inmediato lo publique, y para cada `$('Nodo').first().json.campo`
// se exige que ese nodo exista, sea antecesor y publique el campo.
// Cierra el hueco declarado en n8n/workflows/MANIFEST.md §2.1.
//
// LO QUE NO PRUEBA: que las funciones SQL existan o devuelvan esas columnas
// (004/005 son de forense-db; aquí la tabla `CONTRATOS_NODOS` es la
// especificación que deben cumplir), ni nada de conectividad. Eso es el smoke.
//
// LÍMITE CONOCIDO de la comprobación: los campos disponibles para un nodo son la
// UNIÓN de los que publican sus antecesores inmediatos, no la intersección. Con
// ramas excluyentes (un switch por modo, por ejemplo) basta con que UNA de ellas
// publique el campo para que pase. La intersección sería más estricta pero es
// inviable aquí: hay ciclos legítimos (`Espera barrera → Esperar barrera R1`,
// `Backoff → Reservar request`) cuyo corte devuelve el conjunto vacío y dejaría
// todo en falso positivo.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRATOS_NODOS, FORMA_PENDIENTE, TIPOS_TRANSPARENTES } from '../runtime/generar-workflows.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(RAIZ, 'workflows');
const cargar = (f) => JSON.parse(fs.readFileSync(path.join(DIR, `${f}.json`), 'utf8'));

// Raíces de expresión que NO son datos de otro nodo.
const RAICES_LIBRES = /^\$(execution|workflow|now|today|env|vars|input|itemIndex|runIndex|prevNode|parameter|nodeVersion)/;

/** Texto de los parámetros donde buscar referencias. */
function textoDeNodo(n) {
  const texto = JSON.stringify(n.parameters ?? {});
  if (n.type !== 'n8n-nodes-base.code') return texto;
  // En un Code node solo interesa el cuerpo generado: las constantes
  // inyectadas (prompts embebidos) son datos, no expresiones de n8n.
  const marca = texto.indexOf('// ARCHIVO GENERADO');
  return marca >= 0 ? texto.slice(marca) : texto;
}

function referencias(n) {
  const texto = textoDeNodo(n);
  const deJson = [...texto.matchAll(/\$json\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const deNodo = [];
  // $('Nodo').first().json.campo | .last().json.campo | .item.json.campo
  const conCampo = /\$\('([^']+)'\)\.(?:first\(\)|last\(\)|item)\.json\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const m of texto.matchAll(conCampo)) deNodo.push({ nodo: m[1], campo: m[2] });
  // $('Nodo').all() — se usa el lote entero; solo se comprueba la procedencia.
  const sinCampo = /\$\('([^']+)'\)\.(?:all\(\)|first\(\)|last\(\)|item)/g;
  for (const m of texto.matchAll(sinCampo)) deNodo.push({ nodo: m[1], campo: null });
  return { deJson: [...new Set(deJson)].filter((c) => !RAICES_LIBRES.test(`$${c}`)), deNodo };
}

function grafo(wf) {
  const salientes = new Map();
  const entrantes = new Map();
  for (const n of wf.nodes) { salientes.set(n.name, []); entrantes.set(n.name, []); }
  for (const [origen, salidas] of Object.entries(wf.connections)) {
    for (const rama of salidas.main) {
      for (const d of rama) {
        salientes.get(origen).push(d.node);
        entrantes.get(d.node).push(origen);
      }
    }
  }
  return { salientes, entrantes };
}

/**
 * Campos visibles a la salida de un nodo. Los nodos de paso (if/switch/wait/…)
 * no publican nada propio: reenvían lo de sus antecesores.
 */
function camposPublicados(wf, contrato, nombre, tipos, entrantes, vistos = new Set()) {
  if (vistos.has(nombre)) return new Set();
  vistos.add(nombre);
  if (!TIPOS_TRANSPARENTES.includes(tipos.get(nombre))) {
    const declarado = contrato[nombre];
    assert.ok(declarado, `${wf.name}: falta declarar los campos que publica «${nombre}» en CONTRATOS_NODOS`);
    return new Set(declarado);
  }
  const union = new Set();
  for (const previo of entrantes.get(nombre) ?? []) {
    for (const campo of camposPublicados(wf, contrato, previo, tipos, entrantes, vistos)) union.add(campo);
  }
  return union;
}

function esAntecesor(entrantes, destino, candidato) {
  const pila = [...(entrantes.get(destino) ?? [])];
  const vistos = new Set();
  while (pila.length > 0) {
    const actual = pila.pop();
    if (actual === candidato) return true;
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    pila.push(...(entrantes.get(actual) ?? []));
  }
  return false;
}

for (const nombreWf of Object.keys(CONTRATOS_NODOS)) {
  const wf = cargar(nombreWf);
  const contrato = CONTRATOS_NODOS[nombreWf];
  const { entrantes } = grafo(wf);
  const tipos = new Map(wf.nodes.map((n) => [n.name, n.type]));

  test(`${nombreWf}: CONTRATOS_NODOS cubre exactamente los nodos que publican datos`, () => {
    const enJson = wf.nodes
      .filter((n) => !TIPOS_TRANSPARENTES.includes(n.type))
      .map((n) => n.name).sort();
    const enContrato = Object.keys(contrato).sort();
    assert.deepEqual(enContrato, enJson, 'la tabla de contratos y el JSON se separaron');
  });

  test(`${nombreWf}: todo $json.campo lo publica un antecesor inmediato`, () => {
    for (const n of wf.nodes) {
      const { deJson } = referencias(n);
      if (deJson.length === 0) continue;
      const previos = entrantes.get(n.name) ?? [];
      const disponibles = new Set();
      for (const previo of previos) {
        for (const campo of camposPublicados(wf, contrato, previo, tipos, entrantes)) disponibles.add(campo);
      }
      for (const campo of deJson) {
        assert.ok(
          disponibles.has(campo),
          `${nombreWf}/${n.name}: usa $json.${campo} y ningún antecesor inmediato (${previos.join(', ') || 'ninguno'}) lo publica`,
        );
      }
    }
  });

  test(`${nombreWf}: toda referencia $('Nodo') apunta a un antecesor que publica el campo`, () => {
    const nombres = new Set(wf.nodes.map((x) => x.name));
    for (const n of wf.nodes) {
      if (n.type === 'n8n-nodes-base.stickyNote') continue; // una nota no ejecuta expresiones
      const { deNodo } = referencias(n);
      for (const ref of deNodo) {
        assert.ok(nombres.has(ref.nodo), `${nombreWf}/${n.name}: referencia al nodo inexistente «${ref.nodo}»`);
        assert.ok(
          esAntecesor(entrantes, n.name, ref.nodo),
          `${nombreWf}/${n.name}: «${ref.nodo}» no es antecesor suyo; en ejecución no tendría datos`,
        );
        if (ref.campo === null) continue;
        const publica = camposPublicados(wf, contrato, ref.nodo, tipos, entrantes);
        assert.ok(
          publica.has(ref.campo),
          `${nombreWf}/${n.name}: «${ref.nodo}» no publica ${ref.campo}`,
        );
      }
    }
  });

  test(`${nombreWf}: lo declarado por cada nodo aparece en su propia fuente`, () => {
    const sinComprobar = [];
    for (const n of wf.nodes) {
      const declarado = contrato[n.name] ?? [];
      if (declarado.length === 0) continue;
      const fuente = n.type === 'n8n-nodes-base.postgres' ? n.parameters.query
        : n.type === 'n8n-nodes-base.code' ? textoDeNodo(n)
          : null;
      if (fuente === null) continue;
      // `SELECT * FROM f(...)` no declara columnas: la forma la fija la función
      // de 004/005, que todavía no existe. Esos nodos se listan aparte, no se
      // aprueban en silencio.
      if (n.type === 'n8n-nodes-base.postgres' && /select \*\s+from/i.test(fuente)) {
        sinComprobar.push(n.name);
        continue;
      }
      for (const campo of declarado) {
        assert.ok(
          new RegExp(`\\b${campo}\\b`).test(fuente),
          `${nombreWf}/${n.name}: declara publicar «${campo}» pero su fuente no lo menciona`,
        );
      }
    }
    assert.deepEqual(
      sinComprobar.sort(),
      [...(FORMA_PENDIENTE[nombreWf] ?? [])].sort(),
      'la lista de nodos cuya forma depende de 004/005 cambió: actualiza FORMA_PENDIENTE y IMPORT.md',
    );
  });
}

// ------------------------------------------------- invariantes del lote de tools

test('worker: el lote de herramientas es lineal — sin convergencia de ramas antes de armar los tool_result', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  const { entrantes } = grafo(wf);
  // n8n ejecuta un nodo una vez POR CONEXIÓN de entrada con datos. Si la rama
  // de herramientas se bifurcara (tool nueva / reentrega) y volviera a unirse,
  // «Armar tool_results» correría dos veces y emitiría dos mensajes user
  // incompletos: exactamente lo que 17 §5.5 prohíbe. La idempotencia de la
  // reentrega vive en claim_tool (unicidad request_id+tool_use_id) y en
  // p_operacion de la RPC (06), no en una bifurcación del grafo.
  for (const nodo of ['Reclamar tool', 'Llamar RPC forense', 'Registrar resultado tool', 'Armar tool_results']) {
    assert.equal(entrantes.get(nodo).length, 1, `${nodo} debe tener una sola entrada`);
  }
  assert.deepEqual(entrantes.get('Armar tool_results'), ['Registrar resultado tool']);
});

test('worker: la rama que NO cierra también deja rastro en bitácora (regla 2)', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  const noTerminal = wf.connections['¿Estado terminal?'].main[1].map((d) => d.node);
  assert.deepEqual(noTerminal, ['Registrar paso guardado'], 'antes de redespachar hay que registrar el paso');
  const registro = wf.nodes.find((n) => n.name === 'Registrar paso guardado');
  assert.match(registro.parameters.query, /forense\.log\(/);
  assert.match(registro.parameters.query, /paso_checkpoint/);
  const siguiente = wf.connections['Registrar paso guardado'].main[0].map((d) => d.node);
  assert.deepEqual(siguiente, ['Redespachar paso']);
});

test('worker: advance_case_if_ready se llama con (caso_id, paso, revision_expected)', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  const avanzar = wf.nodes.find((n) => n.name === 'Avanzar caso si listo');
  assert.match(
    avanzar.parameters.query,
    /advance_case_if_ready\(\$1::uuid, \$2::text, \$3::int\)/,
    'DECISIONES H3 01:35: la barrera es por paso',
  );
  const params = avanzar.parameters.options.queryReplacement.split('}},').length;
  assert.equal(params, 3, 'tres parámetros: caso_id, paso, revision_expected');
});

test('worker: ninguna función de 17 §4 se llama con la firma vieja', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  const sql = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres')
    .map((n) => n.parameters.query).join('\n');
  // request_id es TEXT en forense.llm_solicitudes, no uuid.
  assert.equal(/reserve_request\([^)]*::uuid, *\$2::bigint, *\$3::uuid/.test(sql), false);
  assert.match(sql, /reserve_request\(\$1::uuid, \$2::bigint, \$3::text/);
  // finish_step recibe revision_expected y estado INTERNO, no el estado de tarea.
  assert.match(sql, /finish_step\(\$1::uuid, \$2::bigint, \$3::int, \$4::text/);
  // El ledger de herramientas se cierra con finish_tool, no con un UPDATE suelto.
  assert.match(sql, /finish_tool\(\$1::bigint/);
  assert.equal(/UPDATE forense\.tool_ejecuciones/.test(sql), false);
  // La bitácora se escribe con forense.log; forense.registrar_evento no existe.
  assert.equal(/registrar_evento/.test(sql), false);
  assert.match(sql, /forense\.log\(/);
});

test('worker: el backoff vuelve por la RESERVA, no directo al HTTP (17 §4)', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  // Cada reenvío es un intento registrado: reserve_request con el mismo
  // request_id incrementa intento_transporte sin consumir cuota nueva, y ese
  // contador es lo que corta el bucle en `Clasificar transporte`. Volviendo
  // directo al HTTP, el intento se quedaba en 1 y el backoff giraba hasta el
  // deadline del paso contra una cuenta con rate limit.
  assert.deepEqual(wf.connections.Backoff.main[0].map((d) => d.node), ['Reservar request']);
  const clasificador = wf.nodes.find((n) => n.name === 'Clasificar transporte');
  assert.match(
    clasificador.parameters.jsCode,
    /\$\('Reservar request'\)\.item\.json\.intento_transporte/,
    'con varias ejecuciones del nodo hace falta el ítem actual, no .first()',
  );
});

test('worker: el evento de paso en cola resuelve su identidad desde la ejecución', () => {
  const wf = cargar('FORENSE_ejecutar_agente');
  const nodo = wf.nodes.find((n) => n.name === 'Registrar en_cola');
  // forense.bitacora.corrida_id es NOT NULL y claim_step, cuando falla, no
  // devuelve caso_id ni corrida_id: tomarlos del payload del claim rompía justo
  // el evento que la regla 2 exige para la rama en cola.
  assert.match(nodo.parameters.query, /FROM forense\.ejecuciones_agente e WHERE e\.id = \$1::uuid/);
  assert.equal(/p_caso => \$1/.test(nodo.parameters.query), false, 'la identidad no sale del parámetro');
  assert.match(nodo.parameters.options.queryReplacement, /\$json\.execution_id/);
});
