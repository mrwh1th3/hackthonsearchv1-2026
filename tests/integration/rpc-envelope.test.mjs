// =====================================================================
// tests/integration/rpc-envelope.test.mjs — las 11 herramientas de 005_rpc
// contra el contrato tools.envelope, sobre DOS corridas: el fixture y gen-v1.
//
//   node --test tests/integration/rpc-envelope.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Sólo lee db/ y contracts/; escribe únicamente en la base
// forense_qa (casos y tareas propios, prefijo qa-env-).
//
// Qué se afirma y por qué:
//   1. La lista de las 11 se DERIVA de contracts (tools.forense_*), no se
//      escribe a mano: si forense-db añade una tool sin contrato, o al revés,
//      la prueba lo dice sola. public.forense_* tiene 14 funciones; las otras
//      tres (validar_evidencia, evaluar_frontera, despertar) son del runtime,
//      no del modelo, y no tienen $def en tools.
//   2. El envelope vale TAMBIÉN cuando ok=false. Un error de argumento o de
//      ACL es un dato con forma, no una excepción: el runtime lo tiene que
//      poder leer igual. Por eso se valida la forma en los 11 pase lo que
//      pase, y aparte se exige que las lecturas de verdad devuelvan ok=true.
//   3. El fixture no basta como cobertura: tiene 16 CFDI y 6 pistas. gen-v1
//      trae 8081 CFDI y 140 pistas, que es donde un cursor o un límite se
//      rompen. De ahí las dos corridas.
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { CORRIDA_GEN_V1, DB_QA, FIXTURE, contratos, correr, correrOk, escalar, filas, hayBase, json }
  from './_ayudas.mjs';

const saltar = !hayBase(DB_QA) && 'sin base forense_qa (corre tests/integration/preparar-db.sh)';

const AGENTES_R1 = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];

/** Cita un literal para SQL. Todo lo que entra viene de la propia base o de constantes. */
function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Crea (una vez) un caso de QA sobre la primera cluster de la corrida, con las
 * tareas de ronda 1 más auditor. Devuelve los ids que necesitan las 11 tools.
 */
// Cada corrida de la suite usa casos propios: un caso reusado llega con la
// cuota de la ejecución anterior ya gastada y todas las tools responderían
// 'presupuesto_agotado' (que es correcto, pero no es lo que aquí se mide).
const SELLO = `${process.pid}-${Date.now().toString(36)}`;

function montarCaso(corrida, etiquetaBase) {
  const etiqueta = `${etiquetaBase}-${SELLO}`;
  if (Number(escalar(DB_QA, `select count(*) from forense.clusters where corrida_id = ${lit(corrida)}`)) === 0) {
    correrOk(DB_QA, `select forense.armar_clusters(${lit(corrida)}::uuid);`);
  }
  const cluster = escalar(DB_QA,
    `select id::text from forense.clusters where corrida_id = ${lit(corrida)} order by id limit 1`);
  assert.ok(cluster, `la corrida ${corrida} no tiene clusters ni se pudieron armar`);

  const caso = json(DB_QA,
    `forense.crear_caso(${lit(corrida)}::uuid, ${lit(cluster)}::uuid, 'qa', ${lit(etiqueta)}, ${lit(etiqueta)})`);
  assert.equal(caso.ok, true, `crear_caso falló: ${JSON.stringify(caso)}`);

  json(DB_QA, `forense.crear_tareas_ronda(${lit(caso.caso_id)}::uuid, 1,
    array[${[...AGENTES_R1, 'auditor'].map(lit).join(',')}]::text[], 0, 86400)`);

  const tareas = Object.fromEntries(filas(DB_QA,
    `select agente, id::text from forense.tareas_agente where caso_id = ${lit(caso.caso_id)}`));

  // Datos del cluster con los que las tools tienen algo real que devolver.
  const rfcs = escalar(DB_QA,
    `select array_to_string(rfcs, ',') from forense.clusters where id = ${lit(cluster)}`).split(',');
  const uuidCfdi = escalar(DB_QA, `
    select f.uuid::text from forense.cfdi f
     where f.corrida_id = ${lit(corrida)} and f.emisor_rfc = any(array[${rfcs.map(lit).join(',')}])
     order by f.fecha limit 1`);
  const clabe = escalar(DB_QA, `
    select c.clabe from forense.cuentas c
     where c.corrida_id = ${lit(corrida)} and c.rfc_titular = any(array[${rfcs.map(lit).join(',')}])
     order by c.clabe limit 1`);
  const corte = escalar(DB_QA, `select fecha_corte::text from forense.corridas where id = ${lit(corrida)}`);

  return { corrida, cluster, caso: caso.caso_id, rfc: caso.rfc_principal, rfcs, tareas, uuidCfdi, clabe, corte };
}

