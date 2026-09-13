// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ErrorSubida, MAX_ARCHIVOS, hashConjunto, sanearNombre, tipoPorContenido, validarConjunto } from "./archivos";

const SQLITE = Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(84)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....vendors.csv....")]);
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....xl/workbook.xml....")]);
const CSV = Buffer.from("rfc,legal_name\nAAA010101AA1,Uno\n");

function error(fn: () => unknown): ErrorSubida {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorSubida) return e;
    throw e;
  }
  throw new Error("no lanzó ErrorSubida");
}

describe("sanearNombre", () => {
  it("se queda con el último segmento: sin path traversal ni rutas absolutas", () => {
    expect(sanearNombre("../../etc/passwd.csv", 0)).toBe("passwd.csv");
    expect(sanearNombre("C:\\Users\\x\\..\\facturas.CSV", 0)).toBe("facturas.csv");
    expect(sanearNombre("/abs/vendors.csv", 0)).toBe("vendors.csv");
  });

  it("quita puntos iniciales, caracteres de control y conserva letras con acento (nombre de tabla)", () => {
    expect(sanearNombre("..pólizas\u0000;rm -rf.csv", 0)).toBe("pólizasrm -rf.csv");
    expect(sanearNombre("...", 2)).toBe("archivo-3");
  });

  it("acota a 100 caracteres conservando la extensión", () => {
    const n = sanearNombre(`${"a".repeat(300)}.csv`, 0);
    expect(n.length).toBe(100);
    expect(n.endsWith(".csv")).toBe(true);
  });
});

describe("tipoPorContenido", () => {
  it("SQLite exige la cabecera mágica, no basta la extensión", () => {
    expect(tipoPorContenido("e.db", SQLITE)).toBe("sqlite");
    expect(tipoPorContenido("e.db", CSV)).toBeNull();
  });

  it("XLSX es un ZIP con xl/workbook.xml; un ZIP cualquiera renombrado a .xlsx no pasa", () => {
    expect(tipoPorContenido("libro.xlsx", XLSX)).toBe("xlsx");
    expect(tipoPorContenido("libro.xlsx", ZIP)).toBeNull();
    expect(tipoPorContenido("datos.zip", ZIP)).toBe("zip");
    expect(tipoPorContenido("datos.zip", CSV)).toBeNull();
  });

  it("CSV es texto: se rechaza un binario (NUL), un SQLite o un ZIP con extensión .csv", () => {
    expect(tipoPorContenido("t.csv", CSV)).toBe("csv");
    expect(tipoPorContenido("t.csv", SQLITE)).toBeNull();
    expect(tipoPorContenido("t.csv", ZIP)).toBeNull();
    expect(tipoPorContenido("t.csv", Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
    expect(tipoPorContenido("t.csv", Buffer.alloc(0))).toBeNull();
  });
});

describe("validarConjunto", () => {
  it("un SQLite, un ZIP, un XLSX o varios CSV forman un dataset", () => {
    expect(validarConjunto([{ nombre: "e.sqlite3", bytes: SQLITE }]).formato).toBe("sqlite");
    expect(validarConjunto([{ nombre: "e.zip", bytes: ZIP }]).formato).toBe("zip");
    expect(validarConjunto([{ nombre: "e.xlsx", bytes: XLSX }]).formato).toBe("xlsx");
    expect(validarConjunto([{ nombre: "a.xlsx", bytes: XLSX }, { nombre: "b.xlsx", bytes: XLSX }]).formato).toBe("xlsx_dir");
    const c = validarConjunto([
      { nombre: "vendors.csv", bytes: CSV },
      { nombre: "invoices.csv", bytes: CSV },
    ]);
    expect(c.formato).toBe("csv_dir");
    expect(c.archivos.map((a) => a.nombre)).toEqual(["vendors.csv", "invoices.csv"]);
  });

  it("rechaza mezclas con 400 mezcla_invalida", () => {
    for (const set of [
      [{ nombre: "e.db", bytes: SQLITE }, { nombre: "v.csv", bytes: CSV }],
      [{ nombre: "e.zip", bytes: ZIP }, { nombre: "v.csv", bytes: CSV }],
      [{ nombre: "a.xlsx", bytes: XLSX }, { nombre: "v.csv", bytes: CSV }],
      [{ nombre: "a.db", bytes: SQLITE }, { nombre: "b.db", bytes: SQLITE }],
      [{ nombre: "a.zip", bytes: ZIP }, { nombre: "b.zip", bytes: ZIP }],
    ]) {
      const e = error(() => validarConjunto(set));
      expect([e.status, e.codigo]).toEqual([400, "mezcla_invalida"]);
    }
  });

  it("rechaza extensión no admitida, contenido que no coincide, nombres duplicados y demasiados archivos", () => {
    expect(error(() => validarConjunto([{ nombre: "x.exe", bytes: CSV }])).codigo).toBe("extension_no_admitida");
    expect(error(() => validarConjunto([{ nombre: "x.db", bytes: CSV }])).codigo).toBe("contenido_no_coincide");
    expect(
      error(() => validarConjunto([{ nombre: "dir/v.csv", bytes: CSV }, { nombre: "otro/V.csv", bytes: CSV }])).codigo,
    ).toBe("nombres_duplicados");
    const muchos = Array.from({ length: MAX_ARCHIVOS + 1 }, (_, i) => ({ nombre: `t${i}.csv`, bytes: CSV }));
    expect(error(() => validarConjunto(muchos)).codigo).toBe("demasiados_archivos");
    expect(error(() => validarConjunto([])).codigo).toBe("falta_archivo");
  });

  it("el hash del conjunto es determinista e independiente del orden de selección, y cambia con nombre o contenido", () => {
    const a = validarConjunto([{ nombre: "vendors.csv", bytes: CSV }, { nombre: "invoices.csv", bytes: Buffer.from("uuid\n1\n") }]);
    const b = validarConjunto([{ nombre: "invoices.csv", bytes: Buffer.from("uuid\n1\n") }, { nombre: "vendors.csv", bytes: CSV }]);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hashConjunto("csv_dir", [{ nombre: "vendors2.csv", bytes: CSV }])).not.toBe(hashConjunto("csv_dir", [{ nombre: "vendors.csv", bytes: CSV }]));
    expect(hashConjunto("csv_dir", [{ nombre: "vendors.csv", bytes: Buffer.from("x") }])).not.toBe(
      hashConjunto("csv_dir", [{ nombre: "vendors.csv", bytes: CSV }]),
    );
  });
});
