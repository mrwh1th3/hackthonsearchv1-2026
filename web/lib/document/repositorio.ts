import { createClient } from "@supabase/supabase-js";

/**
 * Cliente mínimo que este repositorio usa. Se escribe a mano (en vez de
 * `SupabaseClient<…>`) por dos razones: el genérico de esquema de
 * `supabase-js` fija `"public"` y el nuestro es `forense`, y así la prueba
 * puede inyectar un doble sin red ni tipos generados.
 */
export interface RespuestaPostgrest {
  data: unknown;
  /**
   * `code` es el código de PostgREST (`PGRST202` = función ausente del cache
   * de esquema). Se necesita para distinguir «la RPC todavía no existe» de
   * «la RPC existe y falló», que exigen caminos opuestos (ver `revertir`).
   */
  error: { message: string; code?: string } | null;
}

export interface ConsultaForense extends PromiseLike<RespuestaPostgrest> {
  select(columnas: string): ConsultaForense;
  eq(columna: string, valor: unknown): ConsultaForense;
  order(columna: string, opciones: { ascending: boolean }): ConsultaForense;
  maybeSingle(): PromiseLike<RespuestaPostgrest>;
  update(valores: Record<string, unknown>): ConsultaForense;
  insert(valores: Record<string, unknown>): ConsultaForense;
}

export interface ClienteForense {
  from(tabla: string): ConsultaForense;
  rpc(nombre: string, args?: Record<string, unknown>): PromiseLike<RespuestaPostgrest>;
}

import {
  aplicarPropuestaGuardada,
  descartarPropuestaGuardada,
  guardarBorrador as guardarBorradorDemo,
  hashContenido,
  borradorActual as borradorActualDemo,
  obtenerVersion as obtenerVersionDemo,
  registrarPropuesta as registrarPropuestaDemo,
  revertirAVersion,
  versionActual as versionActualDemo,
  versiones as versionesDemo,
  type Borrador,
  type ResultadoEscritura,
} from "./almacen-demo";
import { normalizarDocumento } from "./documento";
import { aMarkdown } from "./markdown";
import type { Documento, Propuesta, Reporte } from "./tipos";

/**
 * Persistencia del expediente para las cinco operaciones **deterministas** del
 * editor: versiones, borrador, aplicar, descartar y revertir.
 *
 * Por qué no van al webhook de n8n: `n8n/workflows/MANIFEST.md` §5
 * (`FORENSE_editar_expediente`) tiene **un solo** camino —`POST
 * /webhook/forense/editar`, nodo 2 valida `editor.solicitud` con `modo:
 * pregunta|propuesta`— y su nodo 8 dice literalmente «**Todavía no cambia el
 * expediente**: Aplicar es operación determinista del BFF». No existe nodo de
 * webhook para aplicar/descartar/revertir/borrador/versiones, así que
 * `N8N_WEBHOOK_BASE` **no** habilita estas operaciones: solo habilita
 * `/api/reportes/propuestas`.
 *
 * De ahí las tres modalidades, y la regla que las gobierna (CLAUDE.md regla 2:
 * sin evento en `forense.bitacora` el paso no existió; y la instrucción del
 * verificador: «nunca almacén en memoria como si fuera persistencia»):
 *
 * | Entorno | Modo | `origen` | ¿Bitácora? |
 * |---|---|---|---|
 * | `SUPABASE_SERVICE_ROLE_KEY` + URL | `supabase` | `"supabase"` | sí, en `forense.bitacora` |
 * | fuente de datos = fixture | `fixture` | `"fixture"` | **no** (`bitacora:false` en la respuesta) |
 * | resto (incluido n8n sin service role) | `no_configurado` | — | 503 `backend_no_configurado` |
 *
 * El modo `fixture` sigue existiendo para la demo sin credenciales, pero se
 * **declara** en cada respuesta: la UI nunca puede confundir una demo con una
 * escritura real, y el modo fixture jamás afirma haber escrito bitácora.
 */

export type ModoPersistencia = "supabase" | "fixture" | "no_configurado";

