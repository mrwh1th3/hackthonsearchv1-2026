# /loaders — Adaptadores al esquema canónico

Todo dataset entra por un loader. Ninguno hace `\copy` directo a una tabla
final: staging → validación → carga transaccional → promoción a `lista`
(docs/04 §Regla común, docs/19 §Flujo único).

| Loader | Fuente | Estado |
|---|---|---|
| `load_gen.py` | `data/gen/` del generador propio | hecho |
| `load_69b.py` | lista 69-B real del SAT | pendiente |
| `load_ibm_aml.py` | IBM AML (HI-Small), sólo familia F | pendiente |

## load_gen.py

```sh
python3 generator/gen.py --seed 42 --n 100 --out data/gen/
python3 loaders/load_gen.py --in data/gen/ --db forense --nombre gen-v1 --reemplazar
```

Opciones: `--solo-validar` (corre todo y revierte), `--permitir-parcial`
(publica excluyendo filas rechazadas, que quedan en el informe), `--pgbin`.

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
