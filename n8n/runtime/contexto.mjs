// n8n/runtime/contexto.mjs — constructor del paquete de contexto (17 §7).
//
// Principio de 03: el contexto de un agente NO crece con el dataset. Aquí se
// impone por construcción: el envelope lleva resúmenes e IDs, nunca el dataset,
// y los techos recortan FILAS COMPLETAS, jamás JSON a la mitad.
//
// Dos techos distintos y acumulativos (17 §7):
//   - tokens de entrada: 8k especialista, 16k Auditor/Defensor/Réplica, 24k Redactor/Editor.
//   - caracteres del paquete inicial (08): 12k especialista, 24k Auditor/Defensor.
//
// ACL codificada:
//   - R1 (especialista, ronda 1, intento 0): titulares SIEMPRE vacíos. Ninguna
//     señal ajena, ninguna hipótesis, ningún dictamen. `forense_leer_senal`
//     queda fuera de su allowlist (ver provider/messages.mjs).
//   - R2 / reintento: titulares del snapshot de barrera (una línea por señal).
//   - Redactor: solo hechos VALIDADOS; sin hipótesis ni señales libres.
//   - Defensor: sin dictamen (aún no es conclusión consumada).

import { createHash } from 'node:crypto';
import { validateContract } from '../../contracts/index.mjs';
import { ROLES_ESPECIALISTA, TECHO_CARACTERES_PAQUETE, TECHO_TOKENS_ENTRADA } from './config.mjs';

export const SCHEMA_VERSION = 'contexto.v1';
export const HASH_PLACEHOLDER = '0'.repeat(64);

const CAMPOS_DATOS_CIERRE = ['senal_ids', 'evidencia', 'argumentos', 'resoluciones', 'hipotesis',
  'dictamen', 'version_base', 'documento', 'seleccion', 'limitaciones'];

export function sha256(texto) {
  return createHash('sha256').update(texto).digest('hex');
}

/** Hash del contenido del contexto, excluyendo el propio `context_hash`. */
export function hashContexto(contexto) {
  const { context_hash, ...resto } = contexto;
  return sha256(JSON.stringify(ordenar(resto)));
}

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, ordenar(valor[k])]));
  }
  return valor;
}

// El contrato `runtime.contexto` fuerza `titulares: maxItems 0` para cualquier
// especialista con `ronda === 1` (allOf), independientemente del intento: los
// reintentos dirigidos usan `ronda = 2` (07 §3). Aquí se respeta esa regla.
export function esEspecialistaR1({ rol, ronda }) {
  return ROLES_ESPECIALISTA.includes(rol) && ronda === 1;
}

/** Aproximación de tokens para el techo de ingeniería; el conteo real lo da el proveedor. */
export function tokensAproximados(texto) {
  return Math.ceil(texto.length / 3.6);
}

function limitacion(codigo, descripcion, referencias = []) {
  return { codigo, descripcion, referencias };
}

/**
 * Recorta filas completas hasta caber en el techo de caracteres.
 * Orden de sacrificio: lo más voluminoso y menos decisivo primero.
 */
export function acotarDatos(datos, techo_caracteres) {
  const orden = ['titulares', 'resoluciones', 'argumentos', 'evidencia', 'pistas', 'senal_ids'];
  const copia = structuredClone(datos);
  const recortes = [];
  let texto = JSON.stringify(copia);
  for (const campo of orden) {
    while (texto.length > techo_caracteres && Array.isArray(copia[campo]) && copia[campo].length > 0) {
      copia[campo] = copia[campo].slice(0, -1);
      const previo = recortes.find((r) => r.campo === campo);
      if (previo) previo.filas += 1; else recortes.push({ campo, filas: 1 });
      texto = JSON.stringify(copia);
    }
    if (texto.length <= techo_caracteres) break;
  }
  return { datos: copia, recortes, caracteres: texto.length, cabe: texto.length <= techo_caracteres };
}

/**
 * Construye y valida el envelope de 17 §7 contra `runtime.contexto`.
 * @returns {{ok:true, contexto:object, limitaciones:Array, caracteres:number, tokens_aprox:number}
 *          |{ok:false, error:object, errores:Array}}
 */
