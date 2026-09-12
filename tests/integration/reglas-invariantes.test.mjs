// tests/integration/reglas-invariantes.test.mjs — invariantes que no dependen de una
// funcionalidad concreta: CLAUDE.md reglas 4, 6 y 7, y el enum de bitácora contra contratos.
//
//   bash tests/integration/preparar-db.sh
//   node --test tests/integration/reglas-invariantes.test.mjs
//
// Por qué no basta `grep -r definitivo`: `definitivo` es un valor LEGÍTIMO de
// `listas_sat.estatus` (art. 69-B) y aparece en guardas y comentarios que precisamente
// prohíben usarlo como nivel. Un grep crudo devuelve ~30 falsos positivos. Aquí se ancla
// donde importa: el enum de contratos, el CHECK de la tabla, los datos sembrados, la
// función determinista que decide el nivel, y una clasificación explícita de cada
// ocurrencia textual con lista blanca nombrada.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CORRIDA_GEN_V1, DB_QA, RAIZ, contratos, correr, escalar, filas, hayBase, json, leerJson } from './_ayudas.mjs';

const disponible = hayBase(DB_QA);
const saltar = disponible ? false : `falta la base ${DB_QA}: corre bash tests/integration/preparar-db.sh`;

const NIVELES = ['sin_hallazgos', 'anomalia_explicada', 'no_concluyente', 'presuncion', 'presuncion_alta'];

// ---------------------------------------------------------------------
// Regla 7: nunca «definitivo» como nivel
// ---------------------------------------------------------------------

test('contracts common.nivel no incluye "definitivo" y tope es presuncion_alta', async () => {
  const comun = leerJson('contracts/schemas/common.schema.json');
  const nivel = (comun.$defs ?? comun.definitions).nivel;
  assert.deepEqual(nivel.enum, NIVELES);
  assert.ok(!nivel.enum.includes('definitivo'));
});

test('forense.casos rechaza nivel = "definitivo" a nivel de CHECK', { skip: saltar }, () => {
  const r = correr(DB_QA, `update forense.casos set nivel = 'definitivo';`, { detener: true });
  assert.notEqual(r.code, 0, 'la base debe rechazar el término del SAT como nivel');
  assert.match(r.error, /check constraint/i);
  // y sí acepta el tope real del sistema
  const ok = correr(DB_QA, `
    begin;
    update forense.casos set nivel = 'presuncion_alta';
    rollback;`, { detener: true });
  assert.equal(ok.code, 0, `presuncion_alta debe ser aceptable: ${ok.error}`);
});

test('ninguna fila sembrada ni fixture de la webapp usa "definitivo" como nivel', { skip: saltar }, () => {
  const n = escalar(DB_QA, `select count(*) from forense.casos where nivel = 'definitivo'`);
  assert.equal(n, '0');
  const fixtures = path.join(RAIZ, 'web/lib/data/fixtures');
  if (fs.existsSync(fixtures)) {
    for (const f of fs.readdirSync(fixtures).filter((x) => x.endsWith('.json') || x.endsWith('.ts'))) {
      const texto = fs.readFileSync(path.join(fixtures, f), 'utf8');
      assert.equal(/nivel"?\s*[:=]\s*"definitivo"/.test(texto), false,
        `${f} usa "definitivo" como nivel`);
    }
  }
});

