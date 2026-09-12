#!/usr/bin/env python3
"""Adaptador IBM AML (HI-Small) al esquema canónico (docs/04 §2, docs/19).

    python3 loaders/load_ibm_aml.py --in data/raw/HI-Small_Trans.csv \\
        --db forense --fecha-corte 2026-01-31 --max-filas 200000

Llena `forense.cuentas` y `forense.movimientos`, y crea en
`forense.contribuyentes` una **entidad técnica** por clave `(banco, cuenta)`
con el identificador `IBM:<banco>:<cuenta>`. Ese identificador permite
reutilizar pistas, clusters y herramientas; **no es un RFC** y no demuestra
quién es el titular (docs/04 §2). `giro`, `fecha_alta`, `representante`,
`email` y `telefono` quedan **NULL**, no cero ni valores inventados.

CAPACIDADES DECLARADAS — SÓLO LA FAMILIA F ES EVALUABLE
-------------------------------------------------------
La corrida se abre con `modo = 'exploratorio_financiero'` y
`familias_evaluables = '{F}'`, y el adaptador llama a
`forense.marcar_no_evaluable` para dejar **persistido y con motivo**:

*   `D1 D2 D3 D4 R1 R2 R3 T1 T2 E1` → no evaluables: no hay CFDI, ni
    padrón fiscal, ni nómina, ni listas 69-B. Tener timestamps y grafo
    bancario no habilita por sí solo los contratos de evidencia de las
    demás familias (docs/19 §Adaptador IBM financiero).
*   `F1` y `F3` → no evaluables: exigen conciliación CFDI↔banco, y aquí no
    hay CFDI.
*   `F2` → habilitada con cobertura PARCIAL declarada: se ve el flujo de
    entrada y salida por cuenta, pero no la titularidad persona
    física/moral, así que su regla completa no se puede confirmar.
*   `F4` (ciclos de dinero) → la pista habilitada por los campos de este
    adaptador. Que esté habilitada permite BUSCAR ciclos; no garantiza
    encontrarlos.

Ausencia de señal no es ausencia de fraude: las diez pistas no evaluables
quedan como filas `estado = 'no_evaluable'` en `forense.pistas`, con su
motivo, para cada entidad de la corrida. No desaparecen en silencio.
Una sola familia no alcanza para `presuncion`: el resultado insuficiente
queda `no_concluyente` (docs/04 §2).

LA ETIQUETA DE LAVADO NO ENTRA A LA BASE
----------------------------------------
`Is Laundering` es una etiqueta POR TRANSACCIÓN. Se exporta al espacio de
evaluación, `eval/input_labels_<dataset_hash>.csv`, con `fila_fuente`,
`movimiento_id` estable y etiqueta. No se escribe en `forense.ground_truth`
(que es por RFC), no aparece en vistas, herramientas, perfiles del mapper
ni prompts, y no convierte una transferencia etiquetada en una condena de
su cuenta ni de su titular (docs/04 §2, docs/19).

FORMATO DE ENTRADA ESPERADO
---------------------------
CSV con encabezado, tal como se descarga de Kaggle
(`ealtman2019/ibm-transactions-for-anti-money-laundering-aml`, archivo
`HI-Small_Trans.csv`) o del espejo de Hugging Face. Columnas requeridas:

    Timestamp        fecha y hora de la transferencia        OBLIGATORIA
    From Bank        banco de origen                         OBLIGATORIA
    Account          cuenta de origen                        OBLIGATORIA
    To Bank          banco de destino                        OBLIGATORIA
    Account.1        cuenta de destino                       OBLIGATORIA
    Amount Received  importe recibido                        OBLIGATORIA
    Receiving Currency  moneda recibida                      OBLIGATORIA
    Amount Paid      importe pagado                          opcional
    Payment Currency    moneda pagada                        opcional
    Payment Format   instrumento (Wire, ACH, Cheque…)        opcional
    Is Laundering    etiqueta 0/1                            opcional

`Account.1` es el nombre que produce pandas/csv al encontrar dos columnas
`Account`; el adaptador acepta también `To Account` y `Account 1`.

**ADVERTENCIA DE PROCEDENCIA:** esta lista de encabezados está **declarada
a partir de docs/04 §2 y del esquema publicado del dataset, NO verificada
contra el `HI-Small_Trans.csv` real**, que no está en el repo y no se
descarga desde aquí (docs/04 §1: no gastar tiempo del hackathon
automatizando descargas). Si el archivo real trae otro encabezado, el
adaptador falla nombrando la columna que falta y se amplía `SINONIMOS` en
este archivo. La muestra de prueba `loaders/samples/ibm_aml_muestra.csv`
es sintética y la escribí yo con este esquema.

MUESTREO Y MONEDA
-----------------
*   `--max-filas N` recorta por orden de aparición (método `cabecera`,
    determinista y sin usar la etiqueta). Si algún día se muestrea POR
    etiqueta, eso es una demostración sesgada y no una estimación
    poblacional: el manifiesto tendría que decirlo. El método, la semilla
    y el archivo fuente quedan en `corridas.notas` y en bitácora.
*   `forense.movimientos.moneda` es una columna, no una conversión: se
    conserva la moneda de origen y **no** se convierte a MXN. Las filas
    con moneda de recepción distinta de la de pago se rechazan con código
    `MONEDA_CRUZADA`: un cambio de divisa no es una transferencia simple y
    los importes no son comparables.

IDEMPOTENCIA
------------
`corrida_id = uuid5(NS, "corrida:<dataset_hash>|<nombre>")`,
`movimientos.id` = número de fila del archivo fuente (estable) y la carga
va con `on conflict do nothing` sobre las claves primarias de
`contribuyentes`, `cuentas` y `movimientos`. Dos cargas del mismo archivo
dejan los mismos conteos.
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

SINONIMOS = {
    "timestamp": ("timestamp", "date", "datetime"),
    "banco_origen": ("from bank", "frombank", "bank from", "sender bank"),
    "cuenta_origen": ("account", "from account", "sender account"),
    "banco_destino": ("to bank", "tobank", "bank to", "receiver bank"),
    "cuenta_destino": ("account 1", "to account", "receiver account", "account1"),
    "monto_recibido": ("amount received", "amount recieved", "amount"),
    "moneda_recibida": ("receiving currency", "recieving currency", "currency"),
    "monto_pagado": ("amount paid",),
    "moneda_pagada": ("payment currency",),
    "formato": ("payment format", "format"),
    "etiqueta": ("is laundering", "islaundering", "label"),
}
OBLIGATORIAS = ("timestamp", "banco_origen", "cuenta_origen", "banco_destino",
                "cuenta_destino", "monto_recibido", "moneda_recibida")

# Las 12 pistas que este adaptador NO puede evaluar, con su motivo.
NO_EVALUABLES = (
    (["D1", "D2", "D3", "D4"],
     "el adaptador IBM AML no trae CFDI ni padron fiscal: no hay ClaveProdServ, "
     "nomina ni compras que comparar contra pares de giro"),
    (["R1", "R2", "R3"],
     "no hay atributos de padron (domicilio, representante, email) ni grafo CFDI: "
     "la familia relacional no tiene de donde leer"),
    (["T1", "T2"],
     "hay timestamps bancarios, pero no CFDI: los contratos de evidencia temporal "
     "se definen sobre emision de comprobantes, no sobre transferencias"),
    (["E1"],
     "no hay listas 69-B asociadas a estas cuentas: son entidades tecnicas "
     "IBM:<banco>:<cuenta>, no RFC publicados por el SAT"),
    (["F1", "F3"],
     "F1 y F3 exigen conciliar CFDI contra banco y este dataset no tiene CFDI"),
)
F2_PARCIAL = ("F2 opera con cobertura PARCIAL: se ve el flujo por cuenta, pero no la "
              "titularidad persona fisica/moral ni el saldo declarado, asi que su regla "
              "completa no se puede confirmar")


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


def mapear(encabezado):
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
            "  ojo: el encabezado esperado está DECLARADO desde docs/04 §2, no "
            "verificado contra el HI-Small_Trans.csv real. Si el archivo trae otro "
            "nombre, amplía SINONIMOS en loaders/load_ibm_aml.py."
            % (", ".join(faltan), ", ".join(encabezado) or "(ninguna)",
               faltan[0], ", ".join(SINONIMOS[faltan[0]])))
    return indice


def normalizar_ts(v: str) -> str:
    """`2025/03/04 10:12` → `2025-03-04 10:12:00`. '' si no se entiende."""
    v = (v or "").strip().replace("/", "-")
    if not v:
        return ""
    partes = v.split(" ")
    fecha = partes[0].split("-")
    if len(fecha) != 3 or len(fecha[0]) != 4 or not all(x.isdigit() for x in fecha):
        return ""
    hora = partes[1] if len(partes) > 1 else "00:00:00"
    h = hora.split(":")
    if not all(x.isdigit() for x in h):
        return ""
    h = (h + ["0", "0"])[:3]
    return "%04d-%02d-%02d %02d:%02d:%02d" % (int(fecha[0]), int(fecha[1]), int(fecha[2]),
                                              int(h[0]), int(h[1]), int(h[2]))


def leer(ruta: str, max_filas: int, corte: str):
    crudo = open(ruta, "rb").read()
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            texto = crudo.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover
        raise SystemExit("no pude decodificar %s" % ruta)
    lineas = texto.splitlines()
    sep = ";" if lineas[0].count(";") > lineas[0].count(",") else ","
    lector = csv.reader(io.StringIO("\n".join(lineas)), delimiter=sep)
    encabezado = [norm(c) for c in next(lector)]
    idx = mapear(encabezado)

    movs, rechazos = [], []
    cuentas = {}   # clabe técnica -> banco
    etiquetas = []
    for n, fila in enumerate(lector, start=2):
        if max_filas and len(movs) >= max_filas:
            break
        if not any(c.strip() for c in fila):
            continue

        def col(c):
            i = idx.get(c)
            return (fila[i].strip() if i is not None and i < len(fila) else "")

        ts = normalizar_ts(col("timestamp"))
        bo, co = col("banco_origen"), col("cuenta_origen")
        bd, cd = col("banco_destino"), col("cuenta_destino")
        mon_r, cur_r = col("monto_recibido"), col("moneda_recibida")
        mon_p, cur_p = col("monto_pagado"), col("moneda_pagada")
        if not ts:
            rechazos.append((n, "TIMESTAMP_ILEGIBLE", col("timestamp")[:20])); continue
        if ts[:10] > corte:
            rechazos.append((n, "FECHA_POSTERIOR_AL_CORTE", ts)); continue
        if not (bo and co and bd and cd):
            rechazos.append((n, "CUENTA_O_BANCO_VACIO", "%s/%s -> %s/%s" % (bo, co, bd, cd)))
            continue
        try:
            importe = float(mon_r)
        except ValueError:
            rechazos.append((n, "IMPORTE_ILEGIBLE", mon_r[:20])); continue
        if importe <= 0:
            rechazos.append((n, "IMPORTE_NO_POSITIVO", mon_r[:20])); continue
        if cur_p and cur_r and norm(cur_p) != norm(cur_r):
            rechazos.append((n, "MONEDA_CRUZADA", "%s -> %s" % (cur_r, cur_p))); continue

        origen = "IBM:%s:%s" % (bo, co)
        destino = "IBM:%s:%s" % (bd, cd)
        cuentas[origen] = bo
        cuentas[destino] = bd
        movs.append({
            "id": n,
            "cuenta_origen": origen,
            "cuenta_destino": destino,
            "fecha": ts,
            "monto": "%.2f" % importe,
            "moneda": cur_r,
            "tipo": (col("formato") or "transferencia").lower().replace(" ", "_"),
            "referencia": col("formato"),
        })
        et = col("etiqueta")
        if et != "":
            etiquetas.append({"fila_fuente": n, "movimiento_id": n, "es_lavado": et})
    return movs, cuentas, etiquetas, rechazos, {"separador": sep, "encoding": enc,
                                                "columnas": encabezado}


COLS_MOV = "id,cuenta_origen,cuenta_destino,fecha,monto,moneda,tipo,referencia"


def construir_sql(corrida, nombre, dataset_hash, corte, tmp_mov, tmp_cta, notas,
                  solo_validar) -> str:
    stg = "stg_ibm_%s" % dataset_hash[:12]
    s = ["begin;", "set local search_path = '';"]
    s.append("""
