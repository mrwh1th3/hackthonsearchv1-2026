# 00 — El reto

## Enunciado (sesión informativa de Infosys)

El reto se centra en la facturación falsa como pérdida de ingresos fiscales para el gobierno. El planteamiento textual de la sesión: la gente crea empresas fantasma, emite facturas falsas y forma toda una cadena de fraude. La tarea es construir un **agente forense** capaz de investigar registros financieros (registros bancarios y de los proveedores involucrados) e identificar la cadena de transacciones fraudulentas en términos de facturas.

Lo que explicaron sobre el esquema: una empresa crea una factura falsa a nombre de otra empresa, esa otra crea una factura falsa a nombre de una tercera, y así se forma la cadena. No hay transferencia real de dinero, pero sí un valor que se muestra a las autoridades fiscales. Eso infla ingresos, hace aparecer con dinero a empresas que no lo tienen, y se usa para obtener préstamos y para montar otros tipos de fraude encima.

Mencionaron explícitamente que la autoridad tributaria mexicana tiene un formato de facturación electrónica documentado públicamente, que los equipos pueden crear facturas y cadenas sobre ese formato, y que son libres de usar cualquier libro mayor disponible públicamente para detectar patrones inusuales.

## Requisitos explícitos

1. **Detectar la cadena completa**, no facturas sueltas.
2. **Fundamentar el razonamiento.** Lo repitieron varias veces: solo cuando hay explicación las autoridades fiscales tienen la capacidad de proceder con esos casos.
3. **Minimizar falsos positivos.** Textual: muchas personas que son legítimas pueden presentar anomalías y no queremos que se las marque como fraudulentas, pues eso conlleva una carga de cumplimiento normativo. El objetivo es identificar solo las actividades fraudulentas.
4. **Prototipo funcional en vivo** el día del hackathon.
5. **No hay dataset provisto.** No compartirán datos explícitos. Sí compartirán enlaces a recursos abiertos. Los equipos pueden construir su propio conjunto de datos y usar datasets adyacentes que no hayan mencionado. Dijeron explícitamente que hay libertad creativa ahí y que eso puede mejorar la solución.
6. **IA libre.** Los participantes pueden usar IA tanto para programar como para los agentes, con cualquier modelo o herramienta.
7. **Elección de reto el mismo día.** El otro enunciado es de agentes de entrega de última milla maximizando ganancias. No hay asignación: se elige por interés.

## Evaluación

- La rúbrica se comparte el día del hackathon.
- La solución tiene el mayor peso. Dijeron que cómo se construye la solución no es una parte significativa de la evaluación en ningún hackathon.
- El documento con el enunciado completo se entrega al inicio del evento, con tiempo para revisarlo y volver con preguntas.

## Lectura entre líneas

**Precisión y explicabilidad pesan más que recall.** Casi todos los equipos van a construir un detector de anomalías. Pero anomalía no es fraude, y los jueces lo saben: lo dijeron dos veces con distintas palabras. El equipo que muestre por qué *no* marcó a una empresa rara pero legítima se diferencia solo.

**El dataset es parte de la solución.** Como no dan datos, un generador con ground truth permite mostrar métricas reales en el demo. Sin eso, el demo es "confíen en mí".

**El usuario final es el auditor.** El entregable no es un score, es un expediente que alguien del SAT pueda leer y usar para iniciar un procedimiento. Eso encaja con el discurso de Infosys sobre mejorar la vida de los ciudadanos desde la perspectiva de seguridad pública.

**Uno de los jueces trabaja en identidad.** Hitesh se presentó como mantenedor y colaborador de un proyecto open source de plataforma de identidad abierta (MOSIP). La resolución de entidades —detectar que 15 RFC distintos comparten representante, domicilio o cuenta— va a resonar con él.

**Perfil del panel.** Kotesh (17 años en Infosys, Strategic Technology Group, I+D de una plataforma de salud en EE. UU., estará presente físicamente), Hitesh (identidad e inteligencia, open source, desde India), Alberto Labarga Arista (gerente sénior de proyectos, 23 años en TI, 12 en Infosys), y Monu. Los tres primeros aclaran dudas del enunciado durante el evento.

## Nuestra elección

Reto de fraude fiscal. Razones: el equipo tiene contexto mexicano real (CFDI, 69-B, EFOS/EDOS) que la mayoría no va a tener; el problema premia razonamiento explicable sobre optimización, que es donde un sistema multi-agente se luce; y la capa de falsos positivos es un diferenciador que casi nadie va a construir.
