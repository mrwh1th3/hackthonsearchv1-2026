# 23 — Adaptación a la guía oficial de jueces (Forensic Auditor)

Fecha: 2026-09-12. **Normativo sobre formato de entrega y evaluación.** Donde discrepe con 00–22, prevalece este documento para lo que se califica. La guía está copiada sin cambios en `spec/forensic-auditor/`.

## Decisión

La corrida que se califica es una **CLI local, determinista y sin red**. No pasa por n8n ni Supabase, porque la guía exige:

- un estate recibido por ruta en tiempo de ejecución;
- reproducir la corrida sin conectividad;
- que la misma semilla dé el mismo expediente.

El pipeline n8n/Supabase sigue siendo el demo en vivo (docs 17 y 21). No se borra nada.

| Pieza | Ruta |
|---|---|
| Agente (lo que revisan con grep) | `src/auditor/` |
| Generador de estates con el esquema de los jueces | `generator/forensic/estate.py` |
| Harness y única lectura de la clave de evaluación | `eval/forensic/harness.py` |
| Tablas de resultados | `reports/forensic/` |

## Arquitectura (resumen para el pitch)

1. **Detectores SQL** (`detectors.py`). Abren leads, nunca acusan. Hay 12 señales:
   - `phantom_vendor`: `efos_list_match`, `recently_registered_vendor`, `undocumented_purchases`, `invoiced_before_registration` (anomalía de padrón: se explica, no acusa por sí sola; con desfase ≤180 días el proveedor sigue contando como nuevo)
   - `kickback`: `vendor_to_employee_transfer`, `employee_vendor_shared_bank`
   - `round_tripping`: `funds_returned_to_company`, `vendor_is_customer`
   - `threshold_splitting`: `po_below_approval_limit`
   - `revenue_inflation`: `quarter_end_revenue`, `cancelled_sales_invoice`
2. **Investigador por tipología** (`investigate.py`).
   - Usa herramientas de solo lectura que se registran solas: cada lead cerrado lista las herramientas que se llamaron.
   - Aplica reglas explícitas cuyas constantes viven en `config.py`.
   - Asigna `proven` o `probable`. El LLM no decide nada (regla 4 de CLAUDE.md).
3. **Challenger.** Prueba la explicación inocente y puede cerrar el lead. Las explicaciones que revisa son:
   - contrato u orden de compra;
   - cobro bancario;
   - reembolso de un CFDI cancelado;
   - banco compartido sin transferencias;
   - aprobador con facultad por encima del límite;
   - cadencia mensual.
4. **Validador.** Antes de imprimir comprueba:
   - que existe cada `record_id`;
   - que el monto concilia por tabla al 2%;
   - que hay al menos 3 exhibits;
   - que la narrativa tiene 150 palabras o menos.

   Si algo falla, el hallazgo pasa a lead con `closed_by: validator`.
5. **LLM opcional** (`llm.py`). Solo redacta el argumento de la defensa.
   - Modos: `off` (por defecto), `record` y `replay`.
   - El casete guarda el texto y el uso de tokens, así `replay` reporta llamadas y MXN sin red.
6. **Salidas.** `submission.json`, `run_log.json` y `case_file.html`.
   - El expediente es autocontenido y el rastro del dinero es un SVG en línea.
   - `render` reconstruye el expediente byte a byte desde `run_log.json`.

## Comandos

```bash
# generar un estate (la clave de evaluación queda fuera de src/)
python3 generator/forensic/estate.py --seed 101 --out data/forensic/seed_101/estate.db --key data/forensic/keys/seed_101.json

# correr el agente sobre cualquier estate
PYTHONPATH=src python3 -m auditor run --estate data/forensic/seed_101/estate.db --seed 101 --out out/101

# validador oficial
python3 spec/forensic-auditor/validate_format.py --submission out/101/submission.json --estate data/forensic/seed_101/estate.db

# evaluación: semillas de ajuste y reportadas deben ser disjuntas (el harness lo verifica)
python3 eval/forensic/harness.py --tuning-seeds 1 2 3 4 5 --report-seeds 101 102 103 104 105

# reproducir sin red
PYTHONPATH=src python3 -m auditor render --run-log out/101/run_log.json
PYTHONPATH=src python3 -m auditor run --estate ... --seed 101 --out out/101 --llm replay --cassette cassettes/101.json
```

## Semillas

