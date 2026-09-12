#!/usr/bin/env python3
"""Adaptador de la lista 69-B real del SAT al esquema canónico (docs/04 §1).

    python3 loaders/load_69b.py --in data/raw/69b.csv --db forense \\
        --fecha-corte 2026-01-31

Carga `forense.listas_sat`. Valor para el demo: E1 deja de cruzar sólo
contra publicaciones inventadas por el generador y cruza contra la lista
real (docs/04 §1 "Para qué la usamos").

LO QUE ESTE ADAPTADOR **NO** HACE
---------------------------------
No inventa CFDI, ni padrón, ni movimientos. De la lista 69-B sabemos quién
fue publicado y con qué estatus; **no** sabemos sus facturas (docs/04: el
ground truth de esta fuente es PARCIAL). Por eso:

*   la corrida se abre con `familias_evaluables = {E}`: D, F, R y T quedan
    **declaradas no evaluables** con su motivo en `forense.pistas`
    (`estado = 'no_evaluable'`) la primera vez que corren las pistas, no
    silenciosamente ausentes. Ausencia de señal no es ausencia de fraude;
*   `ground_truth` se queda VACÍO. Aparecer en la lista con estatus
    `definitivo` es un hecho publicado por la autoridad, no una etiqueta de
    evaluación de nuestro detector, y mezclarlas inflaría el recall.

Dos modos de entrada:

*   por omisión, **corrida propia** (`--nombre 69b-<fecha_corte>`). Sirve
    como referencia y como fuente de la trampa legítima de E1 (un RFC con
    último estatus `desvirtuado`), y es lo que exige la regla 10: snapshot
    aislado, validado y promovido a `lista`;
*   `--anexar-a <corrida_id>` mete la lista real en un snapshot que TODAVÍA
    está en `preparando`. Si la corrida destino ya está `lista`,
    `procesando` o `completada`, el adaptador se niega: enriquecer un
    snapshot publicado es cambiar los datos bajo los pies de resultados que
    ya se calcularon (regla 10). Para eso se clona la corrida primero.

FORMATO DE ENTRADA ESPERADO
---------------------------
CSV (UTF-8 o Latin-1, separador `,` o `;`, con encabezado) descargado del
portal del SAT → consultas 69-B → "Listado completo". El portal ha usado
varios encabezados a lo largo del tiempo, así que el adaptador acepta
sinónimos (ver `SINONIMOS`) y **falla diciendo qué columna falta**:

    rfc                  RFC del contribuyente publicado          OBLIGATORIA
    razon_social         nombre o razón social (UNTRUSTED)        obligatoria
    estatus              presunto | definitivo | desvirtuado |    OBLIGATORIA
                         sentencia_favorable | ...
    fecha_publicacion    fecha de publicación del estatus         OBLIGATORIA
    oficio               número de oficio global/notificación     opcional

Las primeras filas del portal suelen traer un preámbulo antes del
encabezado real; `--saltar N` las descarta. `data/raw/` está en
`.gitignore`: la descarga es manual y única (docs/04 §1 "Advertencia
práctica"), este repo sólo guarda la muestra de prueba
`loaders/samples/69b_muestra.csv`.

IDEMPOTENCIA
------------
`corrida_id = uuid5(NS, "corrida:<dataset_hash>|<nombre>")` y la carga a
`forense.listas_sat` va con `on conflict do nothing` sobre su clave
primaria `(corrida_id, rfc, lista, estatus, fecha_publicacion)`. Cargar dos
veces el mismo archivo no duplica ni una fila: la segunda corrida reporta
`0 nuevas`. Un archivo distinto tiene otro `dataset_hash` y por tanto otra
corrida; no se pisa la anterior.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
import subprocess
import sys
import tempfile
import unicodedata
import uuid

NS = uuid.UUID("6f1c9d2e-0000-4000-8000-000000000000")

# Columnas canónicas → sinónimos aceptados del portal del SAT (normalizados:
# sin acentos, minúsculas, sin puntuación). Si no hay ninguno, se falla
# nombrando la columna canónica que falta.
SINONIMOS = {
    "rfc": ("rfc", "rfc del contribuyente", "rfc contribuyente"),
    "razon_social": ("razon social", "nombre del contribuyente", "nombre denominacion o razon social",
                     "contribuyente", "nombre razon social"),
    "estatus": ("estatus", "situacion del contribuyente", "situacion", "supuesto",
                "estatus del contribuyente"),
    "fecha_publicacion": ("fecha publicacion", "fecha de publicacion", "fecha publicacion dof",
                          "fecha de publicacion pagina sat", "fecha de primera publicacion"),
    "oficio": ("oficio", "numero y fecha de oficio global de presuncion", "numero de oficio",
               "oficio global", "numero y fecha de oficio global de definitivos"),
}
OBLIGATORIAS = ("rfc", "razon_social", "estatus", "fecha_publicacion")

# Estatus canónicos. Lo que no mapea se conserva tal cual en `estatus`
# (texto del portal) y se reporta: no se reescribe una resolución de la
# autoridad para que encaje en nuestro enum.
#
# El término "definitivo" que aparece abajo es el ESTATUS que publica la
# autoridad en la lista del art. 69-B, y es el único uso legítimo de esa
# palabra en el repo. NUNCA es un nivel de salida del sistema: el máximo que
# emite el dictaminador es `presuncion_alta` (regla 7 de CLAUDE.md). Quien
# lea este diccionario no debe confundir una resolución del SAT con una
# conclusión nuestra.
ESTATUS = {
    "presunto": "presunto",
    "presuntos": "presunto",
    "definitivo": "definitivo",
    "definitivos": "definitivo",
    "desvirtuado": "desvirtuado",
    "desvirtuados": "desvirtuado",
    "sentencia favorable": "sentencia_favorable",
    "sentencia_favorable": "sentencia_favorable",
    "favorable": "sentencia_favorable",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").strip().lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join("".join(c if c.isalnum() or c.isspace() else " " for c in s).split())


def sha256(ruta: str) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sql_lit(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def abrir(ruta: str, saltar: int):
    """Devuelve (encabezado_normalizado, lector). Tolera Latin-1 y `;`."""
    crudo = open(ruta, "rb").read()
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            texto = crudo.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover
        raise SystemExit("no pude decodificar %s (probé utf-8 y latin-1)" % ruta)
    lineas = texto.splitlines()[saltar:]
    if not lineas:
        raise SystemExit("%s: no hay filas después de saltar %d" % (ruta, saltar))
    sep = ";" if lineas[0].count(";") > lineas[0].count(",") else ","
    lector = csv.reader(io.StringIO("\n".join(lineas)), delimiter=sep)
    encabezado = [norm(c) for c in next(lector)]
    return encabezado, lector, sep, enc


def mapear(encabezado):
    """encabezado normalizado → índice por columna canónica. Falla nombrando
    la columna que falta, que es el requisito del encargo."""
    indice = {}
    for canon, alias in SINONIMOS.items():
        for a in alias:
            if a in encabezado:
                indice[canon] = encabezado.index(a)
                break
    faltan = [c for c in OBLIGATORIAS if c not in indice]
    if faltan:
        raise SystemExit(
            "entrada rechazada: falta la columna %s.\n"
            "  columnas encontradas: %s\n"
            "  sinónimos aceptados para %s: %s\n"
            "  si el portal cambió el encabezado, añádelo a SINONIMOS en "
            "loaders/load_69b.py (no lo adivines en la base)."
            % (", ".join(faltan), ", ".join(encabezado) or "(ninguna)",
               faltan[0], ", ".join(SINONIMOS[faltan[0]])))
    return indice


def normalizar_fecha(v: str) -> str:
    """ISO desde los formatos que publica el portal. Devuelve '' si no se
    puede: la fila se rechaza con código, no se inventa una fecha."""
    v = (v or "").strip()
    if not v:
        return ""
    v = v.replace("/", "-").replace(".", "-")
    partes = v.split(" ")[0].split("-")
    MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
             "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}
    if len(partes) == 3:
        a, b, c = partes
        if len(a) == 4 and a.isdigit():                    # 2026-01-31
            return "%04d-%02d-%02d" % (int(a), int(b), int(c)) if b.isdigit() else ""
        if c.isdigit() and len(c) == 4:                    # 31-01-2026 / 31-ene-2026
            mes = int(b) if b.isdigit() else MESES.get(norm(b)[:3], 0)
            if mes and a.isdigit():
                return "%04d-%02d-%02d" % (int(c), mes, int(a))
    return ""


def leer(ruta: str, saltar: int):
    encabezado, lector, sep, enc = abrir(ruta, saltar)
    idx = mapear(encabezado)
    filas, rechazos = [], []
    for n, fila in enumerate(lector, start=saltar + 2):
        if not any(c.strip() for c in fila):
            continue
        def col(c):
            i = idx.get(c)
            return (fila[i].strip() if i is not None and i < len(fila) else "")
        rfc = col("rfc").upper().replace(" ", "")
        estatus_crudo = col("estatus")
        estatus = ESTATUS.get(norm(estatus_crudo), estatus_crudo.strip() or "")
        fecha = normalizar_fecha(col("fecha_publicacion"))
        if len(rfc) < 12 or len(rfc) > 13 or not rfc.isalnum():
            rechazos.append((n, "RFC_INVALIDO", rfc[:20])); continue
        if not estatus:
            rechazos.append((n, "ESTATUS_VACIO", rfc)); continue
        if not fecha:
            rechazos.append((n, "FECHA_ILEGIBLE", col("fecha_publicacion")[:20])); continue
        filas.append({
            "rfc": rfc,
            "lista": "69B",
            "estatus": estatus,
            "fecha_publicacion": fecha,
            "oficio": col("oficio"),
            "razon_social": col("razon_social"),
        })
    return filas, rechazos, {"separador": sep, "encoding": enc, "columnas": encabezado}


COLS = "rfc,lista,estatus,fecha_publicacion,oficio,razon_social"


def construir_sql(filas, corrida, nombre, dataset_hash, corte, tmp_csv,
                  anexar_a, solo_validar) -> str:
    stg = "stg_69b_%s" % dataset_hash[:12]
    s = ["begin;", "set local search_path = '';"]
    if anexar_a:
        # Regla 10: sólo se enriquece un snapshot que todavía no se publicó.
        s.append("""
