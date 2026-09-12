# Informe QA — oleada 5 (H11, hotfix)

Dueño: **forense-qa**. Worktree `.claude/worktrees/wf_be493659-06a-5`, rama
`worktree-wf_be493659-06a-5`, con `main` (952f920), `worktree-wf_be493659-06a-1`
(forense-db: migraciones 014 y 015) y `worktree-wf_709be85c-2c7-2`
(forense-runtime) mergeadas antes de empezar.

Todo lo que aquí se afirma se ejecutó. Ningún número sale de leer código: cada
sección lleva su comando y su exit code.

## Resumen de cifras

| Medición | Oleada 4 | Oleada 5 | Gate |
|---|---|---|---|
| `correr_pistas` sobre un clon de gen-v1 | **42 000 ms** (fallaba) | **1 440 ms** | < 30 000 ms |
| Suite de integración | 149 pruebas, 1 fallo, 58,0 s | **157 pruebas, 0 fallos, 38,0 s** | exit 0 |
| Suite e2e | — | **8 pruebas, 0 fallos, 1,1 s** | exit 0 |

Tres medidas del barrido en esta sesión: 1 348 / 1 366 / 1 440 ms. Margen sobre
el gate de la inyección en vivo: **28 560 ms**.

## Preparación del banco

```
DATOS=clon bash tests/integration/preparar-db.sh          # exit 0
npm --prefix web run build                                # exit 0
```

`preparar-db.sh` se quedaba en 013. Ahora aplica también **014 y 015**, las dos
condicionales como las anteriores (el banco tiene que correr contra el HEAD de
hoy y contra el de mañana). Resultado de esta corrida: 001–008 ok,
`009_editor.sql` ausente (no bloquea), `009_runtime_eventos.sql`,
`010_runtime_funciones.sql`, `011_metricas_corrida.sql`,
`012_inyeccion_clusters.sql`, `013_rendimiento.sql`, `014_estadisticas.sql`,
`015_cobertura.sql` ok; datos clonados de la base compartida `forense` (que
sólo se lee) y `seed_producto.sql` ok; 24 grants de SELECT a `anon`.

No aplicarlas no era cosmético en ninguno de los dos casos: sin 014 el banco
mide un clon sin estadísticas, y sin 015 `cobertura_completa` no la escribe
nadie, así que la prueba de dictamen mediría una columna muerta.

## 1. Rendimiento: 42 s → 1,4 s, y la causa no es la máquina

```
node --test --test-concurrency=1 tests/integration/rendimiento-pistas.test.mjs   # exit 0
```

```
[rendimiento] correr_pistas = 1440 ms sobre un clon de gen-v1
              (155 pistas; umbral 30000 ms; margen 28560 ms)
[estadisticas] último ANALYZE: cfdi=NUNCA complementos_pago=NUNCA
               cuentas=NUNCA movimientos=NUNCA
```

Cuidado con leer mal esa segunda línea: se toma en la subprueba de inventario,
ANTES de clonar, y describe el estado de partida de la base —`pg_dump
--data-only` + `pg_restore` no dejan estadísticas—, no el estado durante la
medición. Las tablas de dominio son **compartidas** (`forense.cfdi` con
`corrida_id`), así que no existe un objeto de estadísticas «del clon»: lo que
hace `forense.analizar_snapshot` es un `ANALYZE` sobre las siete tablas de
dominio, y 014 lo llama dentro de `clonar_corrida`. Medido después de la corrida
del banco, las cuatro tablas tienen ANALYZE de hoy.

La conclusión de la oleada 4 sí se sostiene y es la que importa: la diferencia
entre 0,2 s y 42 s en `pista_f1` sobre el MISMO snapshot era un **cambio de plan
por falta de estadísticas**, no una máquina cargada. Lo que cambió en 014 es que
materializar un snapshot ya no deja al planeador estimando una fila.

El umbral sigue en 30 000 ms y no se tocó. QA no sube umbrales.

## 2. `cobertura_completa` y el dictamen `presuncion`, por el camino real

Fichero nuevo: `tests/integration/cobertura-dictamen-015.test.mjs` (7 pruebas).

```
node --test tests/integration/cobertura-dictamen-015.test.mjs   # exit 0
[dictamen] nivel=presuncion familias=F,T
           regla="2 familia(s) sustentadas: F, T → presuncion"
           cobertura=true evidencia=2 pistas=15
```

`db/tests/assertions_015.sql` ya comprueba la regla sobre un caso construido con
INSERT. Esta prueba es la otra mitad: el mismo resultado sobre un clon de gen-v1
y **sin un solo UPDATE ni INSERT directo** sobre tablas del pipeline. La cadena
completa son funciones:

```
clonar_corrida (014) → correr_pistas (014) → armar_clusters (004)
crear_caso (005) → crear_tareas_ronda (005)
forense_registrar_evidencia (005) → forense_validar_evidencia (005)
claim_step / finish_step (002) → recalcular_cobertura (015)
paquete_auditor_final (015) → dictaminar() (n8n/runtime/auditor-final.mjs)
```

Lo que se comprueba, en orden:

1. Cinco tareas despachadas y pendientes → `cobertura_caso = false`. El punto de
   partida importa: sin él, el `true` del final no probaría que lo puso la regla.
2. Dos familias de evidencia (F y T) registradas por los especialistas
   `financiero` y `temporal`, citando **CFDI reales de la corrida**. El
   `validada = true` lo pone `forense_validar_evidencia` contra `forense.cfdi`,
   no la prueba. Un INSERT con `validada = true` se saltaría al validador, que es
   justo quien decide si una cita sostiene algo.
3. Las cinco tareas cerradas con `claim_step` + `finish_step` (que es quien
   traduce `terminado` → `completada`) → `recalcular_cobertura` devuelve `true`,
   lo persiste y deja su evento `cobertura_recalculada` en `forense.bitacora`
   con `antes=false / despues=true` (regla 2).
4. `dictaminar()` sobre el paquete → **`presuncion`**, familias `['F','T']`.
   No `presuncion_alta`: haría falta una tercera familia o E1 con estatus firme
   del SAT a 0 saltos, y ninguna evidencia de la prueba es de familia E. Nunca
   «definitivo», que no es un nivel del sistema (regla 7).
5. Una sexta tarea (ronda 2) cerrada con `finish_step … 'error'` →
   `recalcular_cobertura` vuelve a `false` y **el mismo dictamen, con la misma
   evidencia de dos familias, baja a `no_concluyente`**. Ausencia de señal no es
   ausencia de fraude, y agotar reintentos nunca sube el nivel (regla 10).

El cluster se elige **sin frontera pendiente** a propósito: con RFC de frontera
fuera del cluster y presupuesto de expansión sin gastar, 015 deja la cobertura
en `false` por diseño, y medir el `true` ahí sería medir el caso equivocado.

### HALLAZGO — `dictaminar(paquete_auditor_final(...))` lanza con evidencia CFDI

`dictaminar()` exige `evidencia[].hecho_validado.monto_centavos`,
`caso.n_reintentos` y `presupuesto.permite_reintento`. **Ninguno de los tres
sale así de `forense.paquete_auditor_final`**: `monto_centavos` va al nivel
superior del item, no dentro de `hecho_validado`. Los arma el nodo Postgres que
va JUSTO ANTES del Code node en `FORENSE_investigar_cluster`. Llamado sobre el
paquete crudo con una evidencia de tipo `cfdi` validada, el dictaminador tira
`Monto validado ausente/inválido para CFDI:…`.

No es un fallo: el adaptador existe y funciona. Es una **frontera frágil** que
estaba latente porque ninguna prueba llegaba nunca a tener evidencia `cfdi`
VALIDADA (`inyeccion-ensayos-bc` llama a `dictaminar()` sobre el paquete crudo y
pasa sólo porque su lista de evidencia está vacía). Para que la prueba no
certifique un adaptador que n8n ya no ejecute, **la consulta se lee del workflow
exportado** (`n8n/workflows/FORENSE_investigar_cluster.json`, el único nodo que
menciona `paquete_auditor_final`) en vez de copiarse al banco. Si alguien cambia
el nodo, la prueba cambia con él; si alguien lo borra, la prueba lo dice.

## 3. Limpieza de clones huérfanos al arrancar la suite

`limpiarClonesHuerfanos()` en `tests/integration/_ayudas.mjs`, ejecutada al
cargar el módulo (o sea al arrancar cada fichero de prueba, antes de que ninguno
cree estado).

```
[limpieza] 1 clon(es) huérfano(s) de gen-v1 borrados (> 0 min):
           gen-v1 + inyección 176d28dd (8084 CFDI)      # exit 0
```

Ese clon lo dejaba `inyeccion-008` en cada corrida del banco: 8 084 CFDI por
ejecución. No es orden doméstico — `rendimiento-pistas` mide compitiendo contra
ellos y su propio aviso («N corrida(s) grandes además de gen-v1») lo dice.

Dos anclas para que el barrido no pueda borrar de más:

- `corrida_origen_id = gen-v1`. gen-v1 tiene origen NULL, así que la consulta no
  puede alcanzarla ni aunque cambie de nombre. Un `LIKE` sobre el nombre sí
  podría: `gen-v1 + inyección …` y `gen-v1` comparten prefijo.
- Edad > 30 min. El techo de prueba más alto del banco es 15 min, así que un
  clon de la sesión EN CURSO nunca llega a esa edad: el barrido sólo alcanza
  restos de ejecuciones anteriores, aunque node lance los ficheros en paralelo.