- **Ajuste:** 1–12. Las reglas se calibraron mirando estas.
- **Reportadas (held-out):** 101–105 con la configuración aleatoria, más:
  - 201–205 con 5 esquemas y 10 señuelos;
  - 301–302 sin fraude y con 10 señuelos.

Resultado del 2026-09-12:

| Conjunto | Recall | Acusaciones falsas | Pesos | Formato | Determinista | Llamadas LLM |
|---|---|---|---|---|---|---|
| 101–105 | 21/21 | 0/38 | concilian | PASS | sí | 0 |
| 201–205 | 25/25 | 0/50 | concilian | PASS | sí | 0 |
| 301–302 | — | 0/20 | — | PASS | sí | 0 |
| 101–105, límite 75 000 | 25/25 | 0/50 | concilian | PASS | sí | 0 |
| 101–105, límite 120 000 | 25/25 | 0/50 | concilian | PASS | sí | 0 |

La tabla anterior es la línea base previa al auditor adaptativo; no incluye estates de otro generador.

### Auditor adaptativo (2026-09-12)

Perfilado del estate (base IVA de la orden, aprobador por id o nombre, cuentas propias, antigüedad del
padrón) y detectores con variantes estructurales. Método y límites: `reports/forensic/ADAPTATIVO.md`.

- **Ajuste:** clásico 1–12 (histórico), variantes `--conventions random` 1–5 y el estate externo seed_103
  (suministrado por el usuario, fuera del repo).
- **Reportadas:** clásico 301–306 con la configuración por defecto (distinta de la corrida 301–302 sin
  fraude de arriba) y variantes 401–410, vistas solo al final.

| Fuente | Conjunto | Recall antes | Recall después | Falsas antes | Falsas después |
|---|---|---|---|---|---|
| Clásico | held-out 301–306 | 22/22 | 22/22 | 0/41 | 0/41 |
| Variantes | held-out 401–410 | 21/40 | 39/40 | 0/77 | 0/77 |
| Externo | seed_103 (ajuste, no held-out) | 3/10 | 10/10 | 1/10 | 0/10 (0/8 evaluables) |
| Clásico | regresión 101–105 / 201–205 5×10 / 301–302 sin fraude | — | 21/21 · 25/25 · — | — | 0/38 · 0/50 · 0/20 |

Formato PASS, pesos concilian y huella determinista en todas. Tablas: `reports/forensic/adaptive/`.

Hay dos pruebas de robustez:

- **Límite de aprobación.** Se corre con `FORENSIC_APPROVAL_LIMIT=75000` y `=120000` en el generador. El agente no recibe el límite: lo infiere del tope firmado por cada aprobador.
- **Entrelazado.** El kickback o el fraccionamiento reutiliza al proveedor fantasma en 6 de 22 semillas. Ambos hallazgos se reportan por separado.

Las tablas quedan en `reports/forensic/`.

En cada caso: MXN 0 y menos de 0.02 s por estate.

**Límite honesto.** El generador y los detectores los escribió el mismo equipo. El 100% mide coherencia interna, no generalización. Los estates de los jueces pueden:

- usar otros límites de aprobación;
- traer pagos sin referencia al UUID;
- esconder kickbacks detrás de intermediarios.

Esto está declarado en la sección 5 de cada expediente.

### Agente de estructura, entradas CSV/XLSX/ZIP y fraud_flag (2026-09-13)

Método completo, tablas y límites: `reports/forensic/ESTRUCTURA.md`; CSV en `reports/forensic/structure/`.

- `--estate` acepta SQLite, directorio de CSV, CSV, XLSX o ZIP. El formato se detecta por contenido.
- Antes de investigar, `src/auditor/structure/`:
  - mapea tablas y columnas al esquema canónico por nombre, sinónimos es/en, firma de valores y relaciones;
  - consulta el LLM solo ante empates, y valida su propuesta;
  - normaliza fechas, montos, RFC, CLABE, catálogos y nulls.
- `record_id` cita el id original. `DIR/validator_estate.db` permite correr `validate_format.py` cuando la
  entrada no es el SQLite canónico.
- Lo que falta se declara:
  - error claro (código 2) si faltan las columnas core de facturas;
  - tipología desactivada si falta algo requerido;
  - "evidencia reducida" si falta evidencia opcional.
- Salidas nuevas: `fraud_flag` en cada hallazgo (true) y lead (false), más `triage.json`, `branch_fraud.json`
  y `branch_no_fraud.json` (esquema en `src/auditor/schemas/triage_schema.json`). `python3 -m auditor branch`
  exporta una rama sin volver a correr.
