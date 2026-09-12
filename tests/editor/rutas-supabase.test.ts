// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import redactorFixture from "@contracts/fixtures/valid/redactor.json";
import { signSession } from "@/lib/auth/session";
import { reiniciarAlmacen } from "@/lib/document/almacen-demo";
import { hashTexto } from "@/lib/document/documento";
import { desdeMarkdown } from "@/lib/document/markdown";
import { crearRepositorioSupabase, forzarRepositorio } from "@/lib/document/repositorio";
import { rangoDeBloque, textoEntre } from "@/lib/document/seleccion";

import { POST as postPropuestas } from "@/app/api/reportes/propuestas/route";
import { POST as postAplicar } from "@/app/api/reportes/aplicar/route";
import { POST as postDescartar } from "@/app/api/reportes/descartar/route";
import { GET as getVersiones } from "@/app/api/reportes/versiones/route";

import { CASO, clienteFalso, crearAlmacen, type Almacen } from "./_doble-postgrest";

/**
 * Recorrido completo del editor **en modo `supabase`**, extremo a extremo por
 * las rutas reales: pedir propuesta → Aplicar → versiones → descartar.
 *
 * Es la prueba que faltaba. Las de `repositorio.test.ts` ejercitan el
 * repositorio por separado, y las de `rutas.test.ts` corren en modo fixture
 * (almacén en memoria). Ninguna de las dos demuestra lo único que importa
 * aquí: que el `propuesta_id` que el BFF devuelve al navegador EXISTE en
 * `forense.propuestas_edicion` cuando el usuario pulsa Aplicar. Si `/propuestas`
 * no persistiera la fila, `forense.aplicar_propuesta` (006 §7 busca por id)
 * respondería `contexto_invalido` y Aplicar sería un 404 permanente.
 *
 * El repositorio se inyecta con `forzarRepositorio`; la fuente de datos sigue
 * siendo la de fixtures para el detalle del caso (evidencia, RFC), que es
 * lectura y no persistencia.
 */

const documentoBase = desdeMarkdown(redactorFixture.markdown);
const BLOQUE_CUERPO = documentoBase.content[1].attrs.id;

let almacen: Almacen;

function montar(): Almacen {
  reiniciarAlmacen();
  almacen = crearAlmacen();
  forzarRepositorio(crearRepositorioSupabase(clienteFalso(almacen)));
  return almacen;
}

afterEach(() => forzarRepositorio(null));

async function cabeceras(): Promise<Record<string, string>> {
  const token = await signSession({ sub: "auditor", perfil_id: "00000000-0000-4000-8000-000000000300" });
  return {
    "content-type": "application/json",
    host: "localhost:3000",
    origin: "http://localhost:3000",
    cookie: `forense_session=${token}`,
  };
}

async function post(url: string, body: unknown): Promise<Request> {
  return new Request(`http://localhost:3000${url}`, { method: "POST", headers: await cabeceras(), body: JSON.stringify(body) });
}

function seleccion() {
  const rango = rangoDeBloque(documentoBase, BLOQUE_CUERPO)!;
  return {
    from: rango.from,
    to: rango.to,
    block_ids: [BLOQUE_CUERPO],
    texto_hash: hashTexto(textoEntre(documentoBase, rango.from, rango.to)),
  };
}

async function pedirPropuesta(clave: string) {
  const res = await postPropuestas(
    await post("/api/reportes/propuestas", {
      caso_id: CASO,
      version_base: 1,
      modo: "propuesta",
      seleccion: seleccion(),
      mensaje: "Hazlo más claro.",
      evidencia_ids: [],
      idempotency_key: clave,
    }),
  );
  return { res, json: await res.json() };
}

describe("BFF del editor en modo supabase (repositorio inyectado)", () => {
  it("la propuesta se PERSISTE antes de responderse y Aplicar la encuentra", async () => {
    const db = montar();
    const { res, json } = await pedirPropuesta("00000000-0000-4000-8000-000000000450");
    expect(res.status).toBe(200);
    expect(json.origen).toBe("fixture"); // la propuesta la calcula el BFF: no hay webhook
    expect(json.seleccion_verificada).toBe(true);

    // La fila existe en la base ANTES de que el usuario pulse Aplicar.
    expect(db.propuestas_edicion).toHaveLength(1);
    expect(db.propuestas_edicion[0].id).toBe(json.propuesta.propuesta_id);
    expect(db.propuestas_edicion[0].estado).toBe("propuesta");

    const aplicado = await postAplicar(
      await post(`/api/reportes/aplicar?caso_id=${CASO}`, {
        propuesta_id: json.propuesta.propuesta_id,
        version_base: 1,
        idempotency_key: "00000000-0000-4000-8000-000000000451",
      }),
    );
    expect(aplicado.status).toBe(200);
    const cuerpo = await aplicado.json();
    expect(cuerpo.origen).toBe("supabase");
    expect(cuerpo.bitacora).toBe(true);
    expect(cuerpo.version).toBe(2);

    // Escritura real: versión nueva en expedientes, propuesta marcada y
    // evento `edicion` en bitácora (CLAUDE.md regla 2).
    expect(db.expedientes.map((e) => e.version)).toEqual([1, 2]);
    expect(db.propuestas_edicion[0].estado).toBe("aplicada");
    expect(db.bitacora.filter((b) => b.tipo_evento === "edicion")).toHaveLength(1);

    const versiones = await getVersiones(
      new Request(`http://localhost:3000/api/reportes/versiones?caso_id=${CASO}`, { headers: await cabeceras() }),
    );
    const listado = await versiones.json();
    expect(listado.origen).toBe("supabase");
    expect(listado.versiones.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  });

  it("Descartar marca la fila real y no crea versión", async () => {
    const db = montar();
    const { json } = await pedirPropuesta("00000000-0000-4000-8000-000000000452");
    const res = await postDescartar(
      await post("/api/reportes/descartar", {
        caso_id: CASO,
        propuesta_id: json.propuesta.propuesta_id,
        idempotency_key: "00000000-0000-4000-8000-000000000453",
      }),
    );
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.origen).toBe("supabase");
    expect(cuerpo.estado).toBe("descartada");
    expect(db.propuestas_edicion[0].estado).toBe("descartada");
    expect(db.expedientes).toHaveLength(1);
  });

  it("dos peticiones con el mismo idempotency_key no crean dos propuestas", async () => {
    const db = montar();
    const uno = await pedirPropuesta("00000000-0000-4000-8000-000000000454");
    const dos = await pedirPropuesta("00000000-0000-4000-8000-000000000454");
    expect(uno.res.status).toBe(200);
    expect(dos.res.status).toBe(200);
    expect(db.propuestas_edicion).toHaveLength(1);
    expect(dos.json.propuesta.propuesta_id).toBe(uno.json.propuesta.propuesta_id);
    expect(dos.json.repetida).toBe(true);
  });
});
