// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import redactorFixture from "@contracts/fixtures/valid/redactor.json";
import { signSession } from "@/lib/auth/session";
import { validateContract } from "@/lib/contracts/validate";
import { reiniciarAlmacen } from "@/lib/document/almacen-demo";
import { citasDeMarkdown } from "@/lib/document/citas";
import { hashTexto } from "@/lib/document/documento";
import { aMarkdown, desdeMarkdown } from "@/lib/document/markdown";
import { rangoDeBloque, textoEntre } from "@/lib/document/seleccion";

import { POST as postPropuestas } from "@/app/api/reportes/propuestas/route";
import { POST as postAplicar } from "@/app/api/reportes/aplicar/route";
import { POST as postDescartar } from "@/app/api/reportes/descartar/route";
import { POST as postRevertir } from "@/app/api/reportes/revertir/route";
import { POST as postExportar } from "@/app/api/reportes/exportar/route";
import { POST as postBorrador } from "@/app/api/reportes/borrador/route";

/**
 * Flujo completo del editor a través del BFF, con la fuente de datos de
 * fixtures: selección → propuesta → Aplicar crea versión; pregunta no modifica;
 * doble Aplicar idempotente; conflicto de `version_base`; exportación que
 * conserva las citas. Todas las respuestas se validan contra los contratos
 * reales de `contracts/` (no contra copias).
 */

const CASO = "00000000-0000-4000-8000-000000000100";
const CITA = "CFDI:00000000-0000-4000-8000-000000000901";

const documentoBase = desdeMarkdown(redactorFixture.markdown);
const BLOQUE_CUERPO = documentoBase.content[1].attrs.id;

let cookie = "";

async function sesion(): Promise<string> {
  if (cookie) return cookie;
  const token = await signSession({ sub: "auditor", perfil_id: "00000000-0000-4000-8000-000000000300" });
  cookie = `forense_session=${token}`;
  return cookie;
}

async function peticion(url: string, body: unknown): Promise<Request> {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      cookie: await sesion(),
    },
    body: JSON.stringify(body),
  });
}

function uuid(sufijo: string): string {
  return `00000000-0000-4000-8000-${sufijo.padStart(12, "0")}`;
}

/**
 * Selección REAL: posiciones ProseMirror del bloque y hash del texto que esas
 * posiciones devuelven. Desde el hallazgo 2 el BFF contrasta `texto_hash` con
 * el contenido del bloque, así que una selección inventada es 409 —lo prueba
 * `seleccion.test.ts`.
 */
function seleccion(blockId = BLOQUE_CUERPO, documento = documentoBase) {
  const rango = rangoDeBloque(documento, blockId);
  if (!rango) throw new Error(`bloque ausente: ${blockId}`);
  return {
    from: rango.from,
    to: rango.to,
    block_ids: [blockId],
    texto_hash: hashTexto(textoEntre(documento, rango.from, rango.to)),
  };
}

async function pedirPropuesta(versionBase = 1, clave = uuid("401")) {
  const res = await postPropuestas(
    await peticion("/api/reportes/propuestas", {
      caso_id: CASO,
      version_base: versionBase,
      modo: "propuesta",
      seleccion: seleccion(),
      mensaje: "Hazlo más claro.",
      evidencia_ids: ["701"],
      idempotency_key: clave,
    }),
  );
  return { res, json: await res.json() };
}