export interface ContextoEdicion {
  /** Perfil de la sesión (`forense.perfiles.id`), para `registrar_actividad`. */
  perfilId?: string | null;
  /** `idempotency_key` de la solicitud → `propuestas_edicion.request_id` (UNIQUE). */
  requestId?: string | null;
  /** `seleccion.texto_hash` de la solicitud, para auditar contra qué se editó. */
  seleccionHash?: string | null;
}

export interface RepositorioExpediente {
  readonly modo: "supabase" | "fixture";
  readonly origen: "supabase" | "fixture";
  /** `true` solo si esta implementación escribe de verdad en `forense.bitacora`. */
  readonly dejaBitacora: boolean;
  versiones(casoId: string): Promise<Reporte[]>;
  versionActual(casoId: string): Promise<Reporte | null>;
  obtenerVersion(casoId: string, version: number): Promise<Reporte | null>;
  guardarBorrador(
    casoId: string,
    args: { version_base: number; documento: Documento },
  ): Promise<ResultadoEscritura<Borrador>>;
  /**
   * Borrador autoguardado vigente para `versionBase`, o `null`. Cada modo
   * sabe DÓNDE vive el suyo; ninguna ruta consulta el almacén en memoria por
   * su cuenta (era la última lectura de memoria que quedaba en modo supabase).
   */
  borrador(casoId: string, versionBase: number): Promise<Borrador | null>;
  aplicar(
    casoId: string,
    args: { propuesta_id: string; version_base: number; idempotency_key: string },
    ctx?: ContextoEdicion,
  ): Promise<ResultadoEscritura<{ reporte: Reporte; repetido: boolean }>>;
  /**
   * Persiste la propuesta ANTES de responderla al cliente. Sin esto, el
   * `propuesta_id` que la UI recibe no existe en `forense.propuestas_edicion`
   * y Aplicar devolvería `contexto_invalido` (006 §7 busca la fila por id).
   * Devuelve el id final: si `request_id` ya estaba (reintento del mismo
   * `idempotency_key`), se reutiliza la propuesta existente.
   */
  registrarPropuesta(
    casoId: string,
    propuesta: Propuesta,
    previsualizacion: Documento,
    ctx?: ContextoEdicion,
  ): Promise<{ ok: boolean; propuestaId: string; repetida: boolean }>;
  /**
   * Descartar no crea versión (07 §4) pero SÍ es un paso: deja evento
   * `edicion` con `payload.evento_real='propuesta_descartada'`. `bitacora`
   * dice si ese evento quedó escrito de verdad.
   */
  descartar(casoId: string, propuestaId: string): Promise<ResultadoEscritura<{ estado: string; bitacora: boolean }>>;
  /**
   * Revertir crea versión nueva (09 §8: el historial no se destruye).
   * `bitacora` dice si el evento `edicion` de ESTA reversión quedó escrito.
   */
  revertir(
    casoId: string,
    args: { version_objetivo: number; version_base: number; idempotency_key: string },
    ctx?: ContextoEdicion,
  ): Promise<ResultadoEscritura<{ reporte: Reporte; repetido: boolean; bitacora: boolean }>>;
}

// ---------------------------------------------------------------------------
// Fixture: el almacén de demostración, SIEMPRE etiquetado.
// ---------------------------------------------------------------------------

export const repositorioFixture: RepositorioExpediente = {
  modo: "fixture",
  origen: "fixture",
  dejaBitacora: false,
  async versiones(casoId) {
    return versionesDemo(casoId);
  },
  async versionActual(casoId) {
    return versionActualDemo(casoId);
  },
  async obtenerVersion(casoId, version) {
    return obtenerVersionDemo(casoId, version);
  },
  async guardarBorrador(casoId, args) {
    return guardarBorradorDemo(casoId, args);
  },
  async borrador(casoId, versionBase) {
    const b = borradorActualDemo(casoId);
    return b && b.version_base === versionBase ? b : null;
  },
  async aplicar(casoId, args) {
    return aplicarPropuestaGuardada(casoId, args);
  },
  async registrarPropuesta(casoId, propuesta, previsualizacion) {
    registrarPropuestaDemo(casoId, propuesta, previsualizacion);
    return { ok: true, propuestaId: propuesta.propuesta_id, repetida: false };
  },
  async descartar(casoId, propuestaId) {
    const r = descartarPropuestaGuardada(casoId, propuestaId);
    // El modo fixture jamás afirma haber escrito bitácora.
    return r.ok ? { ok: true, valor: { estado: r.valor.estado, bitacora: false } } : r;
  },
  async revertir(casoId, args) {
    const r = revertirAVersion(casoId, args);
    return r.ok ? { ok: true, valor: { ...r.valor, bitacora: false } } : r;
  },
};

