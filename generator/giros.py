"""Catálogo de giros del generador sintético (docs/04 §Universo base).

Diez giros, cada uno con su catálogo de ClaveProdServ congruentes y sus rangos
característicos de facturación, nómina/facturación, compras/facturación,
número de clientes y estacionalidad mensual.

Los rangos NO son verdad fiscal: son el comportamiento legítimo que el
generador reproduce para que las pistas tengan pares con quién compararse.
Los umbrales de las pistas son relativos a estos pares (forense.v_pares_giro),
nunca absolutos.

Determinismo: este módulo es datos puros, sin azar ni reloj.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple

# Estacionalidad: 12 multiplicadores, enero..diciembre, media ~1.0.
PLANA = (1.0,) * 12


@dataclass(frozen=True)
class Giro:
    nombre: str
    claves: Tuple[str, ...]          # ClaveProdServ congruentes con el giro
    fact_mensual: Tuple[float, float]   # facturación mensual típica (MXN)
    ratio_nomina: Tuple[float, float]   # nómina / facturación
    ratio_compras: Tuple[float, float]  # compras / facturación
    n_clientes: Tuple[int, int]
    estacionalidad: Tuple[float, ...] = PLANA
    empleados: Tuple[int, int] = (3, 40)


GIROS: Dict[str, Giro] = {
    "comercializadora": Giro(
        nombre="comercializadora",
        claves=("43211500", "43211900", "44103100", "31162800"),
        fact_mensual=(180_000, 1_400_000),
        ratio_nomina=(0.03, 0.09),
        ratio_compras=(0.62, 0.86),
        n_clientes=(5, 15),
        estacionalidad=(0.8, 0.9, 1.0, 1.0, 1.0, 1.05, 1.0, 1.0, 1.05, 1.1, 1.25, 1.35),
        empleados=(4, 25),
    ),
    "consultoria": Giro(
        nombre="consultoria",
        claves=("80101500", "80101600", "80101700"),
        fact_mensual=(90_000, 700_000),
        ratio_nomina=(0.28, 0.52),
        ratio_compras=(0.08, 0.25),
        n_clientes=(3, 10),
        estacionalidad=(0.85, 1.0, 1.05, 1.0, 1.0, 1.05, 0.9, 0.85, 1.05, 1.1, 1.15, 1.0),
        empleados=(3, 30),
    ),
    "construccion": Giro(
        nombre="construccion",
        claves=("72141100", "72102900", "72151500"),
        fact_mensual=(250_000, 2_200_000),
        ratio_nomina=(0.18, 0.34),
        ratio_compras=(0.45, 0.70),
        n_clientes=(3, 8),
        estacionalidad=(0.7, 0.85, 1.0, 1.05, 1.1, 1.1, 1.05, 1.05, 1.1, 1.15, 1.2, 0.65),
        empleados=(10, 90),
    ),
    "transporte": Giro(
        nombre="transporte",
        claves=("78101800", "78101700", "78141500"),
        fact_mensual=(120_000, 900_000),
        ratio_nomina=(0.22, 0.38),
        ratio_compras=(0.35, 0.58),
        n_clientes=(6, 15),
        estacionalidad=(0.85, 0.9, 1.0, 1.0, 1.0, 1.0, 1.05, 1.0, 1.05, 1.15, 1.3, 1.2),
        empleados=(8, 60),
    ),
    "restaurante": Giro(
        nombre="restaurante",
        claves=("90101500", "90101600", "90151800"),
        fact_mensual=(70_000, 450_000),
        ratio_nomina=(0.25, 0.42),
        ratio_compras=(0.30, 0.48),
        n_clientes=(4, 12),
        estacionalidad=(0.8, 0.95, 1.0, 1.05, 1.1, 1.0, 1.0, 0.95, 1.05, 1.05, 1.15, 1.4),
        empleados=(8, 45),
    ),
    "manufactura": Giro(
        nombre="manufactura",
        claves=("31162800", "25174800", "23153000"),
        fact_mensual=(300_000, 2_500_000),
        ratio_nomina=(0.15, 0.30),
        ratio_compras=(0.42, 0.68),
        n_clientes=(4, 11),
        estacionalidad=(0.9, 1.0, 1.05, 1.05, 1.0, 1.0, 0.95, 1.0, 1.1, 1.15, 1.15, 0.85),
        empleados=(15, 120),
    ),
    "marketing": Giro(
        nombre="marketing",
        claves=("82101500", "82101600", "82121500"),
        fact_mensual=(80_000, 600_000),
        ratio_nomina=(0.30, 0.50),
        ratio_compras=(0.12, 0.30),
        n_clientes=(4, 12),
        estacionalidad=(0.75, 0.9, 1.0, 1.0, 1.05, 1.05, 0.95, 0.95, 1.1, 1.15, 1.25, 1.15),
        empleados=(4, 35),
    ),
    "despacho_contable": Giro(
        nombre="despacho_contable",
        claves=("84111500", "84111600", "80121600"),
        fact_mensual=(60_000, 380_000),
        ratio_nomina=(0.32, 0.55),
        ratio_compras=(0.06, 0.18),
        n_clientes=(8, 20),
        estacionalidad=(1.3, 1.35, 1.4, 1.2, 0.9, 0.85, 0.85, 0.85, 0.9, 0.95, 1.0, 0.95),
        empleados=(4, 28),
    ),
    "servicios_personal": Giro(
        nombre="servicios_personal",
        claves=("80111600", "80111500", "80111700"),
        fact_mensual=(200_000, 1_600_000),
        ratio_nomina=(0.55, 0.78),
        ratio_compras=(0.05, 0.15),
        n_clientes=(3, 9),
        estacionalidad=(0.95, 1.0, 1.0, 1.0, 1.0, 1.05, 1.0, 1.0, 1.05, 1.05, 1.1, 0.95),
        empleados=(30, 250),
    ),
    "tecnologia": Giro(
        nombre="tecnologia",
        claves=("81111500", "81111800", "43232700"),
        fact_mensual=(110_000, 1_100_000),
        ratio_nomina=(0.34, 0.58),
        ratio_compras=(0.10, 0.28),
        n_clientes=(3, 10),
        estacionalidad=(0.9, 0.95, 1.05, 1.0, 1.0, 1.05, 1.0, 1.0, 1.05, 1.1, 1.2, 1.05),
        empleados=(5, 60),
    ),
}

ORDEN_GIROS = tuple(sorted(GIROS))  # orden estable: el generador nunca itera un dict sin ordenar

# Claves de servicios genéricos que usa una factura de "consultoría" sin sustancia.
CLAVE_SERVICIOS_GENERICA = "80101500"
CLAVE_NOMINA = "84111505"
