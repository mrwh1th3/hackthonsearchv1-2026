# 01 — Dominio fiscal mexicano

Esta es la ventaja competitiva del equipo. La mayoría de los participantes va a modelar "facturas falsas" en abstracto; nosotros modelamos el esquema real y su marco legal.

## EFOS y EDOS

- **EFOS**: Empresa que Factura Operaciones Simuladas. Es quien emite los comprobantes por operaciones que nunca existieron.
- **EDOS**: Empresa que Deduce Operaciones Simuladas. Es quien usa esas facturas para reducir su base gravable.

Ambas están en el mismo esquema, en lados opuestos de la transacción, y ambas enfrentan consecuencias fiscales y penales. En la práctica, la mayoría de los EFOS son personas morales constituidas específicamente para emitir facturas simuladas, aunque también aparecen personas físicas con actividad empresarial.

## Artículo 69-B del CFF

El fundamento legal. La presunción se activa cuando la autoridad detecta que un contribuyente emitió comprobantes **sin contar con los activos, personal, infraestructura o capacidad material, directa o indirectamente**, para prestar los servicios o producir, comercializar o entregar los bienes que amparan tales comprobantes; o bien que el contribuyente **no está localizado**.

Esa frase es literalmente el criterio que convertimos en reglas: nuestras pistas D2 (factura alto sin nómina ni compras), T1 (ciclo de vida corto con silencio posterior) y E1 (presencia en listas) son la traducción computacional de "sin activos, personal ni capacidad material".

### El procedimiento y sus cuatro listados

El SAT publica cuatro listados bajo el 69-B, más el Listado Global Definitivo del 69-B Bis:

| Estatus | Significado | Cómo lo tratamos |
|---|---|---|
| **Presunto** | El SAT inició el procedimiento. El contribuyente tiene 15 días hábiles para ofrecer pruebas. | Señal fuerte, pero no concluyente por sí sola |
| **Definitivo** | El SAT concluyó que las operaciones son inexistentes. Las facturas son inválidas para efectos fiscales desde la fecha de publicación. | Señal máxima; una contraparte directa con este estatus vale por sí sola |
| **Desvirtuado** | El contribuyente acreditó la materialidad y fue eliminado de la lista. Sus facturas recuperan validez. | **Refuta**. Es una trampa legítima que el Defensor debe usar |
| **Sentencia favorable** | Ganó el medio de defensa. | **Refuta** |

Plazos relevantes: el señalado tiene 15 días para aportar pruebas, con prórroga automática de 5 días, y la autoridad tiene 50 días para resolver. Si el señalado es tu proveedor, tienes 30 días desde la publicación para acreditar la materialidad de la operación o corregir tu declaración.

**El derecho a desvirtuar es el origen conceptual de nuestro agente Defensor.** El procedimiento legal mexicano ya contempla que el señalado presente pruebas en contra; nuestro sistema lo hace de oficio, antes de marcar.

### Contexto de volumen

- El SAT sumó 903 EFOS definitivos entre enero y el 12 de junio de 2026.
- El listado completo acumulado ronda los 14,000 RFC.
- Históricamente la detección es muy volátil: 3,016 nuevos EFOS definitivos en 2018, 1,940 en 2019, y apenas 47 en 2023 — una caída del 98% respecto a 2018.

Ese último dato es un buen argumento de apertura para el pitch: no es que el fraude haya desaparecido, es que la capacidad de detección cayó. Un sistema que baja el costo de investigar ataca justamente eso.

### Consecuencia penal

El artículo 113 Bis del CFF impone sanción de dos a nueve años de prisión a quien, por sí o por interpósita persona, expida, enajene, compre o adquiera comprobantes fiscales que amparen operaciones inexistentes, falsas o actos jurídicos simulados. Desde 2019 la emisión de facturas falsas puede tipificarse como delincuencia organizada.

Esto importa para el diseño: un falso positivo no es un inconveniente administrativo, puede arrastrar a una empresa legítima a un procedimiento penal. Es el argumento moral de la capa de falsos positivos.

## CFDI 4.0: los campos que delatan

El formato de factura electrónica está documentado públicamente por el SAT. Los campos con valor forense:

