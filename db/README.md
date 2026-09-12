# /db — Migraciones SQL

Orden de aplicación (docs/05 §Orden de migraciones + docs/17 §4):

| Archivo | Contenido | Estado |
|---|---|---|
| `001_schema.sql` | Tablas de dominio, detección, pizarrón, casos/trazabilidad **y** control de runtime (`ejecuciones_agente`, `artefactos_contexto`, `llm_solicitudes`, `tool_ejecuciones`, `pasos_pipeline`, `slots_runtime`), índices, RLS, grants, realtime. `tipo_evento` incluye `inyeccion` (docs/21 §3.2). | hecho |
| `002_views.sql` | `next_seq`, `log`, `reservar_tool`, leases de cluster/tarea, helpers de caché, helpers de runtime con fencing, `v_casos_lista`, `v_agregado_rfc`, `v_pares_giro` (materializada), `v_grafo`, `v_trayectoria_rfc`, `clonar_corrida`, `v_metricas_corrida` (completada en 011). | hecho |
| `003_pistas.sql` | Primera entrega de pistas (D2, F1, F2, R1, R2, E1, T1) + `correr_pistas` (claim atómico `lista`→`procesando`) + `marcar_no_evaluable` + `score_entidad` (regla de dos familias). Segunda entrega pendiente: D1, D3, D4, F3, F4, R3, T2. | hecho |
| `004_clusters.sql` | `armar_clusters`, `expandir_cluster`. | pendiente |
| `005_rpc.sql` | 11 herramientas `public.forense_*` + validación/despertar/frontera. | pendiente |
| `006_producto_ui.sql` / `007_notificaciones_voz.sql` | perfiles, investigaciones, outbox, llamadas. | pendiente |
| `008_ingesta.sql` | ingestas, staging, `forense.inyecciones`, `clonar_corrida_con_inyeccion`. | pendiente |
| `009_runtime_eventos.sql` | `paso_en_cola`/`paso_checkpoint` en el catálogo de `tipo_evento` + catálogo ClaveProdServ por giro. | hecho |
| `010_runtime_funciones.sql` | Las 26 funciones que llaman los workflows (`abrir_corrida` … `eventos_salida_pendientes`), `revertir_expediente`, QA-002 y QA-003. Todas `returns table(...)` con las columnas exactas de `CONTRATOS_NODOS`. Aditiva: amplía los CHECK de `casos.estado` y `expedientes.estado_revision` re-declarándolos completos. | hecho |
| `011_metricas_corrida.sql` | `v_metricas_corrida` COMPLETA (`parcial: false`): carril de datos (baseline de dos pistas y selector de dos familias), acierto de caché, tasa de ronda 2 y reintentos por motivo. Solo `costo_usd` queda como `null` declarado. | hecho |
| `012_inyeccion_clusters.sql` | `asegurar_clusters_inyectados` (un cluster por RFC inyectado sin bajar el umbral) + `cola_corrida`. | hecho |
| `013_rendimiento.sql` | Índices de apoyo y `pista_f1` sin subconsulta correlacionada (equivalencia comprobada con `EXCEPT`). | hecho |
| `014_estadisticas.sql` | `analizar_snapshot()` + llamada al final de `clonar_corrida`, `clonar_corrida_con_inyeccion` y `cargar_o_clonar_snapshot`, y como primer paso de `correr_pistas`. El clon nace ANALIZADO. | hecho |
| `015_cobertura.sql` | `cobertura_caso` / `recalcular_cobertura`: la regla determinista de cobertura del caso, calculada en `cerrar_ronda` y `revalidar_caso` y expuesta en `paquete_auditor_final`. | hecho |
| `016_permisos_cobertura.sql` | Cierra los tres hallazgos del hotfix H11 sobre 014/015: revoca el `execute` a PUBLIC que faltaba en `analizar_snapshot`, `cobertura_caso` y `recalcular_cobertura`; corrige la condición (c) de `cobertura_caso` para medir la frontera que PIDIERON LAS SEÑALES y no `clusters.rfcs_frontera` (la lista de candidatos de 004, que nadie pidió y que dejaba la cobertura en false para todo cluster real); siembra `max_expansiones_caso=1` (03 §127); y deja UN escritor de `casos.cobertura_completa` quitando de `guardar_dictamen` la lectura del payload. | hecho |
| `017_evaluacion_pistas.sql` | Devuelve alcance a `anomalia_explicada`: `paquete_auditor_final` expone `evaluacion_caso` indexada por **ID** de pista (así la escribe `aplicar_resolucion_replica`, y `pista_objetivo` es un bigint por contrato); leerla por `codigo` la dejaba en null siempre y el nivel de descarte de falsos positivos era inalcanzable. Además `guardar_dictamen` recalcula la cobertura DESPUÉS del update, no dentro del SET, que leía los `pendientes` viejos. | hecho |

