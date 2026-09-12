# 14 — Fuentes

## Normativa y datos oficiales (México)

| Fuente | Qué aporta | URL |
|---|---|---|
| SAT — datos abiertos art. 69-B | El listado como datos abiertos | http://omawww.sat.gob.mx/tramitesyservicios/Paginas/datos_abiertos_articulo69b.htm |
| SAT — contribuyentes con operaciones presuntamente inexistentes | Listado de presuntos, fundamento en art. 69-B CFF y RCFF 69–70 | https://wwwmat.sat.gob.mx/consultas/76674/consulta-la-relacion-de-contribuyentes-con-operaciones-presuntamente-inexistentes |
| SAT — contribuyentes que realizan operaciones inexistentes | Listado definitivo y opción "Listado completo" | https://wwwmat.sat.gob.mx/consultas/76675/consulta-la-relacion-de-contribuyentes-que-realizan-operaciones-inexistentes |
| SAT — contribuyentes que desvirtuaron la presunción | Listado de desvirtuados (la trampa legítima de E1) | https://wwwmat.sat.gob.mx/consultas/76676/consulta-la-relacion-de-contribuyentes-que-desvirtuaron-la-presuncion-de-inexistencia-de-operaciones |

Fundamento legal citado en esas páginas: artículo 69-B del CFF; regla 2.9.20 de la RMF 2026 para el procedimiento de consulta; regla 1.4 y Anexo 1-A; artículos 69 y 70 del RCFF. Sanción penal: artículo 113 Bis del CFF, de dos a nueve años de prisión.

## Contexto y volumen

| Fuente | Qué aporta | URL |
|---|---|---|
| CIAL Dun & Bradstreet — lista negra del SAT | Los cuatro listados + 69-B Bis, plazos (15 días + 5 de prórroga, 50 para resolver, 30 para el EDOS), 903 EFOS definitivos entre enero y el 12 de junio de 2026, advertencia de bloqueo de descargas | https://es.cialdnb.com/blog/que-es-la-lista-negra-del-sat-y-como-te-afecta-cial |
| 69b.mx | Campos del listado, definiciones de presunto/definitivo/desvirtuado, >14,000 RFC, mayoría de EFOS son personas morales creadas para el fin | https://69b.mx/listado-69b |
| Induxsoft | EFOS/EDOS, art. 113 Bis | https://es.induxsoft.net/mx/sat/consulta-efos-y-edos/ |
| Blog Estela | Evolución de estatus por año | https://blog.estela.com/mexico/sabe-consultar-la-lista-negra-69-b-del-sat |
| MCCI — Mexicanos Contra la Corrupción | 3,016 EFOS definitivos en 2018 → 1,940 en 2019 → 47 en 2023; caída del 98% | https://contralacorrupcion.mx/la-deteccion-de-empresas-fantasma-se-desplomo-98-en-el-penultimo-ano-de-amlo/ |
| Quinto Elemento Lab — El Pacto de las Sombras | Clústers que comparten accionistas, administradores, representantes legales y comisarios; tipificación de 2019 como delincuencia organizada | https://quintoelab.org/fantasmas-del-erario/empresas-fantasma-corrupcion-unam/ |
| Contabilidad Forense | Metodología del contador forense: análisis de sustancia económica, triangulación, rastreo de flujos, mapeo de vínculos | https://contabilidadfinanzas.com/contabilidad-forense/empresas-fantasma/ |
| iAudita | El SAT usa IA y analítica de grafos para detectar redes de EFOS | https://iaudita.com/ayuda/como-detectar-efos-proveedores-facturas |

## Datasets

| Fuente | Qué aporta | URL |
|---|---|---|
| Altman et al., *Realistic Synthetic Financial Transactions for AML* | El paper de AMLworld/IT-AML: las 8 tipologías (fan-in, fan-out, bipartito, stack, random, ciclo, scatter-gather, gather-scatter), etiquetado transitivo, HI vs LI, small/medium/large | https://arxiv.org/abs/2306.16424 |
| Espejo HI-Small en Hugging Face | Alternativa si no hay cuenta de Kaggle | https://huggingface.co/datasets/eexzzm/IBM-Transactions-for-Anti-Money-Laundering-HI-Small-Trans |
| GARG-AML (arXiv 2506.04292) | Distribución de patrones en HI-Small y LI-Large; categoría "not classified" | https://arxiv.org/pdf/2506.04292 |
| Network Analytics for AML (arXiv 2405.19383) | Cómo se construye el grafo de flujo de dinero con ventana temporal | https://arxiv.org/pdf/2405.19383 |
| BlazingAML (arXiv 2604.12241) | Tamaños exactos de los seis datasets IBM | https://arxiv.org/pdf/2604.12241 |

## Detección de fraude con grafos

