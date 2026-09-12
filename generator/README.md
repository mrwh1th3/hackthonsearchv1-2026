# /generator — Generador de dataset sintético

```sh
python3 generator/gen.py --seed 42 --n 100 --meses 12 --out data/gen/
```

Produce `data/gen/{contribuyentes,cuentas,cfdi,complementos_pago,movimientos,atributos_entidad,listas_sat,ground_truth}.csv`
más `manifest.json` con `dataset_hash`, semilla, `fecha_corte`, versiones,
cobertura e invariantes. `data/gen/` está en `.gitignore`: el entregable es el
código, el dataset se regenera.

| Archivo | Contenido |
|---|---|
| `giros.py` | 10 giros con ClaveProdServ, rangos de facturación/nómina/compras y estacionalidad |
| `tipologias.py` | Las 5 tipologías sembradas (docs/04) |
| `trampas.py` | Las 8 trampas legítimas (docs/04) |
| `gen.py` | Mundo, universo de fondo, verificación de invariantes, CSV y manifiesto |

## Propiedades

- **Determinista.** Misma semilla + mismo `--fecha-corte` ⇒ mismo `dataset_hash`.
  La hora del reloj no entra en ningún cálculo.
- **Semilla reservada.** `--seed 20260211` se rechaza sin `--holdout`: es la
  comprobación final sin ajustes posteriores (docs/04 §Parámetros).
- **Invariantes verificadas antes de escribir** (`gen.py:verificar`, con networkx):
  1. ninguna trampa a <3 saltos de un RFC `definitivo` (E1 marca a ≤2 saltos, y
     una segunda familia gratis rompería la regla de dos familias). **Se cumple
     por construcción, no por margen medido**: el fondo opera por zonas
     disjuntas y las trampas nunca tocan la zona de los EDOS, así que en el
     grafo CFDI no hay camino alguno (distancia ∞ para las 15). El corolario
     honesto es que *este* dataset no ejercita la expansión de 2 saltos de E1
     contra una trampa; medir eso necesita un dataset con las zonas conectadas;
  2. como mucho un contribuyente sin compras por giro (con dos, el p10 del giro
     cae a 0 y D2 no puede disparar nunca en ese giro);
  3. todo contribuyente con CLABE (F1 exige titularidad de ambas cuentas);
  4. sin complementos huérfanos ni CLABE inexistente en movimientos;
  5. ninguna fecha posterior al corte.
- **Ground truth aparte.** `ground_truth.csv` no se mezcla con los hechos; el
  loader lo deja en `forense.ground_truth`, fuera del alcance de las herramientas.
- **Texto libre hostil a propósito.** Una `descripcion` contiene instrucciones
  inyectadas. Ninguna pista lee texto libre; el runtime tampoco lo obedece.
- Datos sintéticos: RFC, razones sociales y publicaciones 69-B inventados. No se
  atribuye a personas o empresas reales ninguna operación.

## Medido

`--seed 42 --n 100 --meses 12` → 100 contribuyentes, 8,081 CFDI, 6,006
movimientos, 1,787 complementos, 549 atributos, 0.5 s (objetivo: < 30 s).

## Resolución intradía (`--horario`) — gen-v1 vs gen-v2

```sh
python3 generator/gen.py --seed 42 --n 100 --out data/gen/                    # gen-v1
python3 generator/gen.py --seed 42 --n 100 --horario intradia --out data/v2/  # gen-v2
```

`--horario plano` es el **DEFAULT y no cambia**: `gen-v1` está cargado en la
base compartida y las aserciones `db/tests/assertions_*_gen.sql` miden sobre
esa corrida. `--horario intradia` produce `gen-v2`.

**Por qué existe.** Con todo a las 10:30, la pierna (a) de **T2**
(sincronía, cadena de ≥3 facturas en una ventana corta) es *no evaluable por
construcción*: «menos de 6 horas» equivale a «el mismo día». Una de las 14
pistas no se podía medir.