/**
 * Llamada SQL de cada tool con argumentos válidos. `agente` decide la tarea:
 * en ronda 1 un especialista no puede leer el pizarrón (acl_permite), así que
 * leer_senal se pide como auditor.
 */
function llamadas(c, { operacion = null } = {}) {
  const op = operacion ? `${lit(operacion)}::uuid` : 'null';
  const esp = 'documental';
  const t = (agente) => `${lit(c.caso)}::uuid, ${lit(agente)}, `;
  const cola = (agente) => `${lit(c.tareas[agente])}::uuid, 1, ${op}`;
  // forense_facturas mete p_cursor entre p_tarea y p_ronda (paginación keyset).
  const colaCursor = (agente) => `${lit(c.tareas[agente])}::uuid, null::text, 1, ${op}`;
  const senal = escalar(DB_QA,
    `select id::text from forense.senales where caso_id = ${lit(c.caso)} order by id limit 1`);

  return {
    forense_perfil: `public.forense_perfil(${t(esp)}${lit(c.rfc)}, ${cola(esp)})`,
    forense_facturas: `public.forense_facturas(${t(esp)}${lit(c.rfc)}, 'emisor', ` +
      `${lit(c.corte)}::timestamptz - interval '12 months', ${lit(c.corte)}::timestamptz, 25, ${colaCursor(esp)})`,
    forense_conciliar: `public.forense_conciliar(${t('financiero')}${lit(c.uuidCfdi)}::uuid, ${cola('financiero')})`,
    forense_seguir_dinero: `public.forense_seguir_dinero(${t('financiero')}${lit(c.clabe)}, ` +
      `${lit(c.corte)}::timestamptz - interval '12 months', 2, 0, ${cola('financiero')})`,
    forense_relacionados: `public.forense_relacionados(${t('relacional')}${lit(c.rfc)}, ${cola('relacional')})`,
    forense_ciclos: `public.forense_ciclos(${t('relacional')}${lit(c.rfc)}, 3, ${cola('relacional')})`,
    forense_pares: `public.forense_pares(${t('temporal')}${lit(c.rfc)}, ${cola('temporal')})`,
    forense_listas: `public.forense_listas(${t('externo')}${lit(c.rfc)}, 1, ${cola('externo')})`,
    // El pizarrón: escribir primero (especialista), leer después (auditor).
    forense_escribir_senal: `public.forense_escribir_senal(${t(esp)}'D', 'señal de QA sobre ' || ${lit(c.rfc)}, ` +
      `jsonb_build_object('resumen','prueba de contrato','origen','forense-qa',
         'descripcion','señal mínima que sólo existe para validar el contrato',
         'pista_id', (select id::text from forense.pistas where corrida_id = ${lit(c.corrida)}
                       and rfc = ${lit(c.rfc)} order by codigo limit 1)), ` +
      `array[${lit(c.rfc)}]::text[], array['CFDI:${'qa'}']::text[], '{}'::text[], 'baja', false, ${cola(esp)})`,
    forense_leer_senal: `public.forense_leer_senal(${t('auditor')}${senal ?? 'null'}::bigint, ${cola('auditor')})`,
    forense_registrar_evidencia: `public.forense_registrar_evidencia(${t(esp)}jsonb_build_array(jsonb_build_object(
        'pista_id', (select id::text from forense.pistas where corrida_id = ${lit(c.corrida)}
                      and rfc = ${lit(c.rfc)} order by codigo limit 1),
        'pista_codigo', (select codigo from forense.pistas where corrida_id = ${lit(c.corrida)}
                      and rfc = ${lit(c.rfc)} order by codigo limit 1),
        'familia', (select left(codigo,1) from forense.pistas where corrida_id = ${lit(c.corrida)}
                      and rfc = ${lit(c.rfc)} order by codigo limit 1),
        'tipo', 'indicio', 'ref_id', ${lit(c.rfc)},
        'referencias', jsonb_build_array(jsonb_build_object('tipo','RFC','id',${lit(c.rfc)})),
        'comprobacion', 'verificado contra SQL en la prueba de contrato',
        'rfcs_afectados', jsonb_build_array(${lit(c.rfc)}),
        'descripcion', 'evidencia mínima de QA')), ${cola(esp)})`,
  };
}