do $$
declare v_estado text;
begin
  select estado into v_estado from forense.corridas where id = %s;
  if v_estado is null then
    raise exception 'la corrida destino %% no existe', %s;
  end if;
  if v_estado <> 'preparando' then
    raise exception 'la corrida destino está en estado %%: sólo se anexa a una '
      'corrida en preparando (regla 10: no se cambian los datos de un snapshot '
      'ya publicado; clónala primero)', v_estado;
  end if;
end $$;""" % (sql_lit(anexar_a), sql_lit(anexar_a)))
    else:
        s.append("""
insert into forense.corridas
  (id, nombre, dataset, dataset_hash, fecha_corte, estado, modo, familias_evaluables,
   version_reglas, notas)
values (%s, %s, '69b-sat', %s, %s, 'preparando', 'fiscal', '{E}', 'pistas-1', %s)
on conflict (id) do nothing;""" % (
            sql_lit(corrida), sql_lit(nombre), sql_lit(dataset_hash), sql_lit(corte),
            sql_lit("Lista 69-B real del SAT. Sólo la familia E es evaluable: de esta fuente "
                    "no hay CFDI, padrón ni movimientos, así que D, F, R y T quedan declaradas "
                    "no evaluables. ground_truth vacío a propósito: la publicación de la "
                    "autoridad no es etiqueta de evaluación de nuestro detector.")))
    destino = anexar_a or corrida
    s.append("create schema if not exists stg;")
    s.append("drop table if exists stg.%s;" % stg)
    s.append("create table stg.%s (rfc text, lista text, estatus text, "
             "fecha_publicacion text, oficio text, razon_social text);" % stg)
    s.append("\\copy stg.%s (%s) from %s with (format csv, header true)"
             % (stg, COLS, sql_lit(tmp_csv)))
    # Validación en SQL: nada del CSV se castea antes de estar en staging.
    s.append("""