// ---------------------------------------------------------------------------
// Supabase (service role, servidor): `forense.expedientes` +
// `forense.propuestas_edicion` de la migración 006.
// ---------------------------------------------------------------------------

interface FilaExpediente {
  caso_id: string;
  idempotency_key?: string | null;
  version: number;
  markdown: string | null;
  contenido_json: unknown;
  autor: string | null;
  estado_revision: string | null;
  creado: string | null;
}

function aReporte(fila: FilaExpediente): Reporte {
  const documento = normalizarDocumento(fila.contenido_json ?? { type: "doc", content: [] });
  const markdown = fila.markdown ?? aMarkdown(documento);
  return {
    caso_id: fila.caso_id,
    version: fila.version,
    estado_revision: fila.estado_revision === "validado" ? "validado" : "borrador",
    autor: fila.autor === "humano" ? "humano" : "agente",
    creado: fila.creado ?? new Date().toISOString(),
    contenido_json: documento,
    markdown,
    content_hash: hashContenido(documento, markdown),
  };
}

const COLUMNAS = "caso_id,idempotency_key,version,markdown,contenido_json,autor,estado_revision,creado";

/** Fila de `forense.propuestas_edicion` (006 §5) en lo que el BFF necesita. */
interface FilaPropuesta {
  id: string;
  caso_id: string;
  version_base: number;
  modo: string;
  estado: string;
  patch: unknown;
  version_resultante: number | null;
}
const COLUMNAS_PROPUESTA = "id,caso_id,version_base,modo,estado,patch,version_resultante";

/**
 * `patch` viaja como `jsonb`: vuelve como `unknown`. Se acepta solo si tiene
 * la forma de documento TipTap; cualquier otra cosa es un dato corrupto y se
 * dice, en vez de versionar el expediente con basura.
 */
export function documentoDe(valor: unknown): Documento | null {
  if (!valor || typeof valor !== "object") return null;
  const posible = valor as { type?: unknown; content?: unknown };
  if (posible.type !== "doc" || !Array.isArray(posible.content)) return null;
  return normalizarDocumento(valor as Documento);
}

