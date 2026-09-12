// n8n/runtime/barrera.mjs — barrera de ronda sobre el conjunto despachado (03, 07, 17 §3).
//
//  - La ronda guarda el CONJUNTO EXACTO de `tarea_id` despachados. La barrera
//    espera esos IDs, no «cinco tareas» ni filas indiscriminadas de la tabla.
//  - Terminal = completada | error | timeout | omitida. Error y timeout son
//    limitaciones, no ausencia de fraude.
//  - Filas de otro caso/ronda/cluster se ignoran explícitamente y se cuentan
//    como `ajenas_ignoradas` para que el fallo sea visible, no silencioso.
//  - Toda barrera tiene deadline. Un conjunto vacío (nadie despertado) avanza
//    UNA sola vez y va directo al siguiente paso.

export const ESTADOS_TERMINALES_TAREA = Object.freeze(['completada', 'error', 'timeout', 'omitida']);

export function esTerminalTarea(estado) {
  return ESTADOS_TERMINALES_TAREA.includes(estado);
}

export function crearBarrera({ caso_id, ronda, intento = 0, tarea_ids, deadline_at, snapshot_senales = [] }) {
  const esperadas = new Set(tarea_ids ?? []);
  if (esperadas.size !== (tarea_ids ?? []).length) throw new Error('tarea_ids duplicados en la barrera');
  let avanzada = false;

  /**
   * @param {Array<{id:string, caso_id?:string, ronda?:number, intento?:number, estado:string}>} filas
   * @returns {{completa:boolean, estado:string, terminales:string[], faltantes:string[],
   *   ajenas_ignoradas:number, vencida:boolean, snapshot_senales:Array}}
   */
  function evaluar(filas = [], ahora = Date.now()) {
    const terminales = [];
    const pendientes = new Map();
    let ajenas = 0;
    for (const fila of filas) {
      if (!esperadas.has(fila.id)) { ajenas += 1; continue; }
      if (fila.caso_id !== undefined && caso_id !== undefined && fila.caso_id !== caso_id) { ajenas += 1; continue; }
      if (fila.ronda !== undefined && ronda !== undefined && fila.ronda !== ronda) { ajenas += 1; continue; }
      if (fila.intento !== undefined && intento !== undefined && fila.intento !== intento) { ajenas += 1; continue; }
      if (esTerminalTarea(fila.estado)) terminales.push(fila.id);
      else pendientes.set(fila.id, fila.estado);
    }
    const vistos = new Set(terminales);
    const faltantes = [...esperadas].filter((id) => !vistos.has(id));
    const vencida = deadline_at ? ahora >= Date.parse(deadline_at) : false;
    const completa = faltantes.length === 0;
    return {
      completa,
      estado: completa ? 'completa' : vencida ? 'vencida' : 'esperando',
      terminales: [...vistos],
      faltantes,
      pendientes: [...pendientes.keys()],
      ajenas_ignoradas: ajenas,
      vencida,
      snapshot_senales,
    };
  }

  /** Guarda de avance único: dos callbacks no disparan dos veces al Auditor. */
  function avanzar(evaluacion) {
    if (avanzada) return { avanza: false, motivo: 'ya_avanzada' };
    if (!evaluacion.completa && !evaluacion.vencida) return { avanza: false, motivo: 'incompleta' };
    avanzada = true;
    return {
      avanza: true,
      motivo: evaluacion.completa ? 'conjunto_terminal' : 'deadline_barrera',
      faltantes: evaluacion.faltantes,
      limitaciones: evaluacion.completa ? [] : [{
        codigo: 'cobertura_incompleta',
        descripcion: `La barrera venció con ${evaluacion.faltantes.length} tarea(s) sin estado terminal.`,
        referencias: [],
      }],
    };
  }

  /** Titulares del snapshot que consumirá la ronda 2 (una línea por señal). */
  function titulares() {
    return snapshot_senales.map((s) => ({ id: String(s.id), familia: s.familia, titular: s.titular }));
  }

  return { evaluar, avanzar, titulares, esperadas: () => [...esperadas], yaAvanzo: () => avanzada };
}
