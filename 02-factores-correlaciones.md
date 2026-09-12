# 02 — Factores, trampas y correlaciones

Este es el corazón conceptual del sistema y la respuesta a la pregunta central del reto: **qué cosas hay que correlacionar entre facturas y registros para encontrar pistas**.

## Los tres niveles

1. **Pista**: una regla determinista, barata, sin IA, que se dispara sobre los datos. No afirma fraude. Afirma "aquí hay algo que explicar". Se calcula en SQL para todo el dataset en segundos.
2. **Correlación**: lo que un agente especialista concluye tras investigar una o varias pistas con herramientas. Aquí entra el criterio.
3. **Tipología**: el esquema de fraude que se arma cruzando correlaciones de familias distintas. La determina el Auditor.

## Las cinco familias

Cada familia es una **fuente de evidencia independiente**. Esa independencia es lo que hace válida la regla de dos familias.

| Letra | Familia | Pregunta que responde | Fuente de datos |
|---|---|---|---|
| D | Documental | ¿Lo que factura corresponde a lo que esta empresa puede hacer? | CFDI, nómina, catálogo de claves |
| F | Financiera | ¿El dinero se movió como dice la factura, y a dónde acabó? | Movimientos bancarios, complementos de pago |
| R | Relacional | ¿Quiénes son realmente estas empresas entre sí? | Atributos de entidad, grafo de facturas |
| T | Temporal | ¿La secuencia de hechos tiene sentido en el tiempo? | Fechas de alta, timbrado, series mensuales |
| E | Externa | ¿Qué dice el SAT y la red cercana? | Listas 69-B/69 |

## Catálogo de las 14 pistas

La última columna es la trampa: el caso legítimo que dispara la misma pista. **Cada trampa debe existir en el dataset generado**, porque es contra ellas que se mide la tasa de falsos positivos.

### Familia D — Documental

| Código | Factor | Regla (SQL, sin IA) | Qué investiga el agente | Trampa legítima |
|---|---|---|---|---|
| **D1** | Giro vs. concepto | >40% de lo facturado con `ClaveProdServ` fuera del catálogo del giro registrado | Si compra insumos congruentes con lo que dice vender | Diversificación real del negocio, respaldada por compras del nuevo giro |
| **D2** | Capacidad operativa | Facturación 12m > p50 del giro **y** (nómina = 0 o nómina/facturación < p10 del giro) **y** compras < p10 | A quién subcontrata; sube por la cadena de proveedores | Opera con subcontratistas reales y verificables (hay CFDI de compra de servicios) |
| **D3** | Conceptos y montos | >60% de facturas con monto múltiplo de 1,000, o desvío de Benford (chi² sobre primer dígito) > umbral | Si el patrón se concentra en ciertos receptores o es general | Consultoría real que cobra en montos redondos a clientes diversos |
| **D4** | Cancelaciones | Tasa > p90 del giro, o >50% de las cancelaciones concentradas en diciembre/marzo | Qué se canceló, a quién, y cuánto tiempo después | Errores corregidos con refacturación inmediata (existe `uuid_sustituye`) |

### Familia F — Financiera

| Código | Factor | Regla | Qué investiga el agente | Trampa legítima |
|---|---|---|---|---|
| **F1** | Conciliación CFDI–banco | PUE sin movimiento entrante en ±7 días con monto ±2% desde cuenta del receptor; PPD sin complemento de pago a >120 días | Si hay compensación, factoraje, crédito comercial documentado | Crédito comercial normal del giro, o factoraje con contrato |
| **F2** | Pass-through | En ventana de 30 días: salidas/entradas ≥0.9, saldo medio <5% de entradas, y >50% de salidas a personas físicas o efectivo | A dónde va el dinero: personas físicas, efectivo, cluster, o de regreso | Comercializadora de margen delgado con compras reales a proveedores del giro |
| **F3** | Tercero pagador | >30% de los pagos provienen de una cuenta cuyo titular no es el receptor del CFDI | Relación del tercero con ambas partes | Tesorería centralizada de un grupo corporativo, o factoraje financiero |
| **F4** | Ciclo de dinero | Ciclo en el grafo de movimientos ≤4 saltos, ≤15 días, monto conservado ±15% | Cuánto se queda en cada salto (la comisión) | Préstamos intercompañía documentados |

### Familia R — Relacional

| Código | Factor | Regla | Qué investiga el agente | Trampa legítima |
|---|---|---|---|---|
| **R1** | Atributos compartidos | ≥3 RFC comparten domicilio, representante, email, teléfono o CLABE | Si el cluster se factura entre sí y si el dinero circula dentro | Despacho contable o coworking: comparten domicilio con sus clientes pero **no se facturan entre sí** |
| **R2** | Ciclos y cadenas de facturas | Ciclo ≤5 saltos con montos ±15% y ventana ≤30 días; o cadena ≥4 saltos con monto decreciente 3–10% por salto | Sincronía de fechas y si hubo flujo real de dinero | Grupo corporativo con operaciones intercompañía reales (hay nómina, hay entrega) |
| **R3** | Concentración | Top-3 contrapartes concentran >85% del volumen | Si esas contrapartes están en el mismo cluster relacional | Cliente ancla o proveedor exclusivo legítimo |

