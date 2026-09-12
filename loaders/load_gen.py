#!/usr/bin/env python3
"""Adaptador del generador propio al esquema canónico (docs/04 §Regla común,
docs/19 §Flujo único).

    python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1

Flujo, en una sola transacción:

1.  **Registrar entrada.** Lee `manifest.json` y vuelve a calcular el sha256 de
    cada CSV: si un archivo cambió después de generarse, el loader se detiene.
    El `dataset_hash` y la `fecha_corte` salen del manifiesto, nunca del reloj.
2.  **Staging.** `\\copy` de cada CSV a un esquema `stg_<hash>` con todas las
    columnas en `text`. Nada se castea ni se normaliza antes de estar en
    staging, y nada del CSV se ejecuta como SQL.
3.  **Validar.** Cada fila que no cumple una regla escribe en `stg.rechazos`
    con archivo, fila, código y detalle. Los códigos críticos (claves, montos,
    fechas, moneda, dirección de flujo) bloquean la promoción.
4.  **Cargar.** `corridas` en estado `preparando`, después listas SAT y
    contribuyentes, cuentas y atributos, CFDI, complementos, movimientos y por
    último `ground_truth` (que es material de evaluación y ninguna herramienta
    del agente puede leer).
5.  **Validar el snapshot** ya cargado: conteos, huérfanos, ventana, monedas,
    cobertura por familia y la separación de grafo entre trampas y RFC
    publicados como definitivos.
6.  **Promover.** Sólo con cero críticos la corrida pasa a `lista`. Si algo
    falla, la transacción se revierte entera: no queda un snapshot a medias
    visible como listo.

La corrida deja rastro en `forense.bitacora` dentro de la misma transacción
(regla 2: si no se escribió, el paso no existió).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import uuid

NS = uuid.UUID("6f1c9d2e-0000-4000-8000-000000000000")

TABLAS = [
    # (archivo csv, tabla de staging, columnas)
    ("contribuyentes.csv", "contribuyentes",
     "rfc,razon_social,giro,tipo_persona,fecha_alta,domicilio,cp,representante,email,telefono,"
     "empleados_declarados"),
    ("cuentas.csv", "cuentas",
     "clabe,rfc_titular,banco,tipo,moneda,saldo_inicial,fecha_saldo_inicial"),
    ("cfdi.csv", "cfdi",
     "uuid,tipo,emisor_rfc,receptor_rfc,fecha,subtotal,iva,total,moneda,metodo_pago,forma_pago,"
     "uso_cfdi,clave_prod_serv,descripcion,cancelado,fecha_cancelacion,motivo_cancelacion,"
     "uuid_sustituye"),
    ("complementos_pago.csv", "complementos_pago", "uuid_pago,uuid_cfdi,fecha,monto"),
    ("movimientos.csv", "movimientos",
     "id,cuenta_origen,cuenta_destino,fecha,monto,moneda,tipo,referencia"),
    ("atributos_entidad.csv", "atributos_entidad", "rfc,atributo,valor,fuente"),
    ("listas_sat.csv", "listas_sat", "rfc,lista,estatus,fecha_publicacion,oficio,razon_social"),
    ("ground_truth.csv", "ground_truth", "rfc,es_fraude,tipologia,es_trampa_legitima,nota"),
]


def sha256(ruta: str) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def sql_lit(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def construir_sql(entrada: str, man: dict, corrida: str, nombre: str, stg: str,
                  reemplazar: bool, permitir_parcial: bool, solo_validar: bool) -> str:
    corte = man["fecha_corte"]
    q = []
    a = q.append
    a("\\set ON_ERROR_STOP on")
    a("begin;")

    # ---- 1. staging -------------------------------------------------
    a("drop schema if exists %s cascade;" % stg)
    a("create schema %s;" % stg)
    a("create unlogged table %s.rechazos (archivo text, fila bigint, codigo text, "
      "critico boolean, detalle text);" % stg)
    for archivo, tabla, cols in TABLAS:
        defs = ", ".join("%s text" % c for c in cols.split(","))
        a("create unlogged table {s}.{t} (_fila bigserial, {d});".format(s=stg, t=tabla, d=defs))
        a("\\copy {s}.{t} ({c}) from {p} with (format csv, header true)".format(
            s=stg, t=tabla, c=cols, p=sql_lit(os.path.join(entrada, archivo))))

    # ---- 2. validación en staging -----------------------------------
    # Códigos críticos: clave, monto, fecha, moneda, relación. Un código no
    # crítico excluye la fila y se publica en el informe.
    reglas = [
        ("contribuyentes.csv", "contribuyentes", "rfc_vacio", True,
         "rfc is null or btrim(rfc) = ''"),
        ("contribuyentes.csv", "contribuyentes", "fecha_alta_invalida", True,
         "fecha_alta !~ '^\\d{4}-\\d{2}-\\d{2}$'"),
        ("cuentas.csv", "cuentas", "clabe_invalida", True, "clabe !~ '^\\d{18}$'"),
        ("cuentas.csv", "cuentas", "moneda_no_mxn", True, "moneda is distinct from 'MXN'"),
        ("cfdi.csv", "cfdi", "uuid_invalido", True,
         "uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"),
        ("cfdi.csv", "cfdi", "emisor_o_receptor_vacio", True,
         "coalesce(btrim(emisor_rfc),'') = '' or coalesce(btrim(receptor_rfc),'') = ''"),
        ("cfdi.csv", "cfdi", "total_fuera_de_rango", True,
         "total::numeric <= 0 or total::numeric >= 1e12"),
        ("cfdi.csv", "cfdi", "importes_incongruentes", True,
         "abs((subtotal::numeric + iva::numeric) - total::numeric) > 0.02"),
        ("cfdi.csv", "cfdi", "moneda_no_mxn", True, "moneda is distinct from 'MXN'"),
        ("cfdi.csv", "cfdi", "fecha_posterior_al_corte", True,
         "fecha::timestamptz > %s::timestamptz" % sql_lit(corte)),
        ("cfdi.csv", "cfdi", "metodo_pago_desconocido", False,
         "tipo = 'I' and metodo_pago not in ('PUE','PPD')"),
        ("movimientos.csv", "movimientos", "monto_fuera_de_rango", True,
         "monto::numeric <= 0 or monto::numeric >= 1e12"),
        ("movimientos.csv", "movimientos", "moneda_no_mxn", True, "moneda is distinct from 'MXN'"),
        ("movimientos.csv", "movimientos", "sin_direccion", True,
         "coalesce(btrim(cuenta_origen),'') = '' and coalesce(btrim(cuenta_destino),'') = ''"),
        ("complementos_pago.csv", "complementos_pago", "monto_fuera_de_rango", True,
         "monto::numeric <= 0"),
        ("listas_sat.csv", "listas_sat", "estatus_desconocido", True,
         "estatus not in ('presunto','definitivo','desvirtuado','sentencia_favorable')"),
        ("ground_truth.csv", "ground_truth", "booleano_invalido", True,
         "es_fraude not in ('true','false') or es_trampa_legitima not in ('true','false')"),
    ]
    for archivo, tabla, codigo, critico, cond in reglas:
        a("insert into {s}.rechazos select {f}, _fila, {c}, {k}, left(coalesce(_fila::text,''), 40) "
          "from {s}.{t} where {cond};".format(s=stg, t=tabla, f=sql_lit(archivo),
                                              c=sql_lit(codigo), k=str(critico).lower(),
                                              cond=cond))
    # relaciones (FK) — se validan contra el propio staging
    a("insert into {s}.rechazos select 'complementos_pago.csv', c._fila, 'cfdi_inexistente', true, "
      "c.uuid_cfdi from {s}.complementos_pago c left join {s}.cfdi f on f.uuid = c.uuid_cfdi "
      "where f.uuid is null;".format(s=stg))
    a("insert into {s}.rechazos select 'movimientos.csv', m._fila, 'clabe_inexistente', true, "
      "coalesce(m.cuenta_origen,'') || '>' || coalesce(m.cuenta_destino,'') "
      "from {s}.movimientos m where (coalesce(btrim(m.cuenta_origen),'') <> '' and not exists "
      "(select 1 from {s}.cuentas c where c.clabe = m.cuenta_origen)) or "
      "(coalesce(btrim(m.cuenta_destino),'') <> '' and not exists "
      "(select 1 from {s}.cuentas c where c.clabe = m.cuenta_destino));".format(s=stg))
    a("insert into {s}.rechazos select 'atributos_entidad.csv', a._fila, 'rfc_inexistente', true, "
      "a.rfc from {s}.atributos_entidad a where not exists "
      "(select 1 from {s}.contribuyentes c where c.rfc = a.rfc);".format(s=stg))
    a("insert into {s}.rechazos select 'ground_truth.csv', g._fila, 'rfc_inexistente', true, g.rfc "
      "from {s}.ground_truth g where not exists "
      "(select 1 from {s}.contribuyentes c where c.rfc = g.rfc);".format(s=stg))
    a("insert into {s}.rechazos select 'contribuyentes.csv', c._fila, 'rfc_duplicado', true, c.rfc "
      "from {s}.contribuyentes c where exists (select 1 from {s}.contribuyentes d "
      "where d.rfc = c.rfc and d._fila < c._fila);".format(s=stg))
    a("insert into {s}.rechazos select 'cfdi.csv', f._fila, 'uuid_duplicado', true, f.uuid "
      "from {s}.cfdi f where exists (select 1 from {s}.cfdi g where g.uuid = f.uuid "
      "and g._fila < f._fila);".format(s=stg))

    if not permitir_parcial:
        a("""do $$
