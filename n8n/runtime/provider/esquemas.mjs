// n8n/runtime/provider/esquemas.mjs — JSON Schema de herramientas para el proveedor.
//
// Los `input_schema` que ve el modelo se DERIVAN de contracts v1
// (`tools.schema.json` $defs), que ya excluye identidad, operación y fencing
// (06 «Contrato del dispatcher»). No se reescriben a mano: se resuelven los
// `$ref` locales y se quitan `$id`/`$schema`, porque el proveedor no puede
// resolver `https://forense.invalid/...`.

import fs from 'node:fs';

const DIRECTORIO = new URL('../../../contracts/schemas/', import.meta.url);

const cacheArchivos = new Map();

function cargar(nombreArchivo) {
  if (!cacheArchivos.has(nombreArchivo)) {
    cacheArchivos.set(nombreArchivo, JSON.parse(fs.readFileSync(new URL(nombreArchivo, DIRECTORIO), 'utf8')));
  }
  return cacheArchivos.get(nombreArchivo);
}

function archivoDesdeId(id) {
  const nombre = id.split('/').pop();
  return nombre;
}

function resolverRef(ref) {
  const [base, puntero] = ref.split('#');
  const archivo = base ? archivoDesdeId(base) : null;
  const esquema = archivo ? cargar(archivo) : null;
  if (!esquema) throw new Error(`no se pudo resolver $ref: ${ref}`);
  let nodo = esquema;
  for (const parte of puntero.split('/').filter(Boolean)) {
    nodo = nodo[parte.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (nodo === undefined) throw new Error(`puntero inexistente en ${ref}`);
  }
  return nodo;
}

const CLAVES_FUERA = new Set(['$id', '$schema', '$defs', 'title']);

/** Inlining recursivo de `$ref` con detección de ciclos por profundidad acotada. */
export function desreferenciar(nodo, profundidad = 0) {
  if (profundidad > 12) throw new Error('profundidad máxima al desreferenciar');
  if (Array.isArray(nodo)) return nodo.map((n) => desreferenciar(n, profundidad + 1));
  if (!nodo || typeof nodo !== 'object') return nodo;
  if (typeof nodo.$ref === 'string') {
    const destino = desreferenciar(resolverRef(nodo.$ref), profundidad + 1);
    const resto = { ...nodo };
    delete resto.$ref;
    return { ...destino, ...desreferenciar(resto, profundidad + 1) };
  }
  const salida = {};
  for (const [clave, valor] of Object.entries(nodo)) {
    if (CLAVES_FUERA.has(clave)) continue;
    salida[clave] = desreferenciar(valor, profundidad + 1);
  }
  return salida;
}

// Descripciones operativas tomadas de la tabla de 06. No son prompt de rol
// (esos los posee forense-prompts); describen el contrato de la RPC.
export const DESCRIPCIONES_HERRAMIENTA = Object.freeze({
  forense_perfil: 'Perfil agregado de un RFC del cluster: giro, alta, nómina, facturado/recibido 12m, cuentas, listas SAT y pistas de ese RFC.',
  forense_facturas: 'Hasta 50 CFDI del RFC (emitidos o recibidos) en una ventana [p_desde, p_hasta) con cursor keyset estable.',
  forense_conciliar: 'Concilia un CFDI con movimientos bancarios candidatos y complementos de pago; devuelve estado de pago.',
  forense_seguir_dinero: 'Árbol de movimientos salientes desde una cuenta, hasta 4 saltos, con tipo de destino y porcentaje conservado.',
  forense_relacionados: 'RFC que comparten atributos con el indicado y si se facturan o se transfieren dinero entre sí.',
  forense_ciclos: 'Ciclos y cadenas de facturación que pasan por el RFC: ruta, uuids, montos y días.',
  forense_pares: 'Métricas del RFC contra los percentiles p10/p50/p90 de su giro.',
  forense_listas: 'Estatus en listas del SAT (art. 69-B) del RFC y de contrapartes hasta 2 saltos, con fechas de publicación.',
  forense_leer_senal: 'Detalle completo de una señal del pizarrón autorizada para esta tarea.',
  forense_escribir_senal: 'Escribe una señal compacta en el pizarrón del cluster (titular de una línea, IDs, frontera y confianza).',
  forense_registrar_evidencia: 'Registra evidencia propuesta con sus referencias por ID; la validación posterior es determinista.',
});

export const NOMBRES_HERRAMIENTA = Object.freeze(Object.keys(DESCRIPCIONES_HERRAMIENTA));

const cacheTools = new Map();

/** `input_schema` autocontenido para una herramienta. */
export function esquemaEntrada(nombre) {
  if (!cacheTools.has(nombre)) {
    const tools = cargar('tools.schema.json');
    const def = tools.$defs[nombre];
    if (!def) throw new Error(`herramienta desconocida en contracts: ${nombre}`);
    const esquema = desreferenciar(def);
    if (esquema.type !== 'object') throw new Error(`input_schema de ${nombre} debe ser object`);
    cacheTools.set(nombre, Object.freeze(esquema));
  }
  return cacheTools.get(nombre);
}

/** Definición de herramienta en el formato del proveedor Messages. */
export function definicionHerramienta(nombre) {
  return {
    name: nombre,
    description: DESCRIPCIONES_HERRAMIENTA[nombre] ?? nombre,
    input_schema: esquemaEntrada(nombre),
  };
}

/** Contrato de salida por rol: el schema de `agents.*` desreferenciado. */
export function esquemaSalida(nombreContrato) {
  const [archivo, definicion] = nombreContrato.split('.');
  const esquema = cargar(`${archivo}.schema.json`);
  const def = esquema.$defs[definicion];
  if (!def) throw new Error(`contrato desconocido: ${nombreContrato}`);
  return desreferenciar(def);
}
