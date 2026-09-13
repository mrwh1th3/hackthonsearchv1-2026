# Agente de estructura, entrada multi-formato y fraud_flag

Fecha: 2026-09-13. Rama `worktree-agent-af0a48e067e754c99`, partiendo de `8ffb88e`. Tablas en
`reports/forensic/structure/`.

## Problema

Los jueces generan estates "según `estate_schema.sql`" con su propio generador. El auditor suponía la
estructura exacta: nombres de tabla y columna, tipos y formatos. Una columna `rfc_emisor` en vez de
`issuer_rfc`, o un monto `"$92,800.00"`, bastaba para romper la corrida o, peor, para dar resultados malos
sin avisar.

## Arquitectura (`src/auditor/structure/`)

Corre antes de cargar `Estate`: `prepare(path, llm, work_dir)` → `Estate(path, conn=prep.conn)`.

1. **Formato** (`ingest.py`). Se detecta por contenido: cabecera `SQLite format 3`, ZIP con `xl/workbook.xml`
   (XLSX), ZIP con CSV/XLSX dentro, directorio de CSV o CSV suelto. Todo lo que no es SQLite se carga en
   `DIR/staging.db`:
   - una tabla por archivo u hoja, con todos los valores como TEXT crudo;
   - `_ingest_sources` guarda codificación, delimitador, fila de encabezado y filas omitidas;
   - `_ingest_suspect_cells` guarda las celdas numéricas de Excel con más dígitos de los que conserva un double.

   El CSV detecta codificación (utf-8, BOM, cp1252, latin-1) y delimitador (`, ; tab |`). Omite títulos y filas
   en blanco antes del encabezado, y también columnas y filas vacías al final.

   El XLSX se lee solo con la stdlib (zipfile + XML). Maneja sharedStrings, fechas seriales 1900/1904, celdas
   combinadas y hojas ocultas o vacías. openpyxl no se usa.
2. **Inspección** (`mapper.inspect_db`). Lee tablas, columnas y tipos, más una muestra fija de 200 filas por
   tabla. El costo de mapear no crece con el dataset.
3. **Mapeo determinista**. Para cada par (columna canónica, columna original) se calcula un puntaje:
   - nombre normalizado: minúsculas, sin acentos, snake_case, CamelCase aplanado, prefijo de tabla y sinónimos
     es/en de `schema.py`;
   - firma de valores: RFC, CLABE, UUID/ids, EMP, fechas, montos y catálogos PUE/PPD, estatus y forma de pago;
   - relaciones, en ambos sentidos: `invoices.issuer_rfc ∈ vendors.rfc`, `ledger.invoice_uuid ∈ invoices.uuid`
     (decide cuál de `id` / `invoice_id` es el UUID), `bank_txns.to_clabe ∈ vendors.bank_clabe`, etc.

   La asignación es 1:1 con umbral mínimo. `subtotal + iva = total` desempata montos. Los empates y las
   confianzas bajas quedan marcados.
4. **Asistente LLM, solo para ambigüedades**. Usa `llm.py` en modo off, record o replay. Recibe nombres de
   columna y firmas agregadas, nunca valores de filas; los nombres de columna se tratan como dato no confiable.
   Su propuesta se valida antes de aceptarse: debe ser una candidata listada, coincidir en tipo y respetar el
   1:1. Con `--llm off` el desempate es determinista y se declara (`deterministic_tiebreak`).
5. **Normalización** (`normalize.py`). Construye un SQLite canónico en memoria:
   - fechas ISO; DD/MM vs MM/DD se decide por evidencia y, si falta, se asume DD/MM y se declara;
   - montos float (`$`, `MXN`, `1.234,56`, paréntesis);
   - RFC sin prefijo, espacios ni guiones;
   - CLABE de 18 dígitos (rellena ceros si llegó como número);
   - catálogos canónicos y nulls textuales convertidos a NULL;
   - referencias a personas resueltas al `emp_id` o nombre de `employees`.

   Un id o CLABE con pérdida de precisión se **anula y se reporta**; no se adivinan dígitos.
6. **Citas**. `id_maps` guarda id canónico → id original. `record_id` en `submission.json` es el id tal como
   viene en la entrada, y antes de imprimir se valida contra el estate original. `DIR/validator_estate.db` (o
   `python3 -m auditor validator-estate`) es una copia con nombres canónicos e ids originales, para correr
   `validate_format.py --estate` cuando la entrada es CSV/XLSX o usa otros nombres.
