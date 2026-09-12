# 04 — Datos y datasets

## La respuesta honesta

**No existe un dataset público de CFDI mexicanos con fraude etiquetado.** El SAT no lo publica por secreto fiscal y nadie más lo tiene. Cualquier equipo que diga lo contrario está usando datos sintéticos sin saberlo.

Lo que sí existe son tres piezas que, combinadas, dan lo que necesitamos:

| Fuente | Qué aporta | Real o sintético | Ground truth |
|---|---|---|---|
| **Lista 69-B del SAT** | RFC y razones sociales de EFOS reales, con estatus y fechas | Real | Parcial: sabemos quién fue determinado, no sus facturas |
| **IBM AML (Kaggle)** | Transferencias bancarias con patrones de lavado etiquetados | Sintético | Completo, por transacción |
| **Generador propio** | Universo CFDI + banco + padrón con tipologías sembradas | Sintético | Completo, por RFC |

## 1. Lista 69-B del SAT (real)

**Qué es.** El listado de contribuyentes a los que el SAT presume o determina que emitieron comprobantes por operaciones inexistentes. Cuatro listados: presuntos, definitivos, desvirtuados y sentencia favorable, más el Listado Global Definitivo del 69-B Bis.

**Campos.** RFC, nombre o razón social, estatus dentro del procedimiento, fechas de publicación y cambio de estatus, número de oficio con el que el SAT notificó la resolución.

**Volumen.** Más de 14,000 RFC acumulados. 903 EFOS definitivos solo entre enero y el 12 de junio de 2026.

**Cómo se obtiene.** Portal del SAT, sección de consultas 69-B → opción "Listado completo" (CSV/XLS). También disponible en la sección de datos abiertos de contribuyentes publicados.

**Advertencia práctica.** Algunos navegadores bloquean por defecto la descarga de `.xls` y `.zip` desde el portal del SAT. Si `curl` falla, se descarga a mano o con Claude in Chrome y se deja en `data/raw/69b.csv`. **Es una descarga única, no un pipeline.** No gastar tiempo del hackathon automatizándola.

**Para qué la usamos.**
1. Poblar el padrón del dataset generado con RFC y razones sociales reales de EFOS (le da verosimilitud al demo).
2. Alimentar la pista E1.
3. Sembrar la trampa legítima de E1: un RFC con estatus `desvirtuado`.

**Loader:** `loaders/load_69b.py` → tabla `forense.listas_sat`.

## 2. IBM Transactions for Anti-Money Laundering (Kaggle, sintético etiquetado)

**Qué es.** Datasets sintéticos generados por IBM con un simulador multi-agente de un mundo virtual con individuos, empresas y bancos. Publicados en Kaggle bajo Community Data License Agreement.

**Patrones etiquetados.** Ocho tipologías: fan-out, fan-in, gather-scatter, scatter-gather, ciclo simple, random, bipartito y stack.

**Distribución en HI-Small** (aproximada, según literatura): fan-out 342, fan-in 318, gather-scatter 716, scatter-gather 626, ciclo 287, random 191, bipartito 263, stack 466, más ~1,968 transacciones marcadas como lavado sin patrón estructural asignado. Total ~5.07M transacciones, ~515k cuentas.

**Detalle importante: el etiquetado es transitivo.** Si A paga a B 100 de fondos ilícitos y B paga 50 de esos a C, y C paga 25 a D, las tres transferencias quedan marcadas. Eso hace que el dataset tenga un etiquetado completo que es imposible de obtener con datos reales.

**Variantes.** HI (mayor ratio de ilícitos) y LI (menor), cada una en small / medium / large. **Usar HI-Small.** Las large (176–180M transacciones) no se cargan a tiempo.

**Cómo se obtiene.**
```bash
pip install kaggle
# KAGGLE_USERNAME y KAGGLE_KEY en .env
kaggle datasets download ealtman2019/ibm-transactions-for-anti-money-laundering-aml -f HI-Small_Trans.csv
```
Si no hay cuenta de Kaggle, existe espejo en Hugging Face: `eexzzm/IBM-Transactions-for-Anti-Money-Laundering-HI-Small-Trans`.

**Para qué lo usamos.** Es una **prueba de portabilidad de la capa financiera**: ejecutar el mismo agente Financiero y las pistas F2 y F4 sobre transferencias que nosotros no sembramos. La etiqueta de lavado por transacción no demuestra por sí sola qué ciclos son fraudulentos. Solo reportar recall de ciclos si se obtuvo y verificó una fuente que identifica sus miembros; en otro caso, mostrar ciclos detectados y su solapamiento con transacciones etiquetadas. Esto no demuestra independencia absoluta ni ausencia de sobreajuste.

