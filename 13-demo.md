# 13 — Demo

## Guion (4 minutos)

Preparar una corrida cerrada, un caso fraudulento completo y un despacho investigado explícitamente. Medir previamente la latencia real de `/investigar`: los cuatro minutos son el tiempo de exposición, no una promesa de que todo el pipeline termine dentro de ellos. La traza preparada siempre se identifica como ejecución guardada. Una corrida adicional, con `corrida_id` y versión visibles, puede mostrar avance en vivo sin bloquear el guion.

### 0:00–0:30 — El problema, con un número

> "En México el fraude de facturación funciona así: una empresa fantasma emite facturas por operaciones que nunca ocurrieron, otra las deduce, y entre las dos se forma una cadena. El SAT lo persigue con el artículo 69-B. En 2018 detectó más de 3,000 de estas empresas. En 2023 detectó 47. No es que el fraude haya desaparecido: es que investigar cada caso cuesta demasiado trabajo humano."

Abre con el problema del costo de investigar, no con la tecnología.

### 0:30–1:00 — Qué hicimos

> "Construimos un auditor forense multi-agente. No es un detector de anomalías: cualquier empresa legítima tiene anomalías. Es un sistema que investiga, explica y —esto es lo importante— **intenta desmentirse a sí mismo antes de marcar a nadie**."

Mostrar el mapa de clusters de la corrida: 12 bloques, ya procesados.

### 1:00–2:00 — Una investigación verificable

Escribir un RFC en la barra y abrir su cluster. **Mostrar progreso real sin narrar cada paso.** Si la latencia medida excede este minuto, pasar al caso preparado y decir "esta es la ejecución completa que guardamos". Nunca animar datos sembrados como si fueran una ejecución en vivo.

> "Cinco especialistas arrancan en paralelo. Cada uno mira una familia distinta de evidencia: documentos, dinero, relaciones, tiempo, y las listas del SAT. Ninguno ve lo que hacen los otros."

Los carriles se llenan en vivo, o se inspeccionan sus eventos persistidos en el caso preparado.

> "Cuando terminan, escriben en un pizarrón compartido. Aquí el financiero encontró que esta empresa dispersa el 93% de lo que recibe a seis personas físicas en tres días."

Señalar la tarjeta en el pizarrón. Aparece la flecha.

> "Esa señal despierta al documental, que va a ver si esta empresa tiene con qué operar. No tiene nómina. Y al temporal, que ve que se dio de alta hace ocho meses."

### 2:00–2:45 — El dictamen y la defensa

Abrir el caso. Panel de defensa.

> "Antes de concluir, un agente defensor intenta desvirtuar el caso. Es lo que el propio artículo 69-B le concede al contribuyente: el derecho a acreditar que sus operaciones fueron reales. Probó dos explicaciones legítimas: que fuera un grupo corporativo y que fuera una comercializadora de margen delgado. Las dos fallaron, y aquí está por qué, con los IDs."

Panel de dictamen.

> "El nivel lo calcula código, no el modelo, con las familias confirmadas para este RFC. Y todo lo que dice el expediente apunta a un ID verificado contra la base."

Leer el nivel y las familias reales del caso preparado. No atribuir el resultado a todos los integrantes del cluster. Si falta evidencia para concluir, el resultado es `no_concluyente`; `anomalia_explicada` exige una explicación legítima respaldada.

### 2:45–3:20 — El momento que gana

Abrir el caso del despacho contable, ingresado manualmente con `/investigar`: al tener solo R1 podría no cruzar el umbral de selección automática.

> "Solicitamos investigar este despacho que comparte domicilio y correo con sus clientes. Esa coincidencia merece revisión, pero no demuestra una red de facturación falsa."

Panel de defensa.

> "El defensor verificó que estas empresas **no se facturan entre sí**, y aquí está la evidencia que respalda la explicación de un despacho con sus clientes. El caso se cierra como anomalía explicada."

Pausa.

> "Esto importa porque un falso positivo aquí no es un inconveniente: el artículo 113 Bis contempla de dos a nueve años de prisión. Marcar a una empresa legítima tiene un costo real."

### 3:20–3:50 — Los números

`/estadisticas`, modo comparación.

> "Medimos sobre datos sintéticos etiquetados. Aquí están precisión, recall y cobertura. De N entidades legítimas con anomalías sembradas, investigamos M y marcamos K: mostramos los conteos junto al porcentaje."

Señalar la comparación de corridas.

> "Comparamos tres corridas del mismo snapshot con cambios registrados y este baseline sin agentes. Después comprobamos la configuración sobre otra semilla reservada."