7. **Degradación declarada**. Sin `invoices(uuid, issuer_rfc, receiver_rfc, issue_date, total)` la corrida
   termina con `error: estate structure: …` y código 2. Para lo demás:
   - si falta algo requerido por una tipología (`SCHEME_REQUIRES`), esa tipología se desactiva;
   - si falta evidencia que la tipología usa sin depender de ella (`SCHEME_EVIDENCE`: ledger, lista 69-B,
     referencia bancaria…), corre "con evidencia reducida".

   Ambos casos quedan en `structure_report` y en "Method and limits" del expediente.
8. **Identidad**. Si el SQLite coincide exactamente con el esquema y ningún valor cambia al normalizar, se
   abre el archivo original tal cual.

`run_log.json → structure_report` guarda: formato de entrada, tabla y columna original → canónica,
confianza, método, evidencia del puntaje, reglas aplicadas con conteo y ejemplos (nunca de texto libre),
columnas no mapeadas, faltantes, ids remapeados, colisiones, pérdida de precisión, tipologías desactivadas o
debilitadas y bitácora del asistente.

## fraud_flag y ramas

- Cada hallazgo en `submission.json` lleva `fraud_flag: true` y cada lead `fraud_flag: false`. El validador
  oficial pasa, porque no restringe propiedades extra.
- `DIR/triage.json` tiene un registro por (sujeto, tipología evaluada): hallazgo, lead cerrado o sin señal.
  Incluye todo proveedor, empleado, cliente y cuenta propia que ningún detector levantó, más un consolidado
  por sujeto. Un sujeto tiene `fraud_flag: true` si algún hallazgo lo incluye.
- `branch_fraud.json` y `branch_no_fraud.json` son la partición, con la misma forma de registro. El esquema
  está en `src/auditor/schemas/triage_schema.json`.
- `python3 -m auditor branch --run-log DIR/run_log.json --flag true|false` exporta una rama sin volver a correr.
- `run_log.json` referencia el triage (archivo, sha256, conteos).
- La huella (`fingerprint`) excluye `structure_report` y `triage`, que se derivan del estate y del
  veredicto. Así un estate canónico conserva la huella previa; el determinismo de ambos se prueba aparte.

## Protocolo

- **Ajuste.** Clásico 1–5, variantes 1–3 y externo seed_103, con el vocabulario de mutación `tuning`. Los
  arreglos se hicieron mirando estas corridas.
- **Held-out.** Clásico 501–505 y variantes 506–510, con el vocabulario `heldout`, escrito aparte y nunca
  usado para ajustar: "Folio Fiscal", "Cuenta Ordenante", fechas epoch o con mes en español, `1.234,56`, RFC con
  puntos, `EMPL00001`. Se corrió una vez. El harness rechaza bases de held-out que coincidan con las de ajuste.
- **Resultado idéntico.** Mismos hallazgos (tipo, entidades, pesos, confianza y exhibits traducidos al id
  original) y mismos leads (entidad, señal, quién cerró) que el estate original.
- **Comandos:**
  - `python3 eval/forensic/harness.py --mutations all --formats all --mutation-bases … --vocab heldout --mutation-label heldout --out reports/forensic/structure`
  - `python3 generator/forensic/mutate.py --estate E --out O --kind K --seed N [--vocab] [--format]`

## Resultados

Los conteos son de corridas. Con `--llm off`: 0 llamadas LLM y MXN 0 en todas las corridas. El asistente LLM
no intervino en ningún resultado (`llm_assist_calls = 0`); su camino está cubierto por una prueba con casete.

### Por tipo de mutación (SQLite)

