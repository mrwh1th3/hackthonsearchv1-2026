import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `privado-supabase.ts` es la fuente de service_role para perfil/
 * investigaciones/notificaciones/inyecciones (006/007/008, RLS sin política
 * de SELECT). Igual que `supabase.test.ts`: mappers puros contra filas de
 * ejemplo sin cliente, y `leer*` con un cliente falso encadenable inyectado
 * (`_inyectarClienteParaTests`) — nunca red real ni credenciales.
 */
process.env.SUPABASE_URL = "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba-no-real";

const {
  borrarVistaPrivada,
  buscarCasoPorRfc,
  codigosPorRfc,
  guardarVistaPrivada,
  isPrivadoSupabaseConfigured,
  leerInvestigacionPrivada,
  leerInyeccionPrivada,
  leerPerfilPrivado,
  leerVistasGuardadasPrivadas,
  mapInvestigacion,
  mapInyeccionResumen,
  mapNotificacion,
  mapPerfil,
  mapVista,
  mensajeDiagnostico,
  normalizarTipoNotificacion,
  recursoDesdeRuta,
  timelineDesdeEventos,
  _inyectarClienteParaTests,
  _resetClientePrivadoParaTests,
} = await import("./privado-supabase");

// ---------------------------------------------------------------------------
// Mappers puros
// ---------------------------------------------------------------------------

