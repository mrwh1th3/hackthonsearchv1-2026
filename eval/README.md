# /eval — Evaluación y Métricas

Scripts para calcular métricas de desempeño y comparar corridas.

Ground truth, precision, recall, F1, y análisis de patrones de falsos positivos.

Ver `/docs/10-evaluacion.md` para matriz de evaluación completa.

## Scripts

| Script | Qué hace |
|---|---|
| `metricas.py` | Métricas de una corrida: baseline de dos pistas, selector de dos familias y el bloque de dictámenes de `forense.v_metricas_corrida`. Denominador cero devuelve `null`, nunca 0%. |
| `comparar_corridas.py` | Pone dos corridas lado a lado y marca regresiones contra las metas de docs/10 (FPR sobre trampas ≤ 0.15, recall conservador ≥ 0.65). Avisa si el `dataset_hash` difiere. |

```
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH python3 eval/metricas.py --corrida gen-v1 --db forense
python3 eval/comparar_corridas.py --base gen-v1 --nueva gen-v1-inyectada --db forense
```

Ambos hablan con Postgres por `psql` (sin dependencias) y solo leen.

### Números medidos sobre gen-v1 (100 RFC, 17 fraudes, 15 trampas legítimas)

| Regla | TP | FP | FN | TN | Precisión | Recall | FPR sobre trampas |
|---|---|---|---|---|---|---|---|
| baseline dos pistas | 16 | 7 | 1 | 76 | 69.6% | 94.1% | **4/15 = 26.7%** |
| selector dos familias | 16 | 3 | 1 | 80 | 84.2% | 94.1% | **0/15 = 0.0%** |

Exigir dos FAMILIAS en vez de dos pistas conserva el recall y elimina las
cuatro trampas que el baseline marcaba. Es la comparación que pide docs/10
§Baseline y el argumento del demo: la reducción de falsos positivos empieza
antes de que hable un agente. Las métricas de dictamen quedan en `null`
mientras gen-v1 no tenga casos investigados: cero casos no es 0% de recall.
