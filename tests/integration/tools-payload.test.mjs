// =====================================================================
// tests/integration/tools-payload.test.mjs — el PAYLOAD de las 11 tools
// contra su `$def` de contracts (tools.forense_*), no sólo el envelope.
//
//   node --test tests/integration/tools-payload.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Sólo lee db/ y contracts/; escribe en forense_qa.
//
// Por qué hace falta además de rpc-envelope.test.mjs: aquel valida lo que la
// RPC DEVUELVE. Esto valida lo que el modelo MANDA. Son dos contratos
// distintos y el segundo es el que rompe primero: el `input_schema` que viaja
// en `tools` de la Messages API se genera desde estos `$def`, así que un
// argumento que el modelo puede producir y la RPC no acepta —o al revés— es
// un fallo que no se ve hasta que hay una llamada real con saldo.
//
// Tres afirmaciones por tool:
//   1. El payload que se usa para llamarla VALIDA contra `tools.forense_X`.
//      Se construye con datos reales de la corrida, no con literales bonitos.
//   2. Las propiedades del contrato son un SUBCONJUNTO de los parámetros de
//      la función en `pg_proc`. Subconjunto y no igualdad a propósito: el
//      contrato describe los argumentos DEL MODELO, y la RPC recibe además
//      los del runtime (`p_caso`, `p_agente`, `p_tarea`, `p_ronda`,
//      `p_operacion`), que el modelo nunca elige.
//   3. La llamada se hace con NOTACIÓN NOMBRADA usando exactamente esas
//      claves. Si un nombre del contrato no existiera en la función, psql
//      daría error de función inexistente, no un envelope.
//
// Y una negativa: un payload que viola el esquema tiene que ser rechazado por
// el contrato. Sin ella la prueba sólo demostraría que lo válido valida.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import { DB_QA, FIXTURE, contratos, correrOk, escalar, filas, hayBase, json, techoPrueba } from './_ayudas.mjs';

const saltar = !hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)';

const AGENTES_R1 = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];
const SELLO = `qa-payload-${process.pid}-${Date.now().toString(36)}`;

/** Argumentos que pone el RUNTIME, no el modelo: nunca están en el contrato. */
const DEL_RUNTIME = ['p_caso', 'p_agente', 'p_tarea', 'p_ronda', 'p_operacion'];

/** Tipo SQL de cada parámetro del modelo (de pg_get_function_arguments). */
const TIPOS = {
  p_rfc: 'text', p_rol: 'text', p_desde: 'timestamptz', p_hasta: 'timestamptz',
  p_limite: 'integer', p_cursor: 'text', p_uuid: 'uuid', p_cuenta: 'text',
  p_saltos: 'integer', p_monto_min: 'numeric', p_prof: 'integer', p_senal_id: 'bigint',
  p_familia: 'text', p_titular: 'text', p_detalle: 'jsonb', p_rfcs: 'text[]',
  p_ids: 'text[]', p_frontera: 'text[]', p_confianza: 'text', p_refuta: 'boolean',
  p_items: 'jsonb',
};

function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Un valor del payload como literal SQL del tipo que espera la función. */
function comoSql(nombre, valor) {
  const tipo = TIPOS[nombre];
  assert.ok(tipo, `falta el tipo SQL de ${nombre}: la prueba no sabría cómo pasarlo`);
  if (valor === null) return `null::${tipo}`;
  // `jsonb` primero: `p_items` es un ARRAY en el contrato y jsonb en la RPC,
  // y como array de SQL daría «cannot cast type text[] to jsonb».
  if (tipo === 'jsonb') {
    // Dollar-quoting: el JSON lleva comillas y llaves; nada de él se
    // interpola en una línea de shell (psql lee de un archivo).
    return `$PAY$${JSON.stringify(valor)}$PAY$::${tipo}`;
  }
  if (Array.isArray(valor)) {
    return valor.length === 0 ? `array[]::${tipo}` : `array[${valor.map(lit).join(',')}]::${tipo}`;
  }
  return `${lit(valor)}::${tipo}`;
}

// ---------------------------------------------------------------------
// Caso de QA con tareas de ronda 1 + auditor, sobre la corrida fixture.
// ---------------------------------------------------------------------