| Mutación | Ajuste idéntico | Held-out idéntico | Held-out recall (orig → mutado) | Falsas |
|---|---|---|---|---|
| rename_tables | 9/9 | 10/10 | 42 → 42 | 0 |
| rename_columns | 9/9 | **0/10** | 42 → **28** | 0 |
| reorder_columns | 9/9 | 10/10 | 42 → 42 | 0 |
| extra_columns | 9/9 | 10/10 | 42 → 42 | 0 |
| date_formats | 9/9 | 10/10 | 42 → 42 | 0 |
| amount_text | 9/9 | 10/10 | 42 → 42 | 0 |
| status_alternates | 9/9 | 10/10 | 42 → 42 | 0 |
| rfc_prefix | 9/9 | 10/10 | 42 → 42 | 0 |
| emp_id_format | 9/9 | 10/10 | 42 → 42 | 0 |
| emp_ref_format | 9/9 | 10/10 | 42 → 42 | 0 |
| clabe_numeric | 9/9 | 10/10 | 42 → 42 | 0 |
| null_tokens | 9/9 | 10/10 | 42 → 42 | 0 |
| id_formats | 9/9 | 10/10 | 42 → 42 | 0 |
| combo (5 mutaciones) | 9/9 | **6/10** | 42 → **30** | 0 |
| drop_optional (esperado: degradado y declarado) | 9/9 declarado | 10/10 declarado | 42 → 31 | 0 |
| drop_required (esperado: error claro) | 9/9 error | 10/10 error | — | — |

### Por formato de entrada (sin mutación estructural)

| Formato | Ajuste idéntico | Held-out idéntico | Recall held-out | Validador sobre `validator_estate.db` |
|---|---|---|---|---|
| SQLite original | — | — | 42/42 | PASS directo |
| CSV directorio (utf-8, `,`) | 9/9 | 10/10 | 42/42 | 10/10 |
| CSV cp1252 `;`, título, decimal coma, columna vacía | 9/9 | 10/10 | 42/42 | 10/10 |
| CSV UTF-8 con BOM y tabulador | 9/9 | 10/10 | 42/42 | 10/10 |
| ZIP de CSV | 9/9 | 10/10 | 42/42 | 10/10 |
| XLSX | 9/9 | 10/10 | 42/42 | 10/10 |
| XLSX con título y grupo combinados, hoja oculta/vacía, fechas 1904 | 9/9 | 10/10 | 42/42 | 10/10 |
| ZIP con XLSX | 9/9 | 10/10 | 42/42 | 10/10 |
| XLSX con CLABE numérica (pierde dígitos; esperado degradado) | 9/9 declarado | 10/10 declarado | 18/42 | 10/10 |
| Un solo CSV de facturas (esperado: todo desactivado) | 9/9 declarado | 10/10 declarado | 0/42 | 10/10 |

En todas las variantes: 0 acusaciones falsas (0/1 550 en ajuste y 0/1 725 en held-out, contando señuelos por
corrida) y huella determinista. En los formatos no hay mutación estructural: ahí el vocabulario `heldout` no
aplica, así que la columna "held-out" solo cambia las semillas.

### Regresión de docs/23 con el código nuevo

| Conjunto | Recall | Falsas | Formato/determinista |
|---|---|---|---|
| 101–105 | 21/21 | 0/38 | PASS/sí |
| 201–205 (5×10) | 25/25 | 0/50 | PASS/sí |
| 301–302 sin fraude | — | 0/20 | PASS/sí |
| Clásico 301–306 | 22/22 | 0/41 | PASS/sí |
| Variantes 401–410 | 39/40 | 0/77 | PASS/sí |
| Externo seed_103 | 10/10 | 0/10 | PASS/sí |

Son idénticos a los reportados antes. Además, la huella de 15 estates (clásico 1–5, 101 y 201; variantes 1–5,
401 y 402; seed_103) es byte a byte la misma que antes del cambio.

## Qué se rompe todavía (límites honestos)

1. **Nombres de columna que el vocabulario no conoce.** Es el hallazgo del held-out: "Numero de Asiento",
   "JournalLineId", "Nombre del Contribuyente", "PayrollAccount", "PublishedOn", "Concepto de Pago",
   "ListingStatus". Si la columna es tipada, la firma a veces la rescata; si es un id o texto sin firma, no.

   Cuando falta una columna **core**, la tabla entera se descarta. Ejemplos: `ledger.entry_id` sin mapear
   descarta todo el ledger; `efos_list.publication_date` sin mapear descarta la lista 69-B. Eso quita
   evidencia a phantom y revenue.

   En la corrida held-out original esas pérdidas **no se declaraban** (ver "después del held-out"). No se
   agregaron los sinónimos del held-out, para no contaminarlo. El remedio real, en orden:
   - ampliar sinónimos con vocabulario de sistemas contables reales (CONTPAQi, SAP, Aspel);
   - mandar la columna core faltante al asistente LLM aunque no haya empate;
   - usar `rowid` como id citable cuando no hay columna id. Esto último requeriría que el juez acepte ese id.
