// =====================================================================
// tests/integration/cobertura-dictamen-015.test.mjs — la cobertura del caso y
// el dictamen determinista, sobre un clon de gen-v1 y por el camino real.
//
//   node --test tests/integration/cobertura-dictamen-015.test.mjs
//   (antes: DATOS=clon bash tests/integration/preparar-db.sh)
//
// Dueño: forense-qa. Sólo escribe en forense_qa y borra su clon al terminar.
//
// QUÉ SE MIDE Y POR QUÉ AQUÍ
//
// `forense.casos.cobertura_completa` nacía en false y nadie la escribía; el
// Auditor Final determinista arranca con `cobertura_completa && pendientes
// vacío` y, si no está completo, el nivel es `no_concluyente` SIEMPRE. Es
// decir: el sistema entero salía no_concluyente por una columna muerta.
// 015 puso la regla en SQL y `db/tests/assertions_015.sql` la comprueba sobre
// un caso construido a mano con INSERT.
//
// Esta prueba es la otra mitad, la que ese fichero no puede dar: el mismo
// resultado por el CAMINO REAL, sobre datos de verdad y SIN un solo UPDATE ni
// INSERT directo sobre tablas del pipeline. Todo pasa por funciones:
//
//   clonar_corrida (014)   → correr_pistas (014)  → armar_clusters (004)
//   crear_caso (005)       → crear_tareas_ronda (005)
//   forense_registrar_evidencia (005) → forense_validar_evidencia (005)
//   claim_step / finish_step (002)    → recalcular_cobertura (015)
//   paquete_auditor_final (015)       → dictaminar() (n8n/runtime)
//
// La diferencia importa: un INSERT con `validada = true` mide la regla de
// cobertura pero se salta al validador, que es quien decide si una evidencia
// sostiene algo. Aquí el `true` de cada evidencia lo pone
// `forense_validar_evidencia` contra el CFDI real de la corrida, y el nivel lo
// pone el dictaminador leyendo el paquete. Ni una línea la decide la prueba.
//
// Nivel esperado: `presuncion` (dos familias sustentadas). No `presuncion_alta`
// —haría falta una tercera familia, o E1 con estatus firme del SAT a 0 saltos—
// y nunca «definitivo», que no es un nivel del sistema (regla 7).
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { dictaminar, NIVELES } from '../../n8n/runtime/auditor-final.mjs';
import { CORRIDA_GEN_V1, DB_QA, RAIZ, correr, correrOk, escalar, filas, hayBase, json, techoPrueba }
  from './_ayudas.mjs';

const conBase = hayBase(DB_QA);
const hayGen = conBase && escalar(DB_QA,
  `select count(*) from forense.corridas where id = '${CORRIDA_GEN_V1}'`) === '1';

const saltar = (!conBase && 'sin base forense_qa (corre tests/integration/preparar-db.sh)') ||
  (!hayGen && 'sin gen-v1 en forense_qa (corre DATOS=clon bash tests/integration/preparar-db.sh)') ||
  (!Number(escalar(DB_QA,
    `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'forense' and p.proname = 'recalcular_cobertura'`)) &&
    'sin db/015_cobertura.sql aplicada (la cobertura no la calcula nadie todavía)');

const SELLO = `qa-cob-${process.pid}-${Date.now().toString(36)}`;

/** Los cinco especialistas de la ronda 1 (03 §especialistas por familia). */
const ESPECIALISTAS = ['documental', 'financiero', 'relacional', 'temporal', 'externo'];

function lit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Borra el clon entero. No detiene la prueba si falla: forense_qa es desechable. */
function limpiar(corrida) {
  if (!corrida) return;
  const r = correr(DB_QA, `delete from forense.corridas where id = ${lit(corrida)};`);
  if (r.code !== 0) console.log(`[limpieza] no se borró ${corrida}: ${r.error.slice(0, 200)}`);
}

/**
 * Cierra una tarea por el camino del runtime: reclamar el paso (que entrega el
 * fence) y terminarlo. `finish_step` es quien traduce el estado interno de la
 * ejecución al estado de la tarea ('terminado' → 'completada', 'error' →
 * 'error'). Un `update forense.tareas_agente` desde la prueba mediría la
 * columna, no la transición.
 */