describe("mappers puros (fila real de 006/007/008 -> DTO)", () => {
  it("mapPerfil traduce permiso_aviso_at a consentimiento_at y organizacion/correo nulos a valores seguros", () => {
    const p = mapPerfil({
      id: "00000000-0000-4000-8000-0000000006a1",
      nombre: "Equipo Forense (demo)",
      organizacion: null,
      correo: null,
      telefono_e164: null,
      timezone: "America/Monterrey",
      llamadas_activadas: false,
      permiso_aviso_at: null,
    });
    expect(p).toEqual({
      id: "00000000-0000-4000-8000-0000000006a1",
      nombre: "Equipo Forense (demo)",
      organizacion: "",
      timezone: "America/Monterrey",
      telefono_e164: null,
      llamadas_activadas: false,
      consentimiento_at: null,
      correo: undefined,
    });
  });

  it("normalizarTipoNotificacion pasa 'investigacion.completa' (el único emisor real en 007) a guion bajo", () => {
    expect(normalizarTipoNotificacion("investigacion.completa")).toBe("investigacion_completa");
    expect(normalizarTipoNotificacion("llamada_resultado")).toBe("llamada_resultado");
  });

  it("normalizarTipoNotificacion nunca inventa un cuarto valor: lo desconocido cae a 'error', no a un éxito falso", () => {
    expect(normalizarTipoNotificacion("algo.nuevo.sin.contrato")).toBe("error");
  });

  it("recursoDesdeRuta reconstruye {tipo,id} desde la ruta que arma el trigger de 007", () => {
    expect(recursoDesdeRuta("/investigaciones/00000000-0000-4000-8000-000000000800")).toEqual({
      tipo: "investigacion",
      id: "00000000-0000-4000-8000-000000000800",
    });
    expect(recursoDesdeRuta("/casos/caso-1/expediente")).toEqual({ tipo: "reporte", id: "caso-1" });
  });

  it("recursoDesdeRuta con ruta nula o irreconocible no lanza: cae a 'investigacion' documentado, nunca revienta la página", () => {
    expect(recursoDesdeRuta(null)).toEqual({ tipo: "investigacion", id: "" });
    expect(recursoDesdeRuta("/otra-cosa/x")).toEqual({ tipo: "investigacion", id: "/otra-cosa/x" });
  });

  it("mapNotificacion compone tipo+recurso normalizados", () => {
    const n = mapNotificacion({
      id: "n1",
      perfil_id: "p1",
      event_id: "e1",
      tipo: "investigacion.completa",
      recurso: "/investigaciones/inv-1",
      titulo: "Tu investigación terminó",
      leida_at: null,
      creado: "2026-02-01T00:00:00Z",
    });
    expect(n.tipo).toBe("investigacion_completa");
    expect(n.recurso).toEqual({ tipo: "investigacion", id: "inv-1" });
  });

  it("mapInvestigacion convierte el caso_id singular de la tabla en caso_ids[] (contrato de UI)", () => {
    const inv = mapInvestigacion({
      id: "inv-1",
      perfil_id: "p1",
      modo: "caso",
      corrida_id: "corrida-1",
      caso_id: "caso-1",
      investigacion_padre_id: null,
      estado: "investigacion_completa",
      mensaje: "hola",
      directriz_id: "seguir_dinero",
      reporte_manifest: [],
      creado: "2026-02-01T00:00:00Z",
      completada_at: "2026-02-01T00:05:00Z",
    });
    expect(inv.caso_ids).toEqual(["caso-1"]);
    expect(inv.mensaje).toBe("hola");
  });

  it("mapInvestigacion con modo 'corrida' (sin caso_id) produce caso_ids vacío, nunca [null]", () => {
    const inv = mapInvestigacion({
      id: "inv-2",
      perfil_id: "p1",
      modo: "corrida",
      corrida_id: "corrida-1",
      caso_id: null,
      investigacion_padre_id: null,
      estado: "en_cola",
      mensaje: null,
      directriz_id: null,
      reporte_manifest: [],
      creado: "2026-02-01T00:00:00Z",
      completada_at: null,
    });
    expect(inv.caso_ids).toEqual([]);
  });

  it("mensajeDiagnostico resume {aceptadas,rechazadas,errores,advertencias} (008 §1) sin pasar texto libre", () => {
    expect(mensajeDiagnostico({ aceptadas: 3, rechazadas: 1, errores: ["x"], advertencias: [] })).toEqual({
      mensaje: "3 fila(s) aceptada(s), 1 rechazada(s) · 1 error(es)",
    });
  });

  it("mensajeDiagnostico con null o sin nada que decir devuelve null (nunca un mensaje vacío)", () => {
    expect(mensajeDiagnostico(null)).toBeNull();
    expect(mensajeDiagnostico({})).toBeNull();
  });

  it("mapInyeccionResumen deja timeline/diff vacíos (son de leerInyeccionPrivada, no del resumen de lista)", () => {
    const r = mapInyeccionResumen({
      id: "iny-1",
      corrida_base_id: "base-1",
      corrida_nueva_id: "nueva-1",
      origen: "ui",
      estado: "completada",
      rfcs_afectados: ["DEMO:1"],
      creado: "2026-02-01T00:00:00Z",
      terminado: "2026-02-01T00:10:00Z",
      diagnostico: { aceptadas: 1, rechazadas: 0 },
    });
    expect(r.timeline).toEqual([]);
    expect(r.diff).toEqual([]);
    expect(r.diagnostico).toEqual({ mensaje: "1 fila(s) aceptada(s), 0 rechazada(s)" });
  });

  it("timelineDesdeEventos traduce evento_real -> paso (recuerda solo el primero de cada paso) y descarta lo que no tiene ts o mapeo", () => {
    const tl = timelineDesdeEventos([
      { ts: "2026-02-01T00:00:00Z", evento: "inyeccion_recibida" },
      { ts: "2026-02-01T00:00:05Z", evento: "inyeccion_validada" },
      { ts: "2026-02-01T00:00:10Z", evento: "snapshot_creado" },
      { ts: "2026-02-01T00:00:15Z", evento: "estado_pistas_recalculadas" },
      { ts: "2026-02-01T00:00:20Z", evento: "estado_investigando" },
      { ts: "2026-02-01T00:00:25Z", evento: "estado_completada" },
      { ts: null, evento: "algo_sin_ts" },
      { ts: "2026-02-01T00:00:30Z", evento: null },
      { ts: "2026-02-01T00:00:35Z", evento: "estado_completada" }, // duplicado: se queda con el primero
    ]);
    expect(tl).toEqual([
      { paso: "recibida", ts: "2026-02-01T00:00:00Z" },
      { paso: "validada", ts: "2026-02-01T00:00:05Z" },
      { paso: "snapshot_creado", ts: "2026-02-01T00:00:10Z" },
      { paso: "pistas_recalculadas", ts: "2026-02-01T00:00:15Z" },
      { paso: "investigacion", ts: "2026-02-01T00:00:20Z" },
      { paso: "dictamen", ts: "2026-02-01T00:00:25Z" },
    ]);
  });

  it("timelineDesdeEventos nunca produce 'clusters_afectados': no existe ese evento en 008 (regla 2, sin evento no hay paso)", () => {
    const tl = timelineDesdeEventos([{ ts: "2026-02-01T00:00:00Z", evento: "inyeccion_recibida" }]);
    expect(tl.some((p) => p.paso === "clusters_afectados")).toBe(false);
  });

  it("buscarCasoPorRfc encuentra por rfc_principal o dentro de rfcs_satelite", () => {
    const casos = [
      { id: "c1", rfc_principal: "DEMO:A", rfcs_satelite: ["DEMO:B"], nivel: "presuncion_alta" as const },
    ];
    expect(buscarCasoPorRfc(casos, "DEMO:A")).toEqual({ nivel: "presuncion_alta", caso_id: "c1" });
    expect(buscarCasoPorRfc(casos, "DEMO:B")).toEqual({ nivel: "presuncion_alta", caso_id: "c1" });
    expect(buscarCasoPorRfc(casos, "DEMO:C")).toEqual({ nivel: null, caso_id: null });
  });

  it("codigosPorRfc filtra por rfc y descarta código nulo", () => {
    const pistas = [
      { rfc: "DEMO:A", codigo: "F1" as const },
      { rfc: "DEMO:A", codigo: null },
      { rfc: "DEMO:B", codigo: "D2" as const },
    ];
    expect(codigosPorRfc(pistas, "DEMO:A")).toEqual(new Set(["F1"]));
  });
});