**Cómo se carga.** Solo tiene capa financiera: no hay CFDI, no hay padrón, no hay nómina. Por eso el loader:
- Llena `cuentas` y `movimientos`, y crea en `contribuyentes` una entidad técnica estable por clave `(banco, cuenta)`, por ejemplo `IBM:<banco>:<cuenta>`. Ese identificador permite reutilizar pistas, clusters y herramientas; no es un RFC real ni demuestra quién es el titular. Giro, fecha de alta, nómina y demás atributos desconocidos quedan `NULL`, no cero ni valores inventados. La UI distingue entidad técnica de contribuyente fiscal.
- Filtra a ~200k filas, preservando vecindades completas de los patrones seleccionados más una muestra de fondo; registra método de muestreo, semilla y archivos fuente. Si usa etiquetas para seleccionar filas, es una demostración sesgada, no una estimación del rendimiento poblacional.
- Conserva la etiqueta de lavado **por transacción**, separada de `ground_truth` por RFC, en el artefacto local `eval/input_labels_{dataset_hash}.json` o `.csv`. Incluye ID de fila fuente, `movimiento_id` estable y etiqueta; el evaluador registra el mapa entre `corrida_id`, `dataset_hash` y esos IDs, también al clonar snapshots. El artefacto es de evaluación: no se expone al runner, sus herramientas ni sus prompts. No convierte una transferencia etiquetada en una condena de su cuenta, del titular o de todos los miembros del cluster.
- **Solo F es evaluable. D/R/T/E quedan `no_evaluable`** en este adaptador. Hay timestamps y grafo bancario, pero no están implementados aquí los contratos de evidencia de las demás familias. La UI muestra el motivo por familia. Una familia no alcanza para emitir `presuncion`; el resultado insuficiente queda `no_concluyente`, no `anomalia_explicada`.
- Dentro de F, **F4 es la pista habilitada por los campos del adaptador**; esto permite buscar ciclos, no garantiza encontrarlos. F1/F3 quedan `no_evaluable` porque requieren CFDI/conciliación. F2 solo entrega comprobaciones parciales según cobertura; sin titularidad o saldo no puede confirmar su regla completa. El mismo prompt financiero recibe estas capacidades, informa lo no disponible y continúa con F4, sin inventar datos ni bloquearse al consultar una herramienta no evaluable.

La demostración conserva el algoritmo y el prompt financiero, y declara qué datos y familias faltan. Las métricas financieras se presentan por separado de las métricas fiscales por RFC.

**Loader:** `loaders/load_ibm_aml.py`.

## 3. Generador propio (`generator/gen.py`)

Es el dataset principal del demo, porque es el único con ground truth sobre las cinco tipologías **y** sobre las trampas legítimas.

### Diseño al revés

No se diseña "un universo realista" y luego se busca qué demostrar. Se diseña **desde el guion del demo**: qué casos tienen que existir para que el demo funcione, y se generan esos más un fondo verosímil.

### Parámetros

```bash
python generator/gen.py --seed 42 --n 100 --meses 12 --pct_fraude 0.12 --pct_trampas 0.08 --out data/gen/
```

Debe correr en menos de 30 segundos. Stack: Python + Faker(`es_MX`) + networkx.

`seed=42` es desarrollo/calibración. Reservar otra semilla antes de ajustar umbrales y prompts para una comprobación final sin ajustes posteriores sobre ella. Ambos perfiles deben incluir las cinco tipologías y las ocho clases de trampa; las proporciones no sustituyen esta cobertura. Registrar `fecha_corte` fija y `dataset_hash` de los archivos/manifiesto: la fecha del reloj no debe alterar el resultado de una corrida reproducible.

### Universo base

**Diez giros**, cada uno con su catálogo de `ClaveProdServ` congruentes y rangos característicos de facturación, nómina/facturación, margen y número de clientes:

comercializadora, consultoría, construcción, transporte, restaurante, manufactura, agencia de marketing, despacho contable, servicios de personal, tecnología.

**Cada contribuyente:** RFC con formato válido, razón social, giro, tipo de persona, fecha de alta, domicilio, CP, representante legal, email, teléfono, 1–2 cuentas CLABE, número de empleados (que genera CFDI de nómina mensual).

**Comportamiento legítimo:** facturas mensuales a 3–15 clientes con estacionalidad del giro; compras a proveedores del giro; PUE pagado en 0–15 días; PPD con complemento en 30–90 días; cancelaciones 1–3% con refacturación (`uuid_sustituye`).

### Tipologías sembradas

Cada una escribe `ground_truth.tipologia`:

| Tipología | Construcción |
|---|---|
| `efos_sin_sustancia` | Alta reciente, cero nómina, cero compras, facturas de "servicios de consultoría" a 5–20 EDOS por montos altos. **Variante A**: sin pago (F1 falla). **Variante B**: con pago y retorno (F2) |
| `retorno` | EDOS paga a EFOS; EFOS dispersa 90–95% en 1–5 días a personas físicas o retiros en efectivo |
| `carrusel` | 3–5 empresas del mismo cluster (comparten atributos) con ciclo A→B→C→A, montos ±5–10%, timbrado en horas, dinero que regresa (F4) o que no se mueve |
| `capas` | Cadena lineal de 4–6 saltos, monto conservado menos 3–8% por salto, fechas sincronizadas |
| `cluster_prestanombres` | 6–12 RFC con mismo representante/domicilio/email/CLABE que se facturan entre sí |

