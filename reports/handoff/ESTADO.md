# ESTADO — coordinador

Actualizado: 2026-09-11 H0 (≈21:45, America/Monterrey). Dueño: coordinador (opus). Ver DECISIONES.md para el camino.

## Gate de inicio
- `hackathon_started=true` (usuario: "arranca YA todo el proyecto"). `node scripts/launch.mjs --check` pasa tras el commit baseline.
- Contratos **v1.1.0** (añade `product.inyectar` y `product.inyeccion`, 21 §3): `npm test --prefix contracts` → 98/98 OK (commit f6a9653).

## Destinos (verificados por lectura)
| Destino | Estado |
|---|---|
| GitHub | origin `mrwh1th3/hackthonsearchv1-2026`, **privado** desde 2026-09-11 (petición del usuario). |
| Supabase | proyecto `hackthon2026` (ref `wplsldwzpyocmwzeyarj`). **Aplicadas 001_schema, 002_views, 003_pistas (versiones 20260912050501/050846/051124) y seed_fake** (corrida fixture con 3 casos, 30 eventos). RLS 29/29, 22 policies de lectura, 7 tablas privadas sin policy (diseño), realtime en bitacora/casos/clusters/expedientes/pistas/senales. Advisors: solo INFO/WARN de plataforma. **Aplicadas 019 y 020 el 2026-09-12** (versiones 20260912160948/161051), verificadas por md5: `pista_t2` `ca9a2790…` (10 557, y cambió desde el `454f6019…` de 003), `v_contraste_caso` `17eda3f6…` (9 497, cambió desde el `cf534c8a…` de 018). Firma de la vista intacta con sus siete columnas, ACL sin PUBLIC, asesores sin cambios. Prueba funcional: los tres casos del fixture devuelven cero filas sin error, y se comprobó que el cero no es vacuo (los tres giros existen y son distintos, así que llegan a comparar de verdad). **Aplicadas también 014–018 el 2026-09-12, verificadas cuerpo a cuerpo** (018: `md5(prosrc)` `cf534c8a…`, 5 332 caracteres, idéntico al archivo; `security invoker` como su hermana `v_trayectoria_rfc`; ACL `{postgres, service_role, anon, authenticated}` sin PUBLIC). **Pendiente del usuario: exponer el schema `forense` en Project Settings → API → Exposed schemas.** |
| n8n | proyecto personal `n0vtYcnvIW4LpWOE` en `n8n.srv1550651.hstgr.cloud`; prefijo `FORENSE_`; **n8n 2.33.7** confirmado por el usuario (instance id ce6b6b06…). **Smoke OK** `FORENSE_smoke_anthropic` (ejecución 283972): `claude-sonnet-5` → `tool_use` forense_perfil, 645/45 tokens, 1.1 s. |
| Vercel | equipo `team_btOOK1ypsV2lyPljQaC0r3Ui` (hobby). **403 al crear el proyecto vía MCP** ("You don't have permission to create the project"): el usuario lo crea desde el dashboard importando `mrwh1th3/hackthonsearchv1-2026` con Root Directory `web`, o da permiso al MCP. Variables de entorno de 11 se cargan en el dashboard. |
| ElevenLabs | 0 números salientes al leer la cuenta; el usuario indica que el número se configura desde la UI de ElevenLabs. Hasta que exista, el adaptador se entrega con tests y la UI muestra `omitida` con motivo; ninguna llamada real sin número y consentimiento. |
| Local | Postgres 17.11 `localhost:5432/forense` (usuario postgres, trust, pgcrypto); Python 3.9 + faker/networkx/pandas; Node 22. |

## Bloqueos externos abiertos (decisión del usuario)
0. **Vercel**: crear proyecto `forense` (repo privado, root `web`) y variables de entorno; el MCP no tiene permiso de creación.
1. ~~Supabase~~ resuelto (proyecto `hackthon2026`).
2. ~~Anthropic~~ resuelto para `claude-sonnet-5` (smoke 2026-09-12 03:29Z); `claude-opus-5` también OK (ejecución 283975, 577/45 tokens, 1.7 s). Saldo total desconocido: medir consumo por caso en H8–10.
3. **ElevenLabs/Twilio**: número saliente pendiente de que el usuario lo configure en la UI de ElevenLabs; sin él no hay llamada real.
4. ~~Repo público~~ resuelto (privado).