// ---------------------------------------------------------------------------
// isPrivadoSupabaseConfigured
// ---------------------------------------------------------------------------

describe("isPrivadoSupabaseConfigured", () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("false si falta cualquiera de las dos variables de servidor", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isPrivadoSupabaseConfigured()).toBe(false);
  });

  it("true con ambas presentes (nunca depende de NEXT_PUBLIC_*, esas son del cliente anon)", () => {
    process.env.SUPABASE_URL = "https://example.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave";
    expect(isPrivadoSupabaseConfigured()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// leer* con cliente falso encadenable (sin red)
// ---------------------------------------------------------------------------

/**
 * `construirDiff` hace la MISMA consulta a 'casos'/'pistas' dos veces (una
 * por corrida_id) — un cliente falso que solo mirara la tabla respondería
 * igual a ambas, y un diff con la dirección invertida (base<->nueva) pasaría
 * las pruebas igual de bien que uno correcto. Por eso `eq(col, val)` aquí
 * SÍ importa: si hay una respuesta registrada como `"<tabla>:<val>"` (p.ej.
 * "casos:corrida-nueva-1"), esa gana sobre la respuesta genérica de la
 * tabla — así una prueba puede darle una fila distinta a la corrida base y
 * a la nueva y pillar una dirección invertida.
 */
function clienteFalso(respuestas: Record<string, { data: unknown; error: { message: string } | null }>) {
  const builder = (tabla: string) => {
    let clave = tabla;
    const resolver = () => respuestas[clave] ?? respuestas[tabla] ?? { data: null, error: null };
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: (_col: string, val: unknown) => {
        const especifica = `${tabla}:${String(val)}`;
        if (respuestas[especifica]) clave = especifica;
        return chain;
      },
      in: () => chain,
      limit: () => chain,
      upsert: () => chain,
      delete: () => chain,
      maybeSingle: async () => resolver(),
      single: async () => resolver(),
      then: (resolve: (v: unknown) => unknown) => resolve(resolver()),
    };
    return chain;
  };
  return {
    from: builder,
    rpc: async () => respuestas.__rpc__ ?? { data: null, error: null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("leerPerfilPrivado", () => {
  beforeEach(() => _resetClientePrivadoParaTests());

  it("mapea la única fila de forense.perfiles", async () => {
    _inyectarClienteParaTests(
      clienteFalso({
        perfiles: {
          data: {
            id: "00000000-0000-4000-8000-0000000006a1",
            nombre: "Equipo Forense (demo)",
            organizacion: "Hackathon Infosys",
            correo: "demo@forense.invalid",
            telefono_e164: null,
            timezone: "America/Monterrey",
            llamadas_activadas: false,
            permiso_aviso_at: null,
          },
          error: null,
        },
      }),
    );
    const perfil = await leerPerfilPrivado();
    expect(perfil.id).toBe("00000000-0000-4000-8000-0000000006a1");
    expect(perfil.correo).toBe("demo@forense.invalid");
  });

  it("tabla vacía (sin seed_producto.sql aplicado): lanza en vez de fingir un perfil, nunca cae a fixture en silencio", async () => {
    _inyectarClienteParaTests(clienteFalso({ perfiles: { data: null, error: null } }));
    await expect(leerPerfilPrivado()).rejects.toThrow(/vacío/);
  });

  it("propaga un error real de Postgres en vez de devolver un perfil fingido", async () => {
    _inyectarClienteParaTests(clienteFalso({ perfiles: { data: null, error: { message: "conexión perdida" } } }));
    await expect(leerPerfilPrivado()).rejects.toThrow(/conexión perdida/);
  });
});

describe("leerInvestigacionPrivada", () => {
  beforeEach(() => _resetClientePrivadoParaTests());

  it("id inexistente: null (404 legítimo), no fixture", async () => {
    _inyectarClienteParaTests(clienteFalso({ investigaciones: { data: null, error: null } }));
    expect(await leerInvestigacionPrivada("no-existe")).toBeNull();
  });
});

describe("leerInyeccionPrivada", () => {
  beforeEach(() => _resetClientePrivadoParaTests());

  it("id inexistente en estado_inyeccion (RPC devuelve null): null, no fixture", async () => {
    _inyectarClienteParaTests(clienteFalso({ __rpc__: { data: null, error: null } }));
    expect(await leerInyeccionPrivada("no-existe")).toBeNull();
  });

  it("arma diagnostico/timeline desde la RPC estado_inyeccion", async () => {
    _inyectarClienteParaTests(
      clienteFalso({
        __rpc__: {
          data: {
            id: "iny-1",
            corrida_base_id: "base-1",
            corrida_nueva_id: "nueva-1",
            origen: "ui",
            estado: "completada",
            rfcs_afectados: ["DEMO:A"],
            creado: "2026-02-01T00:00:00Z",
            terminado: "2026-02-01T00:10:00Z",
            diagnostico: { aceptadas: 1, rechazadas: 0 },
            timeline: [{ ts: "2026-02-01T00:00:00Z", evento: "inyeccion_recibida" }],
          },
          error: null,
        },
        // 'casos'/'pistas' sin clave específica de corrida: ambas corridas
        // resuelven igual (vacío) — esta prueba no ejercita la dirección del
        // diff, ver la siguiente para eso.
        casos: { data: [], error: null },
        pistas: { data: [], error: null },
      }),
    );
    const iny = await leerInyeccionPrivada("iny-1");
    expect(iny).not.toBeNull();
    expect(iny?.timeline).toEqual([{ paso: "recibida", ts: "2026-02-01T00:00:00Z" }]);
    expect(iny?.diagnostico).toEqual({ mensaje: "1 fila(s) aceptada(s), 0 rechazada(s)" });
    expect(iny?.diff).toEqual([{ rfc: "DEMO:A", nivel_anterior: null, nivel_nuevo: null, pistas_nuevas: [], caso_id: null }]);
  });

  it("diff: nivel_anterior/nivel_nuevo/pistas_nuevas/caso_id salen de la corrida correcta, nunca invertidos", async () => {
    _inyectarClienteParaTests(
      clienteFalso({
        __rpc__: {
          data: {
            id: "iny-1",
            corrida_base_id: "corrida-base-1",
            corrida_nueva_id: "corrida-nueva-1",
            origen: "ui",
            estado: "completada",
            rfcs_afectados: ["DEMO:A"],
            creado: "2026-02-01T00:00:00Z",
            terminado: "2026-02-01T00:10:00Z",
            diagnostico: null,
            timeline: [],
          },
          error: null,
        },
        // Base: DEMO:A no tiene caso todavía, solo la pista D1 (era EFOS
        // limpio antes de la inyección). Claves por corrida_id, no por tabla
        // sola, para que un `Promise.all` con el orden invertido reviente
        // esta prueba en vez de pasarla en silencio.
        "casos:corrida-base-1": { data: [], error: null },
        "pistas:corrida-base-1": { data: [{ rfc: "DEMO:A", codigo: "D1" }], error: null },
        // Nueva: ahora hay caso con nivel alto y una pista nueva (F1) además de D1.
        "casos:corrida-nueva-1": { data: [{ id: "caso-nueva-1", rfc_principal: "DEMO:A", rfcs_satelite: [], nivel: "presuncion_alta" }], error: null },
        "pistas:corrida-nueva-1": {
          data: [
            { rfc: "DEMO:A", codigo: "D1" },
            { rfc: "DEMO:A", codigo: "F1" },
          ],
          error: null,
        },
      }),
    );
    const iny = await leerInyeccionPrivada("iny-1");
    expect(iny?.diff).toEqual([{ rfc: "DEMO:A", nivel_anterior: null, nivel_nuevo: "presuncion_alta", pistas_nuevas: ["F1"], caso_id: "caso-nueva-1" }]);
  });
});

describe("vistas guardadas (forense.vistas_guardadas, 006 §3)", () => {
  beforeEach(() => _resetClientePrivadoParaTests());

  it("mapVista rellena filtros null como {} (la columna nunca debería serlo, pero nunca revienta la página por eso)", () => {
    expect(mapVista({ id: "v1", nombre: "Mi vista", ruta: "/", filtros: null })).toEqual({ id: "v1", nombre: "Mi vista", ruta: "/", filtros: {} });
  });

  it("leerVistasGuardadasPrivadas mapea las filas del perfil+ruta", async () => {
    _inyectarClienteParaTests(
      clienteFalso({ vistas_guardadas: { data: [{ id: "v1", nombre: "Alta prioridad", ruta: "/", filtros: { nivel: "presuncion_alta" } }], error: null } }),
    );
    const vistas = await leerVistasGuardadasPrivadas("perfil-1", "/");
    expect(vistas).toEqual([{ id: "v1", nombre: "Alta prioridad", ruta: "/", filtros: { nivel: "presuncion_alta" } }]);
  });

  it("guardarVistaPrivada hace upsert (unique(perfil_id,nombre): guardar dos veces el mismo nombre actualiza, no duplica) y devuelve la fila mapeada", async () => {
    _inyectarClienteParaTests(clienteFalso({ vistas_guardadas: { data: { id: "v1", nombre: "Mi vista", ruta: "/", filtros: { nivel: "presuncion" } }, error: null } }));
    const vista = await guardarVistaPrivada({ perfilId: "perfil-1", nombre: "Mi vista", ruta: "/", filtros: { nivel: "presuncion" } });
    expect(vista).toEqual({ id: "v1", nombre: "Mi vista", ruta: "/", filtros: { nivel: "presuncion" } });
  });

  it("guardarVistaPrivada propaga un error real de Postgres (p.ej. FK a un perfil_id inexistente) en vez de fingir éxito", async () => {
    _inyectarClienteParaTests(clienteFalso({ vistas_guardadas: { data: null, error: { message: "violates foreign key constraint" } } }));
    await expect(guardarVistaPrivada({ perfilId: "perfil-fantasma", nombre: "x", ruta: "/", filtros: {} })).rejects.toThrow(/foreign key/);
  });

  it("borrarVistaPrivada no lanza cuando el borrado no encuentra filas (id de otro perfil o ya borrado): delete es idempotente", async () => {
    _inyectarClienteParaTests(clienteFalso({ vistas_guardadas: { data: null, error: null } }));
    await expect(borrarVistaPrivada("perfil-1", "v-no-existe")).resolves.toBeUndefined();
  });
});
