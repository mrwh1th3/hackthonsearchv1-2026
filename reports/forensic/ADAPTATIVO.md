# Auditor adaptativo: método, resultados y límites

Fecha: 2026-09-12. Rama del worktree `agent-a01093fcc8c65fd0d`, partiendo de `b7cc597`.
El auditor sigue siendo determinista: 0 llamadas LLM, MXN 0, menos de 0.03 s por estate.

## Problema

El auditor daba 100% en nuestro generador y 3/10 esquemas con 1 acusación falsa en un estate de otro
generador (seed 103). La causa no eran umbrales, sino **convenciones** que el código daba por hechas:

| Convención supuesta | Lo que trae el estate externo |
|---|---|
| `purchase_orders.amount` = total con IVA | subtotal sin IVA → ninguna orden emparejaba, todo parecía "sin documentar" |
| aprobador escrito como nombre | `EMP:0022` → kickback y límites no resolvían a la persona |
| EFOS solo cuenta si es `definitivo` | fantasmas con solo `presunto`; el cierre decía, falsamente, "not on the 69-B list" |
| fraccionamiento = un aprobador | un solicitante reparte la compra entre 4 aprobadores distintos |
| round-trip = proveedor devuelve directo | empresa → proveedor A → tercero B → empresa, 2.5% de merma por salto |
| inflación de ingresos = fin de trimestre / cancelada | ventas PPD vigentes sin un solo cobro; señuelo con abonos parciales |
| una cuenta de empresa | segunda cuenta propia (traspasos de tesorería) |

## Método

### A. Perfilado (`src/auditor/profile.py`, queda en `run_log.json → estate_profile`)

Todo se deduce de montos, fechas, IDs y CLABEs del propio estate; nunca de texto libre.

| Qué | Cómo se deduce |
|---|---|
| Base de monto de la orden | Voto sobre todas las facturas de compra: la orden coincide (±0.5%, ≤45 días) con el total o con el subtotal. Gana la base con ≥80% de los votos exclusivos; ambas solo si las dos son frecuentes. Una sola base por estate: emparejar "con la que convenga" crea coincidencias espurias. |
| Formato de persona | Proporción de `approver`/`requester`/`ledger.approver` que coincide con `emp_id` o con `name`. `Estate.person()` resuelve cualquiera de los dos. |
| Cuentas de la empresa | Dominante de salida hacia proveedores (como antes) + **cuentas propias**: CLABE que no es de proveedor ni de empleado y que mueve dinero con la dominante **en ambos sentidos**. Un cliente solo paga. |
| "Alta reciente" | Cuartil inferior de la antigüedad del padrón al facturar por primera vez, con tope 180 días. En el estate externo el padrón es joven (p25 = 32 días); en el clásico queda en 180. |
| Límites de aprobación | Candidatos redondos + máximo firmado por cada aprobador. Los umbrales por densidad global se registran pero **no** se usan: salen ruidosos. |
| Cadencia de pago, estatus EFOS, métodos de venta | Registrados para el expediente; no deciden. |

### B/C. Decisión: primero exculpación, después evidencia acumulada

* **phantom_vendor.** (1) Exculpación documental: facturas con orden emparejada en la base detectada o contrato vigente; con menos de 2 sin respaldo se cierra, y el cierre dice el estatus 69-B real. (2) Puntaje sobre lo no documentado, umbral 2 (`PHANTOM_WEIGHTS`): EFOS definitivo vigente al facturar 2, presunto (o definitivo publicado después) 1, alta reciente 1, póliza de registro sin aprobador 1, lo no documentado ≥50% del valor facturado 1, cuenta del proveedor que paga a empleados 1. `presunto` corrobora aunque la publicación sea posterior (la presunción 69-B alcanza operaciones pasadas) y el texto lo dice; nunca da `proven`. El puntaje y cada señal quedan en `scoring`.
* **threshold_splitting.** Ventanas de ≥3 órdenes justo bajo un límite (85–100%) en ≤21 días que juntas lo superan, agrupadas por **(proveedor, aprobador)** y por **(proveedor, solicitante)** con ≥2 aprobadores distintos. Exculpación en modo aprobador: firmó órdenes por encima del límite. Cuota fija periódica con contrato: nunca forma ventana; el cierre lo explica. Pesos = facturas con IVA si cada orden tiene factura; si no, órdenes. Entidades: solo el RFC (el solicitante va en la narrativa).
* **round_tripping.** `graph.py` busca ciclos de 3–4 transferencias: sale de cuenta de la empresa **a un proveedor del padrón**, pasa por terceros sin tocar cuentas propias, cada salto conserva 85–100% del anterior y el ciclo cierra en ≤60 días en una cuenta de la empresa. Un traspaso entre cuentas propias no puede abrir ciclo. El ciclo directo de 2 conserva sus reglas anteriores.
* **revenue_inflation.** Cobranza = todos los cobros de terceros ligados a la factura (abonos parciales incluidos); ≥10% cobrado exculpa. Transferencias desde cuentas propias no son cobranza. Nuevo lead `uncollected_sales` (≥2 ventas vigentes vencidas sin cobro, PUE o PPD) además de fin de trimestre y cancelación.
* **kickback.** Órdenes y señal de banco compartido comparan `emp_id` resuelto, no nombre.

