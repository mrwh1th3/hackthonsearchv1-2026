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
* El selector de dos familias **no se toca**: sobre el paquete (c) el RFC tiene
  cluster y sigue fuera de `score_entidad`. Esa es la diferencia entre garantizar
  investigación y bajar el umbral (la alternativa que se rechazó en H9 07:32).
* `estado_corrida` conserva sus SEIS columnas —cambiarle el tipo de retorno haría
  que reaplicar 010 fallara con «cannot change return type» y el orden de
  migraciones dejaría de ser reaplicable— pero cambia el criterio: `terminada` y
  `estado_final` ya cuentan la cola de clusters, así que terminar de despachar no
  cierra una corrida con clusters sin empezar. El número se expone aparte en
  `forense.cola_corrida(corrida)` → `(clusters_total, cola_restante,
  casos_activos)`, que es aditiva. Se cuenta "pendiente sin caso" porque el
  cluster no pasa a `ronda1` hasta que el caso arranca la ronda 1.

### Rendimiento del barrido (013, medido)

Postgres 17 local, base desechable con el snapshot `gen-v1` (100 contribuyentes,
8 081 CFDI, 6 006 movimientos), tiempos **cálidos** (segunda ejecución), medidos
con `\timing` y `EXPLAIN (analyze, buffers)`:

| paso | antes | después |
|---|---|---|
| `correr_pistas` completo | **1 108 ms** | **906 ms** |
| F1 conciliación | 372 ms | 70 ms |
| `refresh v_pares_giro` | 166 ms | 182 ms |
| E1 cercanía 69-B | 135 ms | 140 ms |
| R2 ciclos de dinero | 128 ms | 128 ms |
| F3 concentración | 99 ms | 101 ms |
| R1 atributos compartidos | 76 ms | 77 ms |
| resto (D1–D4, F2, F4, R3, T1, T2) | < 70 ms c/u | igual |

F1 era el `not exists` correlacionado: el plan lo ejecutaba 5 120 veces (una por
CFDI PUE de la ventana) y tocaba 44 426 buffers para 6 006 movimientos. Resuelto
los pagos una sola vez, baja a 13 ms la parte de conciliación. Mismo resultado
comprobado con `EXCEPT` en las dos direcciones (los 1 471 CFDI PUE sin conciliar
son los mismos) y con `db/tests/assertions_013.sql`, que recalcula F1 con la
formulación original de 003 en cada corrida de la base de prueba.

**Sobre los ≈46 s del e2e de runtime:** no se reproducen en Postgres local. El
barrido medía 1 101 ms en H7 (arriba) y 1 108 ms ahora sobre el mismo snapshot.
Los 46 s son del e2e completo contra el proyecto remoto, no del SQL: ahí entran
la latencia de red por llamada y una instancia compartida. Lo que sí escala mal
y queda **abierto** es `refresh materialized view forense.v_pares_giro`: la
matview es GLOBAL (agrupa por `corrida_id` sobre `v_agregado_rfc` de todas las
corridas), así que cada clon de inyección encarece el refresh de todas las demás.
Pasarla a por-corrida exige tocar las lecturas de D1/D2/D4 y no es aditivo: va a
la oleada siguiente.