function cerrarTarea(tarea, estadoInterno, motivo = null) {
  const ejec = escalar(DB_QA,
    `select id::text from forense.ejecuciones_agente where tarea_id = ${lit(tarea)}`);
  assert.ok(ejec, `la tarea ${tarea} no tiene ejecución: crear_tareas_ronda no la cableó`);

  const claim = json(DB_QA, `forense.claim_step(${lit(ejec)}::uuid, ${lit(SELLO)}, 600)`);
  assert.equal(claim.ok, true, `claim_step falló: ${JSON.stringify(claim)}`);

  const [[fence, rev]] = filas(DB_QA,
    `select fence_token::text, revision::text from forense.ejecuciones_agente where id = ${lit(ejec)}`);
  const fin = json(DB_QA, `forense.finish_step(${lit(ejec)}::uuid, ${fence}::bigint, ${rev}::int,
    ${lit(estadoInterno)}, '{}'::jsonb, ${lit(motivo)})`);
  assert.equal(fin.ok, true, `finish_step falló: ${JSON.stringify(fin)}`);
  return fin;
}

/**
 * El paquete TAL COMO LO RECIBE el Code node del Auditor Final.
 *
 * No es `paquete_auditor_final` a secas. `dictaminar()` exige
 * `evidencia[].hecho_validado.monto_centavos`, `caso.n_reintentos` y
 * `presupuesto.permite_reintento`, y ninguno de los tres sale así de la
 * función: los arma el nodo Postgres que va JUSTO ANTES del Code node en
 * FORENSE_investigar_cluster. Llamar a `dictaminar(paquete_auditor_final(...))`
 * con evidencia de tipo 'cfdi' lanza «Monto validado ausente/inválido».
 *
 * Por eso la consulta se LEE del workflow exportado en vez de reescribirse
 * aquí: una copia se desincroniza en silencio y la prueba pasaría a certificar
 * un adaptador que n8n ya no ejecuta.
 */
const WORKFLOW = path.join(RAIZ, 'n8n/workflows/FORENSE_investigar_cluster.json');

function consultaDelWorkflow() {
  const wf = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));
  const nodos = (wf.nodes ?? []).filter((n) =>
    typeof n.parameters?.query === 'string' &&
    n.parameters.query.includes('forense.paquete_auditor_final'));
  assert.equal(nodos.length, 1,
    `esperaba exactamente un nodo que lea paquete_auditor_final en ${path.basename(WORKFLOW)}, hay ${nodos.length}`);
  return nodos[0].parameters.query;
}

function paqueteComoLoVeElCodeNode(caso) {
  const q = consultaDelWorkflow().replaceAll('$1::uuid', `${lit(caso)}::uuid`);
  assert.ok(!q.includes('$1'), 'quedó un parámetro sin sustituir en la consulta del workflow');
  return json(DB_QA, `(select to_jsonb(t) from (${q}) t)`);
}

/**
 * Los cuatro términos de la regla de cobertura (015 §1), para que un false
 * diga POR QUÉ y no sólo que es false.
 */
function diagnosticoCobertura(caso) {
  const [f] = filas(DB_QA, `
    select (select count(*) from forense.tareas_agente t where t.caso_id = k.id)::text,
           (select count(*) from forense.tareas_agente t where t.caso_id = k.id
             and t.estado not in ('completada','omitida'))::text,
           (select count(*) from unnest(coalesce(cl.rfcs_frontera, '{}'::text[])) x
             where not (x = any(coalesce(cl.rfcs, '{}'::text[]))))::text,
           (select count(*) from forense.bitacora b
             where b.caso_id = k.id and b.tipo_evento = 'cluster_expandido')::text,
           forense.config_int('max_expansiones_caso', 2)::text,
           jsonb_array_length(coalesce(k.pendientes, '[]'::jsonb))::text
      from forense.casos k join forense.clusters cl on cl.id = k.cluster_id
     where k.id = ${lit(caso)}`);
  const [tareas, noTerminales, frontera, expansiones, maxExp, limitaciones] = f;
  return `tareas=${tareas} no_terminales=${noTerminales} frontera_pendiente=${frontera} ` +
    `expansiones=${expansiones}/${maxExp} limitaciones=${limitaciones}`;
}

