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

### Números medidos (gen-v1: 100 RFC · 17 fraudes · 15 trampas · gen-v2: 104 · 17 · 19)

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
| gen-v2 | baseline dos pistas | 17 | 12 | 0 | 75 | 58.6% | 100% | 8/19 |
| gen-v2 | selector dos familias | 17 | 8 | 0 | 79 | **68.0%** | **100%** | **4/19** |

Los denominadores difieren a propósito: gen-v2 **suma** los 4 RFC de la trampa
9 sin sustituir a nadie, así que gen-v1 conserva byte a byte su
`dataset_hash` (`17a3e1ce…`) y sigue siendo la corrida cargada. Un invariante
del generador (`gen.py:verificar` §5) falla si el padrón de trampas y la
constante del módulo se separan, justamente para que nadie "corrija" el
tamaño del fondo y mueva cada RFC de esa corrida.

**El diferencial baseline-vs-selector, y de dónde salió.** En la primera
versión de gen-v2 las dos reglas salían **idénticas** (17/8/0/75): exigir dos
familias no aportaba discriminación. La causa no era un error de siembra,
sino la trampa del grupo corporativo, que comparte domicilio y representante
(familia R) **y** timbra en lote (familia T) —las dos cosas ciertas de un
grupo real—. Quitar esa co-ocurrencia habría recuperado el número midiendo un
dataset más fácil, así que no se quitó.

Se restituyó por el otro lado: **añadiendo** un comportamiento que ocurre de
verdad. La trampa 9 son cuatro comercializadoras constituidas para un solo
proyecto que timbran cada estimación de fase en una corrida del administrador
(3 saltos en 6 min → T2) y concentran su facturación en un trimestre antes de
liquidar la plantilla (→ T1): **dos pistas de UNA sola familia**. Verificado
sobre los 4 RFC, no inferido del agregado: `codigos = {T1,T2}`, `familias = 1`,
el baseline los marca y `score_entidad` no. Ese es exactamente el delta de la
tabla (12−8 FP, 8/19−4/19 trampas). El selector vuelve a ser estrictamente
mejor —68.0% contra 58.6% de precisión, la mitad de trampas en la cola— con
recall 17/17 y `capas` 5/5 en las dos reglas.

**Coste declarado, no escondido:** T2 como pista baja de 38.5% a 29.4% de
precisión (17 marcados = 5 de `capas` + 8 de trampas + 4 del resto). Es el
precio de tener algo que descartar, no un defecto.

**La FPR del selector sigue en 4/19 = 21.1%, por encima de la meta ≤15%** de
docs/10. Son los 4 RFC del grupo corporativo, y bajarla exige quitar esa
co-ocurrencia legítima. Se publica el número, no se maquilla el dataset.

**Lo que ninguna de estas filas dice:** cuántas trampas quedan **marcadas**
al final. Eso exige el pipeline completo con Defensor, y es el gate H8–10
(ver `reports/handoff/ESTADO.md`). Hasta que ese número exista, la FPR del
sistema está **sin medir**, y el 0/15 de gen-v1 no la sustituye: con cero
trampas investigadas, la capa de descarte no llegó a ejercerse.

Las métricas de dictamen quedan en `null` mientras el snapshot no tenga casos
investigados: cero casos no es 0% de recall.