export function crearRepositorioSupabase(cliente: ClienteForense): RepositorioExpediente {
  async function filas(casoId: string): Promise<FilaExpediente[]> {
    const { data, error } = await cliente
      .from("expedientes")
      .select(COLUMNAS)
      .eq("caso_id", casoId)
      .order("version", { ascending: true });
    if (error) throw new Error(`expedientes: ${error.message}`);
    return (data ?? []) as unknown as FilaExpediente[];
  }

  async function cabeza(casoId: string): Promise<FilaExpediente | null> {
    const todas = await filas(casoId);
    return todas.length > 0 ? todas[todas.length - 1] : null;
  }

  /**
   * Evento `edicion` en `forense.bitacora` (CLAUDE.md regla 2) **por
   * `forense.log`**, no por INSERT directo: la función es la que asigna
   * `seq` (`forense.next_seq`, 002 §1), resuelve `corrida_id` y `cluster_id`
   * desde `forense.casos` y respeta el contrato de la tabla. Un INSERT a mano
   * se salta la secuencia y deja la bitácora sin orden.
   *
   * `tipo_evento` es siempre `'edicion'` —el CHECK de la tabla no acepta
   * valores nuevos y ese enum no es de este worker—; el matiz va en
   * `payload.evento_real`, igual que hace 006 §7.
   *
   * Devuelve si el evento quedó escrito: la ruta lo declara como `bitacora`
   * y la UI no puede afirmar trazabilidad que no ocurrió.
   */
  async function bitacoraEdicion(casoId: string, payload: Record<string, unknown>): Promise<boolean> {
    const { error } = await cliente.rpc("log", {
      p_caso: casoId,
      p_agente: "editor",
      p_tipo: "edicion",
      p_payload: payload,
    });
    return !error;
  }

  /** Fila de la propuesta, SIEMPRE acotada al caso de la petición. */
  async function leerPropuesta(casoId: string, propuestaId: string): Promise<FilaPropuesta | null> {
    const { data, error } = await cliente
      .from("propuestas_edicion")
      .select(COLUMNAS_PROPUESTA)
      .eq("id", propuestaId)
      .eq("caso_id", casoId)
      .maybeSingle();
    if (error) throw new Error(`propuestas_edicion: ${error.message}`);
    return (data as FilaPropuesta | null) ?? null;
  }

  return {
    modo: "supabase",
    origen: "supabase",
    dejaBitacora: true,

    async versiones(casoId) {
      return (await filas(casoId)).map(aReporte);
    },

    async versionActual(casoId) {
      const fila = await cabeza(casoId);
      return fila ? aReporte(fila) : null;
    },

    async obtenerVersion(casoId, version) {
      const fila = (await filas(casoId)).find((f) => f.version === version);
      return fila ? aReporte(fila) : null;
    },

    /**
     * Autoguardado: **no crea versión** (15 §10). Actualiza `contenido_json`
     * de la versión vigente y la deja `borrador` (006 §4: «el autoguardado
     * puede dejar `borrador`»). Dos guardas: solo la versión máxima y solo si
     * todavía NO está `validado` — autoguardar sobre una versión validada
     * destruiría un entregable, así que eso es conflicto, no escritura.
     */
    async guardarBorrador(casoId, args) {
      const fila = await cabeza(casoId);
      if (!fila) return { ok: false, motivo: "version_inexistente" };
      if (fila.version !== args.version_base) {
        return { ok: false, motivo: "conflicto_version", version_actual: fila.version };
      }
      if (fila.estado_revision === "validado") {
        return { ok: false, motivo: "conflicto_version", version_actual: fila.version };
      }
      const markdown = aMarkdown(args.documento);
      const { error } = await cliente
        .from("expedientes")
        .update({
          contenido_json: args.documento,
          markdown,
          estado_revision: "borrador",
          actualizado: new Date().toISOString(),
        })
        .eq("caso_id", casoId)
        .eq("version", args.version_base);
      if (error) throw new Error(`borrador: ${error.message}`);
      return {
        ok: true,
        valor: {
          version_base: args.version_base,
          documento: args.documento,
          markdown,
          content_hash: hashContenido(args.documento, markdown),
          guardado: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        },
      };
    },

    /**
     * En supabase NO hay borrador aparte: el autoguardado escribe sobre
     * `contenido_json` de la versión vigente (ver `guardarBorrador`), así que
     * lo que la ruta ya leyó como `versionActual` **es** el borrador. Devolver
     * `null` es la respuesta correcta, y además impide que una petición lea el
     * borrador en memoria de otro proceso (que además sería el de otro modo).
     */
    async borrador() {
      return null;
    },

    /**
     * Aplicar = `forense.aplicar_propuesta` (006 §7): versiona, marca la
     * propuesta, escribe `bitacora.tipo_evento='edicion'` y registra
     * actividad, todo en una transacción del servidor. La idempotencia
     * (doble click) la resuelve la función: propuesta ya aplicada devuelve la
     * MISMA versión con `aplicada:false`.
     *
     * La previsualización se lee de `forense.propuestas_edicion.patch` —la
     * fila que `/propuestas` insertó—, **nunca** de un almacén en memoria: el
     * proceso que aplica puede no ser el que propuso (otro worker, un
     * reinicio, un despliegue nuevo), y entonces la memoria está vacía.
     * Además `aplicar_propuesta` hace `coalesce(p_markdown, markdown de la
     * versión anterior)` (006 §7 línea 237): si el BFF mandara `p_markdown`
     * nulo, la versión nueva tendría el JSON editado y el Markdown VIEJO. Por
     * eso el markdown se deriva aquí del mismo `patch` que versiona.
     */
    async aplicar(casoId, args, ctx) {
      const fila = await leerPropuesta(casoId, args.propuesta_id);
      // El filtro por `caso_id` es una frontera de autorización, no una
      // comodidad: `aplicar_propuesta(p_propuesta)` NO comprueba el caso, así
      // que una propuesta de otro expediente versionaría aquel mientras esta
      // ruta responde con versiones de este.
      if (!fila) return { ok: false, motivo: "propuesta_desconocida" };
      // Desacuerdo cliente↔fila sobre qué versión se está editando: 409 antes
      // de escribir. El contraste fila↔`max(version)` lo sigue haciendo la
      // función del servidor, que además marca la fila `estado='conflicto'`
      // (006 §7 línea 228); adelantarlo aquí perdería esa transición.
      if (fila.version_base !== args.version_base) {
        const actual = await cabeza(casoId);
        return { ok: false, motivo: "conflicto_version", version_actual: actual?.version ?? fila.version_base };
      }
      const previsualizacion = documentoDe(fila.patch);
      if (!previsualizacion) return { ok: false, motivo: "propuesta_sin_patch" };
      const { data, error } = await cliente.rpc("aplicar_propuesta", {
        p_propuesta: args.propuesta_id,
        p_perfil: ctx?.perfilId ?? null,
        p_contenido_json: previsualizacion,
        p_markdown: aMarkdown(previsualizacion),
      });
      if (error) throw new Error(`aplicar_propuesta: ${error.message}`);
      const res = (data ?? {}) as {
        ok?: boolean;
        aplicada?: boolean;
        error?: string;
        version?: number;
        version_actual?: number;
      };
      if (!res.ok) {
        if (res.error === "conflicto_version") {
          return { ok: false, motivo: "conflicto_version", version_actual: res.version_actual ?? 0 };
        }
        return { ok: false, motivo: "propuesta_desconocida" };
      }
      const version = res.version ?? 0;
      const reporte = await this.obtenerVersion(casoId, version);
      if (!reporte) return { ok: false, motivo: "version_inexistente" };
      return { ok: true, valor: { reporte, repetido: res.aplicada === false } };
    },

    /**
     * INSERT en `forense.propuestas_edicion` (006 §5). `patch` guarda el
     * documento resultante porque `aplicar_propuesta` hace
     * `coalesce(p_contenido_json, p.patch)` al versionar. `request_id` lleva el
     * `idempotency_key` y tiene índice UNIQUE: un reintento no crea una
     * segunda propuesta, reutiliza la que ya estaba.
     */
    async registrarPropuesta(casoId, propuesta, previsualizacion, ctx) {
      // Nada se cachea en memoria: la ÚNICA copia de la previsualización es
      // la columna `patch` de esta fila, que es lo que `aplicar` vuelve a leer.
      const fila = {
        id: propuesta.propuesta_id,
        caso_id: casoId,
        perfil_id: ctx?.perfilId ?? null,
        version_base: propuesta.version_base,
        seleccion_hash: ctx?.seleccionHash ?? null,
        mensaje: propuesta.mensaje,
        modo: "propuesta",
        patch: previsualizacion,
        diff: { texto: propuesta.diff },
        citas: propuesta.citas,
        estado: "propuesta",
        request_id: ctx?.requestId ?? null,
      };
      const { error } = await cliente.from("propuestas_edicion").insert(fila);
      if (!error) return { ok: true, propuestaId: propuesta.propuesta_id, repetida: false };

      // Colisión de `request_id`: el mismo idempotency_key ya produjo una.
      if (ctx?.requestId) {
        const { data } = await cliente
          .from("propuestas_edicion")
          .select("id")
          .eq("request_id", ctx.requestId)
          .maybeSingle();
        const existente = (data as { id?: string } | null)?.id;
        if (existente) return { ok: true, propuestaId: existente, repetida: true };
      }
      return { ok: false, propuestaId: propuesta.propuesta_id, repetida: false };
    },

    /**
     * Descartar registra estado y **no** crea versión (07 §4), pero sí deja
     * rastro: evento `edicion` con `payload.evento_real='propuesta_descartada'`.
     *
     * El evento se escribe SOLO si la transición ocurrió. Una propuesta que ya
     * estaba aplicada o descartada sale por el camino corto sin log: la regla
     * 2 también prohíbe lo contrario, anotar un paso que no pasó.
     */
    async descartar(casoId, propuestaId) {
      const fila = await leerPropuesta(casoId, propuestaId);
      if (!fila) return { ok: false, motivo: "propuesta_desconocida" };
      if (fila.estado !== "propuesta") return { ok: true, valor: { estado: fila.estado, bitacora: false } };
      const upd = await cliente
        .from("propuestas_edicion")
        .update({ estado: "descartada" })
        .eq("id", propuestaId)
        .eq("caso_id", casoId)
        .eq("estado", "propuesta");
      if (upd.error) throw new Error(`descartar: ${upd.error.message}`);
      // Confirmación: el UPDATE condicional pudo no tocar ninguna fila (una
      // aplicación concurrente ganó la carrera). Se relee antes de anotar.
      const despues = await leerPropuesta(casoId, propuestaId);
      const estado = despues?.estado ?? fila.estado;
      if (estado !== "descartada") return { ok: true, valor: { estado, bitacora: false } };
      const anotado = await bitacoraEdicion(casoId, {
        evento_real: "propuesta_descartada",
        propuesta_id: propuestaId,
        version_base: fila.version_base,
      });
      return { ok: true, valor: { estado, bitacora: anotado } };
    },

    /**
     * Revertir copia la versión elegida a una NUEVA (07 §4: sin borrado, sin
     * LLM). Dos caminos, y el gate entre ellos es estrecho a propósito:
     *
     * 1. `forense.revertir_expediente(p_caso, p_version_objetivo,
     *    p_version_base, p_idempotency, p_perfil)` —la entrega forense-db en
     *    010— hace versionado, idempotencia y bitácora en UNA transacción.
     * 2. Mientras esa migración no esté aplicada, PostgREST responde
     *    `PGRST202` («could not find the function in the schema cache») y el
     *    BFF hace INSERT + `forense.log`, sin transacción.
     *
     * Se cae al camino 2 **solo** con `PGRST202`. Cualquier otro error —args
     * mal, permiso denegado, `raise` interno— se propaga: si la función existe
     * y falló, repetir la escritura a mano duplicaría o corrompería versiones.
     * Nunca se retrocede por ambigüedad.
     */
    async revertir(casoId, args, ctx) {
      const rpc = await cliente.rpc("revertir_expediente", {
        p_caso: casoId,
        p_version_objetivo: args.version_objetivo,
        p_version_base: args.version_base,
        p_idempotency: args.idempotency_key,
        p_perfil: ctx?.perfilId ?? null,
      });
      if (!rpc.error) {
        const res = (rpc.data ?? null) as {
          ok?: boolean;
          error?: string;
          revertida?: boolean;
          version?: number;
          version_resultante?: number;
          version_actual?: number;
        } | null;
        // Envoltura desconocida: se dice, no se adivina ni se reescribe a mano.
        if (!res || typeof res.ok !== "boolean") {
          throw new Error("revertir_expediente: envoltura inesperada");
        }
        if (!res.ok) {
          if (res.error === "conflicto_version") {
            const actual = await cabeza(casoId);
            return { ok: false, motivo: "conflicto_version", version_actual: res.version_actual ?? actual?.version ?? 0 };
          }
          return { ok: false, motivo: "version_inexistente" };
        }
        const version = res.version ?? res.version_resultante ?? 0;
        const reporte = await this.obtenerVersion(casoId, version);
        if (!reporte) return { ok: false, motivo: "version_inexistente" };
        // La bitácora la escribe la propia transacción de 010 (es parte del
        // contrato que se le pide; ver `solicitudes_coordinador`).
        return { ok: true, valor: { reporte, repetido: res.revertida === false, bitacora: true } };
      }
      if (rpc.error.code !== "PGRST202") {
        throw new Error(`revertir_expediente: ${rpc.error.message}`);
      }

      const todas = await filas(casoId);
      if (todas.length === 0) return { ok: false, motivo: "version_inexistente" };
      const actual = todas[todas.length - 1];

      // Idempotencia PRIMERO: el doble click manda dos veces la misma
      // `version_base` y la segunda llega cuando la reversión ya subió la
      // cabeza; comprobar el conflicto antes convertiría un doble click en 409.
      const clave = `revertir:${args.idempotency_key}`;
      const yaHecha = todas.find((f) => f.idempotency_key === clave);
      // Repetida: no se vuelve a anotar, y se dice (bitacora:false).
      if (yaHecha) return { ok: true, valor: { reporte: aReporte(yaHecha), repetido: true, bitacora: false } };

      if (actual.version !== args.version_base) {
        return { ok: false, motivo: "conflicto_version", version_actual: actual.version };
      }
      const objetivo = todas.find((f) => f.version === args.version_objetivo);
      if (!objetivo) return { ok: false, motivo: "version_inexistente" };

      const nueva = actual.version + 1;
      const reporteObjetivo = aReporte(objetivo);
      const { error } = await cliente.from("expedientes").insert({
        caso_id: casoId,
        idempotency_key: clave,
        version: nueva,
        markdown: reporteObjetivo.markdown,
        contenido_json: reporteObjetivo.contenido_json,
        autor: "humano",
        estado_revision: "borrador",
        version_base: actual.version,
      });
      if (error) {
        // Clave repetida o carrera de versión: se relee y se responde honesto.
        const cabezaNueva = await cabeza(casoId);
        if (cabezaNueva && cabezaNueva.version === nueva) {
          return { ok: true, valor: { reporte: aReporte(cabezaNueva), repetido: true, bitacora: false } };
        }
        return { ok: false, motivo: "conflicto_version", version_actual: cabezaNueva?.version ?? actual.version };
      }
      const anotado = await bitacoraEdicion(casoId, {
        evento_real: "revertir",
        accion: "revertir",
        version_objetivo: args.version_objetivo,
        version_base: actual.version,
        version_resultante: nueva,
        perfil_id: ctx?.perfilId ?? null,
      });
      const creada = await this.obtenerVersion(casoId, nueva);
      if (!creada) return { ok: false, motivo: "version_inexistente" };
      return { ok: true, valor: { reporte: creada, repetido: false, bitacora: anotado } };
    },
  };
}

