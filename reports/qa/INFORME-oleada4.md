# Informe QA — oleada 4 (H9–H10)

Dueño: **forense-qa**. Worktree `.claude/worktrees/wf_be493659-06a-5`, rama
`worktree-wf_be493659-06a-5`, integrada con `main` (b5374b8 + 010/011) y con
las ramas de forense-db (`worktree-wf_be493659-06a-1`, migraciones 012 y 013) y
forense-runtime (`worktree-wf_709be85c-2c7-2`) antes de empezar.

Todo lo que aquí se afirma se ejecutó. Ningún número sale de leer código: cada
sección lleva su comando y su exit code. `verificado ≠ fixture`: las pruebas de
DB corren contra Postgres local (`forense_qa`, migraciones 001–013 aplicadas +
datos clonados de la base compartida `forense`, que sólo se lee), y las de
webapp contra `next start` con el build real.

## Preparación del banco

```
DATOS=clon bash tests/integration/preparar-db.sh     # exit 0
npm run build --prefix web                            # exit 0
```

`preparar-db.sh` ya aplicaba 010–012; ahora aplica también `013_*`. No es
cosmético: sin 013 el banco mide la F1 de 003 y la prueba de rendimiento de
esta oleada dejaría de medir lo que dice medir. Resultado de esta corrida:
001–008 ok, `009_editor.sql` ausente (no bloquea), `009_runtime_eventos.sql`,
`010_runtime_funciones.sql`, `011_metricas_corrida.sql`,
`012_inyeccion_clusters.sql` y `013_rendimiento.sql` ok.

## 1. El e2e detecta el build rancio (encargo 1)

Lo que la oleada 3 dejó anotado como riesgo de proceso —«la prueba se salta
sola si falta `web/.next`, pero no puede detectar un build **rancio**»— ya no
es un riesgo: es una prueba.

`tests/e2e/webapp.test.mjs` compara el mtime de `web/.next/BUILD_ID` con la más
nueva de dos señales:

1. el último commit de `HEAD` que toca `web/` (`git log -1 --format=%ct HEAD -- web`);
2. el mtime más nuevo de los archivos de `web/` **rastreados por git**, que es
   lo único que ve un cambio editado y sin commitear. `.next` y `node_modules`
   están en `.gitignore`, así que no se cuentan a sí mismos.

Si el build es más viejo, la prueba **falla** nombrando el SHA y las dos
fechas, y el resto del archivo se **salta con motivo** para que ningún `ok`
cuelgue de bits viejos. Con `E2E_RECONSTRUIR=1` reconstruye antes de registrar
las pruebas, y si el build falla, lo dice con el exit code de npm.

Verificado en los dos sentidos, no sólo en el que conviene:

| Estado | Comando | Exit | Resultado |
|---|---|---|---|
| BUILD_ID envejecido a mano (`touch -t 202609120100`) | `node --test "tests/e2e/*.test.mjs"` | **1** | `not ok 1 - el build de web/.next no está rancio`, 1 prueba saltada con motivo |
| Reconstruido (`npm run build --prefix web`) | `node --test "tests/e2e/*.test.mjs"` | **0** | 8 pruebas: 8 pass, 0 fail, 0 skipped |

El mensaje real de la corrida en rojo, tal cual:

```
build rancio: web/.next/BUILD_ID es de 2026-09-12 07:00:00 y archivo
web/app/(app)/datos/datos-wizard.test.tsx sin reconstruir es de
2026-09-12 10:24:49 (12289 s más nuevo): el e2e estaría probando un build
viejo. Corre `npm run build --prefix web` (o E2E_RECONSTRUIR=1 ...).
```

Nota de uso: un `git merge` rescribe el mtime de los archivos que toca, así que
**después de cada integración hay que reconstruir**. Es exactamente lo que se
quiere: tras una integración nadie puede afirmar que la webapp pasa sin haber
reconstruido.

## 2. QA-004 cerrada: la garantía la da el sistema, no la prueba (encargo 2)

Hasta la oleada 3, `inyeccion-ensayos-bc.test.mjs` tapaba el hueco de QA-004
llamando a `forense.armar_cluster_para` RFC por RFC. Eso es reimplementar en el
banco la garantía que el sistema no daba: verde en la prueba, agujero en
producción. Ahora la prueba llama a la **misma** función que llama
`FORENSE_inyectar`, `forense.asegurar_clusters_inyectados(corrida, inyeccion)`
(012), y comprueba cuatro cosas por ensayo:

- cada RFC de `rfcs_afectados` vuelve con `cluster_id` **no nulo** y el cluster
  lo contiene de verdad (`rfc = any(rfcs)`): el `null` que devuelve la función
  cuando `armar_cluster_para` se rinde es el modo de fallo de QA-004, no un
  aprobado;
