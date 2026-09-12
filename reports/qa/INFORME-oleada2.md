# QA — informe de oleada 2 (H5)

Agente: **forense-qa**. Worktree `.claude/worktrees/wf_be493659-06a-5`, rama
`worktree-wf_be493659-06a-5`, integrado con `main` en el merge `59aa22b`.

Banco de pruebas propio: base Postgres **`forense_qa`** en `localhost:5432`
(usuario `postgres`, binarios `/opt/homebrew/opt/postgresql@17/bin`). La base
compartida `forense` **sólo se lee** (`pg_dump --data-only`); no se altera, ni
ella ni el proyecto Supabase remoto.

## Cómo se reproduce

```bash
DATOS=clon bash tests/integration/preparar-db.sh   # exit 0
node --test "tests/integration/*.test.mjs"         # exit 0
node --test "tests/e2e/*.test.mjs"                 # exit 0
```

El e2e necesita `web/.next`; si falta, se salta con motivo en vez de fallar:

```bash
npm run build --prefix web                          # exit 0
```

| Comando | Exit | Resultado |
|---|---|---|
| `DATOS=clon bash tests/integration/preparar-db.sh` | 0 | 001–008 aplicadas, 009 ausente (condicional), datos de `forense` clonados, `seed_producto.sql` ok, 24 grants de `anon` |
| `node --test "tests/integration/*.test.mjs"` | 0 | 67 pruebas: **65 pass, 0 fail, 2 todo** (QA‑001 y QA‑003), 43 s |
| `node --test "tests/e2e/*.test.mjs"` | 0 | 6 pruebas, 0 fail, 1 s |
| `npm run build --prefix web` | 0 | build de producción de Next |

`verificado ≠ fixture`: las pruebas de RPC y de inyección corren sobre **gen‑v1**
(8 081 CFDI, 140 pistas) además del fixture; sólo el e2e usa el origen fixture,
porque mide la webapp, no los datos.

## Qué cubre el banco ahora

### `tests/integration/preparar-db.sh`
Aplica **001–008 como obligatorias** y **009 como condicional** (la entrega
forense-db en paralelo: si aún no está, se anuncia y no bloquea; cualquier
`db/009_*.sql` se recoge solo). Dos modos de datos:

* `DATOS=seed` — `seed_fake.sql`;
* `DATOS=clon` — `pg_dump --data-only` de la base compartida, que trae fixture
  **y gen‑v1**. Las tres tablas de configuración (`config_presupuesto`,
  `limites_agente`, `slots_runtime`) se excluyen del volcado porque las siembran
  las propias migraciones.

`seed_producto.sql` se aplica en los dos modos: perfiles e investigaciones no
dependen del origen de los datos de dominio.

### `tests/integration/rpc-envelope.test.mjs` (005) — 29 aserciones
* El conjunto de las 11 tools se **deriva de `contracts`** (`tools.forense_*`) y
  se compara con `public.forense_*`; las tres RPC de runtime
  (`validar_evidencia`, `evaluar_frontera`, `despertar`) quedan nombradas aparte.
* Las 11 devuelven un `tools.envelope` válido **sobre el fixture y sobre gen‑v1**,
  incluidas las respuestas `ok:false` — un error de ACL o de argumento es un dato
  con forma, no una excepción. Se exige además `ok:true` en las seis lecturas que
  sí tienen datos, para que la prueba no se conforme con 11 errores bien formados.
* **ACL**: en ronda 1 el especialista recibe `no_autorizado` al leer el pizarrón y
  el auditor sí lo lee; el rechazo queda en `forense.bitacora` (regla 2).
* **Presupuesto agotado** llega como envelope `ok:false`, `reintentable:false`.
* **`p_operacion` repetido** devuelve el mismo envelope, no consume cuota, no
  duplica la señal y deja una sola fila en `tool_operaciones`.
* **`ground_truth`**: cierre transitivo sobre `pg_proc.prosrc` desde las 11 hacia
  sus ayudantes; ninguna cadena llega a la tabla.

### `tests/integration/inyeccion-008.test.mjs` (008) — 8 aserciones
Cadena completa del ensayo `eval/inyecciones/a-carrusel-nuevo.json` contra gen‑v1:
`registrar_inyeccion` → `validar_inyeccion` → `clonar_corrida_con_inyeccion` →
`correr_pistas`.

* **gen‑v1 no se muta**: digest por tabla (conteo + md5 del contenido ordenado)
  tomado antes y comparado después del clon y de `correr_pistas`. Contar filas no
  bastaría: un `UPDATE` no cambia el conteo.
* El clon declara `corrida_origen_id` y las filas inyectadas llegan **sin**
  `ground_truth` (si vinieran etiquetadas, el juez se estaría dando la respuesta).
* Las pistas del clon cubren los 3 RFC inyectados y disparan familia **R**.
* **UUID de CFDI ya existente**: rechazo con tabla, fila, código y mensaje; el
  estado no queda `validada` y clonar es imposible (`no está validada`).
