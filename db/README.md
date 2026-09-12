# /db — Migraciones SQL

Orden de aplicación (docs/05 §Orden de migraciones + docs/17 §4):

| Archivo | Contenido | Estado |
|---|---|---|
| `001_schema.sql` | Tablas de dominio, detección, pizarrón, casos/trazabilidad **y** control de runtime (`ejecuciones_agente`, `artefactos_contexto`, `llm_solicitudes`, `tool_ejecuciones`, `pasos_pipeline`, `slots_runtime`), índices, RLS, grants, realtime. `tipo_evento` incluye `inyeccion` (docs/21 §3.2). | hecho |
| `002_views.sql` | `next_seq`, `log`, `reservar_tool`, leases de cluster/tarea, helpers de caché, helpers de runtime con fencing, `v_casos_lista`, `v_agregado_rfc`, `v_pares_giro` (materializada), `v_grafo`, `v_trayectoria_rfc`, `clonar_corrida`, `v_metricas_corrida` (**parcial**). | hecho |
| `003_pistas.sql` | Primera entrega de pistas (D2, F1, F2, R1, R2, E1, T1) + `correr_pistas` (claim atómico `lista`→`procesando`) + `marcar_no_evaluable` + `score_entidad` (regla de dos familias). Segunda entrega pendiente: D1, D3, D4, F3, F4, R3, T2. | hecho |
| `004_clusters.sql` | `armar_clusters`, `expandir_cluster`. | pendiente |
| `005_rpc.sql` | 11 herramientas `public.forense_*` + validación/despertar/frontera. | pendiente |
| `006_producto_ui.sql` / `007_notificaciones_voz.sql` | perfiles, investigaciones, outbox, llamadas. | pendiente |
| `008_ingesta.sql` | ingestas, staging, `forense.inyecciones`, `clonar_corrida_con_inyeccion`. | pendiente |

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
aserciones y una fase de concurrencia con varias sesiones (`next_seq`, carrera de
leases). Imprime una línea por aserción y devuelve exit code 0/1. No toca servicios
remotos ni la base compartida.

## Base local compartida

`forense` (Postgres 17 local) queda con **001 + 002 + 003 + seed_fake** aplicados para que
runtime y webapp integren contra datos reales del fixture.