function montarCaso() {
  if (Number(escalar(DB_QA, `select count(*) from forense.clusters where corrida_id = ${lit(FIXTURE.corrida)}`)) === 0) {
    correrOk(DB_QA, `select forense.armar_clusters(${lit(FIXTURE.corrida)}::uuid);`);
  }
  const cluster = escalar(DB_QA,
    `select id::text from forense.clusters where corrida_id = ${lit(FIXTURE.corrida)} order by id limit 1`);
  assert.ok(cluster, 'la corrida fixture no tiene clusters');

  const caso = json(DB_QA, `forense.crear_caso(${lit(FIXTURE.corrida)}::uuid, ${lit(cluster)}::uuid,
    'qa', ${lit(SELLO)}, ${lit(SELLO)})`);
  assert.equal(caso.ok, true, `crear_caso falló: ${JSON.stringify(caso)}`);

  json(DB_QA, `forense.crear_tareas_ronda(${lit(caso.caso_id)}::uuid, 1,
    array[${[...AGENTES_R1, 'auditor'].map(lit).join(',')}]::text[], 0, 86400)`);
  const tareas = Object.fromEntries(filas(DB_QA,
    `select agente, id::text from forense.tareas_agente where caso_id = ${lit(caso.caso_id)}`));

  const rfcs = escalar(DB_QA,
    `select array_to_string(rfcs, ',') from forense.clusters where id = ${lit(cluster)}`).split(',');
  const uuidCfdi = escalar(DB_QA, `
    select f.uuid::text from forense.cfdi f
     where f.corrida_id = ${lit(FIXTURE.corrida)} and f.emisor_rfc = any(array[${rfcs.map(lit).join(',')}])
     order by f.fecha limit 1`);
  const clabe = escalar(DB_QA, `
    select c.clabe from forense.cuentas c
     where c.corrida_id = ${lit(FIXTURE.corrida)} and c.rfc_titular = any(array[${rfcs.map(lit).join(',')}])
     order by c.clabe limit 1`);
  // `common.fecha` exige ISO-8601 terminado en Z: se formatea en UTC desde la
  // base, no con el huso local de quien corre la prueba.
  const fechaUtc = (expr) => escalar(DB_QA,
    `select to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"."MS"Z"')`);
  const corte = fechaUtc(`(select fecha_corte from forense.corridas where id = ${lit(FIXTURE.corrida)})`);
  const desde = fechaUtc(`(select fecha_corte - interval '12 months' from forense.corridas where id = ${lit(FIXTURE.corrida)})`);
  const pista = filas(DB_QA, `
    select id::text, codigo, left(codigo, 1) from forense.pistas
     where corrida_id = ${lit(FIXTURE.corrida)} and rfc = ${lit(caso.rfc_principal)}
     order by codigo limit 1`)[0];
  assert.ok(pista, 'el RFC principal del caso no tiene pistas: no habría evidencia citable');
  assert.ok(uuidCfdi, 'el cluster del fixture no tiene CFDI que citar');

  return {
    caso: caso.caso_id, cluster, rfc: caso.rfc_principal, rfcs, tareas,
    uuidCfdi, clabe, corte, desde, pistaId: pista[0], pistaCodigo: pista[1], familia: pista[2],
  };
}

/**
 * El payload del MODELO para cada tool: exactamente las claves que declara
 * `tools.forense_*`, con valores tomados de la corrida.
 */
