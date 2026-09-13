# Laboratorio A/B sobre el motor Forense

El laboratorio envuelve el auditor existente; no cambia su veredicto, sus reglas ni el pipeline de n8n. El runner es código Python, A cuestiona grupos de señales, B explora sujetos sin señal y un compilador redacta propuestas pendientes de revisión humana. No hay orquestador LLM ni debate libre.

El producto presenta una sola investigación: motor determinista → A/B → compilador. El supervisor web ejecuta el motor con `--llm off` sobre el snapshot local al iniciar cada investigación, guarda sus resultados en `RUN/engine/` y su etapa en `engine_trace.json`, y después invoca este runner sobre ese mismo resultado. Los comandos independientes aquí documentados sirven para verificar cada tramo del mismo flujo. n8n no es necesario para ejecutar esta ruta.

## Inspección del sistema existente

- Motor: `PYTHONPATH=src python3 -m auditor run --estate PATH --seed N --out DIR --llm off`. También `auditor.pipeline.run()` y `write_outputs()`.
- Salida real: `run_log.json` contiene `findings[]`, `leads[]`, `period`, `estate_profile`, `structure_report` y `triage`. Al persistir, `triage.file` apunta a `triage.json`; este contiene registros `finding`, `closed_lead` y `no_signal`. `fraud_flag=false` **no** significa exculpación.
- Hallazgos: `scheme_type`, `entities`, `confidence`, `peso_amount`, `signals`, `scoring`, `exhibits[{source_table,record_id}]`, `money_trail` y `defense`. Los IDs de exhibición `EX-01` se repiten entre hallazgos: nunca se usan como IDs globales.
- IDs de sujetos: `RFC:…`, `EMP:…`, `CLABE:…`. Evidencia: `vendors:<rfc>`, `invoices:<uuid>`, `bank_txns:<txn_id>`, `ledger:<entry_id>`, `purchase_orders:<po_id>`, `contracts:<contract_id>`, `employees:<emp_id>`, `efos_list:<rfc>`. Tabla e ID se validan juntos.
- Stack: Python stdlib/SQLite; cliente anterior `src/auditor/llm.py` usa Anthropic con record/replay. La decisión actual del usuario es Codex autenticado mediante CLI; `labs/provider.py` implementa ese transporte independiente del motor. No se añade framework de agentes.
- Herramientas reales: lectura de exhibiciones del motor, consultas SQLite parametrizadas y limitadas, unión explícita CFDI/referencias bancarias y caminos ya incluidos en `money_trail`. Con estate, `graph_paths` reutiliza `Estate.cycles()` y devuelve como máximo ocho ciclos relacionados; no reconstruye los detectores. Sin estate canónico una consulta de filas devuelve `unavailable`, no resultados inventados.

## Contratos y límites

El runner hace como máximo seis llamadas LLM (configurable entre 3 y 6), reserva una para el compilador y selecciona como máximo dos grupos para A por defecto. A recibe esos grupos en una sola llamada inicial. Cada grupo tiene hasta ocho ejemplares; B recibe hasta treinta sujetos residuales. Con selección automática y seis llamadas caben selector, A, B, una conclusión con herramientas por investigador y compilador. Con un límite menor se prioriza la conclusión de B y se declara la revisión omitida; un handoff incidental a A requiere capacidad sobrante y ocurre como máximo una vez por corrida. Los grupos omitidos quedan declarados.

Antes de investigar, el runner consulta `ContextStore.get(giro)` y entrega el contexto a ambos agentes; las herramientas permiten consultar un giro relacionado. La caché reciente precede al [catálogo local](context_catalog/README.md): doce sectores, cinco referencias por sector, alias EN/ES y fuentes primarias fechadas. Su lectura fresca no invoca modelos ni red. El contexto curado conserva el estado `partial` porque las fuentes abiertas no equivalen a una adjudicación independiente; sin contexto se indica `pending`/`unavailable`. Al caducar se intenta investigar de nuevo y un fallback antiguo se declara como tal. Los prompts sólo reciben el perfil pertinente y acotado. La búsqueda sectorial en vivo tiene presupuesto separado.

Los prompts reciben recortes y memoria acotada, nunca el dataset completo. A/B iniciales se ejecutan en paralelo; el contador y las trazas están sincronizados, y las consultas posteriores son secuenciales. Los textos libres se marcan como datos no confiables. Las trazas guardan objetivos, acciones, evidencia, resultados y justificaciones públicas: no se solicitan pensamientos internos privados. Cada llamada conserva el prompt exacto y la respuesta validada; costes de suscripción desconocidos son `null`, no cero. `llm_calls` cuenta invocaciones del proveedor: un `codex exec` puede hacer varias solicitudes internas, cuyo número no reporta la CLI; los tokens corresponden a su uso agregado.

El total de nuevas corridas incluye la selección de sector, A, B y compilador; la investigación de contexto se agrega una sola vez desde `sector_research`. Los tokens de entrada cacheados son un subconjunto de la entrada, nunca un tercer sumando. Los resúmenes históricos no se reescriben automáticamente al corregir la contabilidad.