Decirlo solo cuando esas ejecuciones existan. Con ocho trampas, cada error cambia la tasa en 12.5 puntos. Los pendientes, errores y casos sin conclusión se muestran en cobertura; no cuentan como absoluciones.

**No decir que la regla de dos familias elimina los falsos positivos del baseline.** Medido (ver `eval/README.md`): en gen-v1 lo hacía (0/15 frente a 4/15), pero en gen-v2 —donde T2 ya es evaluable— el selector y el baseline de dos pistas son **idénticos**, 17/8/0/75. La causa es real y no se tapa: la trampa del grupo corporativo comparte domicilio y representante (familia R) **y** timbra en lote (familia T), y las dos cosas son ciertas de un grupo corporativo legítimo. Con T2 viva, dos familias no lo separa de un fraude.

Lo que sí se puede decir, y es más fuerte porque distingue las dos etapas:

> "El selector decide a quién investigamos; el dictamen decide a quién marcamos. Aquí están los dos números por separado. Y estas cuatro empresas legítimas entraron a investigación: lo que las salva no es el filtro, es la defensa."

Esa es la lectura que pide `docs/10` §FPR, que define la tasa sobre las trampas **marcadas**, no sobre las que el selector encoló, y que dice con esas palabras que "las excluidas por el selector no demuestran una defensa". Si el número del dictamen todavía no existe cuando se ensaye el demo, decir que está sin medir. No sustituirlo por el del selector.

### 3:50–4:00 — Cierre

> "También ejecutamos el mismo agente financiero sobre una muestra sintética de IBM. Solo F es evaluable: el sistema muestra las demás familias como no evaluables y deja explícitos sus límites."

Dejar el caso IBM preparado para preguntas: explicar el muestreo, mostrar ciclos y etiquetas por transacción sin afirmar recall de ciclos si no existe esa etiqueta estructural verificada. Es una prueba de portabilidad financiera, no una validación fiscal completa.

## Reglas del demo

1. **Ensayar dos veces completo**, cronometrado, con la URL de producción. No con localhost.
2. **Grabar el video de respaldo a la hora 33.** Si algo falla en vivo, se reproduce.
3. **Tener la corrida ya procesada.** La investigación en vivo es de un caso. Usar su latencia medida para decidir cuándo mostrar la ejecución guardada, sin esperar a que cierre ni simular progreso.
4. **No narrar la arquitectura.** Nadie quiere oír "usamos n8n con Supabase". Se ve.
5. **Vocabulario correcto:** EFOS, EDOS, 69-B, materialidad, desvirtuar, CFDI, presunción. Señala dominio del problema.
6. **Nunca decir "definitivo"** como conclusión del sistema.
7. Si algo falla en vivo, seguir hablando y abrir un caso ya cerrado. No debuggear frente a los jueces.
8. Mantener accesibles todas las rutas y el alcance completo para preguntas: cinco especialistas, ronda 2, frontera, reintento, evidencia, expediente/chat/diff/exportaciones, explorador, métricas, baseline, bitácora cruda, IBM y perfil grande. Añadir perfil, historial, filtros de fechas/vistas, sugerencias y notificaciones según 15/16. El guion breve selecciona qué enseñar; no elimina funcionalidades.

Recorrido adicional para preguntas: abrir historial → reporte tipo Docs → seleccionar → pedir mejora → revisar diff → Aplicar → descargar; comprobar que preguntar no modifica el texto. Mostrar el aviso interno de investigación completa y estado de llamada en perfil/historial. Una llamada en vivo requiere número autorizado, consentimiento y duración medida; no debe interrumpir ni condicionar los cuatro minutos. Si se enseña una grabación o fixture, identificarlo. Respuesta aceptada del proveedor no demuestra que el destinatario escuchó el aviso.

## Preguntas probables y respuestas