## Oleadas 1–3 — integradas en main (H9, ≈07:40; commit b5374b8)
| Módulo | En main | Verificación en main |
|---|---|---|
| db | 001–011: esquema + runtime, 14 pistas calibradas, clusters, 11 RPC + sistema + 30 funciones del runtime (010), producto, voz, ingesta/inyección, eventos, métricas completas (011 = eval/metricas.py campo a campo); seeds; generator; loaders/load_gen; eval | `bash db/tests/run.sh` 392/392. gen-v1: selector 16/17 fraudes, 0/15 trampas; baseline FPR 4/15 |
| runtime | 10 workflows JSON cableados al 100% (preparar-sql ok=73/73), e2e del camino completo con dictamen determinista real, ensamblado embebido con sello 33a95afbc976, editar/inyectar/voz | 330/330; generadores --check OK |
| prompts | 12 prompts, techos por rol, variantes de reintento, Trayectoria | 106/106 |
| webapp + editor | 20 rutas, Supabase real, privado por perfil_id, realtime, inyección con diff, editor persistente (propuestas en DB, revertir por RPC, bitácora) | typecheck OK, lint 0, build OK, 272/272 |
| voice | adaptador ElevenLabs con firma t=,v0=, callback post_call_transcription, dedupe por tipo | 67/67 |
| qa | 131 integración (forense_qa 001–011) + 7 e2e; informes oleadas 2–3 | 131/131, 7/7 |
Oleada 4 integrada (H11): db 001–013 (381 aserciones sin gen; 012/013), runtime 337 tests y 155 nodos, QA 149 pruebas (gate de rendimiento rojo hasta 014), RUNBOOK/RESUMEN-H10. Contratos **1.3.1**: 110/110. Supabase remoto: **001–013 + 003 recalibrada + seeds aplicadas** (012/013: 5/5 cuerpos idénticos, 4 índices, 128 funciones con ACL explícita; 014 del hotfix pendiente) (versiones hasta 20260912094346; 32/32 cuerpos de 010/011 idénticos; 126 funciones en `forense`, ninguna con EXECUTE público; `v_metricas_corrida` completa). Datos remotos: solo fixture; gen-v1 pendiente de `SUPABASE_DB_URL`.

## Hotfix H11 — integrado en main (commits ffb5050 → 93385ba)
Las tres ramas (db6, runtime6, qa5) entraron en orden de dependencia, y el
coordinador añadió 016 y 017 para cerrar lo que los verificadores dejaron
abierto. Todo lo de abajo está **medido en main**, no heredado de los
informes de los builders.

| Qué | Dónde | Medido en main |
|---|---|---|
| ANALYZE al clonar: el barrido de un clon no terminaba en 300 s | `db/014_estadisticas.sql` | clonado 417 ms + barrido 1 473 ms; el gate de QA mide 1 440 ms contra un umbral de 30 000 ms |
| `cobertura_completa` no la escribía nadie, así que todo caso salía `no_concluyente` | `db/015_cobertura.sql` | regla determinista en SQL, recalculada al cerrar la última ronda y antes del dictamen |
| Tres funciones de 014/015 quedaron ejecutables por PUBLIC (`proacl '=X'`) | `db/016_permisos_cobertura.sql` | aserción sobre `pg_proc.proacl`: ninguna entrada con beneficiario vacío |
| La cobertura medía `clusters.rfcs_frontera`, la LISTA DE CANDIDATOS, no la frontera que pidieron las señales | `db/016` | sobre un cluster real de gen-v1 (40 RFC, **70 candidatos**): sin frontera pedida `true`; con frontera pedida y cuota `false`; cuota agotada `true` |
| `max_expansiones_caso` sin sembrar caía en el default de código 2, contra el "máximo una expansión por cluster" de 03 §127 | `db/016` | sembrada en 1 y comprobada con un default imposible (99) |
| `casos.cobertura_completa` tenía dos escritores: la regla y el payload del dictaminador | `db/016` + `db/017` | el payload ya no la sube ni la baja; se recalcula tras el UPDATE, con evento en bitácora |
| **`anomalia_explicada` era inalcanzable** (ver abajo) | `db/017_evaluacion_pistas.sql` + `n8n/runtime/auditor-final.mjs` | 353 tests de runtime, con casos nuevos para pista sostenida, `no_evaluable` y defensa ausente |
| FORENSE_corrida no redespachaba hasta vaciar la cola | `n8n/` (runtime6) | e2e de corrida: 6 clusters con MAX_ACTIVOS=2 → 7 vueltas, 4 redespachos, corrida `completada`, 6,9 s |