/**
 * Un CFDI real de la corrida emitido por un RFC con la pista `codigo` dentro
 * del cluster. Es la cita que el validador va a comprobar contra
 * `forense.cfdi`: si se inventara, `forense_validar_evidencia` la descartaría
 * y la prueba dejaría de medir lo que dice medir.
 */
function citaPara(corrida, cluster, codigo) {
  const f = filas(DB_QA, `
    select p.id::text, p.rfc, f.uuid::text, f.receptor_rfc
      from forense.pistas p
      join lateral (
        select f.* from forense.cfdi f
         where f.corrida_id = p.corrida_id and f.emisor_rfc = p.rfc
           and f.fecha <= (select fecha_corte from forense.corridas where id = p.corrida_id)
         order by f.fecha limit 1) f on true
     where p.corrida_id = ${lit(corrida)} and p.codigo = ${lit(codigo)}
       and exists (select 1 from forense.clusters c
                    where c.id = ${lit(cluster)} and p.rfc = any(c.rfcs))
     order by p.id limit 1`);
  if (!f.length) return null;
  const [pista_id, rfc, uuid, receptor] = f[0];
  return { pista_id: Number(pista_id), rfc, uuid, receptor };
}

test('cobertura_completa y dictamen determinista sobre un caso de gen-v1 clonado',
  { skip: saltar, timeout: techoPrueba(4) }, async (t) => {
    let corrida = null; let cluster = null; let caso = null;
    const tareas = {};
    t.after(() => limpiar(corrida));

    await t.test('preparar: clon de gen-v1, pistas, clusters, caso y ronda 1', () => {
      corrida = escalar(DB_QA,
        `select forense.clonar_corrida(${lit(CORRIDA_GEN_V1)}::uuid, ${lit(SELLO)})::text`);
      assert.ok(corrida && corrida !== CORRIDA_GEN_V1, `clon inválido: ${corrida}`);

      correrOk(DB_QA, `select forense.correr_pistas(${lit(corrida)}::uuid);`);
      const nClusters = Number(escalar(DB_QA,
        `select forense.armar_clusters(${lit(corrida)}::uuid)`));
      assert.ok(nClusters > 0, 'armar_clusters no armó ninguno: no hay caso que dictaminar');

      // El cluster con más familias distintas Y SIN frontera pendiente. Lo
      // segundo no es comodidad: con RFC de frontera fuera del cluster y
      // presupuesto de expansión sin gastar, la regla de 015 deja la cobertura
      // en false A PROPÓSITO (queda cadena por seguir). Medir el `true` sobre
      // un cluster así sería medir el caso equivocado.
      cluster = escalar(DB_QA, `
        select c.id::text from forense.clusters c
         where c.corrida_id = ${lit(corrida)}
           and not exists (select 1 from unnest(coalesce(c.rfcs_frontera, '{}'::text[])) x
                            where not (x = any(coalesce(c.rfcs, '{}'::text[]))))
         order by (select count(distinct left(p.codigo, 1)) from forense.pistas p
                    where p.corrida_id = c.corrida_id and p.rfc = any(c.rfcs)) desc,
                  c.id limit 1`);
      assert.ok(cluster,
        'todos los clusters de la corrida tienen frontera pendiente: con expansión por hacer ' +
        'la cobertura es false por diseño y no hay caso donde comprobar el true');

      const r = json(DB_QA, `forense.crear_caso(${lit(corrida)}::uuid, ${lit(cluster)}::uuid,
        'qa', ${lit(SELLO)}, ${lit(SELLO)})`);
      assert.equal(r.ok, true, `crear_caso falló: ${JSON.stringify(r)}`);
      caso = r.caso_id;

      const ronda = json(DB_QA, `forense.crear_tareas_ronda(${lit(caso)}::uuid, 1,
        array[${ESPECIALISTAS.map(lit).join(',')}]::text[])`);
      assert.equal(ronda.ok, true, `crear_tareas_ronda falló: ${JSON.stringify(ronda)}`);

      for (const [id, agente] of filas(DB_QA,
        `select id::text, agente from forense.tareas_agente where caso_id = ${lit(caso)} order by agente`)) {
        tareas[agente] = id;
      }
      assert.deepEqual(Object.keys(tareas).sort(), ESPECIALISTAS.slice().sort(),
        'la ronda 1 no despachó a los cinco especialistas');
    });

    await t.test('con tareas despachadas y sin terminar, la cobertura es false', () => {
      // Antes de nada: el punto de partida tiene que ser false, o el true del
      // final no probaría que lo puso la regla.
      assert.equal(escalar(DB_QA, `select forense.cobertura_caso(${lit(caso)}::uuid)::text`), 'false',
        'un caso con cinco tareas pendientes no puede tener cobertura completa');
      assert.equal(escalar(DB_QA,
        `select cobertura_completa::text from forense.casos where id = ${lit(caso)}`), 'false');
    });

    await t.test('dos familias de evidencia registradas y VALIDADAS contra los CFDI reales', () => {
      // Familia F (facturación) y familia T (temporal): dos familias distintas
      // y ninguna es E, así que el camino `presuncion_alta` por E1 firme a 0
      // saltos queda fuera por construcción y el nivel esperado es `presuncion`.
      const plan = [
        { agente: 'financiero', familia: 'F', codigos: ['F1', 'F2', 'F3'] },
        { agente: 'temporal', familia: 'T', codigos: ['T1', 'T2'] },
      ];
      const items = [];
      for (const p of plan) {
        let cita = null; let codigo = null;
        for (const c of p.codigos) {
          cita = citaPara(corrida, cluster, c);
          if (cita) { codigo = c; break; }
        }
        assert.ok(cita, `el cluster no tiene ninguna pista ${p.codigos.join('/')} con CFDI que citar`);
        items.push({
          agente: p.agente,
          item: {
            pista_id: cita.pista_id,
            pista_codigo: codigo,
            familia: p.familia,
            tipo: 'cfdi',
            ref_id: `CFDI:${cita.uuid}`,
            referencias: [`CFDI:${cita.uuid}`],
            comprobacion: `CFDI emitido por ${cita.rfc} presente en forense.cfdi de la corrida`,
            rfcs_afectados: [cita.rfc, cita.receptor].filter(Boolean),
            descripcion: `evidencia ${codigo} citada por la prueba de cobertura`,
          },
        });
      }

      for (const { agente, item } of items) {
        const texto = JSON.stringify([item]).replace(/\$/g, '');
        const r = json(DB_QA, `public.forense_registrar_evidencia(
          ${lit(caso)}::uuid, ${lit(agente)}, $PAY$${texto}$PAY$::jsonb,
          ${lit(tareas[agente])}::uuid, 1, null)`);
        assert.equal(r.ok, true, `registrar_evidencia (${agente}) falló: ${JSON.stringify(r)}`);
        assert.equal((r.datos?.rechazos ?? r.rechazos ?? []).length, 0,
          `evidencia rechazada: ${JSON.stringify(r)}`);
      }

      // El `validada = true` lo pone el validador contra el CFDI real, no la prueba.
      const v = json(DB_QA, `public.forense_validar_evidencia(${lit(caso)}::uuid)`);
      assert.equal(v.ok, true, `validar_evidencia falló: ${JSON.stringify(v)}`);

      const familias = filas(DB_QA, `
        select distinct familia from forense.evidencia
         where caso_id = ${lit(caso)} and valida_tecnica and validada and not refutada
         order by 1`).map((x) => x[0]);
      assert.deepEqual(familias, ['F', 'T'],
        `el validador dejó válidas otras familias: ${familias.join(',')}`);
    });

    await t.test('con las cinco tareas terminales, recalcular_cobertura pone true y deja bitácora', () => {
      for (const a of ESPECIALISTAS) cerrarTarea(tareas[a], 'terminado');

      const estados = filas(DB_QA,
        `select estado, count(*)::text from forense.tareas_agente
          where caso_id = ${lit(caso)} group by 1 order by 1`);
      assert.deepEqual(estados, [['completada', '5']],
        `finish_step no dejó las cinco tareas completadas: ${JSON.stringify(estados)}`);

      const v = escalar(DB_QA,
        `select forense.recalcular_cobertura(${lit(caso)}::uuid, 'qa-integracion')::text`);
      assert.equal(v, 'true',
        'cinco tareas completadas, sin frontera pendiente y sin limitaciones: debía dar true. ' +
        `Términos de la regla: ${diagnosticoCobertura(caso)}`);
      assert.equal(escalar(DB_QA,
        `select cobertura_completa::text from forense.casos where id = ${lit(caso)}`), 'true',
        'recalcular_cobertura devolvió true pero no lo persistió');

      // Regla 2: si no dejó bitácora, el paso no existió.
      const ev = filas(DB_QA, `
        select payload->>'antes', payload->>'despues', payload->>'motivo'
          from forense.bitacora
         where caso_id = ${lit(caso)} and tipo_evento = 'validacion'
           and payload->>'evento_real' = 'cobertura_recalculada'
         order by id desc limit 1`);
      assert.equal(ev.length, 1, 'recalcular_cobertura no dejó evento en forense.bitacora');
      assert.deepEqual(ev[0], ['false', 'true', 'qa-integracion']);
    });

    await t.test('el dictamen determinista da presuncion con dos familias (y nunca "definitivo")', () => {
      const paquete = paqueteComoLoVeElCodeNode(caso);
      assert.equal(paquete.cobertura_completa, true,
        'paquete_auditor_final no lleva la cobertura calculada: el dictaminador leería false');
      assert.equal((paquete.pendientes ?? []).length, 0,
        `el caso tiene limitaciones abiertas: ${JSON.stringify(paquete.pendientes)}`);

      const dictamen = dictaminar(paquete);
      console.log(`[dictamen] nivel=${dictamen.nivel} familias=${dictamen.familias.join(',')} ` +
        `regla="${dictamen.regla}" cobertura=${paquete.cobertura_completa} ` +
        `evidencia=${(paquete.evidencia ?? []).length} pistas=${(paquete.pistas ?? []).length}`);

      assert.ok(NIVELES.includes(dictamen.nivel), `nivel fuera del catálogo: ${dictamen.nivel}`);
      assert.deepEqual(dictamen.familias, ['F', 'T']);
      assert.equal(dictamen.nivel, 'presuncion',
        `dos familias sustentadas y cobertura completa tienen que dar presuncion, no ${dictamen.nivel}`);
      assert.notEqual(dictamen.nivel, 'definitivo',
        'el nivel máximo del sistema es presuncion_alta: "definitivo" lo determina la autoridad (regla 7)');
      assert.equal(dictamen.rechazo, null, 'sin limitaciones reparables no hay reintento que pedir');
      assert.match(String(dictamen.monto_en_riesgo_centavos), /^[0-9]+$/,
        'el monto en riesgo lo resuelve SQL, no el modelo');
    });

    await t.test('una tarea en error devuelve la cobertura a false y el dictamen a no_concluyente', () => {
      // Ausencia de señal no es ausencia de fraude: 'error' y 'timeout' NO son
      // estados terminales para la cobertura, aunque sí lo sean para la barrera.
      const r = json(DB_QA, `forense.crear_tareas_ronda(${lit(caso)}::uuid, 2,
        array['auditor']::text[])`);
      assert.equal(r.ok, true, `crear_tareas_ronda (ronda 2) falló: ${JSON.stringify(r)}`);
      const tareaAuditor = escalar(DB_QA,
        `select id::text from forense.tareas_agente
          where caso_id = ${lit(caso)} and ronda = 2 order by id limit 1`);
      assert.ok(tareaAuditor, 'la ronda 2 no despachó ninguna tarea');

      cerrarTarea(tareaAuditor, 'error', 'timeout del proveedor (simulado por QA)');
      assert.equal(escalar(DB_QA,
        `select estado from forense.tareas_agente where id = ${lit(tareaAuditor)}`), 'error');

      const v = escalar(DB_QA,
        `select forense.recalcular_cobertura(${lit(caso)}::uuid, 'qa-integracion-error')::text`);
      assert.equal(v, 'false', 'una tarea en error tiene que dejar la cobertura en false');

      const paquete = paqueteComoLoVeElCodeNode(caso);
      assert.equal(paquete.cobertura_completa, false,
        'el paquete del auditor no refleja el false del error');

      const dictamen = dictaminar(paquete);
      assert.equal(dictamen.nivel, 'no_concluyente',
        `sin cobertura completa el nivel sólo puede ser no_concluyente, y salió ${dictamen.nivel}. ` +
        'La MISMA evidencia de dos familias que hace un momento daba presuncion: lo que cambió ' +
        'es que una familia dejó de estar cubierta, y agotar reintentos nunca sube el nivel (regla 10).');
    });
  });
