#!/usr/bin/env python3
"""Generador de dataset sintético (docs/04 §3).

    python3 generator/gen.py --seed 42 --n 100 --meses 12 --out data/gen/

Propiedades que el generador garantiza (y que el manifiesto declara):

*   **Determinista.** Todo el azar sale de `random.Random(seed)` y de
    `Faker.seed(seed)`. `fecha_corte` es un parámetro fijo, nunca el reloj:
    dos corridas con la misma semilla y el mismo corte producen los mismos
    bytes y el mismo `dataset_hash`.
*   **Cinco tipologías sembradas y ocho trampas legítimas** (`generator/
    tipologias.py`, `generator/trampas.py`), cada una con su fila en
    `ground_truth.csv`. Las trampas son el único modo de medir falsos
    positivos: sin ellas no hay métrica.
*   **Distancia de grafo declarada.** Ninguna entidad trampa está a menos de
    3 saltos (en el grafo CFDI) de un RFC publicado como `definitivo`. La
    pista E1 marca contrapartes a ≤2 saltos: sin esta separación las trampas
    recibirían una segunda familia gratis y el selector de dos familias
    dejaría de medir lo que dice medir. Se verifica con networkx antes de
    escribir, y el loader lo vuelve a verificar en SQL.
*   **El ground truth no viaja con los hechos.** `ground_truth.csv` es un
    archivo aparte; el loader lo carga en `forense.ground_truth`, que ninguna
    herramienta del agente puede leer.

El texto libre (`razon_social`, `descripcion`, `referencia`) se genera como
dato no confiable e incluye a propósito una cadena con instrucciones
inyectadas: ninguna pista lo lee, y el runtime debe seguir sin obedecerlo.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import sys
import unicodedata
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Sequence, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from giros import CLAVE_NOMINA, CLAVE_SERVICIOS_GENERICA, GIROS, ORDEN_GIROS, Giro  # noqa: E402

NS = uuid.UUID("6f1c9d2e-0000-4000-8000-000000000000")
TZ = "-06"  # America/Mexico_City, declarado en el manifiesto
IVA = Decimal("0.16")
CENT = Decimal("0.01")

# Semilla reservada para la comprobación final sin ajustes posteriores
# (docs/04 §Parámetros). El generador se niega a usarla salvo --holdout.
SEMILLA_RESERVADA = 20260211

# ---------------------------------------------------------------------
# Resolución intradía (--horario)
#
# `plano`    : toda emisión a las 10:30, como gen-v1. Es el DEFAULT y no
#              puede cambiar: `gen-v1` está cargado en la base compartida y
#              las aserciones `db/tests/assertions_*_gen.sql` miden sobre él.
# `intradia` : hora y minuto repartidos. Desbloquea la pierna (a) de T2
#              (sincronía), que sobre un dataset con una sola hora del día
#              queda `no_evaluable` por construcción (ver el comentario de
#              `forense.pista_t2` en db/003_pistas.sql).
#
# Garantía de reproducibilidad: el azar de la hora sale de un generador
# APARTE (`Mundo.rng_hora`), nunca de `Mundo.rng`. En modo `plano` ese
# generador no se consume ni una vez, así que la secuencia del azar
# principal —y con ella cada RFC, importe y fecha de gen-v1— es idéntica
# byte a byte. Comparación en generator/README.md §Reproducibilidad.
HORARIOS = ("plano", "intradia")
DATASET_POR_HORARIO = {"plano": "gen-v1", "intradia": "gen-v2"}

# Peso relativo de cada hora del día para una emisión legítima. Dos picos
# (media mañana y media tarde), comida marcada y cola de timbrado al cierre
# de la jornada. No es uniforme de 0 a 23: nadie factura a las 3 a.m., y una
# uniforme de 24 h le regalaría a T2 una dispersión que no existe.
PESOS_HORA = ((8, 4), (9, 9), (10, 13), (11, 14), (12, 12), (13, 8),
              (14, 5), (15, 9), (16, 12), (17, 10), (18, 7), (19, 4),
              (20, 2), (21, 1))
_PESO_TOTAL = sum(p for _, p in PESOS_HORA)


def dinero(x) -> Decimal:
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


def sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def mes_sumar(y: int, m: int, k: int) -> Tuple[int, int]:
    t = (y * 12 + (m - 1)) + k
    return t // 12, (t % 12) + 1


# =====================================================================
# Mundo: acumula filas del esquema canónico (docs/05)
# =====================================================================


class Mundo:
    def __init__(self, rng: random.Random, fake, corte: datetime, meses: int,
                 horario: str = "plano", rng_hora: Optional[random.Random] = None):
        self.rng = rng
        self.fake = fake
        self.corte = corte
        self.meses = meses
        # Azar de la hora del día, SEPARADO del azar principal: en modo
        # 'plano' no se consume, así que gen-v1 no se mueve.
        self.horario = horario
        self.intradia = (horario == "intradia")
        self.rng_hora = rng_hora if rng_hora is not None else random.Random(0)
        self.contribuyentes: List[dict] = []
        self.cuentas: List[dict] = []
        self.cfdi: List[dict] = []
        self.complementos: List[dict] = []
        self.movimientos: List[dict] = []
        self.atributos: List[dict] = []
        self.listas: List[dict] = []
        self.ground: List[dict] = []
        self._n_uuid = 0
        self._n_mov = 0
        self._n_clabe = 0
        self._rfcs: Dict[str, dict] = {}
        self._ctas_por_rfc: Dict[str, List[str]] = {}
        self.notas: List[str] = []

    # -- identificadores deterministas ---------------------------------
    def nuevo_uuid(self) -> str:
        self._n_uuid += 1
        return str(uuid.uuid5(NS, "cfdi:%d" % self._n_uuid))

    def nueva_clabe(self, banco: str) -> str:
        self._n_clabe += 1
        # 3 dígitos de banco + 3 de plaza + 11 de cuenta + 1 de control.
        # Se conserva como TEXTO: los ceros iniciales son parte de la identidad.
        return "%03d180%011d%d" % (int(banco), self._n_clabe, self._n_clabe % 10)

    def nuevo_rfc(self, nombre: str, alta: date, fisica: bool = False) -> str:
        base = "".join(c for c in sin_acentos(nombre).upper() if c.isalpha())
        base = (base + "XXXX")[: 4 if fisica else 3]
        homo = "%s%s%s" % (
            "ABCDEFGHJKLMNPRSTUVWXYZ"[self._n_clabe % 23],
            "0123456789"[len(self._rfcs) % 10],
            "0123456789ABC"[(len(self._rfcs) // 10) % 13],
        )
        rfc = "%s%s%s" % (base, alta.strftime("%y%m%d"), homo)
        k = 0
        while rfc in self._rfcs:
            k += 1
            rfc = "%s%s%s%d" % (base[:-1], alta.strftime("%y%m%d"), homo[:2], k)
        return rfc

    # -- altas ----------------------------------------------------------
    def alta(
        self,
        giro: str,
        alta: date,
        empleados: int,
        razon: Optional[str] = None,
        domicilio: Optional[str] = None,
        representante: Optional[str] = None,
        email: Optional[str] = None,
        telefono: Optional[str] = None,
        tipo_persona: str = "moral",
        n_cuentas: int = 1,
        saldo_inicial: Optional[float] = None,
        tipo_cuenta: str = "moral",
    ) -> str:
        razon = razon or self.fake.company()
        rfc = self.nuevo_rfc(razon, alta, fisica=(tipo_persona == "fisica"))
        fila = {
            "rfc": rfc,
            "razon_social": razon,
            "giro": giro,
            "tipo_persona": tipo_persona,
            "fecha_alta": alta.isoformat(),
            "domicilio": domicilio or self.fake.street_address(),
            "cp": self.fake.postcode(),
            "representante": representante or self.fake.name(),
            "email": email or ("contacto%d@ejemplo-sintetico.mx" % (len(self._rfcs) + 1)),
            "telefono": telefono or ("55%08d" % (10_000_000 + len(self._rfcs))),
            "empleados_declarados": empleados,
        }
        self._rfcs[rfc] = fila
        self.contribuyentes.append(fila)
        for atributo, valor in (
            ("domicilio", fila["domicilio"]),
            ("representante", fila["representante"]),
            ("email", fila["email"]),
            ("telefono", fila["telefono"]),
        ):
            self.atributo(rfc, atributo, valor, "padron")
        for _ in range(n_cuentas):
            self.cuenta(
                rfc,
                tipo=tipo_cuenta,
                saldo_inicial=saldo_inicial if saldo_inicial is not None else self.rng.uniform(20_000, 400_000),
            )
        return rfc

    def cuenta(self, rfc: Optional[str], tipo: str = "moral", saldo_inicial: float = 0.0,
               banco: Optional[str] = None) -> str:
        banco = banco or self.rng.choice(["002", "012", "014", "021", "072"])
        clabe = self.nueva_clabe(banco)
        self.cuentas.append({
            "clabe": clabe,
            "rfc_titular": rfc,
            "banco": banco,
            "tipo": tipo,
            "moneda": "MXN",
            "saldo_inicial": str(dinero(saldo_inicial)),
            "fecha_saldo_inicial": self.ts(self.mes_ventana(0)[0]),
        })
        if rfc:
            self._ctas_por_rfc.setdefault(rfc, []).append(clabe)
            # El atributo sólo existe para titulares del padrón: una cuenta de
            # persona física receptora de dispersión no es un contribuyente y
            # no puede colgar un atributo de una FK que no existe.
            if rfc in self._rfcs:
                self.atributo(rfc, "clabe", clabe, "banco")
        return clabe

    def clabe_de(self, rfc: str) -> str:
        return self._ctas_por_rfc[rfc][0]

    def atributo(self, rfc: str, atributo: str, valor: str, fuente: str) -> None:
        self.atributos.append({"rfc": rfc, "atributo": atributo, "valor": valor, "fuente": fuente})

    def lista_sat(self, rfc: str, estatus: str, fecha: date, oficio: str, lista: str = "69B") -> None:
        self.listas.append({
            "rfc": rfc,
            "lista": lista,
            "estatus": estatus,
            "fecha_publicacion": fecha.isoformat(),
            "oficio": oficio,
            "razon_social": self._rfcs.get(rfc, {}).get("razon_social", ""),
        })

    def gt(self, rfc: str, es_fraude: bool, tipologia: Optional[str],
           es_trampa: bool = False, nota: str = "") -> None:
        self.ground.append({
            "rfc": rfc,
            "es_fraude": "true" if es_fraude else "false",
            "tipologia": tipologia or "",
            "es_trampa_legitima": "true" if es_trampa else "false",
            "nota": nota,
        })

    # -- tiempo ---------------------------------------------------------
    def ts(self, d: date, hora: int = 10, minuto: int = 30) -> str:
        return "%s %02d:%02d:00%s" % (d.isoformat(), hora, minuto, TZ)

    def hora_emision(self) -> Tuple[int, int]:
        """Hora y minuto de una emisión legítima.

        `plano` devuelve siempre 10:30 (gen-v1). `intradia` reparte sobre el
        horario laboral con `PESOS_HORA` y minuto uniforme: dispersión real,
        no una uniforme de 0 a 23 que le regalaría a T2 una separación que en
        un padrón verdadero no existe."""
        if not self.intradia:
            return 10, 30
        u = self.rng_hora.random() * _PESO_TOTAL
        acum = 0
        hora = PESOS_HORA[-1][0]
        for h, peso in PESOS_HORA:
            acum += peso
            if u < acum:
                hora = h
                break
        return hora, self.rng_hora.randrange(60)

    @staticmethod
    def rafaga(k: int, n: int, hora_inicio: int = 9, minuto_inicio: int = 5,
               minutos_totales: int = 105) -> Tuple[int, int]:
        """Hora y minuto del k-ésimo timbrado de una ráfaga de `n`.

        ESTRICTAMENTE CRECIENTE con k y sin azar: la pierna (a) de T2 encadena
        con `f.fecha >= c.f_act and f.fecha <= c.f_ini + interval '6 hours'`,
        así que una hora no monótona rompe el enlace en silencio. El paso sale
        de `minutos_totales`, que debe quedar por debajo de las 6 h de la
        regla (105 min ≈ 1 h 45)."""
        paso = minutos_totales // max(n - 1, 1)
        t = hora_inicio * 60 + minuto_inicio + paso * k
        return t // 60, t % 60

    def mes_ventana(self, i: int) -> Tuple[date, date]:
        """Mes i de la ventana (0 = el más antiguo). Devuelve (primero, ultimo_util)."""
        y, m = mes_sumar(self.corte.year, self.corte.month, -(self.meses - 1) + i)
        return date(y, m, 1), date(y, m, 28)

    def dia_de(self, i: int, d: int) -> date:
        ini, _ = self.mes_ventana(i)
        return ini + timedelta(days=min(max(d, 1), 27) - 1)

    # -- hechos ---------------------------------------------------------
    def factura(self, emisor: str, receptor: str, f: date, total, clave: str,
                metodo: str = "PUE", tipo: str = "I", descripcion: Optional[str] = None,
                cancelado: bool = False, uuid_sustituye: Optional[str] = None,
                hora: Optional[int] = None, minuto: Optional[int] = None) -> dict:
        # La hora se sortea SOLO aquí (no en `ts`): `cuenta`, `complemento` y
        # `cancelar` conservan su hora fija, que no informa a ninguna pista y
        # sólo añadiría ruido al diff entre gen-v1 y gen-v2.
        if hora is None or minuto is None:
            h_def, m_def = self.hora_emision()
            hora = h_def if hora is None else hora
            minuto = m_def if minuto is None else minuto
        total = dinero(total)
        subtotal = dinero(total / (Decimal("1") + IVA))
        row = {
            "uuid": self.nuevo_uuid(),
            "tipo": tipo,
            "emisor_rfc": emisor,
            "receptor_rfc": receptor,
            "fecha": self.ts(f, hora, minuto),
            "subtotal": str(subtotal),
            "iva": str(dinero(total - subtotal)),
            "total": str(total),
            "moneda": "MXN",
            "metodo_pago": metodo,
            "forma_pago": "03" if metodo == "PUE" else "99",
            "uso_cfdi": "G03",
            "clave_prod_serv": clave,
            "descripcion": descripcion or "Servicios prestados conforme a contrato",
            "cancelado": "true" if cancelado else "false",
            "fecha_cancelacion": "",
            "motivo_cancelacion": "",
            "uuid_sustituye": uuid_sustituye or "",
            "_fecha_date": f,
            "_total": total,
        }
        self.cfdi.append(row)
        return row

    def cancelar(self, row: dict, f: date, motivo: str = "01") -> None:
        row["cancelado"] = "true"
        row["fecha_cancelacion"] = self.ts(f)
        row["motivo_cancelacion"] = motivo

    def complemento(self, row: dict, f: date, monto=None) -> None:
        self.complementos.append({
            "uuid_pago": self.nuevo_uuid(),
            "uuid_cfdi": row["uuid"],
            "fecha": self.ts(f),
            "monto": str(dinero(monto if monto is not None else row["_total"])),
        })

    def movimiento(self, origen: Optional[str], destino: Optional[str], f: date, monto,
                   tipo: str = "spei", referencia: str = "TRANSFERENCIA") -> dict:
        self._n_mov += 1
        row = {
            "id": self._n_mov,
            "cuenta_origen": origen or "",
            "cuenta_destino": destino or "",
            "fecha": self.ts(f, 12, 0),
            "monto": str(dinero(monto)),
            "moneda": "MXN",
            "tipo": tipo,
            "referencia": referencia,
        }
        self.movimientos.append(row)
        return row

    def pagar(self, row: dict, dias: int, pagador: Optional[str] = None,
              referencia: str = "PAGO FACTURA") -> None:
        """Movimiento bancario que concilia la factura (F1: ±7 días, ±2%)."""
        pagador = pagador or row["receptor_rfc"]
        if pagador not in self._ctas_por_rfc or row["emisor_rfc"] not in self._ctas_por_rfc:
            return
        self.movimiento(
            self.clabe_de(pagador),
            self.clabe_de(row["emisor_rfc"]),
            row["_fecha_date"] + timedelta(days=dias),
            row["_total"],
            "spei",
            referencia,
        )


# =====================================================================
# Universo de fondo
# =====================================================================

ZONAS = ("edos", "trampa", "libre")

class Fondo:
    def __init__(self, mundo: Mundo, cfg):
        self.m = mundo
        self.cfg = cfg
        self.por_zona: Dict[str, List[str]] = {z: [] for z in ZONAS}
        self.giro_de: Dict[str, str] = {}
        self.proveedores: Dict[str, str] = {}   # zona -> RFC externo (no contribuyente)


def construir_fondo(m: Mundo, cfg) -> Fondo:
    fondo = Fondo(m, cfg)
    rng = m.rng
    # Proveedor de insumos por zona: emite CFDI pero NO es contribuyente del
    # padrón, así no contamina los percentiles por giro y garantiza que ningún
    # contribuyente quede con compras_12m = 0 por ser cabeza del DAG.
    for z in ZONAS:
        fondo.proveedores[z] = "INS%s%s" % (z[:2].upper(), "200101AB1")

    n = cfg.n_fondo
    for i in range(n):
        giro = ORDEN_GIROS[i % len(ORDEN_GIROS)]
        g = GIROS[giro]
        zona = ZONAS[i % len(ZONAS)]
        alta = date(2026, 1, 1) - timedelta(days=rng.randint(1200, 5200))
        emp = rng.randint(*g.empleados)
        rfc = m.alta(giro, alta, emp, saldo_inicial=rng.uniform(50_000, 900_000))
        fondo.por_zona[zona].append(rfc)
        fondo.giro_de[rfc] = giro
        m.gt(rfc, False, None, False, "fondo verosímil")

    for zona in ZONAS:
        pool = fondo.por_zona[zona]
        for idx, rfc in enumerate(pool):
            _operar_legitimo(m, fondo, rfc, zona, idx, pool)
    return fondo


def _operar_legitimo(m: Mundo, fondo: Fondo, rfc: str, zona: str, idx: int, pool: List[str]) -> None:
    """Comportamiento legítimo: ventas a clientes del mismo sector en orden de
    índice (grafo sin ciclos), compras de insumos, nómina mensual, PUE pagado
    en 0-15 días, PPD con complemento en 30-90 días, 1-3% de cancelaciones con
    refacturación."""
    rng = m.rng
    g = GIROS[fondo.giro_de[rfc]]
    base = rng.uniform(*g.fact_mensual)
    # clientes aguas abajo (índice mayor) -> el fondo no genera ciclos
    candidatos = [r for j, r in enumerate(pool) if j > idx]
    if not candidatos:
        candidatos = [r for j, r in enumerate(pool) if j < idx][:3]
    k = min(len(candidatos), rng.randint(*g.n_clientes))
    clientes = candidatos[:k] if k else []

    emp = m._rfcs[rfc]["empleados_declarados"]
    nomina_mes = base * rng.uniform(*g.ratio_nomina)
    compras_mes = base * rng.uniform(*g.ratio_compras)

    for i in range(m.meses):
        est = g.estacionalidad[m.mes_ventana(i)[0].month - 1]
        # ventas
        for j, cli in enumerate(clientes):
            monto = base * est / max(len(clientes), 1) * rng.uniform(0.7, 1.35)
            if monto < 1500:
                continue
            metodo = "PUE" if rng.random() < 0.65 else "PPD"
            f = m.dia_de(i, 3 + (j * 3) % 22)
            row = m.factura(rfc, cli, f, monto, rng.choice(g.claves), metodo)
            if metodo == "PUE":
                m.pagar(row, rng.randint(0, 7))
            else:
                dpago = rng.randint(30, 80)
                m.complemento(row, f + timedelta(days=dpago))
                m.pagar(row, dpago)
            if rng.random() < 0.02:
                m.cancelar(row, f + timedelta(days=rng.randint(1, 20)))
                m.factura(rfc, cli, f + timedelta(days=1), monto,
                          row["clave_prod_serv"], metodo, uuid_sustituye=row["uuid"])
        # compras de insumos al proveedor externo de la zona
        prov = fondo.proveedores[
            [z for z in ZONAS if rfc in fondo.por_zona[z]][0]
        ]
        fc = m.dia_de(i, 6)
        row = m.factura(prov, rfc, fc, compras_mes * est * rng.uniform(0.8, 1.2),
                        rng.choice(g.claves), "PUE")
        # nómina (tipo N): el receptor es un agregado de empleados, no un contribuyente
        if emp > 0:
            m.factura(rfc, "NOM" + rfc[:9], m.dia_de(i, 25), nomina_mes * rng.uniform(0.95, 1.05),
                      CLAVE_NOMINA, "PUE", tipo="N")


# =====================================================================
# Salida
# =====================================================================

COLUMNAS = {
    "contribuyentes.csv": ["rfc", "razon_social", "giro", "tipo_persona", "fecha_alta", "domicilio",
                           "cp", "representante", "email", "telefono", "empleados_declarados"],
    "cuentas.csv": ["clabe", "rfc_titular", "banco", "tipo", "moneda", "saldo_inicial",
                    "fecha_saldo_inicial"],
    "cfdi.csv": ["uuid", "tipo", "emisor_rfc", "receptor_rfc", "fecha", "subtotal", "iva", "total",
                 "moneda", "metodo_pago", "forma_pago", "uso_cfdi", "clave_prod_serv", "descripcion",
                 "cancelado", "fecha_cancelacion", "motivo_cancelacion", "uuid_sustituye"],
    "complementos_pago.csv": ["uuid_pago", "uuid_cfdi", "fecha", "monto"],
    "movimientos.csv": ["id", "cuenta_origen", "cuenta_destino", "fecha", "monto", "moneda", "tipo",
                        "referencia"],
    "atributos_entidad.csv": ["rfc", "atributo", "valor", "fuente"],
    "listas_sat.csv": ["rfc", "lista", "estatus", "fecha_publicacion", "oficio", "razon_social"],
    "ground_truth.csv": ["rfc", "es_fraude", "tipologia", "es_trampa_legitima", "nota"],
}

FUENTE = {
    "contribuyentes.csv": "contribuyentes",
    "cuentas.csv": "cuentas",
    "cfdi.csv": "cfdi",
    "complementos_pago.csv": "complementos",
    "movimientos.csv": "movimientos",
    "atributos_entidad.csv": "atributos",
    "listas_sat.csv": "listas",
    "ground_truth.csv": "ground",
}


def escribir(m: Mundo, out: str) -> Dict[str, dict]:
    os.makedirs(out, exist_ok=True)
    info = {}
    for archivo, cols in COLUMNAS.items():
        filas = getattr(m, FUENTE[archivo])
        ruta = os.path.join(out, archivo)
        with open(ruta, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
            w.writeheader()
            for fila in filas:
                w.writerow(fila)
        with open(ruta, "rb") as fh:
            h = hashlib.sha256(fh.read()).hexdigest()
        info[archivo] = {"filas": len(filas), "sha256": h}
    return info


def verificar(m: Mundo, definitivos: Sequence[str], trampas_rfc: Sequence[str]) -> dict:
    """Invariantes que el generador se exige a sí mismo antes de escribir."""
    import networkx as nx

    import trampas as trampas_mod

    problemas: List[str] = []

    # 1. Grafo CFDI: ninguna trampa a menos de 3 saltos de un RFC 'definitivo'.
    gx = nx.Graph()
    for f in m.cfdi:
        if f["tipo"] == "I" and f["cancelado"] != "true":
            gx.add_edge(f["emisor_rfc"], f["receptor_rfc"])
    dmin = {}
    for t in trampas_rfc:
        peor = 99
        for d in definitivos:
            if t in gx and d in gx and nx.has_path(gx, t, d):
                peor = min(peor, nx.shortest_path_length(gx, t, d))
        dmin[t] = peor
        if peor < 3:
            problemas.append("trampa %s a %d saltos de un definitivo (E1 la marcaría)" % (t, peor))

    # 2. Como mucho un contribuyente con compras_12m = 0 por giro (si hubiera
    #    dos, percentile_cont(0.1) queda en 0 y D2 no puede disparar nunca).
    compras = {c["rfc"]: Decimal("0") for c in m.contribuyentes}
    for f in m.cfdi:
        if f["tipo"] == "I" and f["cancelado"] != "true" and f["receptor_rfc"] in compras:
            compras[f["receptor_rfc"]] += Decimal(f["total"])
    giro_de = {c["rfc"]: c["giro"] for c in m.contribuyentes}
    ceros: Dict[str, List[str]] = {}
    for rfc, v in compras.items():
        if v == 0:
            ceros.setdefault(giro_de[rfc], []).append(rfc)
    for giro, rfcs in sorted(ceros.items()):
        if len(rfcs) > 1:
            problemas.append("giro %s con %d contribuyentes sin compras: D2 quedaría ciego"
                             % (giro, len(rfcs)))

    # 3. Todo el que paga o cobra tiene cuenta (F1 exige ambas titularidades).
    sin_cuenta = [c["rfc"] for c in m.contribuyentes if c["rfc"] not in m._ctas_por_rfc]
    if sin_cuenta:
        problemas.append("%d contribuyentes sin CLABE: F1 dispararía sobre inocentes" % len(sin_cuenta))

    # 4. Integridad referencial de la salida.
    uuids = set(f["uuid"] for f in m.cfdi)
    huerfanos = [c for c in m.complementos if c["uuid_cfdi"] not in uuids]
    if huerfanos:
        problemas.append("%d complementos sin CFDI" % len(huerfanos))
    clabes = set(c["clabe"] for c in m.cuentas)
    mal = [mv for mv in m.movimientos
           if (mv["cuenta_origen"] and mv["cuenta_origen"] not in clabes)
           or (mv["cuenta_destino"] and mv["cuenta_destino"] not in clabes)]
    if mal:
        problemas.append("%d movimientos con CLABE inexistente" % len(mal))

    # 5. El padrón de trampas tiene el tamaño que declara la constante del
    #    módulo. `CONTRIBUYENTES` dimensiona el universo de fondo
    #    (`cfg.n_fondo`) y por decisión deliberada NO cambia con `--horario`:
    #    la trampa 9 suma 4 RFC sobre el padrón en vez de sustituir a nadie,
    #    y por eso gen-v1 conserva byte a byte su `dataset_hash`. El riesgo
    #    es el inverso: que alguien cablee `CONTRIBUYENTES_INTRADIA` a
    #    `n_fondo` creyendo corregir un descuido, encogiendo el fondo 4 y
    #    moviendo cada RFC de la corrida que ya está cargada. Comprobarlo
    #    aquí convierte ese comentario en un invariante que falla si el
    #    conteo y la constante se separan.
    esperados = trampas_mod.CONTRIBUYENTES_INTRADIA if m.intradia else trampas_mod.CONTRIBUYENTES
    if len(trampas_rfc) != esperados:
        problemas.append(
            "el padrón de trampas tiene %d RFC y la constante del módulo declara %d "
            "(horario=%s): cuadra la constante, no el fondo"
            % (len(trampas_rfc), esperados, "intradia" if m.intradia else "plano"))

    # 6. Ninguna fecha posterior al corte.
    corte_s = m.corte.strftime("%Y-%m-%d")
    futuras = [f["uuid"] for f in m.cfdi if f["fecha"][:10] > corte_s]
    if futuras:
        problemas.append("%d CFDI con fecha posterior al corte" % len(futuras))

    return {"ok": not problemas, "problemas": problemas,
            "distancia_trampa_definitivo": dmin,
            "giros_con_compras_cero": {k: len(v) for k, v in sorted(ceros.items())}}


# =====================================================================
# CLI
# =====================================================================


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Generador de dataset sintético (docs/04)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--n", type=int, default=100, help="contribuyentes objetivo (fondo + sembrados)")
    p.add_argument("--meses", type=int, default=12)
    p.add_argument("--pct_fraude", type=float, default=0.12)
    p.add_argument("--pct_trampas", type=float, default=0.08)
    p.add_argument("--fecha-corte", dest="fecha_corte", default="2026-01-31",
                   help="fecha de corte FIJA (no el reloj); la ventana cierra aquí")
    p.add_argument("--out", default="data/gen/")
    p.add_argument("--horario", choices=HORARIOS, default="plano",
                   help="plano = 10:30 para todo (gen-v1, DEFAULT, no cambiar); "
                        "intradia = horas repartidas y ráfagas (gen-v2, habilita T2)")
    p.add_argument("--holdout", action="store_true",
                   help="autoriza explícitamente la semilla reservada de comprobación final")
    return p.parse_args(argv)


def main(argv=None) -> int:
    t0 = datetime.now()
    args = parse_args(argv)
    if args.seed == SEMILLA_RESERVADA and not args.holdout:
        print("La semilla %d está reservada para la comprobación final (docs/04). "
              "Usa --holdout si de verdad es esa corrida." % SEMILLA_RESERVADA, file=sys.stderr)
        return 2

    from faker import Faker
    import faker as faker_mod

    Faker.seed(args.seed)
    fake = Faker("es_MX")
    rng = random.Random(args.seed)

    d = date.fromisoformat(args.fecha_corte)
    corte = datetime(d.year, d.month, d.day, 23, 59, 59)

    # Semilla propia y derivada para la hora del día: así el modo intradía no
    # desplaza ni un paso la secuencia de `rng`, y sigue siendo determinista.
    rng_hora = random.Random("hora|%d|%s" % (args.seed, args.fecha_corte))

    m = Mundo(rng, fake, corte, args.meses, horario=args.horario, rng_hora=rng_hora)

    import tipologias
    import trampas

    cfg = argparse.Namespace(**vars(args))
    n_sembrados = tipologias.CONTRIBUYENTES + trampas.CONTRIBUYENTES
    cfg.n_fondo = max(args.n - n_sembrados, 12)

    fondo = construir_fondo(m, cfg)
    res_tip = tipologias.sembrar(m, fondo, cfg)
    res_tra = trampas.sembrar(m, fondo, cfg)

    chequeo = verificar(m, res_tip["definitivos"], res_tra["rfcs"])
    if not chequeo["ok"]:
        for p in chequeo["problemas"]:
            print("INVARIANTE ROTA: %s" % p, file=sys.stderr)
        return 1

    info = escribir(m, args.out)
    dataset_hash = hashlib.sha256(
        "|".join("%s:%s" % (k, info[k]["sha256"]) for k in sorted(info)).encode()
    ).hexdigest()

    nombre_dataset = DATASET_POR_HORARIO[args.horario]
    manifiesto = {
        "dataset": nombre_dataset,
        "dataset_hash": dataset_hash,
        "generador": "generator/gen.py",
        "horario": args.horario,
        "semilla": args.seed,
        "holdout": bool(args.holdout),
        "fecha_corte": corte.strftime("%Y-%m-%d %H:%M:%S") + TZ,
        "zona_horaria": "America/Mexico_City (UTC-06:00, sin horario de verano en el periodo)",
        "meses_ventana": args.meses,
        "parametros": {"n": args.n, "pct_fraude": args.pct_fraude, "pct_trampas": args.pct_trampas},
        "versiones": {"python": sys.version.split()[0], "faker": faker_mod.VERSION},
        "archivos": info,
        "cobertura": {
            "tipologias": res_tip["tipologias"],
            "trampas": res_tra["trampas"],
            "familias_evaluables": ["D", "F", "R", "T", "E"],
            "pistas_primera_entrega": ["D2", "F1", "F2", "R1", "R2", "E1", "T1"],
            # Resolución intradía: sin ella la pierna (a) de T2 (sincronía de
            # menos de 6 h) no es comprobable y queda no_evaluable con su
            # motivo en bitácora. Lo declara el dataset, no lo adivina la pista.
            "resolucion_intradia": args.horario == "intradia",
            "t2_sincronia_evaluable": args.horario == "intradia",
            "horas_distintas_cfdi": len(set(f["fecha"][11:16] for f in m.cfdi)),
        },
        "invariantes": chequeo,
        "advertencias": [
            "Dataset sintético. Los RFC, razones sociales y publicaciones 69-B son inventados: "
            "no corresponden a personas o empresas reales ni a operaciones que hayan ocurrido.",
            "ground_truth.csv es material de evaluación: el loader lo carga en forense.ground_truth, "
            "que ninguna herramienta del agente puede leer.",
            "cfdi.descripcion incluye a propósito una cadena con instrucciones inyectadas "
            "(texto libre = dato no confiable). Ninguna pista la lee.",
        ],
        "notas": m.notas,
    }
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifiesto, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")

    dur = (datetime.now() - t0).total_seconds()
    print("dataset %s  horario=%s  hash=%s  %.1fs"
          % (nombre_dataset, args.horario, dataset_hash[:16], dur))
    for k in sorted(info):
        print("  %-24s %6d filas" % (k, info[k]["filas"]))
    print("  tipologías: %s" % ", ".join(sorted(res_tip["tipologias"])))
    print("  trampas:    %s" % ", ".join(sorted(res_tra["trampas"])))
    print("  distancia mínima trampa→definitivo: %s"
          % min(chequeo["distancia_trampa_definitivo"].values()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