// ---------------------------------------------------------------------------
// Selección del repositorio según entorno.
// ---------------------------------------------------------------------------

export function servicioConfigurado(): boolean {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Cliente de servicio. **Solo servidor**: la clave nunca llega al navegador. */
export function crearClienteServicio(): ClienteForense {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error("service_role_no_configurado");
  return createClient(url, clave, {
    db: { schema: "forense" },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteForense;
}

/** Inyección para pruebas: un repositorio fijo sin tocar la red. */
let repositorioForzado: RepositorioExpediente | null = null;
export function forzarRepositorio(repo: RepositorioExpediente | null): void {
  repositorioForzado = repo;
}

export function modoPersistencia(etiquetaFuente: "fixture" | "supabase"): ModoPersistencia {
  if (repositorioForzado) return repositorioForzado.modo;
  if (servicioConfigurado()) return "supabase";
  return etiquetaFuente === "fixture" ? "fixture" : "no_configurado";
}

export function obtenerRepositorio(etiquetaFuente: "fixture" | "supabase"): RepositorioExpediente | null {
  if (repositorioForzado) return repositorioForzado;
  const modo = modoPersistencia(etiquetaFuente);
  if (modo === "supabase") return crearRepositorioSupabase(crearClienteServicio());
  if (modo === "fixture") return repositorioFixture;
  return null;
}
