# /loaders — Adaptadores al esquema canónico

Todo dataset entra por un loader. Ninguno hace `\copy` directo a una tabla
final: staging → validación → carga transaccional → promoción a `lista`
(docs/04 §Regla común, docs/19 §Flujo único).

| Loader | Fuente | Estado |
|---|---|---|
| `load_gen.py` | `data/gen/` del generador propio | hecho |
| `load_69b.py` | lista 69-B real del SAT | hecho |
| `load_ibm_aml.py` | IBM AML (HI-Small), sólo familia F | hecho |

## Prueba

```sh
PGBIN=/opt/homebrew/opt/postgresql@17/bin bash loaders/tests/run.sh
```

Base desechable + `001`/`002`/`003`, muestras de `loaders/samples/`,
**ninguna descarga**. Medido: **24 aserciones, 0 fallidas** (11 de 69-B, 13
de IBM AML). Comprueba carga, promoción a `lista`, familias no evaluables
declaradas, rechazo con mensaje que nombra la columna faltante,
idempotencia y rastro en `forense.bitacora`.

## load_gen.py

```sh
python3 generator/gen.py --seed 42 --n 100 --out data/gen/
python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1
```

Opciones: `--solo-validar` (corre todo y revierte), `--permitir-parcial`
(publica excluyendo filas rechazadas, que quedan en el informe), `--pgbin`,
`--reemplazar` (recarga **el mismo** snapshot: sólo borra una corrida que tenga
ese nombre **y** ese `dataset_hash`). Una corrida con el mismo nombre y otro
hash no se toca: puede tener casos y dictámenes colgando por cascada, y eso lo
decide una persona, no una bandera copiada de este README.

1. **Registrar entrada.** Recalcula el sha256 de cada CSV y lo compara con
   `manifest.json`: un archivo tocado después de generarse detiene la carga.
   `dataset_hash` y `fecha_corte` salen del manifiesto, nunca del reloj.
2. **Staging.** `\copy` a `stg_<hash>` con todo en `text`. Nada del CSV se
   ejecuta como SQL ni se castea antes de estar en staging.
3. **Validar.** Cada fila que falla escribe archivo, fila, código y detalle en
   `stg.rechazos`. Críticos (claves, importes, fecha posterior al corte,
   moneda distinta de MXN, dirección de flujo, duplicados, FK) bloquean la
   promoción salvo `--permitir-parcial`.
4. **Cargar** en orden de dependencias: corrida `preparando` → listas SAT y
   contribuyentes → cuentas y atributos → CFDI → complementos → movimientos →
   `ground_truth`.
5. **Validar el snapshot**: conteos reconciliados, sin huérfanos, una sola
   moneda, ninguna fecha posterior al corte y **ninguna trampa a ≤2 saltos de
   un RFC publicado como `definitivo`** (la distancia a la que marca E1).
6. **Promover** a `lista` y escribir en `forense.bitacora` dentro de la misma
   transacción. Si algo falla, se revierte entero: no queda un snapshot a
   medias visible como listo.

El `corrida_id` es determinista, `uuid5(dataset_hash | nombre)`: recargar el
mismo snapshot con `--reemplazar` reproduce el mismo id.

## Medido (base local `forense`, 2026-01-31 de corte)

`gen-v1` con `--seed 42 --n 100`: 100 contribuyentes, 140 cuentas, 8,081 CFDI,
1,787 complementos, 6,006 movimientos, 509 atributos, 4 publicaciones 69-B y
100 filas de ground truth. **0 rechazos**, 0 críticos.

## load_69b.py — lista 69-B real del SAT

```sh
python3 loaders/load_69b.py --in data/raw/69b.csv --db forense \
  --fecha-corte 2026-01-31 --saltar 0
```

Destino: **`forense.listas_sat`**. Valor para el demo: E1 cruza contra la
lista real, no sólo contra publicaciones inventadas por el generador.

**Formato de entrada esperado.** CSV con encabezado (UTF-8 o Latin-1,
separador `,` o `;`) del portal del SAT → consultas 69-B → "Listado
completo". El encabezado del portal ha cambiado varias veces, así que el
adaptador acepta sinónimos (`SINONIMOS` en el archivo) y **falla nombrando
la columna que falta**. `--saltar N` descarta el preámbulo anterior al
encabezado real.

| canónica | obligatoria | sinónimos aceptados |
|---|---|---|
| `rfc` | sí | RFC, RFC del contribuyente |
| `razon_social` | sí | Nombre del Contribuyente, Nombre/denominación o razón social, Contribuyente |
| `estatus` | sí | Estatus, Situación del contribuyente, Supuesto |
| `fecha_publicacion` | sí | Fecha de publicación, Fecha publicación DOF, Fecha de primera publicación |
| `oficio` | no | Número y fecha de oficio global de presunción/definitivos |

Estatus canónicos: `presunto`, `definitivo`, `desvirtuado`,
`sentencia_favorable`. Lo que no mapea se **conserva tal cual** y se
reporta: no se reescribe una resolución de la autoridad para que encaje.
Fechas aceptadas: `2026-01-31`, `31/01/2026`, `31-ene-2026`.