test('el dictamen determinista nunca puede producir "definitivo"', async () => {
  const mod = await import(path.join(RAIZ, 'n8n/runtime/auditor-final.mjs'));
  const dictaminar = mod.dictaminar ?? mod.default?.dictaminar;
  assert.ok(typeof dictaminar === 'function', 'auditor-final.mjs debe exportar dictaminar');
  // Barrido: 0..5 familias sustentadas × cobertura × E1 definitivo directo.
  const familias = ['D', 'F', 'R', 'T', 'E'];
  const vistos = new Set();
  for (let k = 0; k <= familias.length; k += 1) {
    for (const completa of [true, false]) {
      for (const e1 of [true, false]) {
        const evidencia = familias.slice(0, k).map((fam, i) => ({
          tipo: 'cfdi', ref_id: `CFDI-${i}`, familia: fam, pista_codigo: fam === 'E' ? 'E1' : `${fam}1`,
          valida_tecnica: true, refutada: false, validada: true,
          hecho_validado: { monto_centavos: '100', ...(fam === 'E' && e1 ? { estatus: 'definitivo', saltos: 0 } : {}) },
        }));
        const r = dictaminar({
          caso: { n_reintentos: 0 }, presupuesto: { permite_reintento: false },
          pistas: evidencia.map((e) => ({ codigo: e.pista_codigo, estado: 'confirmada' })),
          evidencia, pendientes: [], cobertura_completa: completa,
        });
        vistos.add(r.nivel);
      }
    }
  }
  for (const nivel of vistos) {
    assert.ok(NIVELES.includes(nivel), `nivel fuera del enum: ${nivel}`);
  }
  assert.equal(vistos.has('definitivo'), false);
  assert.ok(vistos.has('presuncion_alta'), 'el barrido debe llegar al tope para que la prueba valga');
});

test('cada ocurrencia textual de "definitivo" está clasificada (estatus SAT o guarda)', () => {
  // Red secundaria. Los dientes de la regla 7 son las cuatro pruebas anteriores (enum de
  // contratos, CHECK de la tabla, datos sembrados y barrido del dictamen determinista);
  // esto sólo detecta usos nuevos del término que nadie clasificó. Se clasifica con una
  // ventana de ±6 líneas: la guarda suele estar en el comentario de encima, pero cuando
  // la prueba demuestra el RECHAZO —un `begin … exception … end` que captura el error y
  // luego afirma sobre el resultado— la aserción queda varias líneas más abajo
  // (db/tests/assertions_010.sql B7). Sigue exigiéndose una palabra de guarda: ampliar
  // la ventana no vuelve legítimo un uso sin clasificar.
  const dirs = ['db', 'n8n', 'loaders', 'generator', 'web/app', 'web/lib', 'web/components'];
  const sinClasificar = [];
  for (const dir of dirs) {
    for (const archivo of recorrer(path.join(RAIZ, dir))) {
      const lineas = fs.readFileSync(archivo, 'utf8').split('\n');
      lineas.forEach((linea, i) => {
        if (!/definitiv/i.test(linea)) return;
        const ventana = lineas.slice(Math.max(0, i - 6), i + 7).join('\n');
        if (clasificar(linea, ventana)) return;
        sinClasificar.push(`${path.relative(RAIZ, archivo)}:${i + 1}: ${linea.trim().slice(0, 160)}`);
      });
    }
  }
  assert.deepEqual(sinClasificar, [],
    'ocurrencias de «definitivo» que no son estatus del SAT ni guarda explícita:\n' + sinClasificar.join('\n'));
});