insert into forense.corridas
  (id, nombre, dataset, dataset_hash, fecha_corte, estado, modo, familias_evaluables,
   version_reglas, notas)
values (%s, %s, 'ibm-aml-hi-small', %s, %s, 'preparando', 'exploratorio_financiero',
        '{F}', 'pistas-1', %s)
on conflict (id) do nothing;""" % (
        sql_lit(corrida), sql_lit(nombre), sql_lit(dataset_hash), sql_lit(corte),
        sql_lit(notas)))
    s.append("create schema if not exists stg;")
    s.append("drop table if exists stg.%s_cta;" % stg)
    s.append("drop table if exists stg.%s_mov;" % stg)
    s.append("create table stg.%s_cta (clabe text, banco text);" % stg)
    s.append("create table stg.%s_mov (id text, cuenta_origen text, cuenta_destino text, "
             "fecha text, monto text, moneda text, tipo text, referencia text);" % stg)
    s.append("\\copy stg.%s_cta (clabe,banco) from %s with (format csv, header true)"
             % (stg, sql_lit(tmp_cta)))
    s.append("\\copy stg.%s_mov (%s) from %s with (format csv, header true)"
             % (stg, COLS_MOV, sql_lit(tmp_mov)))
    s.append("""
do $$
declare n int;
begin
  select count(*) into n from stg.%s_mov m
   where m.fecha::timestamptz > %s::timestamptz
      or m.monto::numeric <= 0;
  if n > 0 then
    raise exception '%% movimientos de staging con fecha posterior al corte o importe no positivo', n;
  end if;
  select count(*) into n from stg.%s_mov m
   where not exists (select 1 from stg.%s_cta c where c.clabe = m.cuenta_origen)
      or not exists (select 1 from stg.%s_cta c where c.clabe = m.cuenta_destino);
  if n > 0 then
    raise exception '%% movimientos con cuenta inexistente en el staging de cuentas', n;
  end if;