do $$
declare n_mal int;
begin
  select count(*) into n_mal from stg.%s s
   where s.rfc is null or length(s.rfc) not between 12 and 13
      or s.fecha_publicacion !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  if n_mal > 0 then
    raise exception '%% filas de staging no pasan la validación de RFC/fecha', n_mal;
  end if;
  select count(*) into n_mal from stg.%s s
   where s.fecha_publicacion::date > %s::date;
  if n_mal > 0 then
    raise exception '%% publicaciones con fecha posterior al corte %s', n_mal;
  end if;
end $$;""" % (stg, stg, sql_lit(corte), corte))
    s.append("""
insert into forense.listas_sat (rfc, lista, estatus, fecha_publicacion, oficio, razon_social, corrida_id)
select s.rfc, s.lista, s.estatus, s.fecha_publicacion::date, nullif(s.oficio, ''),
       nullif(s.razon_social, ''), %s
  from stg.%s s
on conflict (corrida_id, rfc, lista, estatus, fecha_publicacion) do nothing;""" % (
        sql_lit(destino), stg))
    s.append("""
select 'listas_sat de la corrida: ' || count(*) from forense.listas_sat where corrida_id = %s;"""
             % sql_lit(destino))
    s.append("drop table if exists stg.%s;" % stg)
    if not anexar_a:
        s.append("update forense.corridas set estado = 'lista' where id = %s and estado = 'preparando';"
                 % sql_lit(corrida))
    s.append("""
