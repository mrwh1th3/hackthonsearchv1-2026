# Demostración verificable

En la interfaz, la investigación es un flujo único: primero corre el motor, después A y B contrastan sus datos y al final el compilador propone reglas revisables. El supervisor conserva `engine/run_log.json` y `engine_trace.json` en la misma carpeta del run; el laboratorio consume ese snapshot. Las siguientes invocaciones de terminal permiten verificar ese tramo sin repetir un análisis ya completado.

Desde la raíz:

```sh
python3 -m labs.runner run --engine-output labs/tests/fixtures/engine.json --giro construccion --out /tmp/forense-labs-demo --provider mock
python3 -m labs.runner report --run-id UUID_IMPRESO --out /tmp/forense-labs-demo
python3 -m unittest discover -s labs/tests -v
```

El fixture es sintético y pequeño: un sujeto marcado, un lead cerrado, un proveedor sin señal y una cuenta propia. La cuenta propia se conserva en el universo, pero no se usa como sospechoso residual.

Resultado del recorrido offline verificado: tres invocaciones (`A=1`, `B=1`, `compilador=1`), cero tokens porque no se llamó ningún modelo, cero propuestas fabricadas y una nota que identifica el modo de demostración. No se crea `handoff.json` si no aparecen cruces de IDs. El estado es `partial` cuando falta contexto sectorial verificado o estate; eso declara límites de investigación, no un fallo del transporte.

Para usar un snapshot real existente, conserva juntos su `run_log.json`, `triage.json` si lo tiene, y el estate canónico:

```sh
python3 -m labs.runner run --engine-output data/forensic/runs/371243c2-e107-589f-bc30-009080fb74d5/run_log.json --estate data/forensic/estates/c36ac9f823c4b5910c10b88feb28f42139f930b0f1d883e3272824614bcbe8f3.db --giro construccion --out /tmp/forense-labs-real-snapshot --provider mock
```

Ese snapshot local se verificó sin modificarlo: cuatro sujetos marcados, siete sujetos con leads cerrados y 124 sin señal. El runner recupera el padrón residual desde SQLite cuando el run log anterior carece de triage. Dos grupos A, B y compilador consumen cuatro invocaciones mock. Las consultas `subject_slice`, `cfdi_bank_join` y `graph_paths` se probaron contra el SQLite real en modo lectura. Los IDs exactos anteriores son solo un ejemplo local, no un requisito del producto.

Para investigar con el proveedor elegido, cambia `--provider mock` por `--provider codex`. Se requiere la sesión ChatGPT de Codex CLI en la máquina del worker. El contexto de un giro desconocido puede hacer una investigación web separada antes de A/B; su consumo aparece bajo `sector_research`, separado del presupuesto de 3–6 invocaciones del laboratorio.

## Qué inspeccionar

- `brief.json`: universo, clasificación, muestras exactas, contexto y cobertura omitida.
- `agent_a.json`: veredicto cuestionado, explicación lícita, acciones citadas y dato faltante.
- `agent_b.json`: hipótesis residuales, diferencia canónica y puentes incidentales.
- `compiler.json`: respuesta del compilador; `proposals.json` contiene únicamente lo que pasó las validaciones posteriores.
- `notes.json`: ideas no formalizables, limitaciones y propuestas que no pasaron el filtro.
- `traces.jsonl`: tiempos y consumo medidos, herramientas y justificaciones públicas.
- `prompts/`: recortes exactos y sus schemas; `responses/` y `validated/`: separación de respuesta recibida y resultado validado.
- `summary.json`: estado y etapas para la UI. `cost_usd_est=null` significa coste desconocido de la suscripción, nunca coste cero inferido.

Las pruebas incluyen una hipótesis no canónica programada que termina en `pending_human`, una explicación lícita que produce un anti-patrón pendiente, citas inexistentes/no vistas, confusión entre tablas, repetición canónica, presupuesto, ejecución paralela, handoff único y reanudación prohibida de un run ya existente. Estos fixtures prueban el sistema y sus límites; no miden la calidad de investigación de un LLM real.

## Estado de la verificación

- Suite local: 45 pruebas pasan, sin red ni llamadas a modelos. Incluye el orden real del supervisor, fallos del motor que impiden iniciar agentes, cierre de procesos y muestras con 160 referencias: el mock conserva todos los IDs en bloques de máximo 40 por paso.
- Regresión contra artefactos del dataset V1.3: ambos prompts A de la corrida `6e68eaa4-403a-4dd4-82a5-3071ac9a2c78` se reprodujeron localmente con `MockProvider` y ahora cumplen sus schemas originales. Esta reproducción no equivale a una nueva investigación Codex.
- La primera prueba Codex real terminó parcial porque A escribió sus pasos públicos dentro de la revisión y dejó vacío el resumen raíz. La corrección conserva esos mismos pasos con trazabilidad y sin una llamada adicional; se verificó offline contra la respuesta real. El schema exige ahora pasos públicos no vacíos.
- La repetición Codex con otro dataset queda pendiente de autorización explícita para enviarlo al proveedor. Las comprobaciones posteriores usan modo mock; no demuestran todavía la calidad final de investigación de A/B con ese dataset.