Para repartir el costo del plan puede calcularse una estimación: `MXN mensuales asignados × tokens de la corrida / tokens mensuales de referencia`. El denominador debe proceder de consumo observado o de un supuesto documentado, con el mismo alcance que el gasto asignado. No representa una bolsa mensual garantizada por Codex. Si se mezclan modelos o patrones de caché, conviene ponderar el consumo de forma consistente. Esta estimación exige configurar el importe y la referencia; mientras falten, el costo de suscripción registrado sigue siendo `null`. La [documentación oficial de límites y precios](https://learn.chatgpt.com/docs/pricing) describe límites variables y tarifas distintas para entrada, caché y salida.

Las propuestas requieren predicados estructurados con campos y operadores permitidos, evidencia recibida por los agentes, explicación alternativa y contraejemplo. Sin predicados o evidencia pasan a notas. Las coincidencias exactas con predicados canónicos o rechazados se bloquean; la detección semántica de duplicados sigue siendo una tarea del compilador y del revisor humano. Nada se ejecuta como regla ni se absorbe automáticamente. Una propuesta no equivale a un fraude confirmado.

## Ejecución

```sh
python3 -m labs.runner run --engine-output labs/tests/fixtures/engine.json --giro construccion --out /tmp/forense-labs --provider mock
python3 -m labs.runner run --engine-output data/auditor/runs/RUN/run_log.json --estate data/auditor/runs/RUN/validator_estate.db --giro construccion --out data/labs/runs --provider codex
python3 -m labs.runner report --run-id UUID --out data/labs/runs
python3 -m unittest discover -s labs/tests -v
```

`--run-id` acepta UUID y evita sobreescribir una corrida existente. El estate opcional debe ser canónico y corresponder al mismo snapshot. Las salidas quedan en `{out}/{run_id}/`; `summary.json` se actualiza atómicamente para la UI. `--memory-dir` permite aislar la memoria de propuestas; por defecto es `{out}/../memory`. Los catálogos semilla versionados viven en `labs/memory/`.

## Protocolo de proveedor

`call(actor, prompt, schema)` retorna `{output, tokens_in, tokens_out, tokens_estimated, model, duration_ms}`. El proveedor no decide orquestación ni ejecuta las herramientas de datos: A/B las solicitan como JSON y el runner las valida. `mock` es una demostración offline explícita que no fabrica hallazgos.


## Expediente completo y replay

El supervisor prepara `delivery/case_file.html` y `delivery/manifest.json` al terminar una investigación con
motor persistido. Conserva las cinco secciones del expediente base, añade A/B como contraste y muestra el
consumo de todo el flujo. `engine/submission.json` mantiene únicamente acusaciones validadas por el motor.

```sh
python3 -m labs.delivery --run-dir data/labs/runs/UUID
python3 -m labs.delivery --run-dir data/labs/runs/UUID --check
```

Estas operaciones sólo leen artefactos guardados, sin acceder a servicios ni al dataset. El manifiesto fija
sus hashes y el hash del motor recibido por A/B. Replay idéntico no promete una nueva investigación Codex
idéntica. Costo de suscripción no disponible se declara `null`; las llamadas simuladas no son llamadas LLM.
Las unidades de cobertura se explican en `brief.count_units`: sujetos únicos, participaciones por comprobación,
investigaciones cerradas y cuentas empresariales excluidas no son conteos intercambiables.

El supervisor mantiene la fase pública `report` activa hasta validar el expediente. Para nuevas corridas,
`launch.total_duration_ms` incluye preparación/despacho, motor, contexto, A/B, compilador y la primera
construcción y validación del reporte. Después sella esa medición en un candidato reproducible y vuelve
a validarlo antes de publicarlo; la serialización final de métricas queda fuera del intervalo medido.
`timing_scope=through_report` y `report_completed_at` distinguen este alcance de registros históricos,
que pueden excluir el reporte. No se suman duraciones paralelas ni se sustituye por el tiempo del motor.


## Enfoque del usuario y giro interno

`--focus`, `--focus-from` y `--focus-to` llevan el contexto y periodo inclusivo de enfoque a A, B y compilador. Se persisten en `brief.user_focus`; no alteran el dictamen del motor ni ocultan evidencia fuera del periodo. `--giro` es opcional: sin él, `sector_selector` recibe hasta doce descripciones de actividad de 240 caracteres y selecciona el contexto sectorial antes de A/B. Esta llamada consume el mismo máximo de seis; se reservan llamadas para ambos investigadores y el compilador (mínimo cuatro con selección automática). Si no se puede inferir el giro se registra contexto general, sin inventar un sector. La prueba end-to-end mock de esta integración quedó en `926dcbd0-1a7c-4b88-b3d6-be04bca9506c`, sin errores y con foco recibido por los tres participantes.
