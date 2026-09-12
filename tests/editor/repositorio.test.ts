// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  crearRepositorioSupabase,
  repositorioFixture,
  type ClienteForense,
  type ConsultaForense,
  type RespuestaPostgrest,
} from "@/lib/document/repositorio";
import { desdeMarkdown } from "@/lib/document/markdown";
import redactorFixture from "@contracts/fixtures/valid/redactor.json";

/**
 * Persistencia real del editor (hallazgo 1 del verificador).
 *
 * Lo que estas pruebas fijan:
 *
 * 1. El repositorio `supabase` **no** es el almacén en memoria: escribe en
 *    `forense.expedientes` / `forense.propuestas_edicion` (006) a través de un
 *    cliente inyectado, y las llamadas se comprueban una por una.
 * 2. Aplicar pasa por `forense.aplicar_propuesta` (006 §7), que es la que
 *    versiona **y** escribe `bitacora.tipo_evento='edicion'` en la misma
 *    transacción. No se reimplementa aquí.
 * 3. Revertir, que no tiene RPC en 006, escribe el evento `edicion`
 *    explícitamente (CLAUDE.md regla 2: sin evento, el paso no existió).
 * 4. El repositorio de fixtures declara `dejaBitacora === false`. Jamás afirma
 *    una escritura que no ocurrió.
 *
 * El cliente es un doble en memoria con la forma de PostgREST: no hay red, y
 * lo que se verifica son **las llamadas** (tabla, filtros, valores, RPC), que
 * es exactamente lo que no se puede comprobar contra el Supabase remoto desde
 * este worktree (ver `solicitudes_coordinador`).
 */

const CASO = "00000000-0000-4000-8000-000000000100";
const CORRIDA = "00000000-0000-4000-8000-000000000001";
const PROPUESTA = "00000000-0000-4000-8000-000000000403";

type Fila = Record<string, unknown>;

interface Almacen {
  expedientes: Fila[];
  casos: Fila[];
  propuestas_edicion: Fila[];
  bitacora: Fila[];
  rpc: { nombre: string; args: Record<string, unknown> }[];
}

function crearAlmacen(): Almacen {
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
    propuestas_edicion: [{ id: PROPUESTA, caso_id: CASO, estado: "propuesta" }],
    bitacora: [],
    rpc: [],
  };
}

