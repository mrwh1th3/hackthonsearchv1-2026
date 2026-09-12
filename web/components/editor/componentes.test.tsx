// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import redactorFixture from "@contracts/fixtures/valid/redactor.json";
import { desdeMarkdown } from "@/lib/document/markdown";
import type { Documento } from "@/lib/document/tipos";

import { DocumentWorkspace } from "./document-workspace";
import { ReportChat } from "./report-chat";

/**
 * Pruebas de UI del editor (hoja, citas, índice, modos y chat).
 *
 * POR QUÉ VIVEN AQUÍ Y NO EN `tests/editor/`: `web/vitest.config.ts`
 * (propiedad de forense-webapp) no permite cargar en entorno **jsdom** los
 * archivos situados fuera de `web/` — el mismo archivo con
 * `@vitest-environment node` sí carga, con jsdom falla con "Failed to load
 * url … Does the file exist?" (restricción `server.fs.allow` del pipeline web
 * de Vite). Las pruebas de contrato, documento y BFF sí están en
 * `tests/editor/` (entorno node). Pedido al coordinador en
 * `solicitudes_coordinador`: añadir `server.fs.allow` al config para poder
 * moverlas; no se toca configuración ajena desde aquí.
 */

const CASO = "00000000-0000-4000-8000-000000000100";
const CITA_VALIDA = "CFDI:00000000-0000-4000-8000-000000000901";

const evidencia = [
  {
    id: "701",
    referencias: [CITA_VALIDA],
    referencia: CITA_VALIDA,
    tipo: "cfdi",
    pista_codigo: "D2",
    familia: "D",
    ref_id: "00000000-0000-4000-8000-000000000901",
    rfcs_afectados: ["DEMO:ENTIDAD-0"],
    validada: true,
    refutada: false,
    hecho_validado: { comprobacion: "D2" },
  },
];

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

function workspace(documento: Documento) {
  return (
    <DocumentWorkspace
      casoId={CASO}
      rfc="DEMO:ENTIDAD-0"
      documento={documento}
      version={1}
      estadoRevision="validado"
      referenciasValidadas={[CITA_VALIDA]}
      evidencia={evidencia}
      origen="fixture"
    />
  );
}

/**
 * jsdom no implementa geometría: ProseMirror llama `getClientRects()` sobre
 * nodos de texto al desplazar la selección. Se stubea con un rectángulo vacío
 * (no se prueba layout aquí; el render a 1440/1024/390 px se verifica en
 * navegador, ver `pendientes`).
 */