- Un estate canónico da la misma huella y los mismos resultados que antes. Las tablas de arriba se
  re-corrieron con el código nuevo y dan cifras idénticas.

| Conjunto (mutaciones y formatos) | Corridas como se esperaba | Idénticas al original | Falsas |
|---|---|---|---|
| Ajuste: clásico 1–5, variantes 1–3, seed_103; vocabulario `tuning` | 225/225 | 189 (las 36 restantes son degradación o error esperados) | 0 |
| **Held-out**: clásico 501–505, variantes 506–510; vocabulario `heldout` | **236/250** | 196 | 0 |

- **CSV, XLSX, ZIP y XLSX "sucio".** Idénticos al SQLite en 10/10 held-out.
- **Mutaciones.** Renombrado de tablas, orden, columnas extra, formatos de fecha y monto, catálogos, prefijos
  RFC/EMP, CLABE numérica, nulls e ids: 10/10 cada una.
- **Falla en held-out: renombrado de columnas** con nombres que el vocabulario no conoce. Idénticas 0/10 y
  recall 42 → 28; en `combo`, 6/10.
  - En 5 corridas la pérdida no se declaraba. Se corrigió después, declarando la evidencia reducida; la
    re-corrida de esas semillas ya no es held-out y da 0 pérdidas no declaradas.

## Entrega en disco, descarga y determinismo de submission.json (2026-09-13)

- **Rutas.** La única regla de rutas de la guía es de entrada: *"Your system must accept an estate at a path given
  at run time. Hardcoded paths fail."* No pide una carpeta de salida fija. El CLI escribe donde diga `--out`.
- **Determinismo verificado.** El mismo estate y la misma semilla dan los mismos hallazgos, leads y huella, también
  con `PYTHONHASHSEED` 0, 1 y 42 en el estate de 5005. Entre ejecuciones independientes solo cambia
  `run_metadata.wall_clock_seconds`, que el esquema exige.
- **Re-ejecutar sobre la misma carpeta no cambia la entrega** (`pipeline.write_outputs`):
  - `submission.json`, `run_log.json` y `case_file.html` no se reescriben; conservan el reloj de la ejecución que
    produjo ese resultado;
  - cada ejecución añade una línea a `executions.jsonl`: `new`, `unchanged` o `replaced`, con el reloj medido y el
    reportado;
  - un resultado distinto (otro estate, otra semilla, otra versión del auditor) se escribe y queda `replaced`;
  - la escritura es atómica y en UTF-8.
- **Webapp.** `loaders/auditoria_en_vivo.py` produce la entrega con `auditor.pipeline`: sale igual que en el CLI
  salvo el reloj, que mide el cómputo sin las pausas de visualización (`paso_visible_ms` ya no va en
  `run_metadata`). La carpeta es `FORENSE_SALIDA_DIR/<corrida>` (acepta `~`) o, por defecto,
  `data/forensic/runs/<corrida>`.
- **Descarga.** `GET /auditoria/[corridaId]/submission`, sin editor. Se ofrece en `/documentos/[id]` junto a
  "Reporte completo" y junto a "Abrir expediente entregable". Sirve los bytes del disco si coinciden con
  `forense.auditor_resultados.submission`; si no, sirve lo persistido.
- **Rastro del dinero, corregido al contrastar la guía del juez.** `money_trail` contiene un camino real
  conectado representativo. `money_trails` conserva todos los caminos, incluidos pagos paralelos, sin inventar
  enlaces ni omitir movimientos. El expediente y el run log conservan la evidencia íntegra y los importes.
  Pruebas adicionales comprueban adyacencia, conservación y conciliación porque el validador oficial no comprueba
  la adyacencia. Las exportaciones históricas requieren volver a renderizarse para adoptar este contrato.
- **Resultados ya guardados.** Las 5 corridas auditadas en la base pasan el validador oficial, pero la primera
  re-auditoría de cada una reescribe su submission una vez (`replaced`):
  - 4 se generaron antes de `7fe7c1d` (2026-09-13 00:14) con versiones anteriores del auditor;
  - las 5 traen `paso_visible_ms` en `run_metadata`, que el runner web ya no escribe.

  Desde esa re-auditoría quedan fijas.

## Aislamiento de la clave de evaluación