Suites en main tras el hotfix: `db/tests/run.sh` **459 aserciones, 0 fallidas,
0 omitidas** con GEN=1 (417 con GEN=0, 4 omitidas); integración **157/157**
(exit 0, sin parches ad hoc); e2e webapp **8/8**; runtime **353/353**;
contratos **110/110**; prompts 106; voz 67; web typecheck + lint + **272/272**;
generadores de code-nodes y workflows sin deriva.

### Hallazgo H11-b: la capa de descarte de falsos positivos no podía producirse
Lo destapó el arreglo de la cobertura: mientras `cobertura_completa` era
siempre false, TODO caso salía `no_concluyente` y nadie notó que el nivel
`anomalia_explicada` era imposible.

- El dictaminador llegaba a ese nivel por una sola vía: que todas las pistas
  tuvieran `estado === 'refutada'`.
- `forense.pistas.estado` admite `disparada` y `no_evaluable`, y nada más
  (001); el contrato `entities.pista` declara el mismo par. El valor
  `refutada` no existe, así que la condición era siempre falsa.
- La defensa no toca el estado global de la pista, y hace bien: escribe el
  resultado **por caso** en `casos.evaluacion_pistas`.
- `paquete_auditor_final` exponía ese objeto leyéndolo por código de pista
  (`R1`) cuando la clave es el **ID** de la pista, que es como lo escribe la
  réplica y como lo declara el contrato del defensor. `evaluacion_caso`
  viajaba en null siempre.

Las pruebas lo ocultaron cinco oleadas porque alimentaban valores que la base
no puede contener (`estado: 'refutada'`, `estado: 'confirmada'`).

**Sin verificar todavía:** el descarte no se ha ejercido de punta a punta. El
ensayo (c) con proveedor simulado no corre el Defensor, y sin defensa ese
nivel es inalcanzable por construcción, así que el e2e lo reporta
`requiere_api_real` **antes** de mirar el nivel. Las cifras de trampas
(0/15) miden el **selector**, no el descarte.

**Gate H8–10, redactado para que pueda fallar y se sepa por qué.** Con la API
real, sobre el paquete (c) de `eval/inyecciones/`, medir en el momento del
dictamen estas dos cosas y reportar las dos:

1. `casos.pendientes` está **vacía**, y
2. todas las pistas **evaluables** del caso tienen `resultado='descartada'` en `casos.evaluacion_pistas`.

Si ambas se cumplen, el nivel tiene que ser `anomalia_explicada`. Si el nivel
no sale, el informe debe decir **cuál de las dos falló**, no "el descarte no
funcionó". El punto 1 no es un tecnicismo: `forense.revalidar_caso` construye
limitaciones a partir de evidencia sin validar y no refutada, y 07 §153 hace
que cualquier limitación deje el caso en `no_concluyente`, así que el caso
puede quedarse ahí con 017 perfectamente correcto.

### Hallazgo H11-d (bajo, sin corregir): el contexto del especialista no ve el descarte
`db/005_rpc.sql:416` proyecta el estado de la pista como
`coalesce(evaluacion_pistas->(p.id::text)->>'estado', p.estado)`, pero la
réplica escribe la clave `resultado`, no `estado`: el `coalesce` cae siempre
al estado global y es código inerte. Consecuencia: en un reintento, el
especialista ve como viva una pista que la defensa ya descartó. **No afecta al
veredicto** (el dictaminador lee `evaluacion_caso`, corregido en 017), sólo a
la calidad del prompt de reintento. No se corrige aquí porque el arreglo
limpio toca contrato del contexto, prompt y runtime a la vez: es material de
oleada, no de parche de integración. Nota: el estado global de la pista no
puede llevar el resultado de la defensa, porque el catálogo de 001 y el
contrato `entities.pista` sólo admiten `disparada|no_evaluable`.