/** Orden de ejecución: primero las 9 de lectura, al final las que mutan estado. */
const ORDEN = [
  'forense_perfil', 'forense_facturas', 'forense_conciliar', 'forense_seguir_dinero',
  'forense_relacionados', 'forense_ciclos', 'forense_pares', 'forense_listas',
  'forense_escribir_senal', 'forense_leer_senal', 'forense_registrar_evidencia',
];

// ---------------------------------------------------------------------
// 1. La lista de las 11 sale del contrato, no de la memoria de quien escribe
// ---------------------------------------------------------------------

test('las tools del contrato y las RPC de public.forense_* son el mismo conjunto', { skip: saltar }, async () => {
  const c = await contratos();
  assert.ok(c, 'contracts/index.mjs no carga: npm ci --prefix contracts --ignore-scripts');

  const delContrato = c.contractNames
    .filter((n) => n.startsWith('tools.forense_'))
    .map((n) => n.slice('tools.'.length))
    .sort();
  assert.equal(delContrato.length, 11, `el contrato declara ${delContrato.length} tools, no 11`);

  const enBase = filas(DB_QA, `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'forense\\_%' order by 1;`)
    .map((x) => x[0]).filter(Boolean);

  // Las tres del runtime no son tools del modelo: las llama n8n, no el LLM.
  const NO_SON_TOOLS = ['forense_validar_evidencia', 'forense_evaluar_frontera', 'forense_despertar'];
  const candidatas = enBase.filter((f) => !NO_SON_TOOLS.includes(f)).sort();

  assert.deepEqual(candidatas, delContrato,
    `desalineación contrato↔DB.\n  sólo en DB: ${candidatas.filter((f) => !delContrato.includes(f))}\n` +
    `  sólo en contrato: ${delContrato.filter((f) => !candidatas.includes(f))}`);
  assert.deepEqual(ORDEN.slice().sort(), delContrato, 'ORDEN quedó desfasado del contrato');
});

// ---------------------------------------------------------------------
// 2. El envelope, en las 11, sobre las dos corridas
// ---------------------------------------------------------------------

for (const [nombre, corrida] of [['fixture', FIXTURE.corrida], ['gen-v1', CORRIDA_GEN_V1]]) {
  test(`las 11 tools devuelven un tools.envelope válido sobre ${nombre}`, { skip: saltar }, async (t) => {
    const c = await contratos();
    assert.ok(c, 'contracts/index.mjs no carga');

    const caso = montarCaso(corrida, `qa-env-${nombre}`);
    const sql = llamadas(caso);
    const oks = [];

    for (const tool of ORDEN) {
      await t.test(tool, () => {
        const env = json(DB_QA, sql[tool]);
        const v = c.validateContract('tools.envelope', env);
        assert.equal(v.ok, true,
          `${tool} rompe tools.envelope: ${JSON.stringify(v.errors)}\nenvelope: ${JSON.stringify(env).slice(0, 600)}`);
        // Invariante del contrato que un envelope mal construido suele violar.
        assert.equal(env.ok ? env.error : env.data, null);
        if (env.ok) oks.push(tool);
      });
    }

    // Que 11 errores bien formados pasen la validación no probaría nada: las
    // lecturas que sí tienen datos en el cluster deben responder ok=true.
    for (const obligatoria of ['forense_perfil', 'forense_facturas', 'forense_relacionados',
                               'forense_pares', 'forense_listas', 'forense_escribir_senal']) {
      assert.ok(oks.includes(obligatoria),
        `${obligatoria} no devolvió ok=true sobre ${nombre}; el resto de la prueba mediría poco`);
    }
  });
}