Regla de texto libre: una referencia bancaria que cita el UUID puede **exculpar** (probar cobro o pago), nunca corroborar una acusación.

### D. Robustez medible: `--conventions random`

`generator/forensic/estate.py --conventions random` sortea por semilla, con un RNG aparte:
base IVA de la orden, aprobador por id o nombre, límite (50k/75k/100k/120k), EFOS definitivo/presunto,
segunda cuenta propia con barridos de tesorería, y la forma de cada esquema: fantasma establecido solo
`presunto`, round-trip directo o por 3–4 saltos, fraccionamiento por aprobador o por solicitante,
inflación a fin de trimestre o PPD sin cobro. Señuelos nuevos: abonos parciales PPD, traspaso entre
cuentas propias, cuota fija con mismo solicitante y contrato marco. Sin la bandera el estate clásico es
idéntico byte a byte (verificado con `cmp` en seed 1 y en la prueba unitaria).

`eval/forensic/harness.py` evalúa las tres fuentes: `--conventions classic|random` y
`--external DIR…` (estate.db + ground_truth.json). La clave de seed 103 cumple
`ground_truth_schema.json` pero viene **sin** envoltorio `{"ground_truth": …}`; `load_key` acepta
ambas formas y valida campos requeridos. El emparejado de esquemas ya no cuenta el RFC de la propia
empresa como entidad compartida (aparece en todos los esquemas de ingresos y ciclos y no discrimina).

## Protocolo de semillas

| Uso | Clásico | Variantes | Externo |
|---|---|---|---|
| Ajuste | 1–5 (históricamente 1–12) | 1–5, también con `--schemes 5 --decoys 10` | seed_103 |
| Reporte (vistos solo al final) | 301–306 | 401–410 | — |

## Resultados

"Antes" = auditor de `b7cc597` sobre los mismos estates, puntuado con el mismo harness.

| Fuente | Conjunto | Recall antes | Recall después | Acusaciones falsas antes | después | Pesos concilian | Formato | Determinista |
|---|---|---|---|---|---|---|---|---|
| Clásico | ajuste 1–5 | 18/18 | 18/18 | 0/33 | 0/33 | sí | PASS | sí |
| Clásico | **held-out 301–306** | 22/22 | **22/22** | 0/41 | **0/41** | sí | PASS | sí |
| Variantes | ajuste 1–5 | 11/21 | 21/21 | 0/34 | 0/34 | sí | PASS | sí |
| Variantes | ajuste 1–5, 5 esquemas × 10 señuelos | 13/25 | 25/25 | 0/50 | 0/50 | sí | PASS | sí |
| Variantes | **held-out 401–410** | 21/40 | **39/40** | 0/77 | **0/77** | sí | PASS | sí |
| Externo | seed_103 (ajuste) | 3/10 | 10/10 | 1/10 | 0/10 | sí | PASS | sí |

CSV por fuente y conjunto: `reports/forensic/adaptive/results_{classic,variants}_{tuning,heldout}.csv`,
`results_external_tuning.csv`; detalle por semilla en `eval_summary_*.json`. Hallazgos que no
corresponden a ningún esquema: 0 en todas las corridas.