### Comprobado contra el documento normativo
- 07 §135 pide literalmente que el paquete del auditor "combina catálogo y `casos.evaluacion_pistas` del caso"; eso es lo que 017 implementa y lo que faltaba.
- 07 §135 también fija que `cobertura_completa` "proviene de tareas/errores/frontera/presupuestos": la frontera pertenece a la regla, como hacen 015/016.
- 07 §153 fija `completo = cobertura_completa && pendientes.length === 0`, así que una limitación `cobertura_incompleta` deja el caso en `no_concluyente` **por diseño**, no por un defecto. El nodo de frontera emite esa limitación cuando la cadena sigue hacia RFC no investigados, tanto si la frontera no era significativa como si ya se gastó la cuota.
- 03 §187 exige para `anomalia_explicada` "refutación demostrada de todas las pistas investigadas y ninguna limitación pendiente": el dictaminador pide ahora que todas las pistas **evaluables** estén descartadas, y `completo` sigue exigiendo la lista de pendientes vacía.

### Riesgo de producto con número: el panel Contraste sale vacío 3 de 4 veces
`forense.v_contraste_caso` (018) está en el techo de lo que los datos
permiten, y el techo es bajo. Medido sobre los clusters reales de `gen-v1`:
4 clusters → 4 casos, de los que **2** tienen otro caso del mismo giro (o sea
**1 par**), y como el comparable tiene que estar por debajo en gravedad, sólo
el lado más grave del par puede consultarlo: **1 de 4 casos obtiene
contraste**. El límite es la densidad de casos por giro, no el SQL.

Y medido **en el remoto** tras aplicar 018 (2026-09-12): sobre la corrida
fixture cargada en Supabase, los tres casos devuelven **cero filas**, porque
`DEMO:ENTIDAD-0/1/2` están en tres giros distintos (`comercio_mayoreo`,
`servicios_contables`, `ferreteria`). La función responde bien —cero filas, sin
error— pero esa corrida no puede enseñar el panel jamás.

Consecuencia para el demo: contra Supabase, el panel que responde la pregunta
literal del juez no aparece en ninguno de los casos del fixture, y en gen-v1
aparece en 1 de 4. En la webapp en modo fixture sí aparece, porque
`web/lib/data/fixture.ts` trae un contraste sembrado — pero enseñar eso cuando
se anunció producción es justo lo que 13 §Reglas prohíbe sin identificarlo.

**Decidido no tocar `db/seeds/seed_fake.sql`** para forzarlo: añadir un cuarto
caso del mismo giro cambiaría conteos de fixture en aserciones de varios dueños
y en el remoto ya cargado, y sólo arreglaría la ruta de respaldo. La ruta del
demo es gen-v2.

**Medido (2026-09-12): más datos NO lo arreglan.** Generé los dos snapshots en
bases desechables, corrí pistas y clusters, y conté:

| snapshot | contribuyentes | clusters | clusters que comparten giro | giros distintos | pares con solape |
|---|---|---|---|---|---|
| gen-v2 (intradía) | 100 | 4 | **0** | 4 | 0 |
| prueba de 300 | 300 | 6 | 2 | 5 | 1 (giro `comercializadora`, 2 pistas en común) |

Triplicar el dataset pasó de 0 pares a 1. La causa es estructural: el
clusterizado agrupa por vecindad de grafo con tope de 40 RFC, así que 300
contribuyentes dan 6 clusters, no 60. Con tan pocos casos por corrida, exigir
"otro CASO del mismo giro" no puede funcionar por volumen de datos.

**Hecho: el emparejamiento se cambió** (`db/020_contraste_cluster.sql`). El
comparable es otro RFC del **mismo cluster**, con su nivel de
`resultado_por_rfc`, mismo giro, al menos una pista en común y nivel
estrictamente menos grave; la comparación caso-a-caso de 018 queda como
respaldo. Las dos entidades quedan en la misma investigación, que es una
respuesta más fuerte para el jurado que dos casos sin relación. Por el camino
hubo que arreglar que **nadie emitía `resultado_por_rfc`** (ver abajo).