select forense.log(null, 'sistema', 'pista_cargada',
  jsonb_build_object('evento_real', 'load_69b', 'dataset', '69b-sat',
    'dataset_hash', %s, 'fecha_corte', %s, 'nombre', %s, 'anexado_a', %s,
    'familias_evaluables', case when %s then null else '["E"]'::jsonb end,
    'no_evaluables_declaradas', '["D","F","R","T"]'::jsonb,
    'filas', (select count(*) from forense.listas_sat where corrida_id = %s)),
  null, null, null, null, null, null, null, %s);""" % (
        sql_lit(dataset_hash), sql_lit(corte), sql_lit(nombre),
        sql_lit(anexar_a) if anexar_a else "null",
        "true" if anexar_a else "false", sql_lit(destino), sql_lit(destino)))
    s.append("rollback;" if solo_validar else "commit;")
    return "\n".join(s) + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Carga la lista 69-B real del SAT (docs/04 §1)")
    p.add_argument("--in", dest="entrada", default="data/raw/69b.csv")
    p.add_argument("--db", default=os.environ.get("PGDATABASE", "forense"))
    p.add_argument("--nombre", default=None, help="por omisión 69b-<fecha-corte>")
    p.add_argument("--fecha-corte", dest="corte", default=None,
                   help="corte FIJO del snapshot (no el reloj). Obligatorio.")
    p.add_argument("--saltar", type=int, default=0,
                   help="líneas de preámbulo antes del encabezado real")
    p.add_argument("--anexar-a", dest="anexar_a", default=None,
                   help="corrida_id destino, que debe estar en estado 'preparando'")
    p.add_argument("--solo-validar", dest="solo_validar", action="store_true")
    p.add_argument("--pgbin", default=os.environ.get("PGBIN", "/opt/homebrew/opt/postgresql@17/bin"))
    args = p.parse_args(argv)

    if not args.corte:
        print("falta --fecha-corte: el corte es un parámetro del snapshot, nunca el reloj "
              "(regla 10)", file=sys.stderr)
        return 2
    ruta = os.path.abspath(args.entrada)
    if not os.path.exists(ruta):
        print("no encuentro %s. La descarga del portal del SAT es manual y única "
              "(docs/04 §1); deja el archivo en data/raw/69b.csv." % ruta, file=sys.stderr)
        return 2

    dataset_hash = sha256(ruta)
    filas, rechazos, perfil = leer(ruta, args.saltar)
    nombre = args.nombre or ("69b-%s" % args.corte)
    corrida = str(uuid.uuid5(NS, "corrida:%s|%s" % (dataset_hash, nombre)))

    print("archivo      %s" % ruta)
    print("dataset_hash %s" % dataset_hash)
    print("formato      encoding=%s separador=%r columnas=%d"
          % (perfil["encoding"], perfil["separador"], len(perfil["columnas"])))
    print("filas        %d válidas, %d rechazadas" % (len(filas), len(rechazos)))
    for n, codigo, det in rechazos[:10]:
        print("  rechazo fila %d  %s  %s" % (n, codigo, det))
    if len(rechazos) > 10:
        print("  ... y %d más" % (len(rechazos) - 10))
    reparto = {}
    for f in filas:
        reparto[f["estatus"]] = reparto.get(f["estatus"], 0) + 1
    print("estatus      %s" % ", ".join("%s=%d" % kv for kv in sorted(reparto.items())))
    if not filas:
        print("entrada rechazada: ninguna fila válida", file=sys.stderr)
        return 1

    tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False,
                                      encoding="utf-8", newline="")
    w = csv.DictWriter(tmp, fieldnames=COLS.split(","), lineterminator="\n")
    w.writeheader()
    for f in filas:
        w.writerow(f)
    tmp.close()

    sql = construir_sql(filas, corrida, nombre, dataset_hash, args.corte, tmp.name,
                        args.anexar_a, args.solo_validar)
    tsql = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8")
    tsql.write(sql)
    tsql.close()

    env = dict(os.environ)
    env.setdefault("PGHOST", "localhost")
    env.setdefault("PGUSER", "postgres")
    destino = args.anexar_a or corrida
    print("corrida      %s  nombre=%s%s"
          % (destino, nombre, "  (anexada)" if args.anexar_a else ""))
    r = subprocess.run([os.path.join(args.pgbin, "psql"), "-d", args.db,
                        "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", tsql.name], env=env)
    os.unlink(tmp.name)
    if r.returncode != 0:
        print("la carga falló y se revirtió entera: no queda snapshot parcial. "
              "script: %s" % tsql.name, file=sys.stderr)
        return 1
    os.unlink(tsql.name)
    if args.solo_validar:
        print("solo-validar: todo corrió y se revirtió")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