- lo que se creó dejó `cluster_garantizado` (y el resumen
  `clusters_garantizados`) en `forense.bitacora` con el `cluster_id` correcto
  (regla 2);
- repetir la llamada no crea clusters nuevos ni vuelve a marcar `creado`;
- `clusters_por_prioridad_inyeccion` —la cola que lee el workflow— pone los
  garantizados en las primeras posiciones, así que el despacho hereda la
  garantía sin recablear nada.

El ensayo (c) mantiene lo que ya probaba: la trampa legítima entra al selector
(R1+F1, dos familias), se comprueban los cuatro discriminadores en SQL puro, y
el dictamen **determinista** (`n8n/runtime/auditor-final.mjs`, regla 4) no
puede salir `presuncion` ni `presuncion_alta`.

| Comando | Exit | Resultado |
|---|---|---|
| `node --test tests/integration/inyeccion-ensayos-bc.test.mjs` | **0** | 20 pruebas: 20 pass, 0 fail |

Lo que dejaron dicho las dos corridas: (b) 4 RFC afectados y **1** cluster
creado por la garantía (los otros tres ya estaban cubiertos por el selector);
(c) 8 RFC afectados y **4** clusters creados —sin 012 esos cuatro RFC no los
habría despachado nadie—. El dictamen de (c): `nivel=no_concluyente`,
`cobertura_completa=false`, 74 pistas, 0 evidencia validada. Correcto: sin
evidencia validada el camino determinista no puede subir de ahí, y desde luego
no a `presuncion`.

## 3. `estado_corrida` con clusters pendientes (encargo 3)

`tests/integration/estado-cola-012.test.mjs` arma una corrida propia con SEIS
clusters, despacha CUATRO con `forense.crear_caso` y los cierra como
`dictaminado` con `forense.cerrar_caso`.

Ese escenario es el mínimo que distingue 012 de 010, y los cuatro casos se
cierran a propósito: si se dejaran abiertos, `en_cola > 0` y la prueba pasaría
también con la versión vieja sin probar nada.

| Momento | 010 (antes) | 012 (ahora) |
|---|---|---|
| 6 clusters, 0 casos | `sin_clusters` | `en_curso`, cola 6/6 |
| 4 despachados y dictaminados | `completada`, `terminada=true` | `en_curso`, `cola_restante=2` |
| 6 despachados | `completada` | `completada`, cola 0 |

Cubre además que un cluster agregado **después** reabre la corrida (es el
cluster garantizado de una inyección en vivo, que nace cuando la corrida ya
estaba despachando), que `corridas.estado='completada'` manda sobre la cola, y
que los seis despachos dejaron su `caso_creado` en bitácora.

```
node --test tests/integration/estado-cola-012.test.mjs   # exit 0 — 7 pruebas
```

## 4. Rendimiento de `correr_pistas` (encargo 4) — HALLAZGO ALTO

`tests/integration/rendimiento-pistas.test.mjs` clona gen-v1 (regla 10:
`correr_pistas` escribe, así que nunca se ejecuta sobre la corrida base),
cronometra el barrido y **falla si supera 30 s**, el gate de la inyección en
vivo (21 §3). Cuando se pasa, cronometra las 14 pistas por separado sobre otro
clon y nombra a la culpable.

```
node --test tests/integration/rendimiento-pistas.test.mjs   # exit 1 — 68 801 ms
```

### Mediciones (todas ejecutadas; `psql \timing` y la propia prueba)

| Qué | Valor |
|---|---|
| `clonar_corrida(gen-v1)` | 244 ms |
| `correr_pistas` sobre el clon, medición 1 (`psql`) | **42 971 ms** |
| `correr_pistas` sobre el clon, medición 2 (`psql`) | **43 121 ms** |
| `correr_pistas` sobre el clon, medición 3 (`psql`) | **68 703 ms** |
| `correr_pistas` sobre el clon, medición 4 (la prueba, exit 1) | **68 801 ms** |
| Desglose de la prueba: `F1` | **42 762 ms** |
| Desglose de la prueba: `F3` | 4 773 ms |
| Desglose de la prueba: las otras 12 + `refresh v_pares_giro` | < 450 ms cada una |
| `pista_f1` con un `analyze` **posterior al clon** (121 ms de analyze) | **242 ms** |

Tres conclusiones, en orden de importancia:

1. **El barrido no cabe hoy en el gate de 30 s.** El valor real medido está
   entre 43 s y 69 s sobre un clon de gen-v1 (100 contribuyentes, 8 081 CFDI,
   6 006 movimientos). QA no sube el umbral: el umbral es del juez.