| Pregunta | Respuesta |
|---|---|
| "¿De dónde sacaron los datos?" | Usamos la lista 69-B real para padrón y listas, un generador propio con ground truth para las cinco tipologías y ocho clases de trampa, y una muestra del dataset sintético de IBM para probar portabilidad financiera. Cada corrida conserva su snapshot, hash y fecha de corte. Las métricas sintéticas no prueban rendimiento fiscal real. |
| "¿Cómo sé que el agente no inventó esa evidencia?" | Abrir el panel de evidencia: cada pieza tiene su ID verificado contra la base por un validador que no es un LLM. Y abrir `/corridas/[id]/raw`. |
| "¿Esto escala a millones de facturas?" | El contexto de cada agente no crece con el dataset: se investiga por vecindad de grafo, no por rebanadas. Lo que crece es el número de clusters, que es throughput. Mostrar el mapa de clusters del perfil grande. |
| "¿Qué pasa si el fraude no está en su catálogo de tipologías?" | Las pistas buscan estructuras que pueden aparecer en esquemas nuevos, pero no garantizamos detectarlos. Si la evidencia es insuficiente, el sistema devuelve `no_concluyente` para revisión humana; no lo presenta como anomalía explicada. |
| "¿Por qué no usaron un modelo de machine learning?" | Porque no hay datos etiquetados reales para entrenar, y porque un score no le sirve a un auditor: necesita un expediente que sostenga un procedimiento. |
| "¿Cuánto cuesta correr esto?" | Mostrar invocaciones LLM, tokens, costo y latencia medidos por cluster y corrida. Cada agente puede invocar el modelo varias veces al usar herramientas; ronda 2 y reintentos añaden consumo. No confundir número de roles, llamadas SQL ni peticiones HTTP con invocaciones facturables al modelo. |
| "¿Qué le falta para producción?" | Integración con el padrón real del SAT, revisión humana obligatoria antes de escalar un caso, y auditoría de sesgo por giro y tamaño de empresa. El sistema propone; la autoridad determina. |

## Preguntas para hacerle a los jueces el día del evento

1. ¿Cómo pesa la rúbrica la explicabilidad frente a la capacidad de detección?
2. ¿Esperan procesamiento de XML de CFDI reales, o basta con datos estructurados que repliquen el formato?
3. ¿Van a evaluar con datos de prueba ocultos al final, o con el dataset de cada equipo?
4. ¿Valoran que se crucen fuentes reales como la lista 69-B?
5. ¿La evaluación premia cubrir más tipologías, o cubrir menos con mejor sustento?

La primera y la quinta son las que más pueden cambiar dónde se invierten las últimas ocho horas.

## Addendum H0 (21): lo que el juez principal dijo que evaluará

Ajustes al guion, sin quitar nada de lo anterior:

- **Abrir como fundadores, no como contratistas.** Primera frase: qué hace el producto, para quién y qué **no** hace todavía (padrón real, revisión humana obligatoria, sesgo por giro). Cerrar con costo por caso medido y latencia p50/p95 reales de la corrida.
- **Tendencia, no anomalía.** Al abrir el caso, mostrar primero la `Trayectoria` (serie mensual con alta, primer CFDI, pico, silencio, 69-B) y decir: "no marcamos por una transacción rara; marcamos por una trayectoria que no se explica de forma inocente".
- **"¿Por qué esta sí y aquella no?"** Después del dictamen, abrir el panel `Contraste`: el RFC comparable con resultado distinto y la razón tipificada. Ese es el minuto que responde literalmente la pregunta del juez.
- **Inyección en vivo (2:45–3:20 alternativo).** Ofrecer al jurado inyectar su propio paquete en `/datos → Inyectar datos en vivo`, o usar el paquete (a) `eval/inyecciones/`; enseñar `/inyecciones/[id]`: recibida → validada → snapshot N+1 → pistas nuevas → clusters afectados → investigación → dictamen, con timestamps reales, y el diff antes/después. Si la latencia medida supera el tiempo de exposición, mostrar la ejecución guardada e identificarla como tal. Tener a mano el paquete (c) (trampa legítima) para demostrar `anomalia_explicada` bajo inyección. **Cuidado con esta frase hasta que se mida:** ese nivel exige que el Defensor corra y descarte todas las pistas evaluables, y que el caso no arrastre ninguna limitación (07 §153). Era inalcanzable hasta el hotfix H11 (ver ESTADO.md, hallazgo H11-b) y todavía no se ha ejercido con la API real. Si en el ensayo previo al demo el paquete (c) no cierra en `anomalia_explicada`, enseñar el caso del despacho contable de 2:45 y decir del paquete (c) lo que de verdad salió.
- **El camino.** Ruta `/metodo` con la bitácora de decisiones (DECISIONES.md): decisiones bajo ambigüedad, alternativas descartadas, evidencia. Un juez que pregunte "¿cómo llegaron aquí?" recibe esa pantalla.
- **Preguntas nuevas para el jurado:** ¿el paquete que inyectan sigue el formato CFDI/movimientos que publicamos o traen columnas propias (mapper)? ¿Evalúan la reacción por latencia, por explicación o por ambas? ¿Quieren ver el caso legítimo bajo inyección?
