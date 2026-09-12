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