**Y el cuello de botella se movió: ya no es el emparejamiento, es la
evidencia.** Medido con la función real sobre un clon de datos de
`forense_rt` (15 casos dictaminados, los 15 con `resultado_por_rfc` poblada):
**0 de 15 por el camino de cluster y 0 de 15 por el respaldo**. La causa está
en el dato, no en el SQL: esa base es un smoke de runtime con **5 filas de
evidencia para 15 casos**, así que no hay familias que contar ni defensas que
descartar, y ninguna de las tres razones tipificables puede darse. Ninguna
versión del panel —ni 018, ni 020, ni una con el contrato relajado— podía
disparar ahí.

Corrección de una cifra que circuló antes: relajar `pistas_solapadas` a
`minItems 0` daría **1 de 15**, no 9 de 15. La estimación previa era una cota
sin exigir razón tipificable.

**Decidido: NO se relaja el contrato.** El panel no está roto ni bloqueado por
construcción: las aserciones de 020 lo muestran disparando con una fila real
("del mismo cluster", `familia_faltante`, 1 familia frente a 3), y la regla de
nivel hace que un vecino con una sola familia caiga en `no_concluyente`
mientras el principal con dos presume — o sea, comparte pista Y es menos
grave. Lo que falta es una corrida con evidencia repartida entre varios RFC, y
eso es el **gate H8–10 con la API real**. Lo que sí es inalcanzable con
`minItems 1` son los vecinos `sin_hallazgos`, porque ese nivel exige cero
pistas propias y por tanto cero solape; es un subconjunto, no el panel.

**Sin adornos para el guion:** el panel Contraste **no ha disparado todavía
sobre datos enteramente reales**. La única medición no nula es 1 de 4 en
gen-v1 del corte anterior, y ahí los niveles estaban puestos a mano.

### Hallazgo H11-e: con T2 evaluable, la regla de dos familias deja de discriminar
Sobre gen-v2, el selector de dos familias y el baseline de dos pistas dan
**exactamente lo mismo**: 17/8/0/75. En gen-v1 el selector ganaba (0/15 de
trampas encoladas frente a 4/15 del baseline). La causa es una co-ocurrencia
legítima, no un error de siembra: la trampa del grupo corporativo comparte
domicilio y representante (familia R) **y** timbra en lote (familia T), y las
dos cosas son ciertas de un grupo corporativo real.

**No se quita esa trampa para recuperar el número.** Existe justamente para
medir falsos positivos; borrarla sería medir un dataset más fácil. Se corrigió
la afirmación, no el dato: `eval/README.md` y `13-demo.md` ya no dicen que dos
familias elimina los falsos positivos del baseline.

Contexto que evita leer esto peor de lo que es: la meta de FPR ≤0.15 de
`docs/10` §FPR está definida sobre trampas **marcadas** con cobertura
completa, o sea el dictamen, no la cola del selector. El propio documento dice
que "las [trampas] excluidas por el selector no demuestran una defensa". Así
que el 4/15 del selector **no incumple** la meta, y el 0/15 de gen-v1 tampoco
la cumplía: con cero trampas investigadas, la capa de descarte nunca se
ejercía. La FPR del sistema sigue **sin medir** hasta el gate H8–10.

Trabajo de calibración que queda, con una vía ya descartada por lectura del
código (para que nadie la reintente):

- **Lo que NO funciona:** darle la ráfaga de timbrado a `startup_pico`, que es
  la única trampa que dispara **sólo T** (las otras tres que disparan familia
  son R, R y F). La pierna (a) de T2 exige una **cadena de ≥3 saltos**
  (`saltos >= 3` en `db/019_pista_t2.sql`, donde el receptor de una factura
  emite la siguiente dentro de la ventana), y la startup factura **en
  estrella**: ella emite a varios clientes que no re-emiten. Una ráfaga ahí no
  dispararía T2.