| Fuente | Qué aporta | URL |
|---|---|---|
| Linkurious — fraude carrusel de IVA | El patrón canónico: cadena de ventas + intermediario reciente + ventana corta, con la query Cypher | https://linkurious.com/blog/vat-fraud-mysterious-case-missing-trader/ |
| Linkurious — casos de uso de grafos en fraude | Las empresas del esquema comparten directores, domicilios registrados y datos de contacto | https://linkurious.com/blog/fraud-use-cases-graph-analytics/ |
| Tutorial Neo4j de carrusel (Mongeau / Villedieu) | Implementación paso a paso | https://gist.github.com/jvilledieu/d882df51a4775a6b7588 |
| Bruggen — carrusel y detección de anillos | Uso de path expander para anillos profundos | https://blog.bruggen.com/2020/06/what-vat-fraud-detection-and-contact.html |
| JRSS-A — network approach to detect VAT fraud | Missing trader en su forma simple; las dos características del fraude de IVA: requiere varios actores B2B y no todas las transacciones son reales | https://academic.oup.com/jrsssa/advance-article/doi/10.1093/jrsssa/qnaf205/8407576 |
| Patente US 11231830 | GUI para búsqueda de patrones MTIC/carrusel en redes | https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11231830 |
| mlogica — AI flags tax evasion | Algoritmos de grafo para flujos circulares, clusters densos y entidades efímeras, combinados con análisis temporal | https://www.mlogica.com/resources/blogs/catching-the-invisible-ai-flags-tax-evasion-patterns-as-they-happen |
| itbid — ML para fraude en facturación de proveedores | Entity resolution, empate PO-factura, desvíos temporales y de monto, Isolation Forest, GNN | https://itbid.com/blog/machine-learning-para-detectar-fraudes-en-facturacion-de-proveedores/ |

## n8n

| Fuente | Qué aporta | URL |
|---|---|---|
| n8n docs — tips y problemas comunes de evaluaciones | "Return intermediate steps" agrega el campo `intermediateSteps` usable en nodos posteriores | https://docs.n8n.io/advanced-ai/evaluations/tips-and-common-issues/ |
| n8n issue #21998 | **Los intermediate steps no se devuelven cuando el streaming está activo.** Fundamenta la configuración obligatoria | https://github.com/n8n-io/n8n/issues/21998 |
| n8n docs — Tools Agent | Max Iterations, System Message, Tracing Metadata | https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent |
| n8n docs — AI Agent Tool | Agentes como herramientas de otro agente; batch processing | https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolaiagent |

## Nota sobre el uso de estas fuentes

Infraestructura acelerada y delegación (17–20): [subagentes Claude Code](https://code.claude.com/docs/en/sub-agents), [worktrees](https://code.claude.com/docs/en/worktrees), [configuración de modelos](https://code.claude.com/docs/en/model-config), [Messages/tool results](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [acción oficial y OAuth](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md), [seguridad de la acción](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) y [schedule GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule). Las capacidades de cuenta/instancia se comprueban en preflight, no se infieren de documentación.

Referencias de producto/voz consultadas para los documentos 15/16 (11-09-2026):

- [ElevenLabs Brand](https://elevenlabs.io/brand): lenguaje de marca como referencia. Los tokens y tiempos de animación propuestos son de Forense; no mediciones de un dashboard privado ni uso del logo ajeno.
- [ElevenLabs: llamada saliente por Twilio](https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call): endpoint, identificadores y datos de iniciación. Probar el contrato con la cuenta/número disponibles.
- [ElevenLabs: variables dinámicas](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables): personalización mínima del saludo y referencia de reporte.
- [ElevenLabs: webhooks post-call](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks): eventos de resultado y validación HMAC. No equiparar aceptación HTTP con aviso escuchado.
- [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks): eventos INSERT/UPDATE/DELETE para notificar al backend desde el outbox.

Fuentes de ejecución añadidas al corregir el gameplan:

- [Claude: suscripción y consumo API/Console](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console): comprobar por separado la cuenta API que utiliza n8n; los accesos de programación no fijan su cuota.
- Las referencias primarias de orden de ejecución, subworkflows y concurrencia de n8n quedan enlazadas en `07-n8n-workflows.md`, junto al contrato que sustentan. Comprobarlo en la versión instalada durante H0–1.

Ninguna de estas fuentes se cita textualmente en el código ni en el expediente que produce el sistema. Sirvieron para tres cosas: fundamentar las reglas de detección en el criterio legal real, no inventarlo; calibrar qué hacen los sistemas comerciales para saber en qué nos diferenciamos; y confirmar detalles técnicos de n8n que habrían costado horas descubrir durante el hackathon.

El diferenciador del proyecto —el Defensor y la regla de dos familias— no viene de ninguna de estas fuentes. Viene del procedimiento del 69-B, que ya le concede al contribuyente el derecho a desvirtuar: lo único que hicimos fue ejercerlo de oficio dentro del sistema.