declare n int;
begin
  select count(*) into n from {s}.rechazos where critico;
  if n > 0 then
    raise exception 'validación: % rechazos críticos, la corrida no se promueve '
      '(usa --permitir-parcial para publicar un snapshot con exclusiones visibles)', n;
  end if;
end $$;""".format(s=stg))

    # ---- 3. corrida -------------------------------------------------
    if reemplazar:
        a("delete from forense.corridas where nombre = %s;" % sql_lit(nombre))
    a("""do $$
begin
  if exists (select 1 from forense.corridas where nombre = {n}) then
    raise exception 'ya existe una corrida llamada % (usa --reemplazar si de verdad quieres '
      'volver a cargar ese snapshot)', {n};
  end if;
end $$;""".format(n=sql_lit(nombre)))
    a("""insert into forense.corridas
      (id, nombre, dataset, dataset_hash, fecha_corte, estado, modo, familias_evaluables,
       version_reglas, notas)
    values ({id}::uuid, {n}, {ds}, {h}, {c}::timestamptz, 'preparando', 'fiscal',
            '{{D,F,R,T,E}}'::text[], 'pistas-1', {notas});""".format(
        id=sql_lit(corrida), n=sql_lit(nombre), ds=sql_lit(man["dataset"]),
        h=sql_lit(man["dataset_hash"]), c=sql_lit(corte),
        notas=sql_lit("generator/gen.py semilla=%s meses=%s; %s" % (
            man["semilla"], man["meses_ventana"], man["advertencias"][0]))))

    # ---- 4. carga en orden de dependencias --------------------------
    a("""insert into forense.listas_sat (corrida_id, rfc, lista, estatus, fecha_publicacion,
        oficio, razon_social)
      select {id}::uuid, rfc, lista, estatus, fecha_publicacion::date, nullif(oficio,''),
             nullif(razon_social,'')
        from {s}.listas_sat l
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'listas_sat.csv'
                         and r.fila = l._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.contribuyentes (corrida_id, rfc, razon_social, giro, tipo_persona,
        fecha_alta, domicilio, cp, representante, email, telefono, empleados_declarados)
      select {id}::uuid, rfc, nullif(razon_social,''), nullif(giro,''), nullif(tipo_persona,''),
             fecha_alta::date, nullif(domicilio,''), nullif(cp,''), nullif(representante,''),
             nullif(email,''), nullif(telefono,''), nullif(empleados_declarados,'')::int
        from {s}.contribuyentes c
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'contribuyentes.csv'
                         and r.fila = c._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.cuentas (corrida_id, clabe, rfc_titular, banco, tipo, moneda,
        saldo_inicial, fecha_saldo_inicial)
      select {id}::uuid, clabe, nullif(rfc_titular,''), nullif(banco,''), nullif(tipo,''),
             moneda, nullif(saldo_inicial,'')::numeric, nullif(fecha_saldo_inicial,'')::timestamptz
        from {s}.cuentas c
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'cuentas.csv'
                         and r.fila = c._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.atributos_entidad (corrida_id, rfc, atributo, valor, fuente)
      select distinct on (rfc, atributo, valor) {id}::uuid, rfc, atributo, valor, nullif(fuente,'')
        from {s}.atributos_entidad a
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'atributos_entidad.csv'
                         and r.fila = a._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.cfdi (corrida_id, uuid, tipo, emisor_rfc, receptor_rfc, fecha,
        subtotal, iva, total, moneda, metodo_pago, forma_pago, uso_cfdi, clave_prod_serv,
        descripcion, cancelado, fecha_cancelacion, motivo_cancelacion, uuid_sustituye)
      select {id}::uuid, uuid::uuid, nullif(tipo,''), emisor_rfc, receptor_rfc,
             fecha::timestamptz, subtotal::numeric, iva::numeric, total::numeric, moneda,
             nullif(metodo_pago,''), nullif(forma_pago,''), nullif(uso_cfdi,''),
             nullif(clave_prod_serv,''), nullif(descripcion,''), cancelado::boolean,
             nullif(fecha_cancelacion,'')::timestamptz, nullif(motivo_cancelacion,''),
             nullif(uuid_sustituye,'')::uuid
        from {s}.cfdi f
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'cfdi.csv'
                         and r.fila = f._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.complementos_pago (corrida_id, uuid_pago, uuid_cfdi, fecha, monto)
      select {id}::uuid, uuid_pago::uuid, uuid_cfdi::uuid, fecha::timestamptz, monto::numeric
        from {s}.complementos_pago c
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'complementos_pago.csv'
                         and r.fila = c._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.movimientos (corrida_id, id, cuenta_origen, cuenta_destino, fecha,
        monto, moneda, tipo, referencia)
      select {id}::uuid, m.id::bigint, nullif(m.cuenta_origen,''), nullif(m.cuenta_destino,''),
             m.fecha::timestamptz, m.monto::numeric, m.moneda, nullif(m.tipo,''),
             nullif(m.referencia,'')
        from {s}.movimientos m
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'movimientos.csv'
                         and r.fila = m._fila);""".format(s=stg, id=sql_lit(corrida)))
    a("""insert into forense.ground_truth (corrida_id, rfc, es_fraude, tipologia,
        es_trampa_legitima, nota)
      select {id}::uuid, rfc, es_fraude::boolean, nullif(tipologia,''),
             es_trampa_legitima::boolean, nullif(nota,'')
        from {s}.ground_truth g
       where not exists (select 1 from {s}.rechazos r where r.archivo = 'ground_truth.csv'
                         and r.fila = g._fila);""".format(s=stg, id=sql_lit(corrida)))

    # ---- 5. validación del snapshot ya cargado ----------------------
    a("""do $$