Fuera de migraciones: `seeds/seed_fake.sql` (fixture de UI, se aplica a mano tras
001+002; no participa en métricas) y `seeds/seed_producto.sql` (requiere 006+007).

## Propiedades que se mantienen

- **Idempotencia.** Todo es `IF NOT EXISTS` / `OR REPLACE` / `drop policy` + `create policy`.
  Los índices llevan nombre explícito para poder usar `create index if not exists`.
- **Portabilidad.** Corre en Postgres local y en Supabase: grants y realtime van dentro
  de bloques `DO` que comprueban `pg_roles` y `pg_publication`.
- **Aislamiento por corrida.** Ningún hecho se consulta sin `corrida_id`; claves
  compuestas y FK `(corrida_id, id)` impiden mezclar caso, cluster y tarea de corridas
  distintas.
- **Rastro.** `reservar_tool`, `advance_case_if_ready` y `clonar_corrida` escriben en
  `forense.bitacora` dentro de la misma transacción que muta estado.
- **Orden de locks:** caso → ejecución → cuota/slot, en todas las funciones.

## Pruebas

```sh
bash db/tests/run.sh                 # base desechable, la borra al terminar
KEEP=1 DB=forense_test_9 bash db/tests/run.sh
PGBIN=/otra/ruta/bin bash db/tests/run.sh
```

Crea una base nueva, aplica 001+002+003+seed, los reaplica (idempotencia), corre las
aserciones, valida que las pistas se proyecten al contrato `entities.pista` de
`contracts/` con ajv (se omite si falta `node` o `contracts/node_modules`) y termina
con una fase de concurrencia con varias sesiones (`next_seq`, carrera de leases).
Imprime una línea por aserción y devuelve exit code 0/1. No toca servicios remotos
ni la base compartida.

Última corrida: **109 aserciones, 0 fallidas, exit 0**; 20 pistas validadas contra
`contracts` v1.0.0, 0 fuera de contrato.

## Base local compartida

`forense` (Postgres 17 local) queda con **001 + 002 + 003 + seed_fake** aplicados para que
runtime y webapp integren contra datos reales del fixture, más la corrida **`gen-v1`**
del generador propio (`generator/gen.py --seed 42 --n 100` cargada con
`loaders/load_gen.py`): 100 contribuyentes, 8,081 CFDI, 6,006 movimientos,
`dataset_hash` 17a3e1ce…, con el barrido de pistas ya ejecutado.

| corrida | estado | para qué |
|---|---|---|
| `Fixture UI — no es evaluación` | `completada` | contratos y UI; no participa en métricas |
| `gen-v1` | `procesando` | pistas ya corridas (ver abajo); base de 004/005 y de evaluación |

`gen-v1` queda en `procesando` porque `correr_pistas` la reclamó: una corrida con
pistas calculadas no puede volver a anunciarse como `lista` sin mentir sobre su
estado. Para una corrida limpia, recargarla con
`python3 loaders/load_gen.py --in data/gen/ --nombre gen-v2`.

### Barrido de pistas sobre `gen-v1` (medido)

`select forense.correr_pistas(<gen-v1>)` → **1,101 ms**: D2 3, F1 5, F2 2, R1 49,
R2 38, T1 17, E1 26; 16 candidatos de `score_entidad`.

