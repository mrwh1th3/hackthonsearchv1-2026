"""Las ocho trampas legítimas (docs/04 §Trampas legítimas).

Son la parte más importante del generador: **sin trampas no hay métrica de
falsos positivos y no hay demo**. Cada una se parece a una tipología en algún
eje y se separa de ella en un dato medible, nunca en una intuición.

Qué dispara cada trampa con la primera entrega de pistas y por qué el sistema
debe terminar descartándola:

| trampa                    | pistas       | familias | separación medible                     |
|---------------------------|--------------|----------|-----------------------------------------|
| grupo_corporativo         | R1+R2, T2(a) | R, T     | nómina, compras y pagos reales          |
| comercializadora_margen   | (ninguna)    | —        | el dinero sale a personas morales       |
| startup_pico              | T1           | T        | la nómina crece mes a mes               |
| consultoria_redondos      | (D3, futura) | —        | clientes diversificados, todo conciliado|
| despacho_contable         | R1           | R        | **no se facturan entre sí**             |
| desvirtuado_69b           | (ninguna)    | —        | último estatus publicado: desvirtuado   |
| factoraje_real            | F1           | F        | contrato y pago de un tercero financiero|
| estacionalidad_diciembre  | (T2, futura) | —        | el pico existe también el año anterior  |
| cadena_suministro_proyecto| T1 + T2(a)   | **T**    | nómina, compras, depósito y margen que SUBE |

Con `--horario plano` (gen-v1) ninguna llega a dos familias distintas, así que
el selector automático de `score_entidad` no las convierte en caso. La del
despacho, que es la que más se parece a un cluster, se investiga a propósito
por `/investigar` manual para enseñar la defensa; entrar así es ingreso
manual, no selección automática.

Con `--horario intradia` (gen-v2) cambian dos cosas, las dos buscadas y las
dos declaradas en `ground_truth.csv` y en las notas del manifiesto:

1.  el **grupo corporativo** gana T2(a) —su cierre intercompañía se timbra en
    una sola corrida del ERP— y con ella una segunda familia. T2 necesita un
    falso positivo que la capa de descarte tenga que refutar, y la refutación
    está en los datos (nómina de plantilla, compras al giro, depósito por
    factura). Un grupo real comparte domicilio **y** timbra en lote: borrar
    esa co-ocurrencia para recuperar una métrica sería medir un dataset más
    fácil;
2.  aparece la trampa 9, **cadena de suministro de proyecto único** (4 RFC de
    comercializadora), que dispara T1 + T2(a): **dos pistas de UNA sola familia**.
    Ésa es la que restituye el diferencial entre el baseline de dos pistas
    (la marca) y el selector de dos familias (no la marca), y lo hace
    añadiendo un comportamiento que ocurre de verdad, no quitando uno.
    gen-v2 tiene por eso 4 contribuyentes más en el padrón que gen-v1: se
    añade, no se sustituye.

Las trampas operan exclusivamente con la zona 'trampa' y 'libre' del universo:
nunca con las contrapartes de un EFOS. Así ninguna queda a ≤2 saltos de un RFC
publicado como definitivo, que es la distancia a la que E1 marca.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List

from giros import CLAVE_NOMINA, GIROS

# Contribuyentes del padrón que crea este módulo (para dimensionar el fondo).
# NO se toca: cualquier cambio aquí mueve el tamaño del universo de fondo y
# con él cada RFC de gen-v1, que está cargado en la base compartida. La
# trampa 9 (`--horario intradia`) añade 4 contribuyentes SOBRE este número,
# así que gen-v2 tiene 104 en el padrón donde gen-v1 tiene 100: es una suma
# deliberada, y por eso las métricas de gen-v2 publican sus denominadores.
CONTRIBUYENTES = 15
CONTRIBUYENTES_INTRADIA = 19


def _nomina(m, rfc: str, mes_idx: int, monto: float) -> None:
    m.factura(rfc, "NOM" + rfc[:9], m.dia_de(mes_idx, 25), monto, CLAVE_NOMINA, "PUE", tipo="N")


def _perfil_mensual(m, rfc: str, mes_idx: int, fact_mensual: float, prov: str,
                    pos_nomina: float = 0.5, pos_compras: float = 0.5) -> None:
    """Nómina y compras del mes en el punto medio del rango de su giro.

    Una entidad legítima que declara menos nómina o menos compras que el p10 de
    sus pares dispara D2 aunque no tenga nada que esconder: el umbral es
    relativo al giro, así que una trampa mal calibrada deja de medir el
    detector y pasa a medir el generador. Por eso el perfil se deriva del
    catálogo del giro, no de un número escrito a mano."""
    g = GIROS[m._rfcs[rfc]["giro"]]
    nmin, nmax = g.ratio_nomina
    cmin, cmax = g.ratio_compras
    _nomina(m, rfc, mes_idx, fact_mensual * (nmin + (nmax - nmin) * pos_nomina))
    row = m.factura(prov, rfc, m.dia_de(mes_idx, 4), fact_mensual * (cmin + (cmax - cmin) * pos_compras),
                    g.claves[0], "PUE")
    m.pagar(row, 2)


def sembrar(m, fondo, cfg) -> Dict:
    rng = m.rng
    vecinos = fondo.por_zona["trampa"] or fondo.por_zona["libre"]
    libres = fondo.por_zona["libre"] or vecinos
    prov = fondo.proveedores["trampa"]
    trampas: List[str] = []
    rfcs: List[str] = []

    def cliente(i: int) -> str:
        return vecinos[i % len(vecinos)]

    # -----------------------------------------------------------------
    # 1. Grupo corporativo con tesorería centralizada  →  R1 + R2 (familia R)
    #    Comparte domicilio y representante y factura intercompañía en ciclo,
    #    igual que un carrusel. La diferencia está en los datos: nómina de
    #    plantilla real, compras a proveedores del giro y cada factura con su
    #    depósito en ±1 día. El dinero circula entre personas MORALES.
    # -----------------------------------------------------------------
    dom = "Blvd. Manuel Ávila Camacho 5001, Piso 12, Naucalpan"
    rep = "Alejandro Rubén Garza Treviño"
    grupo = []
    for k in range(4):
        rfc = m.alta("manufactura", date(2013, 3, 4) + timedelta(days=200 * k), 60 + 25 * k,
                     razon="Corporativo Industrial Altamar %s" % "ABCD"[k],
                     domicilio=dom, representante=rep,
                     saldo_inicial=1_800_000.0)
        grupo.append(rfc)
    for i in range(m.meses):
        for k in range(4):
            _nomina(m, grupo[k], i, 900_000 + 120_000 * k)
            row = m.factura(prov, grupo[k], m.dia_de(i, 5), 1_400_000 + 90_000 * k,
                            GIROS["manufactura"].claves[0], "PUE")
            m.pagar(row, 2)
            row = m.factura(grupo[k], cliente(i + k), m.dia_de(i, 9), 2_600_000 + 150_000 * k,
                            GIROS["manufactura"].claves[1], "PUE",
                            descripcion="Venta de producto terminado")
            m.pagar(row, 3)
        if i % 3 == 0:   # tesorería: ciclo intercompañía trimestral
            base = 3_100_000.0
            for k in range(4):
                a, b = grupo[k], grupo[(k + 1) % 4]
                if m.intradia:
                    # TRAMPA DE T2(a): el ERP del grupo timbra TODO el cierre
                    # intercompañía en una sola corrida nocturna, así que
                    # A→B→C→D son 3 facturas encadenadas en 6 minutos. T2
                    # dispara y tiene razón en disparar: lo que la separa del
                    # carrusel no es la hora, es que hay nómina de plantilla,
                    # compras al giro y depósito por factura. Sin este falso
                    # positivo T2 no tendría nada que descartar.
                    f = m.dia_de(i, 11)
                    hora, minuto = m.rafaga(k, 4, hora_inicio=20, minuto_inicio=15,
                                            minutos_totales=6)
                else:
                    f, hora, minuto = m.dia_de(i, 11 + k * 4), None, None
                row = m.factura(a, b, f, base * (1 - 0.04 * k),
                                GIROS["manufactura"].claves[2], "PUE",
                                descripcion="Servicios intercompañía de maquila",
                                hora=hora, minuto=minuto)
                m.pagar(row, 1)
    for rfc in grupo:
        m.gt(rfc, False, None, True,
             "grupo corporativo con tesorería centralizada: comparte domicilio y representante y "
             "opera en ciclo intercompañía, pero tiene nómina, compras y pagos verificables"
             + (". El cierre intercompañía se timbra en una sola corrida del ERP (4 facturas "
                "encadenadas en 6 minutos): es la trampa de T2(a), ráfaga legítima"
                if m.intradia else ""))
    rfcs.extend(grupo)
    trampas.append("grupo_corporativo")

    # -----------------------------------------------------------------
    # 2. Comercializadora de margen delgado  →  se parece a F2 y NO dispara
    #    Rota casi todo lo que entra (ratio ≥ 0.9) pero el dinero sale a
    #    personas MORALES: pct_salidas_a_fisicas ≈ 0.06.
    # -----------------------------------------------------------------
    com = m.alta("comercializadora", date(2016, 7, 12), 14,
                 razon="Abastecedora Peninsular de Insumos", saldo_inicial=120_000.0)
    for i in range(m.meses):
        entradas = 0.0
        for j in range(4):
            row = m.factura(com, cliente(i + j), m.dia_de(i, 3 + j * 5), 620_000 + 40_000 * j,
                            GIROS["comercializadora"].claves[0], "PUE",
                            descripcion="Venta de insumos")
            m.pagar(row, 2)
            entradas += float(row["_total"])
        rowc = m.factura(prov, com, m.dia_de(i, 6), entradas * 0.88,
                         GIROS["comercializadora"].claves[1], "PUE")
        m.pagar(rowc, 3)
        m.movimiento(m.clabe_de(com), m.clabe_de(cliente(i)), m.dia_de(i, 21), entradas * 0.06,
                     "spei", "PAGO PROVEEDOR")
        m.movimiento(m.clabe_de(com), m.cuentas[0]["clabe"], m.dia_de(i, 23), entradas * 0.02,
                     "spei", "GASTOS")
        _nomina(m, com, i, entradas * 0.05)
    m.gt(com, False, None, True,
         "margen delgado: rota más del 90% de lo que entra, pero a personas morales con compras "
         "reales al giro; F2 exige que la salida sea a físicas o efectivo")
    rfcs.append(com)
    trampas.append("comercializadora_margen_delgado")

    # -----------------------------------------------------------------
    # 3. Startup con pico de facturación  →  T1 (familia T, una sola)
    #    Alta reciente, pico trimestral y pausa tras terminar el proyecto:
    #    idéntico perfil temporal que un EFOS. La diferencia: nómina real y
    #    creciente, y compras. D2 no dispara porque su ratio de nómina está
    #    por encima del p10 de su giro.
    # -----------------------------------------------------------------
    startup = m.alta("tecnologia", m.mes_ventana(0)[0] + timedelta(days=5), 12,
                     razon="Plataforma Kuali Labs", saldo_inicial=300_000.0)
    for i in range(0, 9):
        _nomina(m, startup, i, 140_000 + 22_000 * i)          # la nómina crece mes a mes
        row = m.factura(prov, startup, m.dia_de(i, 4), 90_000 + 10_000 * i,
                        GIROS["tecnologia"].claves[0], "PUE")
        m.pagar(row, 2)
    for i in (5, 6, 7):                                       # pico del proyecto
        for j in range(3):
            row = m.factura(startup, cliente(i + j), m.dia_de(i, 6 + j * 6), 1_250_000,
                            GIROS["tecnologia"].claves[1], "PUE",
                            descripcion="Entregable de plataforma, hito %d" % (j + 1))
            m.pagar(row, 4)
    for i in (0, 1, 2, 3, 4):                                 # antes del pico: facturación chica
        row = m.factura(startup, cliente(i), m.dia_de(i, 12), 120_000,
                        GIROS["tecnologia"].claves[1], "PUE")
        m.pagar(row, 5)
    m.atributo(startup, "contrato", "CONTRATO-KUALI-2025-118", "documental")
    m.gt(startup, False, None, True,
         "startup con un proyecto grande: mismo perfil temporal que un EFOS (alta reciente, pico, "
         "pausa) pero con nómina creciente, compras y contrato registrado")
    rfcs.append(startup)
    trampas.append("startup_pico")

    # -----------------------------------------------------------------
    # 4. Consultoría con montos redondos  →  D3 (segunda entrega)
    #    Hoy no dispara ninguna pista implementada: queda documentada para que
    #    la métrica de D3 tenga su cohorte cuando D3 exista.
    # -----------------------------------------------------------------
    cons = m.alta("consultoria", date(2015, 2, 9), 18, razon="Consultoría Estratégica Meridiano",
                  saldo_inicial=450_000.0)
    for i in range(m.meses):
        _perfil_mensual(m, cons, i, 5 * 150_000, prov)
        for j in range(5):
            row = m.factura(cons, cliente(i * 5 + j), m.dia_de(i, 7 + j * 4), 150_000.0,
                            GIROS["consultoria"].claves[1], "PUE",
                            descripcion="Honorarios de consultoría, mensualidad")
            m.pagar(row, 3)
    m.gt(cons, False, None, True,
         "montos redondos e idénticos mes a mes, pero con clientes diversificados y cada factura "
         "empatada con su depósito (cohorte de la futura D3)")
    rfcs.append(cons)
    trampas.append("consultoria_montos_redondos")

    # -----------------------------------------------------------------
    # 5. Despacho contable que comparte domicilio y email con sus clientes
    #    →  R1 y nada más. Es la trampa que más se parece a un cluster de
    #    prestanombres, y el discriminador es medible: NO se facturan entre sí
    #    (se_facturan_entre_si = false, pct_monto_interno = 0).
    # -----------------------------------------------------------------
    dom_d = "Av. Insurgentes Sur 1602, Despacho 402, Benito Juárez"
    mail_d = "recepcion@despacho-mirasol-sintetico.mx"
    despacho = m.alta("despacho_contable", date(2011, 6, 1), 22,
                      razon="Despacho Mirasol y Asociados", domicilio=dom_d, email=mail_d,
                      saldo_inicial=260_000.0)
    domiciliados = [despacho]
    for k in range(3):
        rfc = m.alta(ORDEN_GIRO_CLIENTE[k], date(2017, 4, 3) + timedelta(days=150 * k), 9 + k,
                     razon="Servicios Domiciliados Mirasol %d" % (k + 1),
                     domicilio=dom_d, email=mail_d, saldo_inicial=180_000.0)
        domiciliados.append(rfc)
    for i in range(m.meses):
        for idx, rfc in enumerate(domiciliados):
            g = GIROS[m._rfcs[rfc]["giro"]]
            _perfil_mensual(m, rfc, i, 3 * (150_000 + 30_000 * idx), prov)
            for j in range(3):
                # cada uno factura HACIA FUERA del grupo: ni el despacho factura
                # a sus domiciliados ni los domiciliados entre sí
                row = m.factura(rfc, cliente(i * 7 + j + idx * 2), m.dia_de(i, 8 + j * 5),
                                150_000 + 30_000 * idx, g.claves[1 % len(g.claves)], "PUE",
                                descripcion="Servicios profesionales del mes")
                m.pagar(row, 3)
    for rfc in domiciliados:
        m.gt(rfc, False, None, True,
             "domicilio fiscal y correo compartidos con el despacho que los atiende; no se "
             "facturan entre sí ni hay flujo de dinero interno")
    rfcs.extend(domiciliados)
    trampas.append("despacho_contable")

    # -----------------------------------------------------------------
    # 6. Empresa que estuvo en 69-B y quedó desvirtuada  →  E1 NO la marca
    #    El estatus vigente es el de la última publicación; acreditó
    #    materialidad y sus facturas son válidas.
    # -----------------------------------------------------------------
    desv = m.alta("transporte", date(2014, 9, 22), 38, razon="Autotransportes Valle Sereno",
                  saldo_inicial=520_000.0)
    for i in range(m.meses):
        _perfil_mensual(m, desv, i, 4 * 420_000, prov)
        for j in range(4):
            row = m.factura(desv, cliente(i * 3 + j), m.dia_de(i, 8 + j * 4), 420_000,
                            GIROS["transporte"].claves[1], "PUE",
                            descripcion="Servicio de autotransporte de carga")
            m.pagar(row, 3)
    m.lista_sat(desv, "presunto", date(2024, 3, 18), "500-05-2024-EFOS-0071")
    m.lista_sat(desv, "desvirtuado", date(2024, 11, 25), "500-05-2024-DESV-0071")
    m.gt(desv, False, None, True,
         "estuvo publicada como presunta y desvirtuó: el último estatus publicado antes del corte "
         "es 'desvirtuado', así que E1 no la marca")
    rfcs.append(desv)
    trampas.append("desvirtuado_69b")

    # -----------------------------------------------------------------
    # 7. Factoraje real  →  F1 (familia F, una sola)
    #    El PUE no tiene depósito del receptor porque quien pagó fue el factor
    #    financiero. Hay contrato registrado en atributos_entidad y el
    #    movimiento existe, sólo que sale de otra cuenta: la conciliación
    #    automática falla y la explicación es verificable.
    # -----------------------------------------------------------------
    factor = m.alta("comercializadora", date(2012, 1, 16), 30,
                    razon="Factoraje Financiero Puente Sur", saldo_inicial=6_000_000.0)
    fact = m.alta("construccion", date(2015, 8, 5), 45, razon="Edificaciones Torre Alba",
                  saldo_inicial=700_000.0)
    for i in range(m.meses):
        _nomina(m, fact, i, 480_000)
        _nomina(m, factor, i, 400_000)
        row = m.factura(prov, fact, m.dia_de(i, 4), 300_000, GIROS["construccion"].claves[0], "PUE")
        m.pagar(row, 2)
        row = m.factura(prov, factor, m.dia_de(i, 4), 60_000,
                        GIROS["comercializadora"].claves[0], "PUE")
        m.pagar(row, 2)
        for j in range(5):
            row = m.factura(fact, cliente(i * 4 + j), m.dia_de(i, 6 + j * 4), 890_000,
                            GIROS["construccion"].claves[1], "PUE",
                            descripcion="Estimación de obra %d" % (j + 1))
            if j < 2:
                m.pagar(row, 4)                       # cobro directo
            else:
                # el factor adelanta el 96% y cobra después al cliente:
                # no hay depósito del receptor a ±2%, F1 lo detecta
                m.movimiento(m.clabe_de(factor), m.clabe_de(fact), row["_fecha_date"] +
                             timedelta(days=1), float(row["_total"]) * 0.96, "spei",
                             "ANTICIPO FACTORAJE")
    m.atributo(fact, "contrato_factoraje", "CF-2025-0442 / Factoraje Financiero Puente Sur",
               "documental")
    m.atributo(fact, "factor_financiero", factor, "documental")
    m.gt(fact, False, None, True,
         "factoraje con contrato: el pago existe y llega en 1 día, pero de la cuenta del factor, "
         "no de la del receptor; F1 no puede conciliarlo y la defensa sí puede acreditarlo")
    m.gt(factor, False, None, True, "entidad financiera que adelanta las facturas cedidas")
    rfcs.extend([fact, factor])
    trampas.append("factoraje_real")

    # -----------------------------------------------------------------
    # 8. Estacionalidad fuerte de diciembre  →  T2 (segunda entrega)
    #    El pico de diciembre existe también en el diciembre ANTERIOR: por eso
    #    el generador produce 12 meses extra de historial fuera de la ventana
    #    de 12 meses, y el manifiesto lo declara.
    # -----------------------------------------------------------------
    dic = m.alta("restaurante", date(2012, 11, 7), 40, razon="Banquetes Nochebuena del Centro",
                 saldo_inicial=380_000.0)
    for i in range(-m.meses, m.meses):
        mes = m.mes_ventana(i)[0].month
        factor_mes = 3.4 if mes == 12 else (1.5 if mes == 11 else 1.0)
        _perfil_mensual(m, dic, i, 3 * 210_000 * factor_mes, prov)
        for j in range(3):
            row = m.factura(dic, cliente(i * 2 + j), m.dia_de(i, 9 + j * 5), 210_000 * factor_mes,
                            GIROS["restaurante"].claves[1], "PUE",
                            descripcion="Servicio de banquetes")
            m.pagar(row, 3)
    m.gt(dic, False, None, True,
         "pico de diciembre presente también en el diciembre anterior: el historial de 24 meses es "
         "la evidencia que permite refutar la futura T2")
    rfcs.append(dic)
    trampas.append("estacionalidad_diciembre")

    m.notas.append("La trampa de diciembre tiene 24 meses de historial; la ventana evaluable "
                   "sigue siendo de %d meses cerrada en fecha_corte." % m.meses)
    # -----------------------------------------------------------------
    # 9. Cadena de suministro de proyecto único  →  T1 + T2(a), familia T
    #    SÓLO con --horario intradia (gen-v2): la pierna (a) de T2 exige hora
    #    de timbrado.
    #
    #    Cuatro empresas constituidas para UNA obra: proveedor de materia
    #    prima → maquilador → distribuidor → integrador. Cada estimación de
    #    fase se timbra en una sola corrida del administrador del proyecto,
    #    así que las tres facturas intra-consorcio salen en 6 minutos: son 3
    #    saltos encadenados y T2(a) dispara. Y como se constituyeron hace
    #    menos de 12 meses, facturan todo en un trimestre y después se
    #    quedan en silencio, T1 dispara también.
    #
    #    ESTO ES EL DIFERENCIAL baseline-vs-selector: dos pistas de UNA sola
    #    familia. El baseline de dos pistas las marca; el selector de dos
    #    familias las excluye. No se recupera quitando una co-ocurrencia
    #    legítima, se recupera añadiendo un comportamiento que ocurre.
    #
    #    Lo que la hace legítima Y refutable, en datos, no en intuición:
    #      * nómina de plantilla en cada eslabón (T1 publica nomina_12m);
    #      * compras al giro por `_perfil_mensual` (D2 no dispara);
    #      * cada factura con su depósito del receptor a ±2% (F1 y F3 no);
    #      * margen que SUBE en cada salto, como en una cadena real: no hay
    #        decremento del 3-10% (la pierna de cadena de R2 pide eso Y ≥4
    #        saltos; aquí son 3) ni ciclo que regrese al origen (R2/F4);
    #      * NO comparten domicilio, representante ni email (R1 pide ≥3 RFC
    #        con un atributo común);
    #      * el integrador cierra con 3 dueños de obra distintos, y R3 exige
    #        ≥4 contrapartes justo porque con menos la concentración es
    #        trivialmente del 100% y no dice nada.
    #
    #    Si el selector de dos familias llegara a marcarla, la trampa está
    #    mal sembrada y hay que decirlo, no mover el umbral.
    # -----------------------------------------------------------------
    if m.intradia:
        # GIRO: comercializadora, NO el de la tipología `capas` (construcción).
        # Medido: con el consorcio en construcción ese giro llegaba a 9 de 17
        # RFC en ráfaga (0.53) y la guarda relativa al giro de db/019 —que
        # existe justamente para eso— suprimía la pierna (a) en TODO el giro,
        # incluida la tipología `capas`. Es decir: la trampa tapaba al fraude.
        # Comercializadora tiene 16 pares y ninguno en ráfaga, así que el
        # consorcio queda en 4/20 = 0.20 y ni se suprime ni suprime a nadie.
        # Se movió el giro, NO el umbral de la pista.
        alta_p = m.mes_ventana(4)[0]          # constituidas dentro de los 12 meses
        consorcio = []
        perfil = (
            ("Abastos Industriales del Valle de Toluca", 26, 1_840_000.0),
            ("Ensamble y Habilitado Estructural Toluca", 34, 2_310_000.0),
            ("Distribución Logística de Obra Toluca", 18, 2_690_000.0),
            ("Integradora de Suministro Toluca", 41, 3_180_000.0),
        )
        claves_c = GIROS["comercializadora"].claves
        for k, (razon, empleados, _) in enumerate(perfil):
            # Sin domicilio/representante/email compartidos: R1 necesita ≥3
            # RFC con un atributo común y aquí cada uno lleva el suyo.
            rfc = m.alta("comercializadora", alta_p + timedelta(days=9 * k), empleados,
                         razon=razon, saldo_inicial=260_000.0 + 40_000.0 * k)
            consorcio.append(rfc)
        adjudicatarios = [cliente(i) for i in (2, 17, 29)]   # 3 < 4: R3 no aplica
        for fase, i in enumerate((5, 6, 7)):
            # Las tres facturas intra-consorcio, en una sola corrida del
            # administrador del proyecto: 3 saltos en 6 minutos, crecientes.
            for k in range(3):
                hora, minuto = m.rafaga(k, 3, hora_inicio=18, minuto_inicio=5,
                                        minutos_totales=6)
                row = m.factura(
                    consorcio[k], consorcio[k + 1], m.dia_de(i, 14), perfil[k][2] * (1 + 0.03 * fase),
                    claves_c[k % len(claves_c)], "PUE",
                    descripcion="Suministro %d de la fase %d del proyecto" % (k + 1, fase + 1),
                    hora=hora, minuto=minuto)
                m.pagar(row, 2)               # depósito del receptor: F1 concilia
            # El integrador cierra con el adjudicatario otro día: así la
            # cadena de la ventana son 3 saltos y no arrastra a un tercero.
            row = m.factura(consorcio[3], adjudicatarios[fase], m.dia_de(i, 22),
                            perfil[3][2] * (1 + 0.03 * fase),
                            claves_c[1], "PUE",
                            descripcion="Entrega de la fase %d del suministro" % (fase + 1))
            m.pagar(row, 5)
            for k in range(4):
                _perfil_mensual(m, consorcio[k], i, perfil[k][2], prov)
        # La obra termina: la plantilla se liquida en los dos meses siguientes
        # y ya no se emite ningún CFDI de ingreso. Eso es el silencio que ve
        # T1, y la nómina es lo que permite refutarla.
        for i in (8, 9):
            for k in range(4):
                _nomina(m, consorcio[k], i, perfil[k][2] * 0.18)
        notas_consorcio = (
            "cadena de suministro de proyecto único: cuatro comercializadoras constituidas para un solo proyecto "
            "que timbran cada estimación de fase en una sola corrida del administrador (3 saltos "
            "en 6 minutos → T2) y concentran toda su facturación en un trimestre antes de "
            "liquidar la plantilla (→ T1). Dos pistas de UNA familia: el baseline de dos pistas "
            "la marca, el selector de dos familias no. Se refuta con nómina de plantilla, "
            "compras al giro, depósito del receptor por factura y margen creciente por salto "
            "(no hay decremento ni ciclo)")
        for k, rfc in enumerate(consorcio):
            papel = ("proveedor de materia prima", "maquilador", "distribuidor",
                     "integrador")[k]
            m.gt(rfc, False, None, True, "%s — %s" % (papel, notas_consorcio))
        rfcs.extend(consorcio)
        trampas.append("cadena_suministro_proyecto")

    m.notas.append("El despacho contable dispara sólo R1: no entra por el selector de dos "
                   "familias y se investiga con /investigar explícito (ingreso manual).")
    if m.intradia:
        m.notas.append(
            "TRAMPA 9 declarada, sólo con --horario intradia: cadena de suministro de proyecto "
            "único (4 RFC de comercializadora). Dispara T1 + T2(a), o sea DOS PISTAS DE UNA SOLA "
            "FAMILIA. Es el diferencial que separa el baseline de dos pistas del selector de dos "
            "familias, y por eso gen-v2 tiene 4 contribuyentes más que gen-v1 en el padrón: se "
            "añade, no se sustituye. Si el selector de dos familias la marcase, la trampa está "
            "mal sembrada.")
    if m.intradia:
        m.notas.append("TRAMPA DE T2(a) declarada (--horario intradia): el grupo corporativo "
                       "timbra su cierre intercompañía en una sola corrida del ERP, 4 facturas "
                       "encadenadas en 6 minutos. Es una ráfaga LEGÍTIMA y así consta en "
                       "ground_truth.csv (es_trampa_legitima=true). Con ella el grupo llega a "
                       "dos familias (R y T), así que el selector automático SÍ lo puede "
                       "seleccionar: es el falso positivo que la capa de descarte tiene que "
                       "refutar con nómina, compras al giro y depósito por factura.")

    return {"trampas": sorted(set(trampas)), "rfcs": rfcs}


# Giros de los tres clientes domiciliados en el despacho (uno por giro distinto
# para que compartan dirección sin compartir sector).
ORDEN_GIRO_CLIENTE = ("marketing", "consultoria", "tecnologia")