declare v uuid := {id}::uuid; n int; m int;
begin
  -- conteos leídos vs cargados
  select count(*) into n from {s}.cfdi;
  select count(*) into m from forense.cfdi where corrida_id = v;
  if m + (select count(*) from {s}.rechazos where archivo = 'cfdi.csv') < n then
    raise exception 'conteo de CFDI no reconcilia: leidas=%, cargadas=%', n, m;
  end if;

  -- huérfanos dentro de la corrida
  select count(*) into n from forense.movimientos mo where mo.corrida_id = v
     and mo.cuenta_origen is not null
     and not exists (select 1 from forense.cuentas c where c.corrida_id = v
                     and c.clabe = mo.cuenta_origen);
  if n > 0 then raise exception '% movimientos con cuenta de origen inexistente', n; end if;

  -- una sola moneda
  select count(distinct moneda) into n from forense.cfdi where corrida_id = v;
  if n > 1 then raise exception 'el snapshot mezcla % monedas', n; end if;

  -- ventana cerrada en fecha_corte
  select count(*) into n from forense.cfdi f join forense.corridas r on r.id = f.corrida_id
   where f.corrida_id = v and f.fecha > r.fecha_corte;
  if n > 0 then raise exception '% CFDI posteriores a la fecha de corte', n; end if;

  -- separación de grafo: ninguna trampa a <=2 saltos de un RFC 'definitivo'
  -- (es la distancia a la que E1 marca; sin esto la métrica de falsos
  --  positivos mediría el diseño del dataset, no el detector)
  create temp table if not exists _und (x text, y text) on commit drop;
  delete from _und;
  insert into _und
    select distinct emisor_rfc, receptor_rfc from forense.cfdi
     where corrida_id = v and tipo = 'I' and not cancelado
    union
    select distinct receptor_rfc, emisor_rfc from forense.cfdi
     where corrida_id = v and tipo = 'I' and not cancelado;
  with d as (select rfc from forense.listas_sat
              where corrida_id = v and estatus = 'definitivo'),
  h1 as (select u.y as rfc from _und u join d on d.rfc = u.x),
  h2 as (select u.y as rfc from _und u join h1 on h1.rfc = u.x),
  cerca as (select rfc from d union select rfc from h1 union select rfc from h2)
  select count(*) into n from forense.ground_truth g
   where g.corrida_id = v and g.es_trampa_legitima and g.rfc in (select rfc from cerca);
  if n > 0 then
    raise exception '% trampas a <=2 saltos de un RFC definitivo: E1 les daria una segunda '
      'familia y el selector de dos familias dejaria de medir falsos positivos', n;
  end if;