/** @returns true si el uso de «definitivo» es de los permitidos. */
function clasificar(linea, ventana) {
  const l = linea.toLowerCase();
  const v = ventana.toLowerCase();
  // a) estatus publicado por la autoridad (art. 69-B): el único uso legítimo del término.
  if (/estatus|listas_sat|lista_sat|lista 69-b|69-b|efos|publicad|e1|desvirtuado|sentencia_favorable|definitivos/.test(l)) return true;
  // b) guarda, aserción o comentario que prohíbe usarlo como nivel (puede estar arriba).
  if (/nunca|ningun|ningún|no es un nivel|no un nivel|prohib|rechaza|check_violation|not\.?equal|nottobe|assert|expect|regla 7|término del sat|term del sat/.test(v)) return true;
  // c) comentario de diseño del dataset (separación de grafo trampa→definitivo).
  if (/^\s*(--|\/\/|#|\*)/.test(linea) && /salto|grafo|dataset|trampa|distancia/.test(v)) return true;
  // d) identificador del generador que nombra la LISTA de RFC con estatus definitivo.
  if (/distancia_trampa_definitivo|trampa→definitivo|trampa->definitivo/.test(l)) return true;
  return false;
}

function* recorrer(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* recorrer(p);
    else if (/\.(sql|mjs|js|ts|tsx|py|json|md|sh)$/.test(entrada.name)) yield p;
  }
}

// ---------------------------------------------------------------------
// Regla 4 / 05 §RLS: ninguna RPC del agente lee ground_truth
// ---------------------------------------------------------------------

test('ninguna función expuesta al agente referencia ground_truth (pg_proc.prosrc)', { skip: saltar }, () => {
  const tocan = filas(DB_QA, `
    select n.nspname || '.' || p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('forense','public') and p.prosrc ilike '%ground_truth%'
     order by 1;`).map((x) => x[0]).filter(Boolean);

  // Excepciones nombradas, todas de EVALUACIÓN/INGESTA y ninguna en la superficie del
  // agente (se comprueba abajo que ninguna es una tool del contrato ni es ejecutable
  // por anon/authenticated):
  //  - forense.clonar_corrida copia la tabla al clonar un snapshot (10, 21 §3);
  //  - forense.v_metricas_corrida calcula precisión/recall contra el ground truth (10);
  //  - forense.clonar_corrida_con_inyeccion arrastra las etiquetas del snapshot base
  //    (008:524) sin etiquetar las filas inyectadas: es justo lo que hace honesta la
  //    inyección en vivo de 21 §3;
  //  - forense.validar_inyeccion RECHAZA payloads que traigan ground_truth (008:281),
  //    o sea que menciona la tabla para impedir que el juez se autoetiquete.
  //  - forense.cargar_o_clonar_snapshot (010) es la versión de runtime del clonado:
  //    copia el dominio y las etiquetas a la corrida nueva, igual que clonar_corrida,
  //    y tampoco está en la superficie del agente.
  const permitidas = new Set([
    'forense.clonar_corrida', 'forense.v_metricas_corrida',
    'forense.clonar_corrida_con_inyeccion', 'forense.validar_inyeccion',
    'forense.cargar_o_clonar_snapshot',
  ]);
  const sorpresas = tocan.filter((f) => !permitidas.has(f));
  assert.deepEqual(sorpresas, [],
    `funciones nuevas que leen ground_truth: si alguna es una herramienta del agente, es un fallo de diseño: ${sorpresas.join(', ')}`);

  // Ninguna de las permitidas está en la superficie public.forense_* del agente...
  for (const f of permitidas) assert.ok(!f.startsWith('public.forense_'), f);
  // ...ni es invocable por los roles con los que la UI llega a la base. Sin esto, la
  // lista de excepciones sería una puerta trasera documentada.
  //
  // v_metricas_corrida SÍ está concedida a anon/authenticated a propósito (003:803 y
  // 005:2260): es el panel de métricas del demo. Se le exige lo que de verdad importa
  // —que agregue y no filtre etiquetas por RFC— en la aserción de abajo.
  const expuestasAdrede = new Set(['forense.v_metricas_corrida']);
  const alcanzables = filas(DB_QA, `
    select n.nspname || '.' || p.proname || ' → ' || r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'),('authenticated')) as r(rolname)
     where n.nspname || '.' || p.proname in (${[...permitidas].map((f) => `'${f}'`).join(',')})
       and exists (select 1 from pg_roles where rolname = r.rolname)
       and has_function_privilege(r.rolname, p.oid, 'execute')
     order by 1;`).map((x) => x[0]).filter(Boolean)
    .filter((f) => !expuestasAdrede.has(f.split(' ')[0]));
  assert.deepEqual(alcanzables, [],
    `funciones que leen ground_truth y son ejecutables desde la UI: ${alcanzables.join(', ')}`);

  // Lo que la UI puede pedir sobre gen-v1 son agregados, nunca la etiqueta de un RFC:
  // si aquí apareciera un RFC, el demo estaría enseñando la respuesta.
  const metricas = json(DB_QA,
    `forense.v_metricas_corrida('${CORRIDA_GEN_V1}'::uuid)`);
  const texto = JSON.stringify(metricas);
  assert.doesNotMatch(texto, /[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/,
    'v_metricas_corrida devolvió un RFC: filtra ground truth fila a fila');
  for (const prohibida of ['es_fraude', 'tipologia', 'es_trampa_legitima']) {
    assert.equal(texto.includes(`"${prohibida}"`), false,
      `v_metricas_corrida expone la columna ${prohibida} de ground_truth`);
  }
});

test('las 11 herramientas public.forense_* aún no existen: la aserción anterior es parcial', { skip: saltar }, () => {
  const n = Number(escalar(DB_QA, `
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'forense\\_%'`));
  // Cuando llegue 005_rpc.sql esta prueba cambia de significado sola: exigirá 11 y que
  // ninguna referencie ground_truth. Hoy deja constancia de que la cobertura es parcial.
  if (n === 0) {
    assert.equal(n, 0, 'pendiente por dependencia: 005_rpc.sql no está en este HEAD');
  } else {
    const malas = filas(DB_QA, `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'forense\\_%' and p.prosrc ilike '%ground_truth%'`)
      .map((x) => x[0]).filter(Boolean);
    assert.deepEqual(malas, [], `herramientas del agente que leen ground_truth: ${malas.join(', ')}`);
  }
});

// ---------------------------------------------------------------------
// Bitácora: el enum de la base contra el de contratos 1.2.0
// ---------------------------------------------------------------------

// QA-001 (dueño forense-db, severidad media): ck_bitacora_tipo_evento de
// db/001_schema.sql:339 NO incluye 'corrida_cargada', que contracts 1.2.0 sí enumera
// (product.schema.json) y que DECISIONES H3 01:38 acordó. Consecuencia: el evento de
// carga/clonado que 19 y 21 §3 necesitan en la línea de tiempo no se puede escribir, y
// loaders/load_gen.py sigue emitiendo 'pista_cargada' con payload.evento_real — la
// alternativa que esa misma decisión descartó. Marcada `todo` para no dejar el banco en
// rojo: pasa sola en cuanto la migración aditiva añada el valor.
test('bitacora.tipo_evento acepta todos los valores del contrato product.evento_forense',
  { skip: saltar }, () => {
  const producto = leerJson('contracts/schemas/product.schema.json');
  const defs = producto.$defs ?? producto.definitions;
  const tipos = defs.evento_forense.properties.tipo_evento.enum;
  assert.ok(tipos.includes('corrida_cargada') && tipos.includes('inyeccion'),
    'el contrato 1.2.0 debe traer corrida_cargada e inyeccion');

  const corrida = escalar(DB_QA, `select id from forense.corridas limit 1`);
  const rechazados = [];
  for (const tipo of tipos) {
    const r = correr(DB_QA, `
      begin;
      insert into forense.bitacora (corrida_id, agente, tipo_evento, payload)
        values ('${corrida}', 'qa-enum', '${tipo}', '{}'::jsonb);
      rollback;`, { detener: true });
    if (r.code !== 0) rechazados.push(tipo);
  }
  assert.deepEqual(rechazados, [],
    `tipos del contrato que ck_bitacora_tipo_evento rechaza (falta migración aditiva en db/): ${rechazados.join(', ')}`);
});

test('el contrato no tiene tipos que la base acepte y él desconozca', { skip: saltar }, () => {
  const producto = leerJson('contracts/schemas/product.schema.json');
  const defs = producto.$defs ?? producto.definitions;
  const tipos = new Set(defs.evento_forense.properties.tipo_evento.enum);
  const enBase = escalar(DB_QA, `
    select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_bitacora_tipo_evento'`);
  const sueltos = [...(enBase.match(/'[a-z_]+'/g) ?? [])]
    .map((s) => s.replaceAll("'", ''))
    .filter((s) => !tipos.has(s));
  assert.deepEqual(sueltos, [], `tipos en la base que el contrato no conoce: ${sueltos.join(', ')}`);
});

test('contratos cargables desde tests de integración', async () => {
  const c = await contratos();
  assert.notEqual(c, false, 'falta npm ci --prefix contracts --ignore-scripts');
  assert.equal(typeof c.validateContract, 'function');
});
