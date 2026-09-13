#!/usr/bin/env python3
"""Puente de ingesta multi-formato para la carga web de estates.

    PYTHONPATH=src python3 loaders/ingestar_estate.py --input PATH --estates-dir DIR [--work-dir DIR]

PATH es lo mismo que acepta `python3 -m auditor run --estate`: un SQLite, un directorio de CSV (una tabla por
archivo), un directorio de XLSX, un .xlsx (hoja por tabla) o un .zip con CSV o XLSX. El formato lo detecta
`auditor.structure` por contenido, no por extensión.

Pasos:
1. Límites de seguridad antes de leer nada: el ZIP (y el XLSX, que es un ZIP) no se descomprime a disco —
   `auditor.structure.ingest` lee los miembros en memoria—, pero se rechazan rutas absolutas o con `..`,
   ZIP anidados, demasiados miembros y tamaños o razones de compresión de zip bomb.
2. `prepare()` mapea y normaliza al esquema canónico (spec/forensic-auditor/estate_schema.sql).
3. Si el SQLite ya es canónico e idéntico (`status == "identity"`), se guarda tal cual: mismo sha256 que antes,
   así la corrida ya cargada se reutiliza. Si no, `export_validator_estate` escribe un SQLite canónico con los
   ids originales (los mismos que citan los hallazgos).
4. El archivo queda direccionado por contenido: `DIR/<sha256 de sus bytes>.db`. Ese sha es el `dataset_hash`
   que registra `loaders/forensic_to_forense.py` y con el que preview y auditoría encuentran el archivo.
   Junto a él, `DIR/<sha256>.structure.json` con el `structure_report` y los avisos.

Salida (stdout, una línea JSON): {"estate_db", "sha256", "status", "structure_report_path", "structure_report",
"warnings"}. Código 2 = error de estructura o de entrada del usuario (mensaje en stderr, `error: …`); otro
código distinto de 0 = fallo interno.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from auditor.structure import StructureError, prepare  # noqa: E402

SQLITE_MAGIC = b"SQLite format 3\x00"
ZIP_MAGIC = b"PK\x03\x04"
MAX_ZIP_MEMBERS = 64                      # ZIP de datos: una tabla por miembro
MAX_XLSX_MEMBERS = 4096                   # XLSX: hojas, estilos, rels…
MAX_UNCOMPRESSED = 1024 * 1024 * 1024     # 1 GiB descomprimido por archivo
MAX_RATIO = 200                           # razón de compresión por miembro (zip bomb)
DATA_SUFFIXES = (".csv", ".tsv", ".txt", ".xlsx")


class EntradaInvalida(Exception):
    """Entrada del usuario que no se procesa: sale con código 2, igual que un error de estructura."""


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _head(p: Path, n: int = 16) -> bytes:
    with open(p, "rb") as fh:
        return fh.read(n)


def revisar_zip(p: Path, xlsx: bool) -> None:
    """Rechaza zip-slip, ZIP anidados y zip bombs. No extrae nada."""
    try:
        with zipfile.ZipFile(p) as z:
            infos = z.infolist()
    except zipfile.BadZipFile as exc:
        raise EntradaInvalida(f"{p.name}: ZIP dañado ({exc})") from exc
    limite = MAX_XLSX_MEMBERS if xlsx else MAX_ZIP_MEMBERS
    if len(infos) > limite:
        raise EntradaInvalida(f"{p.name}: {len(infos)} miembros en el ZIP (máximo {limite})")
    total = 0
    datos = 0
    for i in infos:
        nombre = i.filename.replace("\\", "/")
        partes = PurePosixPath(nombre).parts
        if nombre.startswith("/") or (len(nombre) > 1 and nombre[1] == ":") or ".." in partes:
            raise EntradaInvalida(f"{p.name}: ruta insegura dentro del ZIP: {i.filename!r}")
        if i.flag_bits & 0x1:
            raise EntradaInvalida(f"{p.name}: el ZIP está cifrado ({i.filename!r})")
        total += i.file_size
        if total > MAX_UNCOMPRESSED:
            raise EntradaInvalida(f"{p.name}: más de {MAX_UNCOMPRESSED // (1024 * 1024)} MB descomprimido")
        if i.file_size > 1024 * 1024 and i.file_size > max(i.compress_size, 1) * MAX_RATIO:
            raise EntradaInvalida(f"{p.name}: razón de compresión sospechosa en {i.filename!r}")
        if xlsx or i.is_dir() or "__MACOSX" in partes or PurePosixPath(nombre).name.startswith("."):
            continue
        suf = PurePosixPath(nombre).suffix.lower()
        if suf in (".zip",):
            raise EntradaInvalida(f"{p.name}: ZIP anidado ({i.filename!r}); sube los CSV o XLSX directamente")
        if suf in DATA_SUFFIXES:
            datos += 1
    if not xlsx and datos == 0:
        raise EntradaInvalida(f"{p.name}: el ZIP no contiene archivos .csv ni .xlsx")


def revisar_entrada(p: Path) -> None:
    if p.is_dir():
        archivos = sorted(x for x in p.iterdir() if x.is_file() and not x.name.startswith("."))
        if not archivos:
            raise EntradaInvalida("el directorio está vacío")
        sufijos = {x.suffix.lower() for x in archivos}
        if sufijos & {".db", ".sqlite", ".sqlite3", ".zip"}:
            raise EntradaInvalida("un conjunto de archivos solo puede ser CSV o XLSX; un .db o .zip va solo")
        if ".xlsx" in sufijos and sufijos & {".csv", ".tsv", ".txt"}:
            raise EntradaInvalida("no mezcles CSV y XLSX en el mismo dataset")
        for x in archivos:
            if x.suffix.lower() == ".xlsx":
                revisar_zip(x, xlsx=True)
        return
    head = _head(p)
    if not head:
        raise EntradaInvalida(f"{p.name} está vacío")
    if head.startswith(ZIP_MAGIC):
        try:
            with zipfile.ZipFile(p) as z:
                es_xlsx = "xl/workbook.xml" in z.namelist()
        except zipfile.BadZipFile as exc:
            raise EntradaInvalida(f"{p.name}: ZIP dañado ({exc})") from exc
        revisar_zip(p, xlsx=es_xlsx)


def avisos(report: dict) -> list[str]:
    """Resumen legible de lo que el usuario debe revisar. Todo sale del structure_report, nada se inventa."""
    out: list[str] = []
    if report.get("status") == "identity":
        return out
    if report.get("low_confidence"):
        out.append("Mapeos de baja confianza: " + ", ".join(report["low_confidence"]))
    for s, faltan in (report.get("disabled_schemes") or {}).items():
        out.append(f"Detector {s} apagado: falta {', '.join(faltan)}")
    for s, faltan in (report.get("weakened_schemes") or {}).items():
        out.append(f"Detector {s} con evidencia reducida: sin {', '.join(faltan)}")
    for k, n in (report.get("precision_lost") or {}).items():
        out.append(f"{n} valor(es) descartado(s) por pérdida de precisión en {k}")
    for k, n in (report.get("id_collisions") or {}).items():
        out.append(f"{n} id(s) de {k} colisionan al normalizar")
    if report.get("missing_tables"):
        out.append("Tablas sin datos utilizables: " + ", ".join(report["missing_tables"]))
    if report.get("unmapped_source_tables"):
        out.append("Tablas de la entrada no usadas: " + ", ".join(report["unmapped_source_tables"]))
    return out


def avisos_carga(db: Path) -> list[str]:
    """Límites del loader a Supabase que no son de estructura: se avisan antes de que falle la carga."""
    out = []
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        malos = conn.execute("SELECT count(*) FROM ledger WHERE entry_id IS NOT NULL AND typeof(entry_id) <> 'integer' "
                             "AND CAST(entry_id AS INTEGER) || '' <> trim(entry_id)").fetchone()[0]
    except sqlite3.DatabaseError:
        malos = 0
    finally:
        conn.close()
    if malos:
        out.append(f"ledger.entry_id no numérico en {malos} fila(s): la carga a forense.polizas exige entero")
    return out


def ingestar(entrada: Path, estates_dir: Path, work_dir: Path | None = None) -> dict:
    revisar_entrada(entrada)
    estates_dir.mkdir(parents=True, exist_ok=True)
    work = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="ingesta_"))
    work.mkdir(parents=True, exist_ok=True)
    prep = prepare(str(entrada), None, str(work))
    try:
        report = prep.report
        tmp = estates_dir / f".ingesta-{os.getpid()}.db.tmp"
        if report.get("status") == "identity" and entrada.is_file():
            sha = sha256_file(entrada)
            destino = estates_dir / f"{sha}.db"
            if not destino.exists():
                shutil.copyfile(entrada, tmp)
                os.replace(tmp, destino)
        else:
            prep.export_validator_estate(str(tmp))
            sha = sha256_file(tmp)
            destino = estates_dir / f"{sha}.db"
            os.replace(tmp, destino)
    finally:
        if prep.conn is not None:
            prep.conn.close()
        prep.src.close()
    warnings = avisos(report) + avisos_carga(destino)
    ruta_reporte = estates_dir / f"{sha}.structure.json"
    cuerpo = {"sha256": sha, "status": report.get("status"), "structure_report": report, "warnings": warnings}
    tmp_json = ruta_reporte.with_suffix(".json.tmp")
    tmp_json.write_text(json.dumps(cuerpo, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    os.replace(tmp_json, ruta_reporte)
    return {"estate_db": str(destino), "sha256": sha, "status": report.get("status"),
            "structure_report_path": str(ruta_reporte), "structure_report": report, "warnings": warnings}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ingestar_estate")
    ap.add_argument("--input", required=True)
    ap.add_argument("--estates-dir", required=True)
    ap.add_argument("--work-dir")
    a = ap.parse_args(argv)
    entrada = Path(a.input)
    if not entrada.exists():
        print(f"error: no existe {a.input}", file=sys.stderr)
        return 2
    try:
        out = ingestar(entrada, Path(a.estates_dir), Path(a.work_dir) if a.work_dir else None)
    except (StructureError, EntradaInvalida) as exc:
        msg = str(exc)
        print(f"error: {msg if msg.startswith('estate structure') else 'estate structure: ' + msg}", file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