- `grep -r 'ground_truth' src/ --include='*.py'` no devuelve nada.
- La clave se escribe en `data/forensic/keys/`, que está en gitignore.
- Solo la abre `eval/forensic/harness.py`, que ejecuta al agente como subproceso y no importa nada de él.
- Queda pendiente la tabla `forense.ground_truth` del pipeline n8n. No participa en la corrida calificada, pero conviene no mostrarla en el pitch.

## Diferencias con el vocabulario previo

- La confianza usa `proven` o `probable`, como pide el esquema de los jueces. Internamente sigue prohibido "definitivo" como nivel.
- En `efos_list.status`, el valor `definitivo` es dato del SAT, no un veredicto nuestro.
- El texto libre (`concepto_text`, `reference`, `legal_name`, `scope_text`) no decide ningún veredicto. Solo aparece en la narrativa.


## Verificación del flujo único contra los requisitos recibidos (2026-09-13)

Los ocho archivos recibidos en `student-materials/forensic-auditor` coinciden byte por byte con
`spec/forensic-auditor/`. Se utilizaron como especificación de entrega. El flujo actual es una sola investigación:
**motor sobre el estate → contexto → A/B sobre ese mismo resultado → compilación y revisión humana**.

### Evidencia de cumplimiento

- Entrada por ruta en tiempo de ejecución; cinco tipos de esquema; claves de evaluación fuera de los imports y
  herramientas del motor y de A/B. La CLI de Codex recibe muestras acotadas en un directorio aislado, sin shell.
- Antes de exportar: referencias existentes, al menos tres exhibits, narrativa hasta 150 palabras, monto positivo
  conciliado por tabla con tolerancia 2%, confianza válida y respaldo estructurado de cada entidad participante.
  Las notas libres y compartir institución bancaria no acreditan participación.
- Expediente HTML portable: las cinco secciones obligatorias, diagramas SVG con exhibits, reconciliación,
  defensa adversarial y descartes con entidad, motivo, consultas y responsable. Si falta nombre o semilla de
  origen se declara; no se deduce un nombre empresarial ni una semilla de generación inexistentes.
- La home contiene dataset, giro e Investigar; el mapa se desglosa en la misma página. El resultado muestra
  identidad, monto, confianza del motor y reservas de A. Los detalles extensos están plegados.
- Descargas privadas por `run_id`: `/api/laboratorio/[id]/entrega?tipo=submission` sirve el JSON del motor sin
  envolverlo; `tipo=expediente` sirve `delivery/case_file.html`, incluyendo A/B y métricas del flujo completo.
  Los bytes coinciden con disco; la ruta valida dueño, UUID, tipo permitido, contención del archivo y tamaño.
- `python3 -m labs.delivery --run-dir RUTA --check` comprueba HTML y manifiesto byte por byte sin red ni modelo.
  El manifiesto incluye hashes de entrada y comprueba que A/B recibieron el run log del motor de esa investigación.

### Evaluación y cambios generales

La primera evaluación adicional, semillas 9101–9105, dio 24/25 esquemas detectados, 0/50 señuelos acusados y una
subestimación en ciclos. Permitió localizar dos errores generales: elegir el siguiente movimiento por ID antes
que fecha y tratar una aprobación exactamente al límite como autorización superior. Ambos se corrigieron con
regresiones independientes: permutación de IDs, ciclos sucesivos y límites igual/superior. Esas cinco semillas
pasan a ser de ajuste/regresión; **no se presentan como no vistas** tras las correcciones.

Evaluación final: ajuste/regresión **1–12, 9101–9105**; no vistas **10101–10105**. Los conjuntos son disjuntos.
Resultado: **24/25 (96%)**, **0/50 señuelos acusados**, cero hallazgos extra y todos los importes emitidos
conciliados. Se omitió un proveedor fantasma difícil en 10101. No se afinó el motor sobre estos resultados.
Tabla exigida: `reports/forensic/judge-final-20260913/results_variants_heldout.csv`; resumen y tabla de ajuste
están en la misma carpeta. La columna `peso_actual` del harness suma los esquemas detectados, no el importe del
esquema omitido; por tanto conciliación no equivale a cobertura completa de pérdidas.

### Prueba real con Codex y límites pendientes