### Familia T — Temporal

| Código | Factor | Regla | Qué investiga el agente | Trampa legítima |
|---|---|---|---|---|
| **T1** | Ciclo de vida | Alta <12 meses, pico de facturación en un trimestre >60% del total, y silencio ≥2 meses después | Si aparece otro RFC del mismo cluster justo cuando este calla (rotación de fachadas) | Startup en crecimiento, o empresa de proyecto único; la nómina crece o existe |
| **T2** | Sincronía y estacionalidad | ≥3 facturas de una misma cadena timbradas en <6 h; o pico de diciembre >3x la mediana mensual sin histórico previo | Si el pico existe en años anteriores o en pares del mismo giro | Estacionalidad real del giro (comercio en diciembre, construcción por obra) |

### Familia E — Externa

| Código | Factor | Regla | Qué investiga el agente | Trampa legítima |
|---|---|---|---|---|
| **E1** | Listas del SAT | RFC en 69-B (cualquier estatus), o contraparte a ≤2 saltos con estatus definitivo | Estatus exacto y fechas de publicación contra las fechas de las operaciones | Estatus **desvirtuado** o **sentencia favorable**: no se marca. También: operaciones anteriores a la fecha de publicación |

## Prioridad para 36 horas

Primera entrega: **D2, F1, F2, R1, R2, E1 y T1**. Las seis primeras cubren cuatro familias; T1 incorpora la temporal para probar los cinco especialistas. Segunda entrega: **D1, D3, D4, F3, F4, R3 y T2**. Las 14 pistas forman parte del alcance; el orden permite integrar antes. Fechas y gates en `12-plan-36h.md`.

## Umbrales relativos, no absolutos

Ningún umbral es fijo. Todos se comparan contra **pares del mismo giro y tamaño** (vista `v_pares_giro`, percentiles p10/p50/p90). Razón: "factura mucho sin nómina" es normal en una comercializadora y rarísimo en una consultora. Un umbral global genera falsos positivos sistemáticos en giros de margen delgado y falsos negativos en giros intensivos en personal.

Aquí es donde pesa la formación estadística y es un punto que vale la pena decir en el pitch.

## Las correlaciones: cómo se combinan en tipologías

Una pista sola no dice nada. Lo que identifica un esquema es la combinación. **Regla de oro: un caso necesita evidencia confirmada de al menos dos familias distintas.**

| Tipología | Combinación mínima | Nota |
|---|---|---|
| **efos_sin_sustancia** | D2 + T1 (misma y otra familia) reforzado por E1 o F1 | D1+D2+D3 juntas **no alcanzan**: son la misma familia, es la misma fuente de evidencia mirada tres veces |
| **retorno** | F2 + (D2 o R1) | **F1 pasa limpio**, porque el pago sí existe. Es el caso que una conciliación simple no ve; por eso va en el demo |
| **carrusel** | R2 + R1 + (F4 o F1) | El ciclo de facturas con el cluster de atributos y el dinero que regresa o nunca se movió |
| **capas** | R2 (cadena lineal) + T2 (sincronía) + F1 | Monto que se conserva menos comisión en cada salto |
| **cluster_prestanombres** | R1 + R2 + (D2 o F2) | Varios RFC con atributos compartidos que además se facturan entre sí |

## Por qué la regla de dos familias funciona

Es una regla de independencia de fuentes, no un umbral arbitrario. Una empresa legítima puede verse rara desde **un** ángulo por mil razones inocentes: el giro, el tamaño, un año malo, una estrategia de cobro. Que se vea rara desde dos ángulos que dependen de datos distintos (documentos y dinero, o dinero y relaciones) es mucho más difícil de explicar de forma inocente.

Es también lo que hace que el sistema sea defendible ante un juez y ante un auditor: no marca por acumulación de señales débiles del mismo tipo.

## Anti-patrones a evitar

- **Sumar scores de la misma familia** hasta cruzar un umbral. Es el error que produce la mayoría de los falsos positivos en sistemas comerciales.
- **Usar el texto de la factura como prueba.** `descripcion` lo escribe el defraudador. Sirve para orientar la investigación, nunca para sostener el dictamen.
- **Marcar por estar cerca de un 69-B.** Una empresa legítima puede tener un proveedor que resultó ser EFOS; de hecho eso la convierte en EDOS con derecho a acreditar materialidad en 30 días. E1 a 2 saltos es una pista, no un veredicto.
- **Ignorar fechas de publicación.** Operaciones anteriores a la publicación del estatus definitivo tienen otro tratamiento.