export function construirContexto(entrada) {
  const {
    execution_id, tarea_id = null, editor_operacion_id = null, caso_id, corrida_id, cluster_id,
    rol, ronda = 1, intento = 0, version_contexto = 1, dataset_hash, fecha_corte,
    familias_evaluables, prompt_hash, directriz_id = null, directriz_version = null,
    objetivo, limites, cobertura, datos,
  } = entrada;

  const esEspecialista = ROLES_ESPECIALISTA.includes(rol);
  const limitaciones = [];
  let datosFiltrados = esEspecialista
    ? filtrarEspecialista({ rol, ronda, intento, datos, limitaciones })
    : filtrarCierre({ rol, datos, limitaciones });

  const techoCaracteres = TECHO_CARACTERES_PAQUETE[rol];
  const acotado = acotarDatos(datosFiltrados, techoCaracteres);
  datosFiltrados = acotado.datos;
  for (const recorte of acotado.recortes) {
    limitaciones.push(limitacion('cobertura_incompleta',
      `Se omitieron ${recorte.filas} fila(s) de ${recorte.campo} por el techo de ${techoCaracteres} caracteres del paquete.`));
  }
  if (!acotado.cabe) {
    return {
      ok: false,
      error: { codigo: 'contexto_invalido', mensaje: `el paquete no cabe en ${techoCaracteres} caracteres ni recortando filas`, reintentable: false },
      errores: [],
    };
  }

  const objetivoAcotado = String(objetivo ?? '').slice(0, 2400);
  const contexto = {
    schema_version: SCHEMA_VERSION,
    execution_id,
    tarea_id,
    editor_operacion_id,
    caso_id,
    corrida_id,
    cluster_id,
    rol,
    ronda,
    intento,
    version_contexto,
    dataset_hash,
    fecha_corte,
    familias_evaluables,
    prompt_hash,
    context_hash: HASH_PLACEHOLDER,
    directriz_id,
    directriz_version,
    objetivo: objetivoAcotado,
    limites: {
      tools_restantes: limites.tools_restantes,
      requests_restantes: limites.requests_restantes ?? null,
      deadline_at: limites.deadline_at,
      input_tokens_max: limites.input_tokens_max ?? TECHO_TOKENS_ENTRADA[rol],
    },
    cobertura: agregarLimitaciones(cobertura, limitaciones),
    datos: datosFiltrados,
  };
  contexto.context_hash = hashContexto(contexto);

  const validacion = validateContract('runtime.contexto', contexto);
  if (!validacion.ok) {
    return {
      ok: false,
      error: { codigo: 'contexto_invalido', mensaje: 'el envelope no valida contra runtime.contexto', reintentable: false },
      errores: validacion.errors,
      contexto,
    };
  }
  const serializado = JSON.stringify(contexto);
  const tokens = tokensAproximados(serializado);
  return {
    ok: true,
    contexto,
    limitaciones,
    caracteres: serializado.length,
    tokens_aprox: tokens,
    excede_techo_tokens: tokens > contexto.limites.input_tokens_max,
  };
}

function agregarLimitaciones(cobertura, limitaciones) {
  if (limitaciones.length === 0) return cobertura;
  const ausentes = [...new Set([...(cobertura.datos_ausentes ?? []), ...limitaciones.map((l) => l.codigo)])];
  return { ...cobertura, completa: false, datos_ausentes: ausentes.slice(0, 40) };
}

function filtrarEspecialista({ rol, ronda, intento, datos, limitaciones }) {
  const familia = { documental: 'D', financiero: 'F', relacional: 'R', temporal: 'T', externo: 'E' }[rol];
  const pistas = (datos.pistas ?? []).filter((p) => p.familia === familia);
  const descartadas = (datos.pistas ?? []).length - pistas.length;
  if (descartadas > 0) {
    limitaciones.push(limitacion('cobertura_incompleta',
      `Se excluyeron ${descartadas} pista(s) de otras familias: cada especialista solo ve la suya.`));
  }
  const r1 = esEspecialistaR1({ rol, ronda, intento });
  const titulares = r1 ? [] : (datos.titulares ?? []).map((t) => ({ id: t.id, familia: t.familia, titular: t.titular }));
  return {
    rfcs: [...new Set(datos.rfcs ?? [])].slice(0, 40),
    pistas: pistas.slice(0, 40),
    titulares: titulares.slice(0, 80),
  };
}

function filtrarCierre({ rol, datos, limitaciones }) {
  const base = Object.fromEntries(CAMPOS_DATOS_CIERRE.map((c) => [c, valorPorDefecto(c)]));
  const fuente = { ...base, ...datos };
  let evidencia = fuente.evidencia ?? [];
  let hipotesis = fuente.hipotesis ?? null;
  let dictamen = fuente.dictamen ?? null;
  let senal_ids = fuente.senal_ids ?? [];

  if (rol === 'redactor') {
    const antes = evidencia.length;
    evidencia = evidencia.filter((e) => e.validada === true && e.refutada !== true);
    if (antes !== evidencia.length) {
      limitaciones.push(limitacion('cobertura_incompleta',
        `El Redactor solo recibe hechos validados: se excluyeron ${antes - evidencia.length} evidencia(s).`));
    }
    hipotesis = null; // sin señales libres ni razonamiento privado
    senal_ids = [];
    // El dictamen determinista SÍ viaja al Redactor (17 §7 y el contrato lo
    // exige como objeto); lo calcula auditor-final.mjs, nunca el LLM.
  }
  if (rol === 'defensor') {
    dictamen = null; // aún no es conclusión consumada (17 §7)
  }
  if (rol === 'replica') {
    dictamen = null; // la Réplica no decide nivel
    hipotesis = null;
  }
  return {
    senal_ids: [...new Set(senal_ids)].slice(0, 80),
    evidencia: evidencia.slice(0, 40),
    argumentos: (fuente.argumentos ?? []).slice(0, 40),
    resoluciones: (fuente.resoluciones ?? []).slice(0, 40),
    hipotesis,
    dictamen,
    version_base: fuente.version_base ?? null,
    documento: fuente.documento ?? null,
    seleccion: fuente.seleccion ?? null,
    limitaciones: (fuente.limitaciones ?? []).slice(0, 40),
  };
}

function valorPorDefecto(campo) {
  if (['senal_ids', 'evidencia', 'argumentos', 'resoluciones', 'limitaciones'].includes(campo)) return [];
  return null;
}