Contra el ground truth (que las pistas no leen): **16 de 17 entidades de fraude
sembradas** entran por el selector de dos familias, **0 de 15 trampas legítimas**
y **0 del fondo**. La que falta es el eslabón final de la cadena de `capas`: sólo
recibe facturas y nunca emite, así que deja familia R y ninguna más; entra por el
cluster (004) o por `/investigar`, no por el selector.

## Migraciones 012 y 013 (oleada 4)

`012_inyeccion_clusters.sql` — QA-004 y el cierre de corrida:

* `forense.asegurar_clusters_inyectados(corrida, inyeccion)` crea, por la ruta
  manual de 004 (`armar_cluster_para`), un cluster para cada RFC afectado por la
  inyección que no quedó dentro de ningún cluster de la corrida **nueva**.
  "Sin cluster" es pertenencia al array `rfcs`, no ser semilla. Cada cluster
  creado deja evento `inyeccion` con `payload.evento_real='cluster_garantizado'`;
  si `armar_cluster_para` devuelve null (sin `fecha_corte`, o RFC ausente del
  padrón de esa corrida) no hay cluster y **no** hay evento.
  Es idempotente y se niega a escribir sobre la corrida base.
* `clusters_por_prioridad_inyeccion` la llama primero (así el nodo
  `FORENSE_inyectar` hereda la garantía sin recablear) y devuelve **primero los
  garantizados**, después los afectados, después el resto por score. Mismas seis
  columnas de 010: el `SELECT *` del nodo no cambia.
* El selector de dos familias **no se toca**: garantizar el cluster no cambia
  `score_entidad` ni antes ni después (se afirma comparando el conteo antes y
  después en `assertions_012_gen.sql`). Esa es la diferencia entre garantizar
  investigación y bajar el umbral (la alternativa que se rechazó en H9 07:32).
  Corrección de la oleada 5: el paquete (c) **sí puede cruzar el selector** —
  está diseñado para cruzarlo (R1 por domicilio compartido + F1 por crédito
  comercial, ver `eval/inyecciones/README.md`), porque es ahí donde se mide la
  defensa. La aserción que exigía "fuera del selector" medía otra cosa y
  contradecía al propio paquete; ahora se afirma que el paquete trae con qué
  explicar la anomalía (compras reales a proveedores de la base, salida de
  dinero a personas morales identificadas, cero facturación interna) y el falso
  positivo se mide sobre el DICTAMEN en `eval/metricas.py`, no sobre el
  selector.
* `estado_corrida` conserva sus SEIS columnas —cambiarle el tipo de retorno haría
  que reaplicar 010 fallara con «cannot change return type» y el orden de
  migraciones dejaría de ser reaplicable— pero cambia el criterio: `terminada` y
  `estado_final` ya cuentan la cola de clusters, así que terminar de despachar no
  cierra una corrida con clusters sin empezar. El número se expone aparte en
  `forense.cola_corrida(corrida)` → `(clusters_total, cola_restante,
  casos_activos)`, que es aditiva. Se cuenta "pendiente sin caso" porque el
  cluster no pasa a `ronda1` hasta que el caso arranca la ronda 1. **Decisión
  registrada (oleada 5):** no se amplía `estado_corrida`; quien necesite el
  número llama a `cola_corrida`. Las dos conviven y ninguna migración posterior
  cambia la firma de `estado_corrida`.

### Rendimiento del barrido (013 + 014, medido)

Postgres 17 local, base desechable con el snapshot `gen-v1` (100 contribuyentes,
8 081 CFDI, 6 006 movimientos), medidos con `\timing` y `EXPLAIN (analyze,
buffers)`.

**1. Barrido sobre una corrida con estadísticas al día (lo que arregló 013),
tiempos cálidos:**

| paso | antes de 013 | después de 013 |
|---|---|---|
| `correr_pistas` completo | **1 108 ms** | **906 ms** |
| F1 conciliación | 372 ms | 70 ms |
| `refresh v_pares_giro` | 166 ms | 182 ms |
| E1 cercanía 69-B | 135 ms | 140 ms |
| R2 ciclos de dinero | 128 ms | 128 ms |
| F3 concentración | 99 ms | 101 ms |
| R1 atributos compartidos | 76 ms | 77 ms |
| resto (D1–D4, F2, F4, R3, T1, T2) | < 70 ms c/u | igual |