function payloads(c) {
  return {
    forense_perfil: { agente: 'documental', args: { p_rfc: c.rfc } },
    forense_facturas: {
      agente: 'documental',
      args: { p_rfc: c.rfc, p_rol: 'emisor', p_desde: c.desde, p_hasta: c.corte, p_limite: 25, p_cursor: null },
    },
    forense_conciliar: { agente: 'financiero', args: { p_uuid: c.uuidCfdi } },
    forense_seguir_dinero: {
      agente: 'financiero',
      args: { p_cuenta: c.clabe, p_desde: c.desde, p_saltos: 2, p_monto_min: '0.00' },
    },
    forense_relacionados: { agente: 'relacional', args: { p_rfc: c.rfc } },
    forense_ciclos: { agente: 'relacional', args: { p_rfc: c.rfc, p_prof: 3 } },
    forense_pares: { agente: 'temporal', args: { p_rfc: c.rfc } },
    forense_listas: { agente: 'externo', args: { p_rfc: c.rfc, p_saltos: 1 } },
    forense_escribir_senal: {
      agente: 'documental',
      args: {
        p_familia: c.familia,
        p_titular: `señal de QA sobre ${c.rfc}`,
        p_detalle: { pista_id: c.pistaId, descripcion: 'señal mínima que sólo existe para validar el payload' },
        p_rfcs: [c.rfc],
        p_ids: [`CFDI:${c.uuidCfdi}`],
        p_frontera: [],
        p_confianza: 'baja',
        p_refuta: false,
      },
    },
    // El pizarrón lo lee el auditor: en ronda 1 un especialista no puede.
    forense_leer_senal: { agente: 'auditor', args: { p_senal_id: null } },
    forense_registrar_evidencia: {
      agente: 'documental',
      args: {
        p_items: [{
          pista_id: c.pistaId,
          pista_codigo: c.pistaCodigo,
          familia: c.familia,
          tipo: 'cfdi',
          ref_id: `CFDI:${c.uuidCfdi}`,
          referencias: [`CFDI:${c.uuidCfdi}`],
          comprobacion: { codigo: c.pistaCodigo, referencias: [`CFDI:${c.uuidCfdi}`] },
          rfcs_afectados: [c.rfc],
          descripcion: 'evidencia mínima de QA, citada por id',
        }],
      },
    },
  };
}

/** Orden: escribir_senal antes de leer_senal (que necesita una señal). */
const ORDEN = [
  'forense_perfil', 'forense_facturas', 'forense_conciliar', 'forense_seguir_dinero',
  'forense_relacionados', 'forense_ciclos', 'forense_pares', 'forense_listas',
  'forense_escribir_senal', 'forense_leer_senal', 'forense_registrar_evidencia',
];

test('el payload de cada tool valida contra su $def de contracts y la RPC lo acepta por nombre',
  { skip: saltar, timeout: techoPrueba(2) }, async (t) => {
    const c = await contratos();
    assert.ok(c, 'contracts/index.mjs no carga: npm ci --prefix contracts --ignore-scripts');

    const delContrato = c.contractNames.filter((n) => n.startsWith('tools.forense_')).map((n) => n.slice(6)).sort();
    assert.deepEqual(ORDEN.slice().sort(), delContrato,
      'la lista de esta prueba quedó desfasada del contrato');

    // Parámetros reales de cada RPC, por nombre.
    const parametros = new Map(filas(DB_QA, `
      select p.proname, pg_get_function_arguments(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'forense\\_%'`)
      .map(([nombre, args]) => [nombre, args.split(',').map((a) => a.trim().split(/\s+/)[0])]));

    const caso = montarCaso();
    const mapa = payloads(caso);
    const okEnvelope = [];

    for (const tool of ORDEN) {
      await t.test(tool, () => {
        const { agente, args } = mapa[tool];

        // 2. Las claves del contrato existen en la función (subconjunto).
        const enBase = parametros.get(tool);
        assert.ok(enBase, `public.${tool} no existe en la base`);
        const faltan = Object.keys(args).filter((k) => !enBase.includes(k));
        assert.deepEqual(faltan, [],
          `el contrato de ${tool} nombra argumentos que la RPC no tiene: ${faltan.join(', ')};\n` +
          `  la función acepta: ${enBase.join(', ')}`);
        const sobranDelRuntime = enBase.filter((p) => !Object.keys(args).includes(p) && !DEL_RUNTIME.includes(p));
        assert.deepEqual(sobranDelRuntime, [],
          `public.${tool} pide argumentos que ni el contrato ni el runtime declaran: ${sobranDelRuntime.join(', ')}`);

        // `leer_senal` necesita una señal escrita por la llamada anterior.
        if (tool === 'forense_leer_senal') {
          args.p_senal_id = escalar(DB_QA,
            `select id::text from forense.senales where caso_id = ${lit(caso.caso)} order by id limit 1`);
          assert.ok(args.p_senal_id, 'no hay señal en el pizarrón: forense_escribir_senal no dejó ninguna');
        }

        // 1. El payload valida contra su $def.
        const v = c.validateContract(`tools.${tool}`, args);
        assert.equal(v.ok, true,
          `el payload de ${tool} no cumple tools.${tool}: ${JSON.stringify(v.errors)}\n` +
          `  payload: ${JSON.stringify(args).slice(0, 500)}`);

        // 3. Y se llama con notación nombrada, con esas mismas claves.
        const nombrados = Object.entries(args).map(([k, val]) => `${k} => ${comoSql(k, val)}`);
        const env = json(DB_QA, `public.${tool}(
          p_caso => ${lit(caso.caso)}::uuid,
          p_agente => ${lit(agente)},
          p_tarea => ${lit(caso.tareas[agente])}::uuid,
          p_ronda => 1,
          ${nombrados.join(',\n          ')})`);
        assert.equal(c.validateContract('tools.envelope', env).ok, true,
          `${tool} devolvió algo que no es un envelope: ${JSON.stringify(env).slice(0, 400)}`);
        if (env.ok) okEnvelope.push(tool);
        else assert.notEqual(env.error?.codigo, 'argumentos_invalidos',
          `la RPC rechazó por argumentos un payload que el contrato acepta: ${JSON.stringify(env.error)}`);
      });
    }

    // Que 11 rechazos bien formados pasaran no probaría nada.
    for (const obligatoria of ['forense_perfil', 'forense_facturas', 'forense_relacionados',
                               'forense_pares', 'forense_listas', 'forense_escribir_senal',
                               'forense_leer_senal', 'forense_registrar_evidencia']) {
      assert.ok(okEnvelope.includes(obligatoria),
        `${obligatoria} no devolvió ok=true con un payload válido de contrato`);
    }
  });