2. **Validador oficial contra el archivo que entrega el juez.** `validate_format.py` busca las tablas y columnas
   id con sus nombres canónicos y hace `float()` del monto. Con tablas o columnas id renombradas, montos como
   texto, CSV o XLSX, falla o truena **por diseño del validador**. Está resuelto con `validator_estate.db`, que
   pasa en el 100% de las corridas no idénticas. Los `record_id` siguen siendo los ids originales.
3. **Pérdida de precisión en Excel.** Una CLABE guardada como número tiene 17 dígitos significativos: se anula
   y se declara, no se reconstruye. Kickback, round-trip e ingresos quedan desactivados si todas se pierden.
4. **Fechas ambiguas sin evidencia** (todos los días ≤ 12): se asume DD/MM y se declara `assumed_day_first`.
5. **Entidades de empleado.** `EMP:` + el `emp_id` tal como viene (`EMP:1`, `EMP:E0001`). Si la clave del juez
   usa otra forma para el mismo empleado, no emparejará.
6. **Referencias bancarias en texto libre.** Si el generador cambia la grafía del UUID dentro de `reference`,
   el emparejamiento por referencia cae al de monto y fecha.
7. **`--llm replay`** con un estate no canónico necesita entradas `structure_assist` en el casete, grabadas
   contra la misma entrada.
8. **Costo.** La normalización recorre todas las filas: seed_103, con 3 500 empleados, tarda ~0.5 s en total
   (antes ~0.03 s por estate). El contexto del asistente sí está acotado: 200 filas de muestra y firmas agregadas.

## Después del held-out: declaración de evidencia reducida

Tras ver el held-out se agregó `SCHEME_EVIDENCE`: ledger, lista 69-B, referencia bancaria y otras
evidencias no requeridas. Si faltan, la tipología aparece como "evaluada con evidencia reducida" en
`structure_report.weakened_schemes` y en el expediente. No cambia ningún mapeo ni resultado; solo convierte
pérdidas silenciosas en declaradas.

La re-corrida de las mismas semillas está en `mutations_heldout_declared*.csv`. **No es held-out**: el cambio
se hizo mirando esas corridas.

| | Held-out original | Misma semilla tras declarar evidencia reducida (no held-out) |
|---|---|---|
| Corridas como se esperaba | 236/250 | 236/250 (mapeos y resultados idénticos) |
| Corridas con pérdida de esquemas **no declarada** | 5 (seed_504, variants_506 y variants_509 `rename_columns`; variants_509 `combo`; en variants_510 el hallazgo cambió de exhibits/confianza, no se perdió) | **0** |
| Acusaciones falsas | 0 | 0 |

Las 14 corridas que siguen fuera de lo esperado son las 10 `rename_columns` y 4 `combo` que incluyen
`rename_columns` con vocabulario held-out. Pierden recall, pero ahora lo declaran.

## Qué necesitaría el BFF web (fuera de alcance; `web/` es de otro agente)

- **Subida.** Aceptar `.db/.sqlite`, `.csv` (varios), `.xlsx` y `.zip` como multipart. Guardarlos en un
  directorio de trabajo por corrida, y los CSV múltiples como directorio o ZIP. Correr
  `python3 -m auditor run --estate <archivo o dir> --seed N --out <dir>`.
- **Límites y seguridad.** Tamaño máximo; ZIP sin rutas absolutas ni `..` (el lector solo lee miembros, no
  extrae); sin ejecutar macros (el lector XML no las interpreta).
- **Mostrar** `structure_report.summary`, `input` (hoja/archivo, codificación, delimitador, fila de
  encabezado), columnas de baja confianza, `disabled_schemes`, `weakened_schemes` y `precision_lost` antes de
  los hallazgos. Idealmente, dejar al usuario confirmar el mapeo de columnas de baja confianza.
- **Descargas:** `submission.json`, `case_file.html`, `triage.json`, `branch_fraud.json`,
  `branch_no_fraud.json` y `validator_estate.db`.
- **Errores.** El código 2 con `error: estate structure: …` es un error de entrada del usuario, no un 500.