- **Lo que sí lo restauraría:** una **cadena de suministro legítima que timbra
  su cierre en una sola corrida** — por ejemplo proveedor → maquilador →
  distribuidor → cliente, tres saltos dentro de la ventana, con pagos reales,
  nómina de plantilla y contrapartes diversificadas. Dispararía T1+T2, o sea
  **dos pistas de UNA sola familia**: el baseline de dos pistas la marcaría y
  el selector de dos familias la excluiría. Eso **restaura el diferencial**
  que gen-v2 dejó en cero, y lo hace **añadiendo** un comportamiento legítimo,
  no borrando el del grupo corporativo. Es trabajo de `generator/trampas.py`
  con su declaración en el ground truth, no un parche de integración.

### Adaptadores de datasets externos (oleada 6)
`loaders/load_69b.py` (lista 69-B real del SAT → `listas_sat`, sólo familia E)
y `loaders/load_ibm_aml.py` (IBM AML → `cuentas`/`movimientos`, sólo familia F,
con 12 códigos persistidos como `no_evaluable` **con motivo**). Los dos fallan
nombrando la columna que falta y son idempotentes. `bash loaders/tests/run.sh`
→ 24 aserciones, 0 fallidas, sin red.

**Limitación declarada:** el encabezado esperado de IBM está tomado de
`04-datos-y-datasets.md` y del esquema publicado, **no verificado contra el
`HI-Small_Trans.csv` real**, que no está en el repo y no se descargó. La
muestra del repo es sintética con ese esquema. Si el archivo real trae otro
encabezado, el loader falla nombrando la columna y se amplía su tabla de
sinónimos.

### Hallazgo H11-f: `/metodo` habría salido vacía en producción
La pantalla que responde "¿cómo llegaron aquí?" (21 §El camino) lee
`reports/handoff/DECISIONES.md`, `ESTADO.md` y `RUNBOOK.md` de la **raíz del
repo** en tiempo de petición. Es una ruta dinámica (`ƒ` en el build, porque el
layout de `(app)` lee la cookie de sesión), así que el `readFileSync` corre en
el servidor. En Vercel el Root Directory es `web/` y la función serverless
sólo lleva lo que el rastreo de Next incluye: esos tres archivos están FUERA
de `web/`, así que no viajaban. Pasaba en local y en las pruebas —que tienen
el repo entero— y habría fallado sólo en el demo.

Arreglado con el mecanismo propio de Next en `web/next.config.ts`
(`outputFileTracingRoot` un nivel arriba + `outputFileTracingIncludes` para
`/metodo`), sin duplicar los documentos ni generar copias que se desincronicen.

**Verificado por contrafactual, no por suposición:** en el artefacto de
rastreo `web/.next/server/app/(app)/metodo/page.js.nft.json`, sin la
configuración entran **0** archivos `.md` (73 rastreados); con ella entran los
**3** (76 rastreados).

**Queda por comprobar en el primer despliegue real** (no se puede antes, el
proyecto Vercel todavía no existe): abrir `/metodo` y ver las tres secciones
con contenido. Si sale el mensaje de "no se encontró ninguno", el rastreo no
los incluyó y hay que pasar a plan B (generar un módulo con los tres
documentos en tiempo de build e importarlo, que garantiza el empaquetado a
costa de duplicar el texto).

### Hallazgo H11-g: en producción el corte del snapshot se vería un día después
Catorce sitios de la UI formateaban fechas con `new Date(x).toLocaleString("es-MX")`
**sin** `timeZone`, y eso formatea en la zona del PROCESO. En local es
America/Mexico_City y todo cuadra; una Vercel Function corre en **UTC**. El caso
que lo vuelve grave: `corridas.fecha_corte` vale `2026-01-31 23:59:59-06`, que
en UTC es `2026-02-01 05:59:59`, así que la pantalla habría enseñado el corte
como **1 de febrero** en un sistema fiscal cuyo propio manifiesto dice 31 de
enero. Un juez con dominio del problema lo nota.

Arreglado con `web/lib/date/formato.ts`, que pasa `timeZone` explícito y usa la
misma zona por omisión que el selector de rangos (`America/Monterrey`) — dos
zonas por omisión distintas en la misma UI serían peor que el bug. No es una
decisión nueva: `web/lib/date/range.ts` ya la había tomado para la aritmética de
rangos, con el análisis de por qué `Intl.DateTimeFormat` con zona explícita no
depende del reloj del proceso; esto la extiende al formato de presentación.