2. **La culpable es una sola pista: F1** se lleva 42 de los 48 s del desglose;
   las otras trece suman menos de 6 s, y F3 (4.8 s) es la única otra visible.
3. **No es la máquina: es el efecto de estadísticas anteriores al clon**
   (medido; no se corrió `EXPLAIN`, así que se afirma el efecto, no el plan).
   No es una consulta lenta aislada: entre dos desgloses del **mismo**
   snapshot, en la misma base y con minutos de diferencia, varias pistas se
   mueven un orden de magnitud, que es justo lo que hace una estimación mala y
   no lo que hace una máquina cargada.

   | pista | desglose 1 | desglose de la prueba |
   |---|---|---|
   | F1 | 42 343 ms | 42 762 ms |
   | F3 | 104 ms | 4 773 ms |
   | F2 | 17 ms | 244 ms |

   Y la comprobación directa: la misma
   `pista_f1`, sobre el mismo snapshot y la misma base, tarda 42 762 ms si las
   estadísticas se calcularon **antes** del clon y 242 ms si se calculan
   **después** (175×; el `analyze` de las cuatro tablas cuesta 121 ms).
   `clonar_corrida` duplica las filas de `cfdi` y `movimientos` y nadie las
   analiza, así que el planificador estima mal la selectividad por corrida. En
   la corrida de la prueba las estadísticas existían (04:56:04) pero eran
   **anteriores** al clon: F1 volvió a 42 s. El `not exists` correlacionado de
   003 era lento pero estable; la reescritura de 013 es mucho más rápida **y**
   mucho más sensible a las estadísticas.

**Lo que se pide a forense-db (QA no toca `db/`):** que
`forense.clonar_corrida` y `forense.clonar_corrida_con_inyeccion` terminen con
`analyze forense.cfdi, forense.movimientos, forense.cuentas,
forense.complementos_pago` (o que `correr_pistas` lo haga antes del fan-out).
Cuesta ~120 ms y es la diferencia entre 43–69 s y ~1 s en el camino exacto que
seguirá el juez: clonar → recalcular → reordenar la cola. Mientras no esté, la
prueba de rendimiento queda **en rojo a propósito**: es el aviso de que la
inyección en vivo tarda más de un minuto en reaccionar.

### Efecto colateral que ya se arregló en el banco

Un `psql` matado por timeout **no mata la consulta en el servidor**: el backend
seguía corriendo con el lock de `v_pares_giro` (que `correr_pistas` refresca) y
la prueba siguiente se bloqueaba detrás de un proceso que ya nadie miraba. Así
se veía: dos `correr_pistas` abandonados de 15 y 10 minutos, y un `delete`
esperando en `Lock/transactionid`. `tests/integration/_ayudas.mjs` ahora fija
`statement_timeout` 20 s por debajo del timeout del cliente, de modo que el
servidor cancela primero y el motivo viaja en stderr.

## 5. El banco completo

| Suite | Comando | Exit | Resultado |
|---|---|---|---|
| Integración (12 archivos) | `node --test --test-concurrency=1 "tests/integration/*.test.mjs"` | **1** | 149 pruebas: 147 pass, **2 fail**, 0 skipped, 299 s |
| E2E webapp | `node --test "tests/e2e/*.test.mjs"` | **0** | 8 pruebas: 8 pass, 0 fail, 0 skipped |

Los dos `fail` son **el mismo hallazgo**: `rendimiento-pistas.test.mjs` (la
prueba y su padre). El único `^not ok` de nivel superior en toda la corrida es
`correr_pistas sobre un clon de gen-v1 cabe en el gate de 30 s`. Ninguna otra
prueba se rompió con el cambio de `_ayudas.mjs`, que es el único archivo de
esta oleada que usan los doce archivos del banco.

**Para quien integre:** mientras el hallazgo de §4 siga abierto, la suite de
integración sale con **exit 1** por ese único motivo, y cada corrida paga ~49 s
extra de desglose y deja dos clones de 8 k CFDI en `forense_qa` si se la mata a
media prueba. No es una regresión: es el aviso.

## 6. Lo que NO se probó

- Nada de esto llama al modelo. El dictamen que se comprueba es el determinista
  (`auditor-final.mjs`); la calidad de la redacción del LLM no se mide aquí.
- El gate de 30 s se mide en Postgres **local** con dos sesiones ajenas de
  otros agentes ocupando dos núcleos durante toda la ventana. Supabase es otra
  máquina: el número de allá lo tiene que medir quien aplique las migraciones.
- La prueba de build rancio compara fechas, no contenido: un `git merge` que
  reescribe un archivo con el mismo contenido también la dispara. Es
  conservadora a propósito.
