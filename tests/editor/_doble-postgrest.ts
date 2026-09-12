import { desdeMarkdown } from "@/lib/document/markdown";
import type { ClienteForense, ConsultaForense, RespuestaPostgrest } from "@/lib/document/repositorio";
import redactorFixture from "@contracts/fixtures/valid/redactor.json";

/**
 * Doble en memoria con la forma de PostgREST (`from().select().eq().order()`,
 * `insert()`, `update()`, `maybeSingle()`, `rpc()`) más un almacén que imita
 * `forense.expedientes`, `forense.propuestas_edicion`, `forense.casos` y
 * `forense.bitacora` con sus índices UNIQUE. Compartido por las pruebas del
 * repositorio y por las de ruta en modo supabase: no hay red en ninguna.
 *
 * `rpc('aplicar_propuesta')` reproduce 006 §7, incluido su evento `edicion`.
 */

export const CASO = "00000000-0000-4000-8000-000000000100";
export const CORRIDA = "00000000-0000-4000-8000-000000000001";
export const PROPUESTA = "00000000-0000-4000-8000-000000000403";

export type Fila = Record<string, unknown>;

export interface Almacen {
  expedientes: Fila[];
  casos: Fila[];
  propuestas_edicion: Fila[];
  bitacora: Fila[];
  rpc: { nombre: string; args: Record<string, unknown> }[];
}

export function crearAlmacen(): Almacen {
  const documento = desdeMarkdown(redactorFixture.markdown);
  return {
    expedientes: [
      {
        caso_id: CASO,
        idempotency_key: "redactor:1",
        version: 1,
        markdown: redactorFixture.markdown,
        contenido_json: documento,
        autor: "agente",
        estado_revision: "borrador",
        creado: "2026-09-12T00:00:00Z",
      },
    ],
    casos: [{ id: CASO, corrida_id: CORRIDA }],
    // VACÍO a propósito: si el BFF no inserta la propuesta, aplicar/descartar
    // no pueden funcionar. Esa era la ruta de escritura que faltaba.
    propuestas_edicion: [],
    bitacora: [],
    rpc: [],
  };
}

/**
 * Opciones del doble. `revertirExpediente` decide si `forense.revertir_expediente`
 * (migración 010, forense-db) EXISTE: con `false` —el estado de main hoy— la
 * llamada devuelve el `PGRST202` de PostgREST, que es lo único que autoriza al
 * BFF a usar su camino a mano. `errorRevertir` fuerza un fallo AMBIGUO (la
 * función existe y revienta) para comprobar que entonces NO hay respaldo.
 */
export interface OpcionesDoble {
  revertirExpediente?: boolean;
  errorRevertir?: { message: string; code?: string };
}