Regresión sobre los conjuntos reportados antes (docs/23), sin cambios: clásico 101–105 21/21 y 0/38;
201–205 con 5 esquemas × 10 señuelos 25/25 y 0/50; 301–302 sin fraude 0/20
(`reports/forensic/adaptive/regression_*`). Estate grande `mega_estate.py --seed 5005` (manual, no
tabulado): antes 4/6, después 5/6 (ahora detecta el round-trip triangular); 0/21 señuelos en ambos; los
dos hallazgos fantasma extra aparecen igual antes y después.

Reproducir (`data/external/seed_103` lo suministró el usuario; `data/` no está en el repo):

```bash
python3 eval/forensic/harness.py --tuning-seeds 1 2 3 4 5 --report-seeds 301 302 303 304 305 306 --out reports/forensic/adaptive
python3 eval/forensic/harness.py --conventions random --tuning-seeds 1 2 3 4 5 --report-seeds 401 402 403 404 405 406 407 408 409 410 --out reports/forensic/adaptive
python3 eval/forensic/harness.py --tuning-seeds --report-seeds --external data/external/seed_103 --out reports/forensic/adaptive
python3 -m unittest discover -s tests/auditor -v
```

## El fallo held-out (401–410), sin corregir

Seed 408: fantasma `presunto_established` **entrelazado** con un fraccionamiento sobre el mismo
proveedor. Las órdenes del fraccionamiento documentan 5 de 9 facturas; las 4 sin respaldo son <50% del
valor; alta no reciente, pólizas aprobadas, sin pagos a empleados. Solo suma `efos_presunto` = 1 < 2 y se
cierra como lead con esa explicación. No se ajustó: es semilla de reporte. Se registra como límite.

## Límites honestos

* **El generador de variantes también es nuestro.** 39/40 en 401–410 mide que las formas que
  imaginamos se detectan sin memorizar semillas, no que cubrimos las formas de los jueces. La única
  evidencia ajena es seed_103, y se usó para ajustar: su 10/10 no es un resultado held-out.
* **seed_103: "0/10" son en rigor 0/8 evaluables.** Dos señuelos de traspaso de tesorería están
  registrados con el RFC de la propia empresa, que también figura en esquemas reales; el harness excluye
  del conteo cualquier señuelo cuya entidad aparece en un esquema, así que nunca podrían contarse. El
  comportamiento sí está probado (`test_transfers_between_own_accounts_open_nothing`).
* Los señuelos nuevos casi no castigaron al auditor anterior (0 acusaciones falsas en variantes antes y
  después): la dificultad de señuelos de nuestro generador sigue siendo baja. La única acusación falsa
  real que observamos vino del estate externo.
* **Fantasma solo `presunto` entrelazado** con otro esquema del mismo proveedor puede quedar bajo el
  umbral (seed 408).
* **Cuentas propias** se reconocen solo si mueven dinero en ambos sentidos con la cuenta dominante.
  Una cuenta propia que solo recibe (p. ej. el cierre de un ciclo) se ve como tercero: el ciclo se sigue
  detectando, pero un "cobro" desde esa cuenta contaría como cobranza.
* **Round-trip** exige que el primer salto llegue a la CLABE de un proveedor del padrón y que cada salto
  conserve ≥85%. Un ciclo con más de 4 saltos, con mermas mayores, fragmentado en varias
  transferencias o de más de 60 días no se ve. Un tercero que es cliente legítimo y paga una venta real
  justo después de recibir dinero del proveedor sería un falso positivo posible (no generado).
* **Fraccionamiento** necesita ≥3 órdenes en 21 días bajo un límite candidato (redondos o tope firmado
  por aprobador). Dos órdenes, ventanas más largas o límites no redondos que nadie firma no se ven.
* **Cobranza sin referencia al UUID** y en abonos no se liga (solo un cobro de monto igual): una venta
  PPD pagada en abonos sin referencia se vería como no cobrada.
* La base de monto de la orden se decide una vez por estate; un estate que mezcle convenciones por
  proveedor quedaría con "ambas" y emparejaría con más holgura.
* Determinismo: `submission.json` y `case_file.html` son idénticos entre corridas **salvo el reloj de
  pared** (`wall_clock_seconds`); la huella `fingerprint` del run_log lo excluye y coincide.