Run `f0090036-61c9-420a-b3c8-f358c4605a56`, `estateV1.3.db`: 4 hallazgos del motor, 9 investigaciones cerradas,
2 grupos contrastados por A, 0 hipótesis adicionales de B y 0 propuestas. Se ejecutaron 6 invocaciones CLI,
162 518 tokens de entrada, 8 629 de salida y 207.038 segundos en total. A cuestionó parte del soporte del grupo
phantom_vendor y declaró evidencia insuficiente para corroborar los cierres kickback. No se convirtieron esas
reservas en cambios automáticos de reglas. B recibió 30 de 117 sujetos residuales elegibles, no todo el estate.

El contexto de construcción tiene cuatro fuentes de casos accesibles y conserva estado parcial; no se inventó
un quinto caso. Los 14 sujetos cerrados y las 18 participaciones sujeto/comprobación son unidades diferentes;
118 sin señal incluye una cuenta empresarial excluida de los 117 elegibles para B. Los nuevos briefs explicitan
las unidades y exclusiones. Esta corrida histórica conserva sus entradas y respuestas originales.

Se volvieron a renderizar sus exportaciones desde el mismo run log, sin reejecutar detectores ni modelos,
para adoptar caminos conectados y el encabezado requerido. Los originales están en
`engine/export_history/pre_judge_contract`; `export_migration.json` registra el cambio. La versión exportada
pasó el validador oficial recibido con comprobación del estate y el replay del expediente completo.
La corrida mock `86479a24-e7f4-4929-bba7-f612fee56859` también verificó la creación automática de las entregas
por el supervisor después de motor y A/B.

**No es cumplimiento total demostrable:** una ejecución nueva de Codex puede variar; el replay guardado sí es
idéntico. El costo MXN atribuible a esta suscripción es desconocido y queda `null`; no se presenta como cero.
Las seis invocaciones CLI no equivalen a un número conocido de solicitudes internas. Los ceros de costo y
llamadas de la tabla de evaluación corresponden exclusivamente al motor `--llm off`. Los ciclos siguen teniendo
asociación conservadora y la evaluación sintética no garantiza generalización a los estates ocultos del juez.

Pruebas de cierre: motor 82/82; labs 51/51; web afectada 47/47, TypeScript correcto y build de producción aprobado. UI comprobada en escritorio y móvil (393 px), sin desbordamiento horizontal. La suite web completa
registra 461 aprobadas y 4 fallos previos en las pruebas del editor (`tests/editor/repositorio.test.ts` y
`components/editor/componentes.test.tsx`), fuera de estas modificaciones. Se preservó ese trabajo concurrente.

### English UI and seed 105 verification · 2026-09-13

The main workspace now uses English controls, static investigation/context controls, an explicit
`Run again` action preserving the dataset and focus, start/end times, searchable findings,
pattern distribution filters and paginated dismissed leads. Evidence records and technical originals
remain expandable; mobile money movements use a vertical sequence. English report section titles
are recognized alongside legacy Spanish headings, retaining section protection.

Real Codex run `06a3fe55-f478-4003-a7c6-7cce08360c79` imported the supplied `estate_seed_105.zip`:
8 tables, 16,336 rows; canonical hash `c616f3da67a778f90ab7f5ab88d32fd5d4200e8c98aa4aec9463c968ee718f89`.
The engine reported 18 findings and 226 dismissed leads; the supplied official format validator
passed against that estate. Runtime was 314.800 seconds. A recorded two pattern reviews; B recorded
no additional hypotheses and the compiler produced no proposals. Five notes and the sampled scope
remain available. The industry could not be inferred and general context was used; A reviewed two
of five groups and B sampled 30 of 6,152 eligible entities. This is not a full-coverage or accuracy claim.
No answer key was supplied or used. Six workflow CLI calls plus one industry-research invocation
were recorded; subscription MXN cost remains unavailable.

The completed dataset was dispatched again through the real authenticated API with provider `mock`
(run `3372722d-bbf3-4892-beff-bdded6c7affe`) to check repeat execution without additional paid calls.
Distinct run IDs, the same dataset/focus, and unchanged original artifact hashes were verified.
Authenticated submission/report downloads matched saved bytes. The English delivery replay passed.
Desktop and 390px mobile UI were inspected, including search, pattern filters, money trails and
Context/Filters; no horizontal page overflow or browser errors were observed.

### Visual delivery and automatic publication checks · 2026-09-13

The self-contained HTML retains the five required sections in order. It now includes a finding
index, confidence and exposure charts, workflow diagrams, SVG money trails, complete expandable
paths, linked exhibits and per-table amount reconciliation. The same operations can contribute
to several findings; the visual total is explicitly not a deduplicated loss estimate. New engine
runs record referenced vendor/employee names in presentation metadata; this does not affect the
conclusion fingerprint or detector logic. Historical run logs keep their original bytes.