const RECT = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ ok: true })));
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(document, "elementFromPoint", { value: () => document.body, configurable: true, writable: true });
  for (const proto of [Element.prototype, Text.prototype, Range.prototype]) {
    Object.defineProperty(proto, "getClientRects", { value: () => [RECT], configurable: true, writable: true });
    Object.defineProperty(proto, "getBoundingClientRect", { value: () => RECT, configurable: true, writable: true });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DocumentWorkspace", () => {
  it("monta la hoja, decora las citas y marca la que no tiene evidencia validada", async () => {
    render(
      workspace(desdeMarkdown(`## 1. Resumen\n\nHecho sostenido [${CITA_VALIDA}] y afirmación sin sustento [CADENA:paso-3].`)),
    );

    const hoja = await waitFor(() => {
      const nodo = document.querySelector(".hoja-prosa");
      expect(nodo).not.toBeNull();
      return nodo as HTMLElement;
    });
    await waitFor(() => expect(hoja.querySelectorAll("[data-referencia]").length).toBe(2));

    const valida = hoja.querySelector(`[data-referencia="${CITA_VALIDA}"]`);
    const invalida = hoja.querySelector('[data-referencia="CADENA:paso-3"]');
    expect(valida?.className).toContain("cita");
    expect(valida?.className).not.toContain("cita-invalida");
    // 09 §8: un ID citado sin evidencia validada se marca en rojo, aunque no sea uuid.
    expect(invalida?.className).toContain("cita-invalida");

    // "Revisar citas" bloquea la publicación, no la conservación del borrador.
    expect(screen.getByTestId("estado-citas").textContent).toContain("Revisar citas (1)");
  });

  it("el índice lista las diez secciones y deshabilita las que el documento no trae", async () => {
    render(workspace(desdeMarkdown(redactorFixture.markdown)));

    const indice = await screen.findByRole("navigation", { name: /índice del expediente/i });
    expect(within(indice).getAllByRole("button")).toHaveLength(11); // plegado + 10 secciones

    expect(within(indice).getByRole("button", { name: /trayectoria/i })).toBeDisabled();
    expect(within(indice).getByRole("button", { name: /cadena de explicación/i })).toBeDisabled();
    expect(within(indice).getByRole("button", { name: /dictamen/i })).toBeEnabled();
  });

  it("autoguarda el borrador 1 s después de escribir, contra la versión base y sin crear versión", async () => {
    const usuario = userEvent.setup();
    const llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        llamadas.push({ url, cuerpo: JSON.parse(String(init?.body ?? "{}")) });
        return respuestaJson({
          origen: "fixture",
          guardado: "2026-09-11T23:00:00Z",
          version_base: 1,
          content_hash: "c".repeat(64),
          revisar_citas: false,
          citas_invalidas: [],
        });
      }),
    );

    render(workspace(desdeMarkdown(`## 1. Resumen\n\nTexto base [${CITA_VALIDA}].`)));
    const hoja = await waitFor(() => {
      const nodo = document.querySelector(".hoja-prosa");
      expect(nodo).not.toBeNull();
      return nodo as HTMLElement;
    });

    hoja.focus();
    await usuario.keyboard("Nota del auditor. ");

    // (la primera llamada es la sincronización de versiones del montaje)
    const borradores = () => llamadas.filter((l) => l.url === "/api/reportes/borrador");
    await waitFor(() => expect(borradores().length).toBeGreaterThan(0), { timeout: 4000 });
    expect(borradores()[0].cuerpo.version_base).toBe(1);
    expect(JSON.stringify(borradores()[0].cuerpo.documento)).toContain("Nota del auditor");
    // El autoguardado no versiona: la cabecera sigue en v1.
    expect(screen.getByText(/v1 · validado/)).toBeInTheDocument();
    expect(await screen.findByText(/^Guardado /)).toBeInTheDocument();
  }, 15000);

  it("al montar adopta la versión vigente si el expediente ya avanzó (recarga tras Aplicar)", async () => {
    const documentoV2 = desdeMarkdown(`## 1. Resumen\n\nTexto ya editado en la versión 2 [${CITA_VALIDA}].`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/reportes/versiones")) {
          return respuestaJson({
            origen: "fixture",
            versiones: [
              {
                caso_id: CASO,
                version: 1,
                estado_revision: "validado",
                autor: "agente",
                creado: "2026-09-11T22:00:00Z",
                contenido_json: desdeMarkdown("## 1. Resumen\n\nTexto original."),
                markdown: "## 1. Resumen\n\nTexto original.",
                content_hash: "a".repeat(64),
              },
              {
                caso_id: CASO,
                version: 2,
                estado_revision: "borrador",
                autor: "agente",
                creado: "2026-09-11T23:00:00Z",
                contenido_json: documentoV2,
                markdown: "## 1. Resumen\n\nTexto ya editado en la versión 2.",
                content_hash: "b".repeat(64),
              },
            ],
          });
        }
        return respuestaJson({ ok: true });
      }),
    );

    // La página monta con la v1 del Redactor: sin sincronización, toda
    // escritura chocaría en 409 contra un almacén que ya está en v2.
    render(workspace(desdeMarkdown("## 1. Resumen\n\nTexto original.")));

    expect(await screen.findByText(/v2 · borrador/)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector(".hoja-prosa")?.textContent).toContain("Texto ya editado en la versión 2"),
    );
  });

  it("ofrece los tres modos y explica el modo sugerir", async () => {
    const usuario = userEvent.setup();
    render(workspace(desdeMarkdown(redactorFixture.markdown)));

    const grupo = await screen.findByRole("group", { name: /modo de edición/i });
    await usuario.click(within(grupo).getByRole("button", { name: "sugerir" }));
    expect(await screen.findByText(/el documento no se edita a mano/i)).toBeInTheDocument();
  });
});