// ---------------------------------------------------------------------
// Negativa: lo que el contrato tiene que rechazar
// ---------------------------------------------------------------------

test('un payload fuera del $def se rechaza: rango, enum, clave de más y clave de menos',
  { skip: !hayBase(DB_QA) && saltar }, async () => {
    const c = await contratos();
    assert.ok(c, 'contracts/index.mjs no carga');

    const casos = [
      ['forense_listas', { p_rfc: 'AAA010101AAA', p_saltos: 9 }, 'p_saltos fuera de rango (máximo 2)'],
      ['forense_ciclos', { p_rfc: 'AAA010101AAA', p_prof: 0 }, 'p_prof por debajo del mínimo'],
      ['forense_facturas', {
        p_rfc: 'AAA010101AAA', p_rol: 'tercero',
        p_desde: '2025-01-01T00:00:00.000Z', p_hasta: '2026-01-01T00:00:00.000Z', p_limite: 10,
      }, 'p_rol fuera del enum emisor/receptor'],
      ['forense_perfil', { p_rfc: 'AAA010101AAA', p_extra: 1 }, 'clave de más (additionalProperties:false)'],
      ['forense_seguir_dinero', {
        p_cuenta: '012345678901234567', p_desde: '2025-01-01T00:00:00.000Z', p_saltos: 2,
      }, 'falta p_monto_min (required)'],
      ['forense_escribir_senal', {
        p_familia: 'X', p_titular: 't',
        p_detalle: { pista_id: '1', descripcion: 'd' },
        p_rfcs: ['AAA010101AAA'], p_ids: ['CFDI:1'], p_frontera: [], p_confianza: 'baja', p_refuta: false,
      }, 'familia fuera de D/F/R/T/E'],
      ['forense_registrar_evidencia', { p_items: [] }, 'p_items vacío (minItems 1)'],
      // Regla 6: las referencias se citan por id con prefijo; un texto libre
      // como cita es justo lo que el contrato tiene que cortar.
      ['forense_escribir_senal', {
        p_familia: 'D', p_titular: 't',
        p_detalle: { pista_id: '1', descripcion: 'd' },
        p_rfcs: ['AAA010101AAA'], p_ids: ['la factura de la que me habló el contribuyente'],
        p_frontera: [], p_confianza: 'baja', p_refuta: false,
      }, 'cita en texto libre en vez de REF:id'],
    ];

    for (const [tool, payload, motivo] of casos) {
      const v = c.validateContract(`tools.${tool}`, payload);
      assert.equal(v.ok, false, `tools.${tool} aceptó un payload que debía rechazar: ${motivo}`);
    }
  });