The web supervisor builds a candidate report in a private temporary directory, then runs
`scripts/verify-judge-delivery.py` before publishing it. The gate invokes the supplied official
format and estate-reference validators, checks the five-section report and rendered SVGs, and
rebuilds both engine and complete delivery from recorded inputs with network and subprocesses
blocked. A failure preserves the prior published report and recorded investigation; it leaves
an error for inspection. Successful deliveries include `delivery/validation.json`.

The presentation of real seed 105 run `06a3fe55-f478-4003-a7c6-7cce08360c79` was refreshed from
its saved log, with no new model calls or detector run. Prior HTML/manifest files and hash records
are retained under `presentation_history/20260913T100740Z`; the final disclosure and English-label
polish has a second backup at `presentation_history/20260913T101626Z`. Engine conclusions, submission,
A/B inputs and outputs, proposals, notes, traces, launch and summary remain unchanged.

Chrome verification followed finding 9's EX-03 link into its initially collapsed evidence table,
which opened to BNK-00834 using native fragment navigation. The HTML contains no scripts and the
authenticated viewer keeps its restrictive content-security policy. Desktop charts and 390px
reading layouts were inspected; wide diagrams scroll within their own container.

Final verification: 90 auditor tests, 58 lab tests and 524 web tests passed, followed by 14 tests
of the last affected web components. TypeScript and the production build passed. The refreshed
real delivery passed the official format/estate gate and offline replay.

Passing this gate demonstrates format, reference integrity and saved replay, not detection
accuracy. Subscription MXN allocation remains unavailable, fresh Codex reviews may vary, and
this seed produced no additional B hypotheses or compiler proposals. Improving recall still
requires separate evaluation on independently verified examples.

### Curated context, bounded reviews and complete timing · 2026-09-13

The context tool now loads a dated local catalog of 12 industries, five case references per
industry, 58 distinct primary-source URLs and 141 normalized EN/ES aliases. It retains legal
status, legitimate alternatives and disconfirming checks. Fresh catalog reuse costs no model
or network calls; only the requested bounded profile enters the prompt. Recent runtime context
has priority, and stale references require refresh or an explicit stale fallback. These are
reference mechanisms, not additional accusations or a claim to contain the latest five cases
worldwide. Details and refresh procedure are in `labs/context_catalog/README.md`.

A's sampled groups share one initial call. The six-call workflow can now fit sector selection,
initial A and B, both tool follow-ups, and compilation. Smaller configured limits explicitly
record omitted follow-up; they do not execute a data query whose results cannot be reviewed.
This fixes B's previous follow-up starvation without raising the workflow call limit.

New runs measure dispatch/preparation, engine, context, A/B, compilation and the first successful
report build/validation. The public run remains active until a final candidate seals that timing
and passes another gate. Final metric sealing is outside the measured interval. Renderer v3
preserves all five required sections, self-contained money diagrams and evidence links; its
first page distinguishes complete timing from legacy measurements and unknown subscription cost.

The real seed 105 worker was exercised offline with mock A/B in an isolated `/tmp` workspace:
18 findings and 226 closed leads matched the saved baseline exactly, both publication gates
passed, and the measured complete interval was 2.857 seconds. Construction context loaded from
the bundled catalog with no model calls. The 90-test labs suite passed.

Saved reports `3372722d-bbf3-4892-beff-bdded6c7affe` and
`06a3fe55-f478-4003-a7c6-7cce08360c79` were refreshed to v3 from their saved inputs. Original
presentation files and SHA records remain in each run's
`presentation_history/20260913T114109.469501Z`. All 44/52 non-presentation files respectively
retained their hashes. Their historical durations remain 2.288/314.800 seconds with the legacy
scope disclosed. Both refreshed deliveries passed the official format/estate and offline replay gate.

The subsequently saved real Codex run `ac160589-4af3-4234-a891-8865017e0df7` also passed that gate
on read-only inspection: 18 findings, 226 closed leads, two A reviews, zero B hypotheses, zero
proposals, six provider invocations, 169,237 input and 7,613 output tokens, and 202.058 seconds
including report validation. B did complete a second review after data-tool calls. This verifies
the execution path, not improved recall. No independent labels or measured subscription allocation
were introduced; a new AI review may vary.