// ---------------------------------------------------------------------
// 3. ACL: en ronda 1 un especialista no lee el pizarrón
// ---------------------------------------------------------------------

test('ACL: en ronda 1 un especialista no puede leer_senal; el auditor sí', { skip: saltar }, async () => {
  const c = await contratos();
  const caso = montarCaso(FIXTURE.corrida, 'qa-acl');

  // El especialista escribe una señal (permitido) y después intenta leerla.
  json(DB_QA, llamadas(caso).forense_escribir_senal);
  const senal = escalar(DB_QA,
    `select id::text from forense.senales where caso_id = ${lit(caso.caso)} order by id limit 1`);
  assert.ok(senal, 'no hay señal que leer: la prueba de ACL no mediría nada');

  const comoEspecialista = json(DB_QA,
    `public.forense_leer_senal(${lit(caso.caso)}::uuid, 'documental', ${senal}::bigint,
      ${lit(caso.tareas.documental)}::uuid, 1, null)`);
  assert.equal(c.validateContract('tools.envelope', comoEspecialista).ok, true);
  assert.equal(comoEspecialista.ok, false, 'un especialista de ronda 1 leyó el pizarrón');
  assert.equal(comoEspecialista.error.codigo, 'no_autorizado');
  assert.equal(comoEspecialista.data, null);

  const comoAuditor = json(DB_QA,
    `public.forense_leer_senal(${lit(caso.caso)}::uuid, 'auditor', ${senal}::bigint,
      ${lit(caso.tareas.auditor)}::uuid, 1, null)`);
  assert.equal(c.validateContract('tools.envelope', comoAuditor).ok, true);
  assert.equal(comoAuditor.ok, true, `el auditor debería leer el pizarrón: ${JSON.stringify(comoAuditor.error)}`);

  // La negativa también deja rastro: sin evento en bitácora, el paso no existió.
  const n = Number(escalar(DB_QA, `
    select count(*) from forense.bitacora
     where caso_id = ${lit(caso.caso)} and tipo_evento = 'tool_result'
       and payload->>'tool' = 'leer_senal' and payload->'error'->>'codigo' = 'no_autorizado'`));
  assert.ok(n >= 1, 'el rechazo de ACL no quedó en forense.bitacora');
});

// ---------------------------------------------------------------------
// 4. Presupuesto agotado: dato con forma de envelope, no excepción
// ---------------------------------------------------------------------

test('presupuesto agotado llega como envelope ok=false, no como error de SQL', { skip: saltar }, async () => {
  const c = await contratos();
  const caso = montarCaso(FIXTURE.corrida, 'qa-presupuesto');

  // Se agota la cuota de la tarea poniendo el contador en su techo. No se toca
  // config_presupuesto: eso cambiaría el sistema, no la condición de la prueba.
  const techo = escalar(DB_QA, `
    select coalesce(l.limite, 0)::text from forense.tareas_agente t
      left join forense.limites_agente l on l.agente = t.agente and l.ronda = t.ronda
     where t.id = ${lit(caso.tareas.documental)}`);
  assert.ok(Number(techo) > 0, 'la tarea no tiene techo de tools: nada que agotar');
  correrOk(DB_QA,
    `update forense.tareas_agente set tool_calls = ${Number(techo)} where id = ${lit(caso.tareas.documental)};`);

  const env = json(DB_QA, llamadas(caso).forense_perfil);
  assert.equal(c.validateContract('tools.envelope', env).ok, true,
    `el envelope de presupuesto agotado no valida: ${JSON.stringify(env)}`);
  assert.equal(env.ok, false);
  assert.equal(env.error.codigo, 'presupuesto_agotado');
  assert.equal(env.error.reintentable, false, 'reintentar un presupuesto agotado sería un bucle');
  assert.equal(env.data, null);
  assert.equal(env.has_more, false);
  assert.equal(env.next_cursor, null);
});

// ---------------------------------------------------------------------
// 5. Idempotencia por p_operacion (docs/17 §reentrega)
// ---------------------------------------------------------------------