Verificado con la condición de producción: la suite de web pasa **281/281 con
`TZ=UTC`**, y hay una prueba que fija que el corte sigue saliendo 31/1/2026 con
el proceso en UTC y en Asia/Tokyo.

Queda a propósito sin tocar un sitio: el indicador de "guardado" del editor usa
el reloj del visitante, que ahí es lo correcto.

## Abierto
- ~~Aplicar 014–017 a Supabase~~ **hecho** (2026-09-12 14:32–14:35, versiones 20260912143247/143340/143417/143459). Verificado en remoto, no por el "ok" del aplicador: las cinco funciones tocadas con `md5(prosrc)` idéntico al cuerpo del archivo que las define en último lugar (`cobertura_caso` contra 016; `paquete_auditor_final` y `guardar_dictamen` contra 017); `proacl` de las cinco sin ninguna entrada de PUBLIC (`{postgres=X/postgres, service_role=X/postgres}`); `max_expansiones_caso=1`; `evaluacion_pistas->(p.id::text)` presente y `->p.codigo` ausente; asesores idénticos a la línea base tomada antes de aplicar (22 INFO + 2 WARN preexistentes, ningún ERROR nuevo). Prueba funcional sobre el remoto, en un bloque revertido por excepción: sin frontera pedida `true`, con la lista de candidatos poblada `true`, con una señal que pide frontera `false`; cero residuos.
- ~~Deriva de `003_pistas_recalibrada_2b`~~ **resuelta por comprobación** (2026-09-12): el remoto registra esa migración sin archivo en `db/`, pero es solo historia del nombre con que se aplicó el 003 ya calibrado. Los cuerpos coinciden byte a byte: `pista_d3` `b69e55c8…` (6 354), `pista_f3` `28ab859a…` (5 325), `pista_t2` `454f6019…` (7 101), los tres idénticos a `db/003_pistas.sql`. `correr_pistas` difiere del 003 local a propósito: el remoto tiene `66f1be11…` (3 726), que es exactamente el cuerpo de `db/014_estadisticas.sql` (014 la redefine para meter el ANALYZE como primer paso). Una instalación limpia desde `db/` reproduce el mismo estado; no falta ningún archivo.
- Bloqueado por .env: credenciales n8n, importación de workflows, carga remota de gen-v1, smoke H4 y gate H8–10 (primer expediente real con API).
- Sin empezar por los builders: horas intradía en `generator/gen.py` (gen-v2, necesario para que T2 sea evaluable), `loaders/load_69b.py`, `loaders/load_ibm_aml.py`.

## Acciones pendientes del usuario
- Rellenar `.env` (raíz, gitignored): `N8N_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Con eso el coordinador ejecuta `node scripts/n8n-credentials.mjs`, `node scripts/n8n-import.mjs`, carga gen-v1 en remoto y corre el smoke H4.
- **Exponer el schema `forense`** en Supabase → Project Settings → API → Exposed schemas (hoy PostgREST responde que el schema no está expuesto).
- Crear en n8n las credenciales `Forense Postgres` (host db.wplsldwzpyocmwzeyarj.supabase.co) y `Forense Supabase` (header apikey/Authorization con la service role del proyecto hackthon2026) y `Forense Webhook` (INTERNAL_WEBHOOK_SECRET). El coordinador no puede leer esas claves por MCP.
- Crear el proyecto Vercel `forense` (root `web`) y sus variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_DATA_SOURCE=supabase, DEMO_PASSWORD, SESSION_SECRET, N8N_WEBHOOK_BASE, INTERNAL_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY **y `SUPABASE_URL`** (la misma URL sin el prefijo público: `web/lib/data/privado-supabase.ts:33` la exige sin respaldo, y sin ella el camino privado del BFF —perfil, historial, notificaciones, llamadas— se apaga mientras la lectura pública funciona). La lista completa y la verificación de los cuatro fallos que sólo aparecen en producción están en `RUNBOOK.md` §(c) Paso 6.
- Número saliente ElevenLabs cuando decida configurarlo.

## Próxima entrega
Gate H4: DB → herramienta → runtime (proveedor simulado) → evento persistido → UI con fixture.