/** Doble con la forma de PostgREST: `from().select().eq().order()`, `rpc()`. */
function clienteFalso(almacen: Almacen): ClienteForense {
  function consulta(tabla: string): ConsultaForense {
    const filtros: [string, unknown][] = [];
    let operacion: { tipo: "select" } | { tipo: "update" | "insert"; valores: Fila } = { tipo: "select" };
    let ordenPor: string | null = null;

    function ejecutar(): RespuestaPostgrest {
      const filas = (almacen as unknown as Record<string, Fila[]>)[tabla];
      if (!filas) return { data: null, error: { message: `tabla desconocida: ${tabla}` } };
      const coincide = (f: Fila) => filtros.every(([c, v]) => f[c] === v);
      if (operacion.tipo === "insert") {
        const clave = operacion.valores.idempotency_key;
        if (clave !== undefined && filas.some((f) => f.idempotency_key === clave)) {
          return { data: null, error: { message: "duplicate key" } };
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
      if (nombre !== "aplicar_propuesta") {
        return Promise.resolve({ data: null, error: { message: `rpc desconocida: ${nombre}` } });
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
      const nueva = maxima + 1;
      almacen.expedientes.push({
        caso_id: CASO,
        idempotency_key: `propuesta:${String(args.p_propuesta)}`,
        version: nueva,
        markdown: args.p_markdown ?? "",
        contenido_json: args.p_contenido_json ?? {},
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

describe("repositorio del expediente", () => {
  it("fixture NUNCA afirma haber escrito bitácora", () => {
    expect(repositorioFixture.modo).toBe("fixture");
    expect(repositorioFixture.origen).toBe("fixture");
    expect(repositorioFixture.dejaBitacora).toBe(false);
  });

  it("lee las versiones de forense.expedientes, no de la memoria del proceso", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    expect(repo.dejaBitacora).toBe(true);
    const versiones = await repo.versiones(CASO);
    expect(versiones).toHaveLength(1);
    expect(versiones[0].version).toBe(1);
    expect(versiones[0].markdown).toBe(redactorFixture.markdown);
    const actual = await repo.versionActual(CASO);
    expect(actual?.version).toBe(1);
  });

  it("el autoguardado actualiza contenido_json de la versión vigente y NO crea versión", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const documento = desdeMarkdown("# Otro título\n\nCuerpo reescrito a mano.\n");
    const r = await repo.guardarBorrador(CASO, { version_base: 1, documento });
    expect(r.ok).toBe(true);
    expect(almacen.expedientes).toHaveLength(1);
    expect(almacen.expedientes[0].estado_revision).toBe("borrador");
    expect(almacen.expedientes[0].contenido_json).toEqual(documento);
  });

  it("no autoguarda sobre una versión ya validada: conflicto, no destrucción", async () => {
    const almacen = crearAlmacen();
    almacen.expedientes[0].estado_revision = "validado";
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const documento = desdeMarkdown("# Sobrescritura indebida\n\nTexto.\n");
    const r = await repo.guardarBorrador(CASO, { version_base: 1, documento });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("conflicto_version");
    expect(almacen.expedientes[0].contenido_json).not.toEqual(documento);
  });

  it("aplicar delega en forense.aplicar_propuesta (006 §7), que versiona y deja bitácora 'edicion'", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const r = await repo.aplicar(
      CASO,
      { propuesta_id: PROPUESTA, version_base: 1, idempotency_key: "00000000-0000-4000-8000-000000000410" },
      { perfilId: "00000000-0000-4000-8000-000000000300" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.reporte.version).toBe(2);
    expect(almacen.rpc.map((c) => c.nombre)).toContain("aplicar_propuesta");
    expect(almacen.rpc[0].args.p_propuesta).toBe(PROPUESTA);
    expect(almacen.rpc[0].args.p_perfil).toBe("00000000-0000-4000-8000-000000000300");
    expect(almacen.bitacora.filter((b) => b.tipo_evento === "edicion")).toHaveLength(1);
  });

  it("doble aplicar devuelve la MISMA versión (idempotencia de 006 §7)", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const args = { propuesta_id: PROPUESTA, version_base: 1, idempotency_key: "00000000-0000-4000-8000-000000000411" };
    const uno = await repo.aplicar(CASO, args);
    const dos = await repo.aplicar(CASO, args);
    expect(uno.ok && dos.ok).toBe(true);
    if (uno.ok && dos.ok) {
      expect(dos.valor.reporte.version).toBe(uno.valor.reporte.version);
      expect(dos.valor.repetido).toBe(true);
    }
    expect(almacen.expedientes).toHaveLength(2);
  });

  it("revertir crea versión nueva y escribe el evento 'edicion' a mano (no hay RPC en 006)", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    await repo.aplicar(CASO, {
      propuesta_id: PROPUESTA,
      version_base: 1,
      idempotency_key: "00000000-0000-4000-8000-000000000412",
    });
    almacen.bitacora.length = 0;

    const r = await repo.revertir(CASO, {
      version_objetivo: 1,
      version_base: 2,
      idempotency_key: "00000000-0000-4000-8000-000000000413",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.reporte.version).toBe(3);
      expect(r.valor.reporte.markdown).toBe(redactorFixture.markdown); // el contenido de v1
    }
    // El historial no se destruye: v1 y v2 siguen ahí (09 §8).
    expect(almacen.expedientes.map((e) => e.version)).toEqual([1, 2, 3]);
    const evento = almacen.bitacora.find((b) => b.tipo_evento === "edicion");
    expect(evento).toBeDefined();
    expect(evento?.corrida_id).toBe(CORRIDA);
    expect((evento?.payload as Record<string, unknown>).accion).toBe("revertir");
    expect((evento?.payload as Record<string, unknown>).version_resultante).toBe(3);
  });

  it("revertir con version_base desfasada no escribe nada: conflicto", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const r = await repo.revertir(CASO, {
      version_objetivo: 1,
      version_base: 7,
      idempotency_key: "00000000-0000-4000-8000-000000000414",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("conflicto_version");
    expect(almacen.expedientes).toHaveLength(1);
    expect(almacen.bitacora).toHaveLength(0);
  });

  it("descartar marca la propuesta en forense.propuestas_edicion y no crea versión", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const r = await repo.descartar(CASO, PROPUESTA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.estado).toBe("descartada");
    expect(almacen.propuestas_edicion[0].estado).toBe("descartada");
    expect(almacen.expedientes).toHaveLength(1);
  });

  it("descartar una propuesta inexistente no inventa un éxito", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const r = await repo.descartar(CASO, "00000000-0000-4000-8000-0000000004ff");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("propuesta_desconocida");
  });
});