end $$;""".format(s=stg, id=sql_lit(corrida)))

    # ---- 6. promoción + rastro --------------------------------------
    a("""select forense.log(null, 'sistema', 'pista_cargada',
        jsonb_build_object('evento_real', 'load_gen', 'dataset', {ds},
          'dataset_hash', {h}, 'fecha_corte', {c},
          'archivos', (select jsonb_object_agg(t.tabla, t.n) from (
              select 'contribuyentes' as tabla, count(*) n from forense.contribuyentes
                where corrida_id = {id}::uuid
              union all select 'cuentas', count(*) from forense.cuentas
                where corrida_id = {id}::uuid
              union all select 'cfdi', count(*) from forense.cfdi where corrida_id = {id}::uuid
              union all select 'complementos_pago', count(*) from forense.complementos_pago
                where corrida_id = {id}::uuid
              union all select 'movimientos', count(*) from forense.movimientos
                where corrida_id = {id}::uuid
              union all select 'atributos_entidad', count(*) from forense.atributos_entidad
                where corrida_id = {id}::uuid
              union all select 'listas_sat', count(*) from forense.listas_sat
                where corrida_id = {id}::uuid
              union all select 'ground_truth', count(*) from forense.ground_truth
                where corrida_id = {id}::uuid) t),
          'rechazos', (select count(*) from {s}.rechazos),
          'rechazos_criticos', (select count(*) from {s}.rechazos where critico)),
        null, null, null, null, null, null, null, {id}::uuid);""".format(
        s=stg, id=sql_lit(corrida), ds=sql_lit(man["dataset"]),
        h=sql_lit(man["dataset_hash"]), c=sql_lit(corte)))
    a("update forense.corridas set estado = 'lista' where id = %s::uuid;" % sql_lit(corrida))

    # informe de calidad (docs/19 §Calidad): se imprime siempre, antes de cerrar
    a("\\echo ''")
    a("\\echo '== informe de calidad =='")
    a("""select 'rechazos' as seccion, archivo, codigo, critico, count(*) as filas
        from {s}.rechazos group by 1,2,3,4 order by critico desc, 2, 3;""".format(s=stg))
    a("""select t.tabla, t.filas from (
        select 'contribuyentes' tabla, count(*) filas from forense.contribuyentes
          where corrida_id = {id}::uuid
        union all select 'cuentas', count(*) from forense.cuentas where corrida_id = {id}::uuid
        union all select 'cfdi', count(*) from forense.cfdi where corrida_id = {id}::uuid
        union all select 'complementos_pago', count(*) from forense.complementos_pago
          where corrida_id = {id}::uuid
        union all select 'movimientos', count(*) from forense.movimientos
          where corrida_id = {id}::uuid
        union all select 'atributos_entidad', count(*) from forense.atributos_entidad
          where corrida_id = {id}::uuid
        union all select 'listas_sat', count(*) from forense.listas_sat
          where corrida_id = {id}::uuid
        union all select 'ground_truth', count(*) from forense.ground_truth
          where corrida_id = {id}::uuid) t order by 1;""".format(id=sql_lit(corrida)))
    a("""select min(fecha) as cfdi_desde, max(fecha) as cfdi_hasta,
        count(distinct moneda) as monedas from forense.cfdi
       where corrida_id = {id}::uuid;""".format(id=sql_lit(corrida)))
    a("""select coalesce(giro,'sin_giro') as giro, count(*) as contribuyentes,
        count(*) filter (where compras_12m = 0) as sin_compras
        from forense.v_agregado_rfc where corrida_id = {id}::uuid
       group by 1 order by 1;""".format(id=sql_lit(corrida)))
    a("drop schema %s cascade;" % stg)
    a("rollback;" if solo_validar else "commit;")
    return "\n".join(q) + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Carga el dataset del generador (docs/04, docs/19)")
    p.add_argument("--in", dest="entrada", default="data/gen/")
    p.add_argument("--db", default=os.environ.get("PGDATABASE", "forense"))
    p.add_argument("--nombre", default="gen-v1")
    p.add_argument("--pgbin", default=os.environ.get("PGBIN", "/opt/homebrew/opt/postgresql@17/bin"))
    p.add_argument("--reemplazar", action="store_true",
                   help="borra la corrida que tenga ese nombre antes de cargar")
    p.add_argument("--permitir-parcial", dest="permitir_parcial", action="store_true",
                   help="publica el snapshot excluyendo las filas rechazadas (queda en el informe)")
    p.add_argument("--solo-validar", dest="solo_validar", action="store_true",
                   help="ejecuta todo y revierte: no deja nada cargado")
    args = p.parse_args(argv)

    entrada = os.path.abspath(args.entrada)
    ruta_man = os.path.join(entrada, "manifest.json")
    if not os.path.exists(ruta_man):
        print("no encuentro %s: corre primero generator/gen.py" % ruta_man, file=sys.stderr)
        return 2
    with open(ruta_man, encoding="utf-8") as fh:
        man = json.load(fh)

    # 1. registrar entrada: los bytes tienen que ser los que dice el manifiesto
    malos = []
    for archivo, _, _ in TABLAS:
        ruta = os.path.join(entrada, archivo)
        if not os.path.exists(ruta):
            malos.append("%s: no existe" % archivo)
            continue
        esperado = man.get("archivos", {}).get(archivo, {}).get("sha256")
        real = sha256(ruta)
        if esperado and esperado != real:
            malos.append("%s: sha256 %s != %s del manifiesto" % (archivo, real[:12], esperado[:12]))
    if malos:
        for x in malos:
            print("entrada rechazada: %s" % x, file=sys.stderr)
        return 2

    corrida = str(uuid.uuid5(NS, "corrida:%s|%s" % (man["dataset_hash"], args.nombre)))
    stg = "stg_%s" % man["dataset_hash"][:12]
    sql = construir_sql(entrada, man, corrida, args.nombre, stg, args.reemplazar,
                        args.permitir_parcial, args.solo_validar)

    tmp = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8")
    tmp.write(sql)
    tmp.close()

    psql = os.path.join(args.pgbin, "psql")
    env = dict(os.environ)
    env.setdefault("PGHOST", "localhost")
    env.setdefault("PGUSER", "postgres")
    print("corrida %s  nombre=%s  hash=%s" % (corrida, args.nombre, man["dataset_hash"][:16]))
    r = subprocess.run([psql, "-d", args.db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", tmp.name],
                       env=env)
    if r.returncode != 0:
        print("la carga falló: la transacción se revirtió entera, no queda snapshot parcial",
              file=sys.stderr)
        print("script: %s" % tmp.name, file=sys.stderr)
        return 1
    os.unlink(tmp.name)
    if args.solo_validar:
        print("solo-validar: todo corrió y se revirtió; no queda nada cargado")
    else:
        print("corrida %s lista" % args.nombre)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
