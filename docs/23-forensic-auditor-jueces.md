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

1. **Detectores SQL** (`detectors.py`). Abren leads, nunca acusan. Hay 11 señales:
   - `phantom_vendor`: `efos_list_match`, `recently_registered_vendor`, `undocumented_purchases`
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

## Aislamiento de la clave de evaluación

- `grep -r 'ground_truth' src/ --include='*.py'` no devuelve nada.
- La clave se escribe en `data/forensic/keys/`, que está en gitignore.
- Solo la abre `eval/forensic/harness.py`, que ejecuta al agente como subproceso y no importa nada de él.
- Queda pendiente la tabla `forense.ground_truth` del pipeline n8n. No participa en la corrida calificada, pero conviene no mostrarla en el pitch.

## Diferencias con el vocabulario previo

- La confianza usa `proven` o `probable`, como pide el esquema de los jueces. Internamente sigue prohibido "definitivo" como nivel.
- En `efos_list.status`, el valor `definitivo` es dato del SAT, no un veredicto nuestro.
- El texto libre (`concepto_text`, `reference`, `legal_name`, `scope_text`) no decide ningún veredicto. Solo aparece en la narrativa.