describe("BFF de reportes (editor)", () => {
  beforeEach(() => {
    reiniciarAlmacen();
  });

  it("rechaza sin sesión (401) y con origen cruzado (403)", async () => {
    const sinCookie = new Request("http://localhost:3000/api/reportes/propuestas", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
      body: "{}",
    });
    expect((await postPropuestas(sinCookie)).status).toBe(401);

    const cruzado = new Request("http://localhost:3000/api/reportes/propuestas", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "https://evil.example", cookie: await sesion() },
      body: "{}",
    });
    expect((await postPropuestas(cruzado)).status).toBe(403);
  });

  it("cuerpo que no cumple `editor.solicitud` devuelve 422 con los errores del contrato", async () => {
    const res = await postPropuestas(
      await peticion("/api/reportes/propuestas", { caso_id: CASO, version_base: 1, modo: "propuesta", mensaje: "x" }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("contrato_invalido");
  });

  it("una pregunta devuelve mensaje y NO modifica el documento (09 §8)", async () => {
    const res = await postPropuestas(
      await peticion("/api/reportes/propuestas", {
        caso_id: CASO,
        version_base: 1,
        modo: "pregunta",
        mensaje: "¿Qué sostiene la sección 5?",
        evidencia_ids: [],
        idempotency_key: uuid("410"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.modo).toBe("pregunta");
    expect(json.propuesta).toBeUndefined();
    expect(json.origen).toBe("fixture");

    // La versión sigue siendo la 1 y su contenido es el del Redactor.
    const exportado = await (await postExportar(await peticion("/api/reportes/exportar", { caso_id: CASO, formato: "md" }))).json();
    expect(exportado.manifiesto.version).toBe(1);
    expect(exportado.contenido).toContain("## 1. Resumen");
  });

  it("selección → propuesta → Aplicar crea la versión 2", async () => {
    const { res, json } = await pedirPropuesta();
    expect(res.status).toBe(200);
    expect(json.modo).toBe("propuesta");
    expect(validateContract("editor.propuesta", json.propuesta).errors).toEqual([]);

    const aplicar = await postAplicar(
      await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: json.propuesta.propuesta_id,
        version_base: 1,
        idempotency_key: uuid("402"),
      }),
    );
    expect(aplicar.status).toBe(200);
    const aplicado = await aplicar.json();
    expect(aplicado.version).toBe(2);
    expect(aplicado.repetido).toBe(false);
    expect(validateContract("editor.reporte", aplicado.reporte).errors).toEqual([]);
    // El editor nunca marca una versión como validada.
    expect(aplicado.reporte.estado_revision).toBe("borrador");
    expect(aplicado.reporte.markdown).toContain("Wording revised");
  });

  it("doble Aplicar (mismo idempotency_key) devuelve la misma versión, no dos", async () => {
    const { json } = await pedirPropuesta();
    const cuerpo = { propuesta_id: json.propuesta.propuesta_id, version_base: 1, idempotency_key: uuid("403") };

    const primero = await (await postAplicar(await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, cuerpo))).json();
    const segundo = await (await postAplicar(await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, cuerpo))).json();

    expect(primero.version).toBe(2);
    expect(segundo.version).toBe(2);
    expect(segundo.repetido).toBe(true);
    expect(segundo.reporte.content_hash).toBe(primero.reporte.content_hash);
  });

  it("Aplicar con `version_base` vencido es conflicto 409 e informa la versión actual", async () => {
    const primera = await pedirPropuesta();
    await postAplicar(
      await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: primera.json.propuesta.propuesta_id,
        version_base: 1,
        idempotency_key: uuid("404"),
      }),
    );

    // Otra propuesta calculada sobre la versión 1, aplicada tarde: conflicto.
    const res = await postAplicar(
      await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: primera.json.propuesta.propuesta_id,
        version_base: 1,
        idempotency_key: uuid("405"),
      }),
    );
    // La propuesta ya aplicada devuelve su versión (idempotencia por propuesta).
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);

    // Una solicitud de propuesta con version_base vencida también es conflicto.
    const desfasada = await pedirPropuesta(1, uuid("406"));
    expect(desfasada.res.status).toBe(409);
    expect(desfasada.json.version_actual).toBe(2);
  });

  it("Descartar no crea versión y deja la propuesta inutilizable", async () => {
    const { json } = await pedirPropuesta();
    const descarte = await postDescartar(
      await peticion("/api/reportes/descartar", {
        caso_id: CASO,
        propuesta_id: json.propuesta.propuesta_id,
        idempotency_key: uuid("407"),
      }),
    );
    expect(descarte.status).toBe(200);
    const cuerpo = await descarte.json();
    expect(cuerpo.estado).toBe("descartada");
    expect(cuerpo.version_actual).toBe(1);

    const aplicar = await postAplicar(
      await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: json.propuesta.propuesta_id,
        version_base: 1,
        idempotency_key: uuid("408"),
      }),
    );
    expect(aplicar.status).toBe(404);
    expect((await aplicar.json()).error).toBe("propuesta_descartada");
  });

  it("Revertir crea una versión nueva con el contenido de la elegida (no borra historial)", async () => {
    const { json } = await pedirPropuesta();
    await postAplicar(
      await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: json.propuesta.propuesta_id,
        version_base: 1,
        idempotency_key: uuid("409"),
      }),
    );

    const res = await postRevertir(
      await peticion("/api/reportes/revertir", {
        caso_id: CASO,
        accion: "revertir",
        version_objetivo: 1,
        version_base: 2,
        idempotency_key: uuid("411"),
      }),
    );
    expect(res.status).toBe(200);
    const revertido = await res.json();
    expect(revertido.version).toBe(3);
    expect(revertido.reporte.autor).toBe("humano");
    // El contenido revertido es idéntico al de la versión 1 (Markdown derivado del mismo JSON).
    expect(revertido.reporte.markdown).toBe(aMarkdown(desdeMarkdown(redactorFixture.markdown)));
    expect(revertido.reporte.markdown).toContain("## 1. Resumen");
    expect(revertido.reporte.markdown).not.toContain("Wording revised");
  });

  it("el autoguardado NO crea versión y detecta el conflicto de version_base", async () => {
    const documento = { ...documentoBase };
    const ok = await postBorrador(
      await peticion("/api/reportes/borrador", { caso_id: CASO, version_base: 1, documento }),
    );
    expect(ok.status).toBe(200);
    const guardado = await ok.json();
    expect(guardado.content_hash).toMatch(/^[a-f0-9]{64}$/);

    const exportado = await (await postExportar(await peticion("/api/reportes/exportar", { caso_id: CASO, formato: "json" }))).json();
    expect(exportado.manifiesto.version).toBe(1); // el borrador no versiona

    const conflicto = await postBorrador(
      await peticion("/api/reportes/borrador", { caso_id: CASO, version_base: 7, documento }),
    );
    expect(conflicto.status).toBe(409);
    expect((await conflicto.json()).version_actual).toBe(1);
  });

  it("un texto_hash que no corresponde al bloque es 409 seleccion_desplazada", async () => {
    // El bloque existe, pero el texto seleccionado ya no está en él: el BFF lo
    // PRUEBA contra el contenido y pide reconfirmar (07 §4 nodo 6).
    const res = await postPropuestas(
      await peticion("/api/reportes/propuestas", {
        caso_id: CASO,
        version_base: 1,
        modo: "propuesta",
        seleccion: { ...seleccion(), texto_hash: hashTexto("un fragmento que jamás estuvo en el expediente") },
        mensaje: "Hazlo más claro.",
        evidencia_ids: [],
        idempotency_key: uuid("430"),
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("seleccion_desplazada");
    expect(json.motivo).toBe("texto_hash");
    expect(json.version_actual).toBe(1);
  });

  it("una selección real declara seleccion_verificada:true", async () => {
    const { res, json } = await pedirPropuesta(1, uuid("431"));
    expect(res.status).toBe(200);
    expect(json.seleccion_verificada).toBe(true);
  });

  it("la propuesta se calcula sobre el borrador: un bloque escrito en la sesión puede editarse y Aplicar no lo pierde", async () => {
    // El usuario escribe un párrafo nuevo; el autoguardado lo conserva.
    const conNota = {
      ...documentoBase,
      content: [
        ...documentoBase.content,
        { type: "paragraph", attrs: { id: "blk-nota-1" }, content: [{ type: "text", text: "Nota manual del auditor." }] },
      ],
    };
    const guardado = await postBorrador(
      await peticion("/api/reportes/borrador", { caso_id: CASO, version_base: 1, documento: conNota }),
    );
    expect(guardado.status).toBe(200);

    // Ese bloque NO existe en la versión almacenada: si la propuesta se
    // calculara sobre ella, esto sería 409 `seleccion_desplazada`.
    const res = await postPropuestas(
      await peticion("/api/reportes/propuestas", {
        caso_id: CASO,
        version_base: 1,
        modo: "propuesta",
        seleccion: seleccion("blk-nota-1", conNota as typeof documentoBase),
        mensaje: "Hazlo más claro.",
        evidencia_ids: [],
        idempotency_key: uuid("412"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.modo).toBe("propuesta");

    const aplicado = await (
      await postAplicar(
        await peticion(`/api/reportes/aplicar?caso_id=${CASO}`, {
          propuesta_id: json.propuesta.propuesta_id,
          version_base: 1,
          idempotency_key: uuid("413"),
        }),
      )
    ).json();
    expect(aplicado.version).toBe(2);
    // La edición manual sobrevive a Aplicar y la propuesta se aplicó sobre ella.
    expect(aplicado.reporte.markdown).toContain("Nota manual del auditor");
    expect(aplicado.reporte.markdown).toContain("Wording revised");
  });

  it("exportar MD y JSON conserva exactamente las citas del documento", async () => {
    const md = await (await postExportar(await peticion("/api/reportes/exportar", { caso_id: CASO, formato: "md" }))).json();
    const json = await (await postExportar(await peticion("/api/reportes/exportar", { caso_id: CASO, formato: "json" }))).json();

    expect(md.nombre).toBe("expediente-DEMO:ENTIDAD-0-v1.md");
    expect(new Set(citasDeMarkdown(md.contenido))).toEqual(new Set([CITA]));
    expect(new Set(json.citas)).toEqual(new Set([CITA]));
    expect(md.manifiesto.content_hash).toBe(json.manifiesto.content_hash);
    expect(md.manifiesto.contratos).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(md.manifiesto.citas_sin_evidencia).toEqual([]);
    // El JSON exportado incluye el documento canónico completo.
    expect(JSON.parse(json.contenido).reporte.contenido_json.type).toBe("doc");
  });

  it("una cita sin evidencia validada queda marcada en la exportación y en el guardado", async () => {
    const conCitaFalsa = desdeMarkdown(
      `## 1. Resumen\n\nAfirmación sin sustento [CFDI:99999999-9999-4999-8999-999999999999] y [CADENA:paso-3].`,
    );
    const res = await postBorrador(
      await peticion("/api/reportes/borrador", { caso_id: CASO, version_base: 1, documento: conCitaFalsa }),
    );
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.revisar_citas).toBe(true);
    expect(cuerpo.citas_invalidas).toEqual(["CFDI:99999999-9999-4999-8999-999999999999", "CADENA:paso-3"]);
  });

  it("caso inexistente: 404", async () => {
    const res = await postExportar(await peticion("/api/reportes/exportar", { caso_id: uuid("999"), formato: "md" }));
    expect(res.status).toBe(404);
  });
});