- `familias_evaluables = '{E}'`: D, F, R y T quedan **declaradas no
  evaluables** por `correr_pistas`. De esta fuente no hay CFDI ni padrón.
- `ground_truth` **vacío a propósito**: la publicación de la autoridad es
  un hecho, no una etiqueta de evaluación de nuestro detector.
- `--anexar-a <corrida_id>` sólo acepta una corrida en `preparando`; se
  niega a tocar un snapshot publicado (regla 10).

**Medido** sobre `loaders/samples/69b_muestra.csv`: 7 publicaciones
válidas, 2 rechazadas (`RFC_INVALIDO`, `FECHA_ILEGIBLE`), estatus
`definitivo=3 desvirtuado=2 presunto=1 sentencia_favorable=1`. Dos cargas
seguidas dejan 7 filas y una sola corrida.

La descarga del portal es **manual y única** (docs/04 §1): `data/raw/` está
en `.gitignore` y este repo sólo guarda la muestra sintética.

## load_ibm_aml.py — IBM AML (HI-Small), sólo familia F

```sh
python3 loaders/load_ibm_aml.py --in data/raw/HI-Small_Trans.csv --db forense \
  --fecha-corte 2026-01-31 --max-filas 200000
```

Destino: `forense.cuentas`, `forense.movimientos` y una **entidad técnica**
por `(banco, cuenta)` en `forense.contribuyentes` con identificador
`IBM:<banco>:<cuenta>`. No es un RFC y no demuestra titularidad. `giro`,
`fecha_alta`, `representante`, `email` y `telefono` quedan **NULL**: lo
desconocido no es cero ni un valor inventado.

**Formato de entrada esperado.** CSV con encabezado, tal como se descarga
de Kaggle (`ealtman2019/ibm-transactions-for-anti-money-laundering-aml`,
`HI-Small_Trans.csv`) o del espejo de Hugging Face.

| canónica | obligatoria | sinónimos aceptados |
|---|---|---|
| `timestamp` | sí | Timestamp, Date, Datetime |
| `banco_origen` | sí | From Bank, Sender Bank |
| `cuenta_origen` | sí | Account, From Account, Sender Account |
| `banco_destino` | sí | To Bank, Receiver Bank |
| `cuenta_destino` | sí | Account.1, To Account, Account 1 |
| `monto_recibido` | sí | Amount Received, Amount |
| `moneda_recibida` | sí | Receiving Currency, Currency |
| `monto_pagado` | no | Amount Paid |
| `moneda_pagada` | no | Payment Currency |
| `formato` | no | Payment Format |
| `etiqueta` | no | Is Laundering, Label |

> **Procedencia, sin suavizar.** Esta lista está **declarada** a partir de
> docs/04 §2 y del esquema publicado del dataset; **no está verificada
> contra el `HI-Small_Trans.csv` real**, que no está en el repo y no se
> descarga desde aquí. Si el archivo real trae otro encabezado, el
> adaptador falla nombrando la columna que falta y se amplía `SINONIMOS`.
> `loaders/samples/ibm_aml_muestra.csv` es sintética y la escribí con ese
> esquema.

**Capacidades declaradas.** `modo = 'exploratorio_financiero'`,
`familias_evaluables = '{F}'`, y el loader **persiste** con
`marcar_no_evaluable` y motivo por escrito: `D1 D2 D3 D4 R1 R2 R3 T1 T2 E1
F1 F3` (12 códigos). `F4` es la pista habilitada —permite **buscar**
ciclos, no garantiza encontrarlos—; `F2` queda con cobertura **parcial**
declarada (se ve el flujo, no la titularidad ni el saldo). Una sola familia
no alcanza para `presuncion`: el resultado insuficiente es
`no_concluyente`. Ausencia de señal no es ausencia de fraude.

**La etiqueta de lavado no entra a la base.** `Is Laundering` es por
transacción y se exporta a `eval/input_labels_<dataset_hash>.csv` con
`fila_fuente`, `movimiento_id`, `corrida_id` y `dataset_hash`.
`forense.ground_truth` (que es por RFC) se queda vacío. Una transferencia
etiquetada no condena a su cuenta ni a su titular.

**Muestreo.** `--max-filas` recorta por orden de aparición (método
`cabecera`), determinista y **sin usar la etiqueta**; queda registrado en
`corridas.notas` y en bitácora. Si algún día se muestrea por etiqueta, eso
es una demostración sesgada y no una estimación poblacional.

**Moneda.** Se conserva la del origen; **no** se convierte a MXN. Las filas
con moneda de recepción distinta de la de pago se rechazan con
`MONEDA_CRUZADA`: los importes de una operación de cambio no son
comparables.

**Medido** sobre `loaders/samples/ibm_aml_muestra.csv` (19 filas): 15
movimientos, 12 entidades técnicas, 4 rechazos
(`FECHA_POSTERIOR_AL_CORTE`, `CUENTA_O_BANCO_VACIO`, `IMPORTE_NO_POSITIVO`,
`MONEDA_CRUZADA`), 12 códigos de pista declarados no evaluables. Dos cargas
seguidas dejan los mismos 15 movimientos.

**Pendiente para el coordinador** (dueño de `.gitignore`): añadir
`eval/input_labels_*.csv`. Es un artefacto generado de evaluación y no debe
viajar en el repo.