end $$;""" % (stg, sql_lit(corte), stg, stg, stg))
    # Entidad técnica: giro / fecha_alta / representante NULL a propósito.
    s.append("""
insert into forense.contribuyentes
  (rfc, razon_social, giro, tipo_persona, fecha_alta, domicilio, cp, representante,
   email, telefono, empleados_declarados, corrida_id)
select c.clabe, null, null, null, null, null, null, null, null, null, null, %s
  from stg.%s_cta c
on conflict (corrida_id, rfc) do nothing;""" % (sql_lit(corrida), stg))
    s.append("""
insert into forense.cuentas
  (clabe, rfc_titular, banco, tipo, moneda, saldo_inicial, fecha_saldo_inicial, corrida_id)
select c.clabe, c.clabe, c.banco, null, null, null, null, %s
  from stg.%s_cta c
on conflict (corrida_id, clabe) do nothing;""" % (sql_lit(corrida), stg))
    s.append("""
insert into forense.movimientos
  (id, cuenta_origen, cuenta_destino, fecha, monto, moneda, tipo, referencia, corrida_id)
select m.id::bigint, m.cuenta_origen, m.cuenta_destino, m.fecha::timestamptz,
       m.monto::numeric, m.moneda, m.tipo, nullif(m.referencia, ''), %s
  from stg.%s_mov m