* `idempotency_key` repetido no crea otra inyección.

### `tests/integration/notificaciones-006-007.test.mjs` — 4 aserciones
* El paso a `investigacion_completa` emite **un** evento de outbox y **un** aviso;
  reescribir el mismo estado no reemite (regla 11: una vez por solicitud).
* Cinco reclamos concurrentes del mismo evento: **uno solo** se lo lleva (lease);
  cinco `solicitar_llamada` dejan como mucho **una** llamada activa, y sin
  consentimiento responden `omitida` con motivo sin invalidar el reporte.
* Versionar el expediente (`version_entregada` 2→4) no emite nada nuevo; volver a
  `parcial` y regresar tampoco duplica.
* La finalización deja `actividad_producto`.

### `tests/e2e/webapp.test.mjs` — 6 aserciones
`next start` en puerto libre, `NEXT_PUBLIC_DATA_SOURCE=fixture`,
`DEMO_PASSWORD=1234`, `SESSION_SECRET=test`, sin webhooks configurados.

* Sin cookie: **401** en la API, redirección a `/login` en la página.
* Login: contraseña mala **401**; buena **200** con cookie `HttpOnly`.
* **12 rutas a 200**, incluidas `/casos/<id>/expediente` y
  `/api/reportes/versiones`.
* `/api/investigaciones`: **400** con cuerpo ilegible, **503**
  `backend_no_configurado` sin backend (no 500).
* `/api/reportes/propuestas`: una **pregunta** devuelve mensaje y **no versiona**;
  una **propuesta** con selección válida devuelve propuesta y **tampoco versiona**
  (sólo Aplicar lo hace); una selección sobre un bloque inexistente da **409**.

## Bugs abiertos

| Id | Severidad | Dueño | Qué pasa | Dónde |
|---|---|---|---|---|
| **QA‑001** | media | forense-db | `ck_bitacora_tipo_evento` rechaza `paso_en_cola` y `paso_checkpoint`, que el contrato `product.evento_forense` sí declara. Un checkpoint del runtime no se puede registrar, y sin evento en bitácora el paso no existió (regla 2). Falta una migración aditiva. | `tests/integration/reglas-invariantes.test.mjs` (todo) |
| **QA‑003** | media | forense-db | Reenviar el **mismo** payload de inyección **sin** `idempotency_key` propaga `unique_violation` de `ux_ingestas_idempotency` en vez de devolver un rechazo con motivo, como hacen las demás funciones de 008. Un doble clic del juez en la demo daría un 500 sin diagnóstico. | `tests/integration/inyeccion-008.test.mjs` (todo) |
| **QA‑002** | baja (cosmética) | forense-db | 007 no repite el `revoke execute … from public` al final, así que `forense.trg_investigacion_completa` queda ejecutable por `PUBLIC`. No es explotable: Postgres rechaza toda invocación directa de una función que devuelve `trigger`, y la prueba lo comprueba. Conviene igualarlo con 002–006. | `tests/integration/rls-scope.test.mjs` |

Los tres están **verificados con comando**, no deducidos por lectura.

## Cambios de criterio en pruebas propias (no son bugs ajenos)

Tres aserciones de la oleada 1 fallaban por ser más estrictas que el diseño; se
ajustaron con la justificación dentro del propio test:

1. `db/tests/assertions.sql:49` usa `'definitivo'` dentro de un bloque que prueba
   que el CHECK lo **rechaza**. `check_violation` pasa a contar como guarda.
2. `clonar_corrida_con_inyeccion` y `validar_inyeccion` nombran `ground_truth`
   legítimamente (clonar etiquetas del snapshot base; impedir que un payload las
   traiga). Se añaden a la lista de excepciones **y** se exige que ninguna
   excepción sea ejecutable por `anon`/`authenticated`.
3. `forense.v_metricas_corrida` **sí** está concedida a `anon`/`authenticated` a
   propósito (003:803, 005:2260): es el panel de métricas del demo. En vez de
   prohibirlo, se exige lo que importa: que su salida sea agregada y no contenga
   ningún RFC ni las columnas `es_fraude`/`tipologia`/`es_trampa_legitima`.

## Lo que este banco todavía NO cubre

* **009** (editor, forense-db) llega condicional en `preparar-db.sh`, sin pruebas
  propias: cuando exista, hay que añadirlas.
* **Payload de cada tool**: se valida `tools.envelope`, no los `$def`
  `tools.forense_*` de cada `data`. Es el siguiente corte natural.
* **Ensayos (b) y (c)** de `eval/inyecciones/` (retorno EFOS y trampa
  comercializadora): sólo se ejercita el (a).
* **Voz de punta a punta** (ElevenLabs) y **n8n**: aquí se prueba el contrato en
  base de datos, no la llamada real ni los workflows ejecutándose.
* `/api/reportes/aplicar` (la mutación que **sí** versiona) no tiene e2e todavía.