| | `plano` (gen-v1) | `intradia` (gen-v2) |
|---|---|---|
| emisiones legítimas | todas 10:30 | `PESOS_HORA` 8:00–21:00, dos picos y cola de cierre; minuto uniforme |
| `capas` | 4 saltos en 20 días | 4 saltos en **6 min**, mismo día y **mismo mes** que en gen-v1 |
| `carrusel` | ciclo en días | ciclo en **6 min** (3 nodos → 2 saltos: T2(a) no lo captura, y es deliberado) |
| trampa de T2(a) | — | el **grupo corporativo** timbra su cierre intercompañía en una corrida del ERP: 4 encadenadas en 6 min. Ráfaga **legítima**, declarada en `ground_truth` |
| trampa 9 (nueva) | — | **cadena de suministro de proyecto único**: 4 comercializadoras, 3 saltos en 6 min → T2, alta reciente + trimestre único + silencio → T1. **Dos pistas de UNA familia** |
| contribuyentes del padrón | 100 | **104** (la trampa 9 se **añade**, no sustituye) |
| horas distintas en `cfdi` | 1 | 818 |
| `dataset_hash` | `17a3e1ceb787d56d…` | cambia con la versión de las ráfagas |

**Cómo se garantiza que gen-v1 no se movió.** El azar de la hora sale de un
`random.Random` **aparte** (`Mundo.rng_hora`, sembrado con
`"hora|<seed>|<fecha_corte>"`) que en modo `plano` **no se consume ni una
vez**; la aleatorización vive en `factura()`, no en `ts()`, así que
`cuenta()`, `complemento()` y `cancelar()` conservan su hora fija. Medido:

1. los 8 CSV regenerados con el código nuevo en modo `plano` tienen el
   **mismo sha256** que los del código anterior, archivo por archivo;
2. el `dataset_hash` reproducido es
   `17a3e1ceb787d56df08534c501284c9eb33a72bc143cc2f6c0a0ab2a73581778`, el
   mismo que tiene cargada la corrida `gen-v1` de la base compartida;
3. cargado en una base **desechable**, los conteos por tabla y por tipología
   salen idénticos a los de esa corrida (diff vacío), y el `corrida_id`
   determinista coincide: `3fc52b5a-3e4b-54f4-a714-b3303b6f0347`;
4. `gen-v2` difiere de `gen-v1` **sólo en la columna `cfdi.fecha`**: 8047
   filas cambian de hora y 19 de día (las tres ráfagas). Mismo padrón, mismas
   cuentas, mismos importes (`sum(total)` idéntico).

`gen-v2` entra **siempre como corrida nueva**, con su nombre, su
`dataset_hash` y su `fecha_corte`. La corrida `gen-v1` no se toca.

### El diferencial baseline-vs-selector, medido sobre gen-v2

La trampa 9 existe por una razón medible: con T2 evaluable, el **grupo
corporativo** pasa a dos familias (R+T) y entra al selector, así que el
baseline de dos pistas y el selector de dos familias quedaban **idénticos** y
se perdía el argumento de que exigir dos FAMILIAS filtra mejor que exigir dos
pistas. No se recupera borrando la ráfaga del grupo —un grupo real comparte
domicilio **y** timbra en lote; quitar esa co-ocurrencia sería medir un
dataset más fácil— sino añadiendo un comportamiento que también ocurre: una
cadena de suministro legítima que timbra su cierre en una sola corrida y
dispara **dos pistas de una sola familia**.

| gen-v2 (104 RFC · 17 fraude · 19 trampas) | sin trampa 9 | **con trampa 9** |
|---|---|---|
| baseline dos pistas — TP/FP/FN/TN | 17/8/0/75 | 17/**12**/0/75 |
| baseline — precisión | 68.0% | **58.6%** |
| baseline — FPR sobre trampas | 4/19 = 21.1% | **8/19 = 42.1%** |
| selector dos familias — TP/FP/FN/TN | 17/8/0/75 | 17/8/0/**79** |
| selector — precisión | 68.0% | **68.0%** |
| selector — FPR sobre trampas | 4/19 = 21.1% | **4/19 = 21.1%** |

El baseline **sube** y el selector **no se mueve**: el selector vuelve a ser
estrictamente mejor (68.0% vs 58.6% de precisión, la mitad de falsos
positivos sobre trampas). Los 4 RFC del consorcio salen con
`codigos = T1,T2`, `familias = 1` y `score_entidad = false`: verificado, no
supuesto. Si el selector llegara a marcarlos, la trampa estaría mal sembrada.

**Colisión medida y resuelta moviendo el giro, no el umbral.** El primer
intento puso el consorcio en *construcción*, el giro de la tipología `capas`.
Resultado: 9 de 17 RFC del giro en ráfaga (0.53) y la guarda relativa al giro
de `db/019_pista_t2.sql` —que existe justamente para eso— suprimió la pierna
(a) en **todo** el giro, `capas` incluida: la trampa tapaba al fraude.
Comercializadora tiene 16 pares y ninguno en ráfaga, así que el consorcio
queda en 4/20 = 0.20. Se movió el giro; el umbral de la pista no se tocó.