on conflict (corrida_id, id) do nothing;""" % (sql_lit(corrida), stg))
    s.append("drop table if exists stg.%s_mov;" % stg)
    s.append("drop table if exists stg.%s_cta;" % stg)
    # Capacidades: lo no evaluable queda PERSISTIDO con motivo.
    for codigos, motivo in NO_EVALUABLES:
        s.append("select forense.marcar_no_evaluable(%s, array[%s], %s);" % (
            sql_lit(corrida), ",".join(sql_lit(c) for c in codigos), sql_lit(motivo)))
    s.append("""
select forense.log(null, 'sistema', 'pista_cargada',
  jsonb_build_object('evento_real', 'load_ibm_aml', 'dataset', 'ibm-aml-hi-small',
    'dataset_hash', %s, 'fecha_corte', %s, 'nombre', %s,
    'familias_evaluables', '["F"]'::jsonb,
    'pistas_habilitadas', '["F4"]'::jsonb,
    'pistas_parciales', jsonb_build_object('F2', %s),
    'no_evaluables_declaradas', '["D1","D2","D3","D4","R1","R2","R3","T1","T2","E1","F1","F3"]'::jsonb,
    'etiqueta_lavado', 'por transaccion, exportada a eval/input_labels_<hash>.csv; '
                       'no entra a forense.ground_truth ni a ninguna vista del agente',
    'movimientos', (select count(*) from forense.movimientos where corrida_id = %s),
    'entidades_tecnicas', (select count(*) from forense.contribuyentes where corrida_id = %s)),
  null, null, null, null, null, null, null, %s);""" % (
        sql_lit(dataset_hash), sql_lit(corte), sql_lit(nombre), sql_lit(F2_PARCIAL),
        sql_lit(corrida), sql_lit(corrida), sql_lit(corrida)))
    s.append("update forense.corridas set estado = 'lista' where id = %s and estado = 'preparando';"
             % sql_lit(corrida))
    s.append("rollback;" if solo_validar else "commit;")
    return "\n".join(s) + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Carga la muestra de IBM AML (docs/04 §2)")
    p.add_argument("--in", dest="entrada", default="data/raw/HI-Small_Trans.csv")
    p.add_argument("--db", default=os.environ.get("PGDATABASE", "forense"))
    p.add_argument("--nombre", default=None, help="por omisión ibm-aml-<fecha-corte>")
    p.add_argument("--fecha-corte", dest="corte", default=None,
                   help="corte FIJO del snapshot (no el reloj). Obligatorio.")
    p.add_argument("--max-filas", dest="max_filas", type=int, default=200000,
                   help="recorte por orden de aparición; 0 = sin recorte")
    p.add_argument("--solo-validar", dest="solo_validar", action="store_true")
    p.add_argument("--pgbin", default=os.environ.get("PGBIN", "/opt/homebrew/opt/postgresql@17/bin"))
    args = p.parse_args(argv)

    if not args.corte:
        print("falta --fecha-corte: el corte es un parámetro del snapshot, nunca el reloj "
              "(regla 10)", file=sys.stderr)
        return 2
    ruta = os.path.abspath(args.entrada)
    if not os.path.exists(ruta):
        print("no encuentro %s. La descarga de Kaggle/Hugging Face es manual (docs/04 §2); "
              "deja el archivo en data/raw/. Para probar el adaptador sin red usa "
              "loaders/samples/ibm_aml_muestra.csv." % ruta, file=sys.stderr)
        return 2

    dataset_hash = sha256(ruta)
    movs, cuentas, etiquetas, rechazos, perfil = leer(ruta, args.max_filas, args.corte)
    nombre = args.nombre or ("ibm-aml-%s" % args.corte)
    corrida = str(uuid.uuid5(NS, "corrida:%s|%s" % (dataset_hash, nombre)))

    print("archivo      %s" % ruta)
    print("dataset_hash %s" % dataset_hash)
    print("formato      encoding=%s separador=%r columnas=%d"
          % (perfil["encoding"], perfil["separador"], len(perfil["columnas"])))
    print("muestreo     método=cabecera max_filas=%s (determinista, NO usa la etiqueta)"
          % (args.max_filas or "sin recorte"))
    print("filas        %d movimientos, %d entidades técnicas, %d rechazadas"
          % (len(movs), len(cuentas), len(rechazos)))
    reparto = {}
    for _, codigo, _ in rechazos:
        reparto[codigo] = reparto.get(codigo, 0) + 1
    for codigo, n in sorted(reparto.items()):
        print("  rechazo %-26s %d" % (codigo, n))
    print("familias     evaluable=F (F4 habilitada, F2 parcial); "
          "no evaluables declaradas: D1-D4 R1-R3 T1 T2 E1 F1 F3")
    if not movs:
        print("entrada rechazada: ningún movimiento válido", file=sys.stderr)
        return 1

    # Artefacto de EVALUACIÓN: fuera de la base, fuera de las herramientas.
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dir_eval = os.path.join(raiz, "eval")
    os.makedirs(dir_eval, exist_ok=True)
    ruta_etq = os.path.join(dir_eval, "input_labels_%s.csv" % dataset_hash)
    with open(ruta_etq, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["fila_fuente", "movimiento_id", "es_lavado",
                                           "corrida_id", "dataset_hash"],
                           lineterminator="\n")
        w.writeheader()
        for e in etiquetas:
            e = dict(e); e["corrida_id"] = corrida; e["dataset_hash"] = dataset_hash
            w.writerow(e)
    print("etiquetas    %d filas en eval/%s (por TRANSACCIÓN; no entra a la base ni a "
          "ground_truth)" % (len(etiquetas), os.path.basename(ruta_etq)))

    tmov = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False,
                                       encoding="utf-8", newline="")
    w = csv.DictWriter(tmov, fieldnames=COLS_MOV.split(","), lineterminator="\n")
    w.writeheader()
    for mv in movs:
        w.writerow(mv)
    tmov.close()
    tcta = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False,
                                       encoding="utf-8", newline="")
    tcta.write("clabe,banco\n")
    for clabe in sorted(cuentas):
        tcta.write("%s,%s\n" % (clabe, cuentas[clabe]))
    tcta.close()

    notas = ("IBM AML HI-Small. SOLO la familia F es evaluable: no hay CFDI, padrón ni "
             "nómina. F4 habilitada, F2 con cobertura parcial, F1/F3 y D/R/T/E declaradas "
             "no evaluables en forense.pistas. Entidades técnicas IBM:<banco>:<cuenta>, "
             "no RFC. Muestreo por cabecera (%s filas), determinista y sin usar la "
             "etiqueta. Etiqueta de lavado por transacción en "
             "eval/input_labels_%s.csv, fuera del alcance del agente. Archivo fuente: %s"
             % (args.max_filas or "todas", dataset_hash, os.path.basename(ruta)))
    sql = construir_sql(corrida, nombre, dataset_hash, args.corte, tmov.name, tcta.name,
                        notas, args.solo_validar)
    tsql = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8")
    tsql.write(sql)
    tsql.close()

    env = dict(os.environ)
    env.setdefault("PGHOST", "localhost")
    env.setdefault("PGUSER", "postgres")
    print("corrida      %s  nombre=%s" % (corrida, nombre))
    r = subprocess.run([os.path.join(args.pgbin, "psql"), "-d", args.db,
                        "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", tsql.name], env=env)
    os.unlink(tmov.name)
    os.unlink(tcta.name)
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