**2. Barrido sobre un CLON recién creado (el camino de la inyección en vivo, que
es lo que ve el juez). Ésta es la causa real de los segundos que se habían
atribuido a la formulación de F1:**

| escenario | `clonar_corrida` | `correr_pistas` |
|---|---|---|
| clon sin analizar (hasta 013) | 205 ms | **no terminó en 300 s** (`statement_timeout`, dentro de `pista_f1`) |
| clon analizado (014) | 417 ms (incluye `ANALYZE`) | **1 473 ms** (incluye un segundo `ANALYZE` de ~300 ms) |
| corrida base ya analizada, de referencia | — | 918 ms |

**Causa: estadísticas rancias, no la formulación de F1.** Las tablas de dominio
son COMPARTIDAS entre corridas (`corrida_id` es una columna, no una base
distinta). Al clonar se duplican miles de filas con un `corrida_id` que el
planeador no ha visto nunca: la lista de valores frecuentes de esa columna no lo
incluye, el estimador cree que la corrida nueva tiene ~1 fila y elige nested
loops en todo el barrido. La prueba de que es estadística y no álgebra: la MISMA
función, sobre la MISMA corrida, baja de minutos a ~1 s sólo con `analyze`.
La verificación de la oleada 4 midió 42 s / 243 ms en su máquina; aquí, con la
instancia local más cargada, el caso rancio ni siquiera terminó en 300 s. El
orden de magnitud es el mismo y la conclusión no depende del número.

**Arreglo (014):** `forense.analizar_snapshot()` corre al final de
`clonar_corrida`, `clonar_corrida_con_inyeccion` y `cargar_o_clonar_snapshot`, y
como primer paso de `correr_pistas` (defensa para cualquier corrida que llegue
por otro camino). `ANALYZE` sin `VACUUM` es válido dentro de una función y de una
transacción, y toma `ShareUpdateExclusiveLock`, que no bloquea lecturas ni
escrituras normales. Cada llamada deja evento en `forense.bitacora`
(`corrida_cargada` / `evento_real=estadisticas_analizadas`, regla 2). Medido por
`db/tests/assertions_014_gen.sql`, que exige el barrido del clon por debajo de
5 s.

**Lo que escala mal y queda declarado:**

* El `ANALYZE` es de TABLA COMPLETA: su costo crece con el total de filas de
  todas las corridas juntas, no con las del clon. Con un puñado de clones son
  ~300 ms; con decenas, hay que pasar a `analyze` por partición o a tablas por
  corrida, que ya no es aditivo.
* El histograma de `corrida_id` (statistics target 100 por omisión) se degrada a
  medida que crece el número de corridas: llegado ese punto, el arreglo correcto
  es `alter table ... alter column corrida_id set statistics`, no más índices.
* `refresh materialized view forense.v_pares_giro` sigue siendo GLOBAL (agrupa
  por `corrida_id` sobre `v_agregado_rfc` de todas las corridas), así que cada
  clon encarece el refresh de todas las demás: ~180 ms hoy, y sube con cada
  corrida viva. Pasarla a por-corrida exige tocar las lecturas de D1/D2/D4 y no
  es aditivo: queda para la oleada siguiente.
* **Índice por `corrida_id` en `v_pares_giro`:** ya existe. El índice ÚNICO
  `ux_pares_giro (corrida_id, giro)` sirve `where corrida_id = ?` como columna
  principal; añadir un segundo índice sólo por `corrida_id` sería redundante y
  añadiría un índice más que reconstruir en cada `refresh` (coste por clon, que
  es justo lo que se quiere bajar). 014 lo comprueba en tiempo de migración y
  crea el índice sólo si algún día desaparece esa clave única;
  `db/tests/assertions_014.sql` afirma que existe un índice con `corrida_id` como
  primera columna.

**Sobre los ≈46 s del e2e de runtime:** siguen sin reproducirse en Postgres local
para el barrido de una corrida ya cargada (906–1 108 ms). Lo que sí se
reproducía en local —y ya está arreglado— es el clon sin analizar.