/** Doble con la forma de PostgREST: `from().select().eq().order()`, `rpc()`. */
export function clienteFalso(almacen: Almacen, opciones: OpcionesDoble = {}): ClienteForense {
  function consulta(tabla: string): ConsultaForense {
    const filtros: [string, unknown][] = [];
    let operacion: { tipo: "select" } | { tipo: "update" | "insert"; valores: Fila } = { tipo: "select" };
    let ordenPor: string | null = null;

    function ejecutar(): RespuestaPostgrest {
      const filas = (almacen as unknown as Record<string, Fila[]>)[tabla];
      if (!filas) return { data: null, error: { message: `tabla desconocida: ${tabla}` } };
      const coincide = (f: Fila) => filtros.every(([c, v]) => f[c] === v);
      if (operacion.tipo === "insert") {
        // Índices UNIQUE reales: ux_expedientes (idempotency_key),
        // ux_propuestas_request (request_id) y la PK id.
        for (const columna of ["idempotency_key", "request_id", "id"]) {
          const clave = operacion.valores[columna];
          if (clave !== undefined && clave !== null && filas.some((f) => f[columna] === clave)) {
            return { data: null, error: { message: `duplicate key (${columna})` } };
          }
        }
        filas.push({ ...operacion.valores });
        return { data: null, error: null };
      }
      if (operacion.tipo === "update") {
        const valores = operacion.valores;
        filas.filter(coincide).forEach((f) => Object.assign(f, valores));
        return { data: null, error: null };
      }
      let datos = filas.filter(coincide);
      if (ordenPor) {
        const columna = ordenPor;
        datos = [...datos].sort((a, b) => Number(a[columna]) - Number(b[columna]));
      }
      return { data: datos, error: null };
    }

    const api: ConsultaForense = {
      select: () => api,
      eq: (columna, valor) => {
        filtros.push([columna, valor]);
        return api;
      },
      order: (columna) => {
        ordenPor = columna;
        return api;
      },
      update: (valores) => {
        operacion = { tipo: "update", valores };
        return api;
      },
      insert: (valores) => {
        operacion = { tipo: "insert", valores };
        return api;
      },
      maybeSingle: () => {
        const r = ejecutar();
        const dato = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return Promise.resolve({ data: dato, error: r.error });
      },
      then: (resolver, rechazar) => Promise.resolve(ejecutar()).then(resolver, rechazar),
    };
    return api;
  }

  return {
    from: consulta,
    /** Imita `forense.aplicar_propuesta` de 006 §7 (incluido su log de bitácora). */
    rpc(nombre, args = {}) {
      almacen.rpc.push({ nombre, args });
      // `forense.log` (002 §1): asigna seq y resuelve corrida desde `casos`.
      if (nombre === "log") {
        const caso = almacen.casos.find((c) => c.id === args.p_caso);
        if (!caso) return Promise.resolve({ data: null, error: { message: "caso inexistente", code: "P0002" } });
        almacen.bitacora.push({
          corrida_id: caso.corrida_id,
          caso_id: args.p_caso,
          seq: almacen.bitacora.length + 1,
          agente: args.p_agente,
          tipo_evento: args.p_tipo,
          payload: args.p_payload,
        });
        return Promise.resolve({ data: null, error: null });
      }
      if (nombre === "revertir_expediente") {
        if (opciones.errorRevertir) return Promise.resolve({ data: null, error: opciones.errorRevertir });
        if (!opciones.revertirExpediente) {
          return Promise.resolve({
            data: null,
            error: {
              code: "PGRST202",
              message: "Could not find the function forense.revertir_expediente in the schema cache",
            },
          });
        }
        // La idempotencia se mira ANTES que el conflicto: el doble click
        // manda dos veces la misma `version_base`, y la segunda llega cuando
        // la reversión ya subió la cabeza. Si se mirara el conflicto primero,
        // un doble click sería 409 en vez de la misma versión.
        const clave = `revertir:${String(args.p_idempotency)}`;
        const yaHecha = almacen.expedientes.find((e) => e.idempotency_key === clave);
        if (yaHecha) {
          return Promise.resolve({ data: { ok: true, revertida: false, version: yaHecha.version }, error: null });
        }
        const maxima = Math.max(...almacen.expedientes.map((e) => Number(e.version)));
        if (Number(args.p_version_base) !== maxima) {
          return Promise.resolve({ data: { ok: false, error: "conflicto_version", version_actual: maxima }, error: null });
        }
        const objetivo = almacen.expedientes.find((e) => Number(e.version) === Number(args.p_version_objetivo));
        if (!objetivo) return Promise.resolve({ data: { ok: false, error: "version_inexistente" }, error: null });
        const nueva = maxima + 1;
        almacen.expedientes.push({
          caso_id: args.p_caso,
          idempotency_key: clave,
          version: nueva,
          markdown: objetivo.markdown,
          contenido_json: objetivo.contenido_json,
          // Marca de autoría del SERVIDOR: si esta fila lleva `servidor`, la
          // escribió la función, no el INSERT a mano del BFF.
          autor: "servidor",
          estado_revision: "borrador",
          creado: "2026-09-12T02:00:00Z",
        });
        almacen.bitacora.push({
          corrida_id: CORRIDA,
          caso_id: args.p_caso,
          agente: "editor",
          tipo_evento: "edicion",
          payload: { evento_real: "revertir", version_objetivo: args.p_version_objetivo, version_resultante: nueva },
        });
        return Promise.resolve({ data: { ok: true, revertida: true, version: nueva }, error: null });
      }
      if (nombre !== "aplicar_propuesta") {
        // PostgREST responde así a una función que no está en el cache de
        // esquema; el código es lo que el BFF mira, no el texto.
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: `rpc desconocida: ${nombre}` },
        });
      }
      const propuesta = almacen.propuestas_edicion.find((p) => p.id === args.p_propuesta);
      if (!propuesta) return Promise.resolve({ data: { ok: false, error: "contexto_invalido" }, error: null });
      if (propuesta.estado === "aplicada") {
        return Promise.resolve({
          data: { ok: true, aplicada: false, motivo: "ya_aplicada", version: propuesta.version_resultante },
          error: null,
        });
      }
      const maxima = Math.max(...almacen.expedientes.map((e) => Number(e.version)));
      if (Number(propuesta.version_base) !== maxima) {
        propuesta.estado = "conflicto";
        return Promise.resolve({
          data: { ok: false, error: "conflicto_version", version_base: propuesta.version_base, version_actual: maxima },
          error: null,
        });
      }
      const nueva = maxima + 1;
      const anterior = almacen.expedientes.find((e) => Number(e.version) === maxima);
      almacen.expedientes.push({
        caso_id: CASO,
        idempotency_key: `propuesta:${String(args.p_propuesta)}`,
        version: nueva,
        // 006 §7: `coalesce(p_markdown, markdown de la versión anterior)` y
        // `coalesce(p_contenido_json, p.patch)`. Reproducirlos es lo que hace
        // visible el desfase JSON/Markdown si el BFF no manda el markdown.
        markdown: args.p_markdown ?? anterior?.markdown ?? "",
        contenido_json: args.p_contenido_json ?? propuesta.patch ?? {},
        autor: "humano",
        estado_revision: "borrador",
        creado: "2026-09-12T01:00:00Z",
      });
      propuesta.estado = "aplicada";
      propuesta.version_resultante = nueva;
      almacen.bitacora.push({
        corrida_id: CORRIDA,
        caso_id: CASO,
        agente: "editor",
        tipo_evento: "edicion",
        payload: { propuesta_id: args.p_propuesta, version_resultante: nueva },
      });
      return Promise.resolve({ data: { ok: true, aplicada: true, version: nueva }, error: null });
    },
  };
}

