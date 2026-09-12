# 10 — Evaluación

Sin métricas, el demo es "confíen en mí". Con métricas contra ground truth, es una demostración. Esta es la diferencia más grande entre un proyecto de hackathon y un proyecto que gana un hackathon.

## Definición de la predicción

Para un RFC con resultado validado, referido a la evidencia que lo implica individualmente:

| Nivel | Predicción |
|---|---|
| `presuncion`, `presuncion_alta` | **positivo** |
| `sin_hallazgos`, `anomalia_explicada` | **negativo** |
| `no_concluyente` | **sin conclusión**, nunca negativo por defecto |

Un RFC sin caso solo cuenta como negativo del **selector** si la corrida completó su barrido de pistas y consta que no cruzó el umbral. No equivale a una defensa exitosa. Pendientes, errores, ejecuciones agotadas y datos insuficientes se registran como **sin conclusión**; no suman verdaderos negativos. En una corrida parcial, la ausencia de caso no prueba que el RFC haya sido evaluado.

El nivel de un cluster no se propaga a todos sus RFC. Evaluar cada RFC por las pistas, defensas y evidencia validada que le corresponden; el resto permanece sin atribución concluyente. Si existen varios casos/reintentos para un RFC, resolver un único resultado final vigente por `(corrida_id, rfc)`, con orden determinista, antes de agregar. `ground_truth` permanece inaccesible a las herramientas de investigación.

## Métricas

`forense.v_metricas_corrida(p_corrida uuid)` debe implementar el siguiente contrato. Esta sección es una especificación; no contiene SQL incompleto para ejecutar como migración.

1. Partir de **todos** los RFC con ground truth del snapshot de `p_corrida` y unir un resultado vigente por RFC, sin duplicar filas por casos o reintentos.
2. Separar resultados positivos, negativos comprobados y sin conclusión, incluyendo motivos y estado de la corrida.
3. **Métricas selectivas:** TP/FP/FN/TN, precisión, recall y F1 sobre resultados concluyentes; denominador cero devuelve `null`, nunca un 0% ficticio.
4. **Cobertura:** RFC con resultado concluyente / total etiquetado. Desglosar negativos del selector, casos investigados, pendientes, errores y `no_concluyente`. Para la defensa, mostrar además trampas investigadas concluyentemente / total de trampas.
5. **Recall conservador de extremo a extremo:** `TP / total_RFC_fraude`. Todo fraude sin positivo validado cuenta como FN, incluso si no llegó a investigarse o sigue sin conclusión. Un legítimo pendiente o sin conclusión **no** suma TN. Publicar ese FN conservador junto a los FN selectivos, con nombres distintos.
6. Devolver FPR de trampas con sus conteos y cobertura, recall por tipología, acierto de tipología, errores enlazables, costo, latencia, caché, rondas, fronteras y reintentos.

Cada resultado incluye `corrida_id`, `dataset_hash`, `fecha_corte`, `corrida_origen_id`, versión de prompts y configuración de umbrales. Las métricas finales exigen corrida terminal; las parciales se identifican como tales. Una corrida terminada con errores conserva su cobertura real, no se convierte automáticamente en evaluación completa.

## La métrica que importa

Con cobertura completa, **FPR sobre trampas** = trampas legítimas marcadas como positivas / total de trampas legítimas.

Mientras existan trampas sin conclusión, ese cociente es solo el mínimo observado. Mostrar también la FPR entre trampas con resultado concluyente, la cobertura y el rango posible `FP / N` a `(FP + sin_conclusion) / N`. Para evaluar al Defensor, desglosar las trampas realmente investigadas: las excluidas por el selector no demuestran una defensa. Con ocho entidades, informar por ejemplo `1/8 (12.5%)`; no ocultar el tamaño de la cohorte detrás de decimales.

No es la precisión global. La precisión global se puede inflar con un dataset donde las empresas legítimas sean obviamente legítimas. La FPR sobre trampas mide exactamente lo que los jueces dijeron que les preocupa: que una empresa legítima con anomalías reales quede marcada y cargue con el costo de cumplimiento.

Va en su propia tarjeta grande en `/estadisticas` y es el número que se dice en voz alta en el demo.

## Métricas secundarias