describe("ReportChat", () => {
  const props = {
    casoId: CASO,
    version: 1,
    evidencia,
    origen: "fixture" as const,
    modoLectura: false,
    onAplicado: vi.fn(),
    onLimpiarSeleccion: vi.fn(),
    onAbrirCita: vi.fn(),
  };

  const seleccion = { from: 1, to: 20, block_ids: ["blk-2"], texto_hash: "a".repeat(64), texto: "fragmento" };

  const propuestaFalsa = {
    propuesta_id: "00000000-0000-4000-8000-000000000403",
    version_base: 1,
    mensaje: "Propuesta de claridad.",
    patch: [],
    diff: "--- a\n+++ b\n-viejo\n+nuevo",
    citas: [CITA_VALIDA],
  };

  it("una pregunta sin selección devuelve mensaje y no ofrece Aplicar", async () => {
    const usuario = userEvent.setup();
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        llamadas.push(url);
        return respuestaJson({ origen: "fixture", modo: "pregunta", mensaje: "Respuesta sin cambios.", version_base: 1 });
      }),
    );

    render(<ReportChat {...props} seleccion={null} />);
    await usuario.type(screen.getByLabelText(/instrucción para el editor/i), "¿Qué sostiene la sección 5?");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    expect(await screen.findByText("Respuesta sin cambios.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar" })).not.toBeInTheDocument();
    expect(llamadas).toEqual(["/api/reportes/propuestas"]);
  });

  it("doble click en Aplicar crea una sola versión", async () => {
    const usuario = userEvent.setup();
    const aplicaciones: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/reportes/propuestas") {
          return respuestaJson({ origen: "fixture", modo: "propuesta", advertencias: [], propuesta: propuestaFalsa });
        }
        aplicaciones.push(JSON.parse(String(init?.body)));
        return respuestaJson({
          origen: "fixture",
          repetido: false,
          version: 2,
          reporte: {
            caso_id: CASO,
            version: 2,
            estado_revision: "borrador",
            autor: "agente",
            creado: "2026-09-11T23:00:00Z",
            contenido_json: { type: "doc", content: [] },
            markdown: "x",
            content_hash: "b".repeat(64),
          },
          revisar_citas: false,
          citas_invalidas: [],
        });
      }),
    );

    render(<ReportChat {...props} seleccion={seleccion} />);
    await usuario.type(screen.getByLabelText(/instrucción para el editor/i), "Hazlo más claro");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));
    await usuario.dblClick(await screen.findByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(aplicaciones).toHaveLength(1));
    expect(await screen.findByText(/versión 2 creada/i)).toBeInTheDocument();
    expect(props.onAplicado).toHaveBeenCalledTimes(1);
  });

  it("un conflicto de versión conserva el borrador y explica qué hacer", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/reportes/propuestas") {
          return respuestaJson({
            origen: "fixture",
            modo: "propuesta",
            advertencias: [],
            propuesta: { ...propuestaFalsa, propuesta_id: "00000000-0000-4000-8000-000000000404" },
          });
        }
        return respuestaJson({ error: "conflicto_version", version_actual: 3 }, 409);
      }),
    );

    render(<ReportChat {...props} seleccion={seleccion} />);
    await usuario.type(screen.getByLabelText(/instrucción para el editor/i), "Ajusta el resumen");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));
    await usuario.click(await screen.findByRole("button", { name: "Aplicar" }));

    expect(await screen.findByText(/cambió a la versión 3/i)).toBeInTheDocument();
    expect(await screen.findByText(/en conflicto/i)).toBeInTheDocument();
  });

  it("sin backend configurado lo dice, no finge una respuesta", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ error: "backend_no_configurado" }, 503)));

    render(<ReportChat {...props} seleccion={null} />);
    await usuario.type(screen.getByLabelText(/instrucción para el editor/i), "Resume");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    expect(await screen.findByText(/no hay backend de edición configurado/i)).toBeInTheDocument();
  });
});
