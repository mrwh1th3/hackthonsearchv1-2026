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
import type { Propuesta } from "@/lib/document/tipos";
import redactorFixture from "@contracts/fixtures/valid/redactor.json";

import { CASO, CORRIDA, PROPUESTA, clienteFalso, crearAlmacen } from "./_doble-postgrest";

function propuestaDemo(): Propuesta {
  return {
    propuesta_id: PROPUESTA,
    version_base: 1,
    mensaje: "Propuesta de claridad.",
    patch: [],
    diff: "--- a\n+++ b\n-viejo\n+nuevo",
    citas: ["CFDI:00000000-0000-4000-8000-000000000901"],
  };
}

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

async function sembrarPropuesta(
  repo: ReturnType<typeof crearRepositorioSupabase>,
  requestId = "00000000-0000-4000-8000-000000000499",
) {
  const previsualizacion = desdeMarkdown("# Título\n\nCuerpo propuesto por el editor.\n");
  return repo.registrarPropuesta(CASO, propuestaDemo(), previsualizacion, {
    perfilId: "00000000-0000-4000-8000-000000000300",
    requestId,
    seleccionHash: "c".repeat(64),
  });
}

describe("repositorio del expediente", () => {
  it("registrarPropuesta ESCRIBE la fila en forense.propuestas_edicion (sin ella, Aplicar es 404)", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    const r = await sembrarPropuesta(repo);
    expect(r.ok).toBe(true);
    expect(r.propuestaId).toBe(PROPUESTA);
    expect(almacen.propuestas_edicion).toHaveLength(1);
    const fila = almacen.propuestas_edicion[0];
    expect(fila.caso_id).toBe(CASO);
    expect(fila.estado).toBe("propuesta");
    expect(fila.modo).toBe("propuesta");
    expect(fila.version_base).toBe(1);
    expect(fila.request_id).toBe("00000000-0000-4000-8000-000000000499");
    expect(fila.seleccion_hash).toBe("c".repeat(64));
    // `patch` guarda el documento resultante: aplicar_propuesta hace
    // coalesce(p_contenido_json, p.patch) al versionar (006 §7).
    expect(fila.patch).toBeDefined();
  });

  it("reintento con el mismo idempotency_key reutiliza la propuesta, no crea una segunda", async () => {
    const almacen = crearAlmacen();
    const repo = crearRepositorioSupabase(clienteFalso(almacen));
    await sembrarPropuesta(repo, "00000000-0000-4000-8000-000000000498");
    const dos = await sembrarPropuesta(repo, "00000000-0000-4000-8000-000000000498");
    expect(dos.ok).toBe(true);
    expect(dos.repetida).toBe(true);
    expect(dos.propuestaId).toBe(PROPUESTA);
    expect(almacen.propuestas_edicion).toHaveLength(1);
  });

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
    await sembrarPropuesta(repo);
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
    await sembrarPropuesta(repo);
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
    await sembrarPropuesta(repo);
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
    await sembrarPropuesta(repo);
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
