// n8n/runtime/nodos/clasificar-transporte.mjs — fuente del Code node
// «Clasificar transporte» del worker (17 §6).
//
// Misma política que n8n/runtime/transporte.mjs, inlineada porque un Code node
// de n8n no puede importar módulos del repositorio. El test compara ambas
// implementaciones sobre los mismos casos para que no se separen.
//
//  - 429 / 5xx / 408: reintentable, hasta DOS reintentos de transporte dentro
//    del deadline; `Retry-After` manda sobre el backoff calculado.
//  - timeout o conexión cortada: AMBIGUO. Puede haber coste en el proveedor sin
//    respuesta: no se reintenta solo y no se afirma exactly-once.
//  - Un reintento de transporte NO es un reintento forense ni consume otro
//    request de cuota.

export function clasificarTransporteNodo(x) {
  // <<<CODE_NODE_INICIO
  const BASE_BACKOFF_MS = 500;
  const MAX_BACKOFF_MS = 8000;
  const MAX_REINTENTOS = Number(x.max_reintentos ?? 2);
  // n8n con `fullResponse: true` entrega `statusCode`; el transporte inyectado
  // de los tests usa `status`. Se aceptan ambos: si solo se leyera `status`, un
  // 200 real caería en la rama de error.
  const crudoStatus = x.status !== undefined && x.status !== null ? x.status : x.statusCode;
  const status = crudoStatus === undefined || crudoStatus === null ? null : Number(crudoStatus);
  const tipo = x.tipo ?? null;
  const intento = Number(x.intento ?? 1);
  const ahora = Number(x.ahora_ms ?? Date.parse(x.ahora ?? new Date().toISOString()));
  const limite = x.deadline_at ? Date.parse(x.deadline_at) : Number.POSITIVE_INFINITY;
  const headers = x.headers ?? {};

  let clase;
  if (tipo === 'timeout' || tipo === 'conexion_interrumpida') clase = 'ambiguo';
  else if (status === null) clase = 'error';
  else if (status >= 200 && status < 300) clase = 'ok';
  else if (status === 429 || status === 408 || status >= 500) clase = 'reintentable';
  else clase = 'error';

  const crudo = headers['retry-after'] ?? headers['Retry-After'] ?? null;
  let segundos = null;
  if (crudo !== null && crudo !== undefined && crudo !== '') {
    const numero = Number(crudo);
    if (Number.isFinite(numero)) segundos = numero;
    else {
      const fecha = Date.parse(String(crudo));
      if (Number.isFinite(fecha)) segundos = Math.max(0, (fecha - ahora) / 1000);
    }
  }
  const aleatorio = x.aleatorio === undefined || x.aleatorio === null ? Math.random() : Number(x.aleatorio);
  const techo = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, intento - 1)));
  const espera_ms = segundos !== null ? Math.max(0, Math.round(segundos * 1000)) : Math.round(techo * aleatorio);

  const cabeEnDeadline = ahora + espera_ms < limite;
  const reintentar = clase === 'reintentable' && intento <= MAX_REINTENTOS && cabeEnDeadline;
  // Ruta EXCLUYENTE para el switch del workflow: una respuesta correcta no
  // puede caer además en la rama de «desconocido».
  let ruta;
  if (clase === 'ok') ruta = 'continuar';
  else if (reintentar) ruta = 'reintentar';
  else if (clase === 'ambiguo') ruta = 'desconocido';
  else ruta = 'error';
  const salida = {
    clase,
    ruta,
    espera_ms: reintentar ? espera_ms : 0,
    intento,
    reintentar,
    retry_after_respetado: segundos !== null,
    motivo: clase === 'ambiguo'
      ? 'timeout_ambiguo: posible consumo externo sin respuesta; no se reintenta automáticamente'
      : clase === 'reintentable' && !reintentar
        ? (cabeEnDeadline ? 'reintentos_transporte_agotados' : 'deadline_excedido')
        : null,
  };
  // <<<CODE_NODE_FIN
  return salida;
}