test('p_operacion repetido devuelve lo mismo, no consume cuota y no duplica señal', { skip: saltar }, async () => {
  const c = await contratos();
  const caso = montarCaso(FIXTURE.corrida, 'qa-idempotencia');
  // El id de operación también es único por ejecución: tool_operaciones guarda
  // el resultado para siempre, así que reusar el uuid devolvería la respuesta
  // de la corrida anterior y la prueba se estaría mintiendo.
  const operacion = escalar(DB_QA, 'select gen_random_uuid()::text');

  const antes = () => ({
    usadas: Number(escalar(DB_QA,
      `select tool_calls from forense.tareas_agente where id = ${lit(caso.tareas.documental)}`)),
    senales: Number(escalar(DB_QA,
      `select count(*) from forense.senales where caso_id = ${lit(caso.caso)}`)),
    ops: Number(escalar(DB_QA,
      `select count(*) from forense.tool_operaciones where operacion_id = ${lit(operacion)}`)),
  });

  const e0 = antes();
  const primera = json(DB_QA, llamadas(caso, { operacion }).forense_escribir_senal);
  const e1 = antes();
  const segunda = json(DB_QA, llamadas(caso, { operacion }).forense_escribir_senal);
  const e2 = antes();

  assert.equal(c.validateContract('tools.envelope', primera).ok, true);
  assert.equal(c.validateContract('tools.envelope', segunda).ok, true);
  assert.equal(primera.ok, true, `la primera escritura falló: ${JSON.stringify(primera.error)}`);
  assert.deepEqual(segunda, primera, 'la reentrega devolvió un resultado distinto al registrado');

  assert.equal(e1.usadas, e0.usadas + 1, 'la primera llamada debía consumir una unidad de cuota');
  assert.equal(e2.usadas, e1.usadas, 'la reentrega consumió cuota: un reintento de red costaría presupuesto');
  assert.equal(e1.senales, e0.senales + 1, 'la primera llamada no escribió la señal');
  assert.equal(e2.senales, e1.senales, 'la reentrega duplicó la señal en el pizarrón');
  assert.equal(e2.ops, 1, 'tool_operaciones debe guardar exactamente una fila por operación');
});

// ---------------------------------------------------------------------
// 6. Ninguna de las 11 toca ground_truth, ni directamente ni por sus ayudantes
// ---------------------------------------------------------------------

test('ninguna tool ni su cadena de ayudantes lee ground_truth', { skip: saltar }, async () => {
  const c = await contratos();
  const tools = c.contractNames.filter((n) => n.startsWith('tools.forense_')).map((n) => n.slice(6));

  // Cierre transitivo textual: de cada tool se siguen las funciones forense.*
  // que su prosrc nombra, y de esas las suyas. Una tool que delegara la
  // lectura de la etiqueta en un ayudante quedaría igual de atrapada.
  // Se trae como un único jsonb: prosrc tiene saltos de línea y pipes, y una
  // lectura por filas los partiría (el cierre se quedaría en las 11 y la
  // prueba pasaría sin haber mirado a ningún ayudante).
  const fuentes = new Map(Object.entries(json(DB_QA, `
    (select jsonb_object_agg(n.nspname || '.' || p.proname, p.prosrc)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('forense','public')
        and p.prolang <> (select oid from pg_language where lanname = 'c'))`)));

  const nombresForense = [...fuentes.keys()].filter((f) => f.startsWith('forense.'));
  const vistas = new Set();
  const culpables = [];
  const visitar = (fn, ruta) => {
    if (vistas.has(fn)) return;
    vistas.add(fn);
    const src = fuentes.get(fn);
    if (src === undefined) return;
    if (/ground_truth/i.test(src)) culpables.push([...ruta, fn].join(' → '));
    for (const otra of nombresForense) {
      const corto = otra.slice('forense.'.length);
      if (corto.length > 3 && src.includes(`forense.${corto}(`)) visitar(otra, [...ruta, fn]);
    }
  };
  for (const tool of tools) visitar(`public.${tool}`, []);

  assert.deepEqual(culpables, [],
    `cadenas que llegan a ground_truth desde una tool del agente:\n${culpables.join('\n')}`);
  assert.ok(vistas.size > tools.length,
    'el cierre transitivo no bajó de las 11: la prueba no estaría siguiendo a los ayudantes');
});
