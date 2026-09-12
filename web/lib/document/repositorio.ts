import { createClient } from "@supabase/supabase-js";

/**
 * Cliente mínimo que este repositorio usa. Se escribe a mano (en vez de
 * `SupabaseClient<…>`) por dos razones: el genérico de esquema de
 * `supabase-js` fija `"public"` y el nuestro es `forense`, y así la prueba
 * puede inyectar un doble sin red ni tipos generados.
 */
export interface RespuestaPostgrest {
  data: unknown;
  error: { message: string } | null;
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
  registrarPropuesta as registrarPropuestaDemo,
  descartarPropuestaGuardada,
  guardarBorrador as guardarBorradorDemo,
  hashContenido,
  obtenerPropuesta,
  obtenerVersion as obtenerVersionDemo,
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
  aplicar(
    casoId: string,
    args: { propuesta_id: string; version_base: number; idempotency_key: string },
    ctx?: ContextoEdicion,
  ): Promise<ResultadoEscritura<{ reporte: Reporte; repetido: boolean }>>;
  /**
   * Persiste la propuesta ANTES de responderla al cliente. Sin esto, el
   * `propuesta_id` que la UI recibe no existe en `forense.propuestas_edicion`
   * y Aplicar devolvería `contexto_invalido` (006 §7 busca la fila por id).
   * Devuelve el id definitivo: si `request_id` ya estaba (reintento del mismo
   * `idempotency_key`), se reutiliza la propuesta existente.
   */
  registrarPropuesta(
    casoId: string,
    propuesta: Propuesta,
    previsualizacion: Documento,
    ctx?: ContextoEdicion,
  ): Promise<{ ok: boolean; propuestaId: string; repetida: boolean }>;
  descartar(casoId: string, propuestaId: string): Promise<ResultadoEscritura<{ estado: string }>>;
  revertir(
    casoId: string,
    args: { version_objetivo: number; version_base: number; idempotency_key: string },
    ctx?: ContextoEdicion,
  ): Promise<ResultadoEscritura<{ reporte: Reporte; repetido: boolean }>>;
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
  async aplicar(casoId, args) {
    return aplicarPropuestaGuardada(casoId, args);
  },
  async registrarPropuesta(casoId, propuesta, previsualizacion) {
    registrarPropuestaDemo(casoId, propuesta, previsualizacion);
    return { ok: true, propuestaId: propuesta.propuesta_id, repetida: false };
  },
  async descartar(casoId, propuestaId) {
    const r = descartarPropuestaGuardada(casoId, propuestaId);
    return r.ok ? { ok: true, valor: { estado: r.valor.estado } } : r;
  },
  async revertir(casoId, args) {
    return revertirAVersion(casoId, args);
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
   * Evento `edicion` en `forense.bitacora` (CLAUDE.md regla 2). `corrida_id`
   * es NOT NULL: se resuelve desde `forense.casos`. `aplicar_propuesta` ya lo
   * escribe en el servidor (006 §7), así que esto solo se usa para revertir.
   */
  async function bitacoraEdicion(casoId: string, payload: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await cliente.from("casos").select("corrida_id").eq("id", casoId).maybeSingle();
    const corridaId = (data as { corrida_id?: string } | null)?.corrida_id;
    if (error || !corridaId) return false;
    const escritura = await cliente
      .from("bitacora")
      .insert({ corrida_id: corridaId, caso_id: casoId, agente: "editor", tipo_evento: "edicion", payload });
    return !escritura.error;
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
     * Aplicar = `forense.aplicar_propuesta` (006 §7): versiona, marca la
     * propuesta, escribe `bitacora.tipo_evento='edicion'` y registra
     * actividad, todo en una transacción del servidor. La idempotencia
     * (doble click) la resuelve la función: propuesta ya aplicada devuelve la
     * MISMA versión con `aplicada:false`.
     *
     * `p_contenido_json`/`p_markdown` se envían con la previsualización que
     * este BFF calculó al construir la propuesta cuando la tiene en memoria;
     * si no la tiene, van `null` y la función usa el `patch` persistido.
     */
    async aplicar(casoId, args, ctx) {
      const guardada = obtenerPropuesta(casoId, args.propuesta_id);
      const previsualizacion = guardada?.previsualizacion ?? null;
      const { data, error } = await cliente.rpc("aplicar_propuesta", {
        p_propuesta: args.propuesta_id,
        p_perfil: ctx?.perfilId ?? null,
        p_contenido_json: previsualizacion,
        p_markdown: previsualizacion ? aMarkdown(previsualizacion) : null,
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
      // La previsualización se cachea en memoria para no recalcularla al
      // aplicar; la VERDAD está en la fila que se inserta aquí.
      registrarPropuestaDemo(casoId, propuesta, previsualizacion);
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

    /** Descartar registra estado y **no** crea versión (07 §4). */
    async descartar(casoId, propuestaId) {
      const { data, error } = await cliente
        .from("propuestas_edicion")
        .select("id,estado")
        .eq("id", propuestaId)
        .eq("caso_id", casoId)
        .maybeSingle();
      if (error) throw new Error(`propuestas_edicion: ${error.message}`);
      const fila = data as { estado?: string } | null;
      if (!fila) return { ok: false, motivo: "propuesta_desconocida" };
      if (fila.estado !== "propuesta") return { ok: true, valor: { estado: fila.estado ?? "descartada" } };
      const upd = await cliente
        .from("propuestas_edicion")
        .update({ estado: "descartada" })
        .eq("id", propuestaId)
        .eq("estado", "propuesta");
      if (upd.error) throw new Error(`descartar: ${upd.error.message}`);
      return { ok: true, valor: { estado: "descartada" } };
    },

    /**
     * Revertir copia la versión elegida a una NUEVA (07 §4: sin borrado, sin
     * LLM). No hay RPC para esto en 006 —se pide en `solicitudes_coordinador`—
     * así que aquí va INSERT + evento `edicion` explícito. La idempotencia se
     * apoya en `expedientes.idempotency_key` (UNIQUE).
     */
    async revertir(casoId, args, ctx) {
      const todas = await filas(casoId);
      if (todas.length === 0) return { ok: false, motivo: "version_inexistente" };
      const actual = todas[todas.length - 1];
      if (actual.version !== args.version_base) {
        return { ok: false, motivo: "conflicto_version", version_actual: actual.version };
      }
      const objetivo = todas.find((f) => f.version === args.version_objetivo);
      if (!objetivo) return { ok: false, motivo: "version_inexistente" };

      const clave = `revertir:${args.idempotency_key}`;
      const yaHecha = todas.find((f) => f.idempotency_key === clave);
      if (yaHecha) return { ok: true, valor: { reporte: aReporte(yaHecha), repetido: true } };

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
          return { ok: true, valor: { reporte: aReporte(cabezaNueva), repetido: true } };
        }
        return { ok: false, motivo: "conflicto_version", version_actual: cabezaNueva?.version ?? actual.version };
      }
      await bitacoraEdicion(casoId, {
        accion: "revertir",
        version_objetivo: args.version_objetivo,
        version_base: actual.version,
        version_resultante: nueva,
        perfil_id: ctx?.perfilId ?? null,
      });
      const creada = await this.obtenerVersion(casoId, nueva);
      if (!creada) return { ok: false, motivo: "version_inexistente" };
      return { ok: true, valor: { reporte: creada, repetido: false } };
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