| Métrica | Para qué |
|---|---|
| Recall por tipología | Dice qué esquema se detecta mal. Revisar generador, selector, herramientas y luego prompts; un recall bajo no identifica por sí solo la causa |
| Acierto de tipología | De los verdaderos positivos, cuántos recibieron la etiqueta correcta. Un caso detectado con tipología equivocada sigue siendo útil, pero menos |
| Costo por caso | Tokens y minutos. Define cuántos clusters caben en el tiempo del demo |
| Tasa de ronda 2 | Si es 100%, el disparo está mal calibrado y se paga el doble sin ganancia |
| Tasa de reintento | Si es alta, algo estructural falla (probablemente el Auditor cita IDs que no existen) |
| Acierto de caché | Confirma que la optimización sirve |

## Loop de iteración

Esto es lo que hace posible mejorar durante el hackathon en lugar de solo construir:

```
1. Cambiar un prompt o un umbral
2. Preparar snapshot nuevo del mismo dataset: dataset_hash y fecha_corte iguales,
   corrida_origen_id de la anterior, y registrar version_prompts/umbrales
3. POST /webhook/forense/corrida con ese corrida_id ya cargado;
   esperar su estado terminal (12–18 min es una estimación a medir)
4. /estadisticas en modo comparación: corrida anterior vs nueva
5. Mirar la tabla de errores: qué FP apareció, qué FN se arregló
6. Volver a 1
```

Cada corrida deja intactas las anteriores. `version_prompts` (hash de `/n8n/prompts`) las identifica. Tres o cuatro corridas comparadas en el demo demuestran método, no suerte.

Usar `seed=42` para desarrollo/calibración. Reservar otra semilla y su manifiesto antes de iterar; ejecutar una comprobación final sobre ella con configuración congelada. Si se ajusta tras ver ese resultado, deja de ser una comprobación reservada y hay que declararlo. Ninguna métrica sintética se presenta como rendimiento demostrado sobre fraude fiscal real.

**Regla:** cambiar **una cosa por corrida**. Si se cambian tres prompts a la vez y el resultado empeora, no se sabe cuál lo rompió y se pierden 20 minutos.

## Metas para el demo

Sobre el dataset generado (`gen-v3`):

| Métrica | Meta | Mínimo aceptable |
|---|---|---|
| Precisión | ≥ 0.85 | 0.75 |
| Recall | ≥ 0.75 | 0.65 |
| **FPR sobre trampas** | **≤ 0.15** | 0.25 |
| Acierto de tipología | ≥ 0.70 | — |
| Casos cerrados en el demo | ≥ 12 | 8 |

Si hay que elegir entre subir recall y bajar FPR, **bajar FPR**. Los jueces dijeron dos veces que les preocupan los falsos positivos, y un recall de 0.65 con FPR de 0.10 es mejor pitch que un recall de 0.90 con FPR de 0.40.

## Sobre IBM AML

No se mezclan métricas de IBM con clasificación fiscal por RFC. Se reporta una cosa concreta:

> "Corrimos el mismo agente Financiero sobre una muestra del dataset sintético de IBM que nosotros no generamos. Mostramos los ciclos detectados y cómo se relacionan con las etiquetas de lavado por transacción. Solo evaluamos la familia financiera; D/R/T/E quedan sin evaluar."

Registrar el tamaño real de la muestra. Si la selección usa etiquetas, declararla como demostración enriquecida: no estima precisión/recall poblacionales. Solo calcular recall de ciclos si existe ground truth verificado a nivel de ciclo, y métricas por transacción si se ha definido una predicción al mismo nivel. F por sí sola no satisface dos familias; información insuficiente se presenta como `no_concluyente`.

## Baseline para comparar

Implementar el baseline en el carril de datos desde la primera evaluación y mostrarlo junto en `/estadisticas`: "marcar como positivo a todo RFC con ≥2 pistas disparadas, sin agentes". Ejecutarlo sobre el mismo snapshot y cohorte; medir el resultado sin presuponer que será peor. Distinguir dos pistas de dos familias: esta es una regla base explícita, no el dictamen final. Comparar además el selector determinista de dos familias cuando se quiera aislar cuánto aporta la investigación.

La comparación prueba si la investigación reduce falsos positivos y qué ocurre con recall, cobertura, costo y latencia. El despacho de solo R1 entra al demo por `/investigar` explícito: ese ejemplo prueba una defensa concreta, aunque este baseline tampoco lo marcara.

## Qué no medir

- **Tiempo de desarrollo o líneas de código.** Los jueces dijeron que el proceso no pesa en la evaluación.
- **Número de pistas implementadas como sustituto de calidad.** Se conserva el catálogo completo y se comprueban sustento, trampas y cobertura de cada pista.
- **Tamaño del dataset.** 100 contribuyentes con ground truth completo valen más que 100,000 sin etiquetas.
