# n8n/tests

Dueño: **forense-runtime**. Pruebas de protocolo con proveedor simulado; nunca llaman a la API real sin autorización.

```bash
node --test "n8n/tests/*.test.mjs"     # 317 pruebas, sin red
```

Todo lo que empieza por `[SIMULADO]` usa un proveedor falso y **no acredita
conectividad ni detección** (17 §9). Lo que estas pruebas sí cubren:

| Archivo | Qué comprueba |
|---|---|
| `protocolo.test.mjs` | tool_use → resultado → end_turn, dos tools en una respuesta, cursor, JSON inválido, refusal, max_tokens, 429, timeout, doble entrega |
| `checkpoint.test.mjs`, `dispatcher.test.mjs` | máquina persistida, CAS, fencing, barrera por paso, reconciliación |
| `presupuesto.test.mjs`, `ledger.test.mjs`, `barrera.test.mjs` | cuotas, reserva de cierre, idempotencia por request/tool |
| `nodos.test.mjs` | la lógica que se copia a cada Code node, comparada con su gemelo de `n8n/runtime` |
| `workflows.test.mjs` | forma de los diez JSON: tipos, credenciales por nombre, secretos, topología |
| `contratos-nodos.test.mjs` | que la salida de un nodo sea la entrada del siguiente, en los diez workflows |
| `prompts-embebidos.test.mjs` | que el system embebido en el JSON sea el de `n8n/prompts/ensamblar.mjs` y lleve el sello del manifest |
| `voz.test.mjs` | interfaz del adaptador de voz: qué se envía y qué nunca se envía (16 §3) |

**Fuera de `node --test`** porque necesita una base local:

```bash
createdb forense_runtime
psql -d forense_runtime -f db/001_schema.sql
psql -d forense_runtime -f db/002_views.sql
psql -d forense_runtime -f db/003_pistas.sql
node n8n/tests/preparar-sql.mjs forense_runtime    # ok=25 pendiente_004_005=48 falla=0
```

Hace `PREPARE` de las 73 consultas de los workflows: analiza y comprueba tipos
**sin ejecutar nada**. Es lo único de este directorio que toca Postgres de
verdad, y es donde aparecen los errores que un test de forma no ve (una columna
que no existe, un array pasado como JSON, una función con otra firma).