### Trampas legítimas

`ground_truth.es_trampa_legitima = true`. **Una por familia de pista, mínimo.** Son la parte más importante del generador: sin ellas no hay métrica de falsos positivos y no hay demo.

| Trampa | Pistas que dispara | Por qué es legítima |
|---|---|---|
| Grupo corporativo con tesorería centralizada | R1, F3, R2 | Tiene nómina, compras y giros congruentes; las operaciones intercompañía son reales |
| Comercializadora de margen delgado | F2 | Tiene compras reales a proveedores del giro; el dinero sale a personas morales, no físicas |
| Startup con pico de facturación | T1, D2 parcial | La nómina crece mes a mes; hay contrato de proyecto |
| Consultoría con montos redondos | D3 | Clientes diversificados; todos los pagos empatan |
| Despacho contable que comparte domicilio y email con clientes | R1 | **No se facturan entre sí** — esa es la diferencia con un cluster de prestanombres |
| Empresa que estuvo en 69-B con estatus `desvirtuado` | E1 | Acreditó materialidad; sus facturas son válidas |
| Factoraje real: PUE pagado por un tercero financiero | F3, F1 parcial | Hay contrato registrado en `atributos_entidad` |
| Empresa con estacionalidad fuerte de diciembre | T2 | El pico existe también en el año anterior |

La trampa de diciembre necesita **historial del diciembre anterior**: el generador debe producir ese contexto aunque la ventana objetivo sea de 12 meses, y registrarlo en el manifiesto. El despacho solo dispara R1 y puede no entrar por la selección automática de dos familias: para probar su defensa se solicita explícitamente con `/investigar`, registrando ingreso manual. No confundir "no seleccionado" con "investigado y explicado".

Reportar cuántas entidades y escenarios legítimos fueron generados e investigados. Si la cohorte tiene exactamente ocho entidades, un falso positivo equivale a 1/8 = 12.5%; presentar siempre conteo y porcentaje.

### Salida

```
data/gen/
  contribuyentes.csv
  cuentas.csv
  cfdi.csv
  complementos_pago.csv
  movimientos.csv
  atributos_entidad.csv
  ground_truth.csv
```

**Tamaño objetivo:** 100 contribuyentes, ~8,000 CFDI, ~10,000 movimientos, ~12 clusters candidatos.

Para probar escalabilidad en el demo hay un perfil grande: `--n 2000 --meses 24` → ~200k CFDI. No se usa para métricas (tarda), se usa para enseñar el mapa de clusters y decir "el contexto por agente es el mismo".

**Loader:** `loaders/load_gen.py`.

## Regla común a los tres

Todo dataset entra por un **loader** que primero crea una fila en `corridas`, registra `dataset_hash`, `fecha_corte` y, si copia una corrida anterior, `corrida_origen_id`. Después carga su snapshot al esquema canónico en orden de dependencias: listas SAT y contribuyentes; cuentas y atributos; CFDI; complementos y movimientos; etiquetas de evaluación. Conserva los identificadores fuente dentro de su corrida y verifica claves, conteos y cobertura antes de declararla lista.

El loader usa staging + validación + inserción transaccional; el `\copy` directo a una tabla final no sustituye ese flujo. La lista 69-B corresponde al snapshot de cada corrida. El webhook `/corrida` recibe **el `corrida_id` ya cargado** y lo procesa; no crea una corrida vacía nueva. Para comparar prompts se crea otro snapshot reproducible, vinculado mediante `corrida_origen_id`, conservando las corridas anteriores. El seed de UI vive en `db/seeds/seed_fake.sql`, se ejecuta explícitamente después de las migraciones estructurales y usa su propia corrida, separada de métricas reales.

Los agentes nunca ven CSV ni las etiquetas de `ground_truth`. Cambiar de dataset es cambiar de loader y declarar las capacidades disponibles, no modificar silenciosamente al agente.

Esa es la definición operativa de "independiente del dataset".

## Presupuesto de tiempo

Objetivo inicial: generador funcional en 3–4 horas de trabajo asistido, con validación e integración dentro del carril de datos del plan de §12; es una estimación, no una garantía. Si a las 4 horas no está listo, diagnosticar el bloqueo y reasignar un ejecutor a fixtures, loaders o validadores. Mantener las cinco tipologías, ocho trampas y perfiles de escala; completar primero el fixture contractual que permita integrar y después toda la cobertura dentro del mismo plan. No gastar el tiempo en aumentar realismo cosmético. Los casos sembrados deben ser detectables y las trampas deben tener evidencia concreta que permita refutarlas.