| Campo | Qué revela |
|---|---|
| `MetodoPago` | **PUE** (pago en una exhibición) implica que ya se pagó: debe existir un movimiento bancario que empate. **PPD** (pago en parcialidades o diferido) exige complementos de pago posteriores; su ausencia prolongada es señal |
| Complemento de recepción de pagos | El comprobante del pago de un PPD. Un PPD sin complemento a 120 días es una operación que nunca se cobró |
| `ClaveProdServ` | Catálogo del SAT. Facturar claves ajenas al giro registrado es incongruencia documental |
| `UsoCFDI` | Para qué dice el receptor que la usa. "Gastos en general" masivo es señal débil pero acumulable |
| `FormaPago` | Efectivo en montos altos es atípico |
| Cancelaciones | Tasa alta o concentrada en cierres fiscales. Desde 2022 la cancelación requiere motivo y, si sustituye, el UUID sustituto |
| CFDI de nómina (tipo N) | **El más importante.** Una empresa sin CFDI de nómina no tiene empleados. Una empresa sin empleados no puede prestar "servicios de personal" ni ejecutar obra. Es la prueba directa de la ausencia de capacidad material del 69-B |

## Los esquemas reales

### 1. EFOS sin sustancia

El básico. Empresa de alta reciente, sin nómina, sin compras, que emite facturas de "servicios de consultoría", "asesoría" o "servicios de personal" a un grupo de EDOS. Conceptos deliberadamente genéricos porque no requieren entrega física verificable.

### 2. El retorno (el más común en la práctica)

**Este es el que el enunciado del reto no describe y nosotros sí cubrimos.** La EDOS sí transfiere el dinero a la EFOS —la operación bancaria existe y una conciliación simple la da por buena— y la EFOS lo devuelve en efectivo, menos una comisión típica del 5 al 10%. El rastro: entra el dinero y sale casi todo en pocos días hacia personas físicas o retiros en efectivo, dejando saldo cercano a cero.

Cubrir esta variante demuestra que entendemos el problema mejor que el enunciado, y es un buen momento del demo.

### 3. Carrusel

Ciclo cerrado: A factura a B, B a C, C a A. Montos similares con pequeñas variaciones que simulan margen. Timbrado sincronizado. El dinero o no se mueve, o regresa al origen en pocos saltos. Es el análogo mexicano del *missing trader* / fraude carrusel de IVA europeo.

### 4. Capas (layering)

Cadena lineal de 4 a 6 saltos donde el monto se conserva menos una comisión de 3 a 8% por eslabón. Cada transferencia entre capas genera documentación que aparenta operaciones reales. El objetivo es alejar el origen del destino.

### 5. Cluster de prestanombres

Varios RFC que comparten representante legal, domicilio, correo, teléfono o cuenta bancaria, y que se facturan entre sí. La investigación periodística mexicana sobre empresas fantasma documentó exactamente esto: las empresas contratadas están ligadas entre sí en clústers que comparten accionistas, administradores, representantes legales y comisarios.

## Metodología del contador forense (lo que replicamos)

El trabajo humano equivalente: recopilar la documentación contable, fiscal y bancaria relacionada con las operaciones sospechosas, y aplicar análisis de sustancia económica, triangulación de información, rastreo de flujos financieros y mapeo de vínculos entre entidades.

Nuestro mapeo directo:

| Técnica forense humana | Componente del sistema |
|---|---|
| Análisis de sustancia económica | Especialista Documental (D1–D4) |
| Rastreo de flujos financieros | Especialista Financiero (F1–F4) |
| Mapeo de vínculos entre entidades | Especialista Relacional (R1–R3) + clustering SQL |
| Triangulación de información | Auditor (cruza familias) |
| Derecho a desvirtuar (69-B) | Defensor |

## Vocabulario para el pitch

Usar los términos correctos en el demo señala dominio del problema: EFOS, EDOS, 69-B, materialidad, desvirtuar, CFDI, PUE/PPD, complemento de pago, timbrado, RFC. Evitar "empresa fantasma" como término técnico (es periodístico) salvo en la introducción.
