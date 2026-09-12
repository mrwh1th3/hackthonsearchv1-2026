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

### Números medidos (100 RFC, 17 fraudes, 15 trampas legítimas)

**Estos números son del SELECTOR, no del dictamen.** El selector decide a
quién se investiga; el dictamen decide a quién se marca. `docs/10` §FPR lo
define sobre lo segundo: "trampas legítimas **marcadas como positivas** /
total de trampas legítimas", con cobertura completa. Y añade que "las
[trampas] excluidas por el selector no demuestran una defensa". Así que la
meta de ≤0.15 **no se compara contra esta tabla**.

| Snapshot | Regla | TP | FP | FN | TN | Precisión | Recall | Trampas en la cola |
|---|---|---|---|---|---|---|---|---|
| gen-v1 | baseline dos pistas | 16 | 7 | 1 | 76 | 69.6% | 94.1% | 4/15 |
| gen-v1 | selector dos familias | 16 | 3 | 1 | 80 | 84.2% | 94.1% | 0/15 |
| gen-v2 | baseline dos pistas | 17 | 8 | 0 | 75 | 68.0% | 100% | 4/15 |
| gen-v2 | selector dos familias | 17 | 8 | 0 | 75 | **68.0%** | **100%** | **4/15** |

**Lo que cambió al volver T2 evaluable (gen-v2 + db/019), sin adornos:** el
recall sube a 17/17 y `capas` pasa de 4/5 a 5/5, pero el selector de dos
familias y el baseline de dos pistas quedan **idénticos** (17/8/0/75). O sea:
en gen-v2 la regla de dos familias **no aporta discriminación**. La causa no
es un error de siembra: la trampa del grupo corporativo comparte domicilio y
representante (familia R) **y** timbra en lote (familia T), y las dos cosas
son ciertas de un grupo corporativo real. Con T2 evaluable, exigir dos
familias no separa a ese grupo legítimo de un fraude.

No se quita esa co-ocurrencia para recuperar el número: la trampa existe
justamente para medir falsos positivos, y borrarla sería medir un dataset más
fácil. Es un hallazgo sobre el selector, no un problema de etiquetado.

**Lo que ninguna de estas filas dice:** cuántas trampas quedan **marcadas**
al final. Eso exige el pipeline completo con Defensor, y es el gate H8–10
(ver `reports/handoff/ESTADO.md`). Hasta que ese número exista, la FPR del
sistema está **sin medir**, y el 0/15 de gen-v1 no la sustituye: con cero
trampas investigadas, la capa de descarte no llegó a ejercerse.

Las métricas de dictamen quedan en `null` mientras el snapshot no tenga casos
investigados: cero casos no es 0% de recall.