Y `inyeccion-008` ya borra el suyo en `t.after` (también si una subprueba falla):
barrer restos ajenos está bien, producirlos no. Comprobado después de la corrida
completa de la sección 5: `select count(*) from forense.corridas where
corrida_origen_id = <gen-v1>` devuelve **0**, o sea que el `t.after` dispara y el
barrido no está tapando un clon que nadie borra.

## 4. El techo de node estaba por debajo del techo de psql (QA-006)

`inyeccion-008` declaraba tres pruebas a `timeout: 120000` contra un cliente
psql de 300 000 ms y un `statement_timeout` de 280 000 ms. El orden estaba
invertido y con la máquina cargada —que es cuando corre la suite entera, y
cuando el juez inyecta en vivo— **node cortaba antes que el servidor**. Dos
daños, los dos malos:

1. El diagnóstico se pierde: node reporta «test timed out», no el error de SQL.
2. El backend sigue vivo con el lock de `v_pares_giro` que `correr_pistas` toma
   para refrescarla, así que la prueba siguiente se bloquea detrás de un proceso
   que ya nadie está mirando. Es justo el escenario contra el que
   `_ayudas.mjs` diseñó su `statement_timeout`, anulado por el techo de node.

Invariante encodado: **`statement_timeout` < timeout del cliente psql <
timeout de la prueba**. `techoPrueba(n)` lo deriva del techo del cliente
(`TIMEOUT_MS × n + 60 s`) y se aplicó a los cinco ficheros que declaraban
literales (`inyeccion-008`, `inyeccion-ensayos-bc`, `estado-cola-012`,
`tools-payload`, `rendimiento-pistas`). Una guarda nueva en
`rendimiento-pistas.test.mjs` recorre todos los `*.test.mjs` del directorio y
falla si vuelve a aparecer un literal por debajo de `TIMEOUT_MS`: arreglarlo en
un fichero y no en el resto sólo lo hace volver por otro.

## 5. Suite completa

```
node --test --test-concurrency=1 "tests/integration/*.test.mjs"
# tests 157 · pass 157 · fail 0 · duration_ms 38038      # exit 0

npm --prefix web run build && node --test "tests/e2e/*.test.mjs"
# tests 8 · pass 8 · fail 0 · duration_ms 1089           # exit 0
```

La suite de integración pasó de 149 a 157 pruebas (las 7 nuevas de cobertura y
la guarda de techos) y de 58,0 s a 38,0 s: el barrido de pistas dejó de ser el
tramo caro.

## BLOQUEO abierto — no es de QA y no se puede cerrar desde aquí

`db/014_estadisticas.sql` y `db/015_cobertura.sql` **no repiten el
`revoke execute … from public`** con el que terminan 002–006. Tres funciones
nuevas quedan ejecutables por PUBLIC, y PUBLIC incluye a `anon`, que tiene
`usage` sobre el schema `forense` (lo imprime la propia comprobación de
`preparar-db.sh`):

```
funciones de forense ejecutables por PUBLIC:
  analizar_snapshot, cobertura_caso, recalcular_cobertura
```

No es el hueco cosmético de QA-002 (funciones de trigger, que Postgres rechaza
en cualquier invocación directa). **`recalcular_cobertura` es `security definer`
y MUTA**: escribe `forense.casos.cobertura_completa` y una fila en
`forense.bitacora`. `analizar_snapshot` dispara ANALYZE sobre las tablas grandes.

Arreglo, tres líneas, dueño **forense-db**:

```sql
revoke execute on function forense.analizar_snapshot(uuid) from public;           -- db/014
revoke execute on function forense.cobertura_caso(uuid) from public;              -- db/015
revoke execute on function forense.recalcular_cobertura(uuid, text) from public;  -- db/015
```

**Verificado**: aplicadas ad hoc sobre `forense_qa` (sin tocar ningún fichero de
`db/`, que es ownership de forense-db), `rls-scope.test.mjs` pasa 9/9, exit 0.
Sin ellas la suite de integración da **156/157 con un fallo**; con ellas,
157/157. Los números de la sección 5 se midieron con las tres aplicadas: el
`exit 0` de la suite depende de que forense-db las añada a las migraciones.

## Lo que queda anotado para la siguiente oleada

- La frontera `paquete_auditor_final` → `dictaminar()` depende de un adaptador
  que vive en un nodo del workflow. Hoy hay una prueba que lo ejercita leyendo
  el propio workflow; lo robusto sería que la función emitiera ya la forma que
  el dictaminador consume, o que el adaptador viviera en `n8n/runtime/` con su
  test unitario. Decisión de forense-db + forense-runtime, no de QA.
- `armar_clusters` sobre un clon de gen-v1 arma 4 clusters y sólo algunos
  quedan sin frontera pendiente. Si en el demo todos los clusters del caso a
  enseñar tienen frontera sin expandir, el dictamen saldrá `no_concluyente` con
  razón y hay que contarlo como tal, no como un fallo del sistema.
