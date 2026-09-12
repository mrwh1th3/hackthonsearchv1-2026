# 12 — Gameplan: 36 horas, alcance completo

## Objetivo y condiciones

**Se conserva todo:** 14 pistas, cinco especialistas, dos rondas, frontera, Auditor, Defensor, Réplica, Validador y Auditor Final deterministas, dos reintentos, redactor, editor/chat, todas las vistas, tres fuentes de datos y evaluación comparativa. Las entregas incrementales adelantan la integración; no eliminan funciones.

Estimación condicionada a infraestructura accesible, tres carriles con IA y una persona responsable de integrar. A/B/C corresponden a los roles anteriores Manu/B/C: pueden ser tres integrantes asistidos o sesiones aisladas supervisadas por un integrador. Los tiempos se recalibran con las pruebas, no con la velocidad de generación de código.

**Ruta crítica:** contrato → snapshot cargado → pistas/RPC verificadas → investigación completa → defensa y validación → métricas → ensayo. La UI avanza en paralelo desde fixtures. Primer expediente real **H8–10**; alcance integrado **H24–26**; correcciones hasta **H32**.

El alcance de producto incluye el design system inspirado en ElevenLabs, login demo, perfil, historial, vistas/filtros de gráficas, editor tipo Docs con chat y sugerencias, notificaciones y aviso telefónico de los documentos 15/16. El estado de producto `investigacion_completa` ocurre **después** de defensa, validación y reporte persistido; no confundirlo con terminar las búsquedas. La telefonía es una dependencia externa que se verifica en H0, no al final.

## H0–1: cerrar contratos y verificar acceso

**Antes de H0:** el usuario confirmó ~90 min restantes antes del evento. Solo documentación/andamio permitido; no implementar lógica ni UI del reto anticipadamente. Los tres supervisores pueden revisar destinos, modelos, ownership y contratos.

**Objetivo UI H1, agresivo y verificable:** 0–15 min scaffold/contratos/fixtures; 15–35 shell y todas las rutas; 35–50 ChartPanel y editor base; 50–60 QA visual/navegación. Tres personas supervisan integración, UI y datos. Esto acredita superficie navegable con fixtures rotulados, no editor/chat completo, API real, métricas ni voz. Integrar comportamiento real en los gates siguientes; no anunciar “UI terminada” si botones clave son placeholders.

- Confirmar rúbrica, entrada esperada y dataset oculto. Fijar IDs, estados, eventos, herramientas y salida en los documentos 05/06/07.
- Probar Postgres, PostgREST, realtime, despliegue y una llamada API con herramienta. Medir concurrencia real de dos tareas por timestamps; dibujar ramas en n8n no basta.
- Verificar acceso a ElevenLabs Agents, número saliente conectado, destinatario autorizado y callback HTTPS. Acordar tokens visuales, contrato de editor y sesión demo; no realizar llamadas por guardar el perfil.
- Tres ramas/worktrees con dueños. Integrar cambios pequeños cada 60–90 minutos; una persona aplica migraciones al proyecto compartido y publica workflows.
- Los accesos Claude/Codex se distribuyen entre carriles según disponibilidad. “20x/10x” no permite inferir tokens ni créditos de la API que usará n8n. Verificar esa API por separado; el reset queda como reserva, sin depender de él.
- Proveedor: auditar sistema existente GitHub Actions/Claude Code en15–20 min (20), o comprobar API. Elegir uno; validar sus cuotas y qué puede medir. Subagentes y prompt maestro en18/ARRANQUE; tres builders iniciales, hasta cuatro con decisión humana.

## Orden único de migración y carga

Detalle normativo en 05. Orden de aplicación, aunque se escriban en paralelo:

1. `db/001_schema.sql`: tablas, claves por corrida, índices, RLS y realtime.
2. `db/002_views.sql`: utilidades compartidas de logging/presupuesto y vistas.
3. `db/003_pistas.sql`: 14 pistas, selección de candidatos y orquestador SQL.
4. `db/004_clusters.sql`: creación y expansión de clusters.
5. `db/005_rpc.sql`: herramientas, funciones de sistema y permisos explícitos.
6. `db/006_producto_ui.sql`: perfiles privados, investigaciones agrupadas, vistas guardadas, propuestas, actividad y documento estructurado/versionado.
7. `db/007_notificaciones_voz.sql`: outbox, notificaciones, intentos de llamada y cierre transaccional. Activar webhook **después** de aplicar y probar estos permisos.
8. `db/008_ingesta.sql`: importaciones/mapping/staging/rechazos privados (19). El generador/loader canónico no espera al mapeador genérico.

**Fixture manual:** `db/seeds/seed_fake.sql` conserva los tres casos del antiguo `006_seed_fake.sql`. Se carga tras 001+002, sin esperar 003–005, en una corrida de prueba excluida de evaluación. No es una migración.

`db/seeds/seed_producto.sql` se carga después de 006+007: perfil demo, historial y notificaciones sintéticas, sin teléfonos reales ni disparos de llamadas. Ningún seed se ejecuta automáticamente en producción.

**Ejecución:** loader → snapshot validado y marcado `lista` → pistas → clusters → agentes. Repetir un experimento crea otra corrida con el mismo snapshot y nuevas versiones de prompts/reglas; no una corrida vacía ni un overwrite.

## Carriles con propiedad exclusiva

- **A · integración/agentes:** `n8n/`, prompts, contratos de eventos y secuencia completa.
- **B · datos/SQL/evaluación:** `db/`, `generator/`, `loaders/`, `eval/`. Dueño del esquema; A/C solicitan cambios.
- **C · producto/demo:** `web/`, fixtures de presentación acordados con B, grafo, realtime, editor y exportaciones.

18 desglosa estos carriles en ocho perfiles Claude con ownership reservado y oleadas. No son ocho personas ni ocho workers obligatorios; un único integrador mantiene contratos/lockfiles y abre como máximo los slots disponibles.

Revisión cruzada antes de integrar. Cada entrega incluye entradas/salidas, una prueba ejecutable y la versión del contrato. No ejecutar sesiones simultáneas que modifiquen los mismos archivos.

## H1–4: integración mínima

- **A:** esqueleto de workflows y worker; llamada real a herramienta con JSON y bitácora. Preparar la secuencia Auditor → Defensor → Réplica → Validador → Auditor Final → redactor contra fixtures.
- **B:** 001+002, seed separado y generador con cinco tipologías/ocho trampas. Obtener 69-B e IBM en segundo plano.
- **Datos:** generador canónico primero; perfilar datasets y reconocer adaptadores IBM/69-B. Preparar008/mapeo manual+IA sobre schema/muestra sanitizada, no generar filas masivas con LLM ni aceptar campos inventados.
- **C:** Next.js desplegado, cola/detalle contra tres casos y realtime; resto de componentes contra el contrato.
- **Producto:** C implementa tokens, shell, login `auditor` / `1234`, favicon y componentes compartidos; B prepara 006/007 después del contrato base; A comprueba configuración de telefonía sin bloquear el pipeline.
- **Gate H4:** DB → herramienta → n8n → evento persistido → UI funciona. Es una prueba técnica, no una métrica de detección.

## H4–10: primer expediente real completo

- **A:** cinco especialistas, Auditor, Defensor, Réplica, Validador, Auditor Final y redactor conectados. Fan-out y barrera por tareas despachadas.
- **B:** loader, D2/F1/F2/R1/R2/E1 + T1 para cubrir las cinco familias; clustering y RPC. Comprobar resultados SQL antes de culpar a los prompts.
- **C:** carriles, pizarrón, grafo y expediente de lectura; estados reales de espera/error.
- **Producto:** perfil/consentimiento, historial y prompt con sugerencias; agrupar solicitudes con `investigacion_id`. Cierre del primer reporte genera notificación interna y outbox, sin llamar por cada cluster.
- **Gate H8–10:** una cadena del dataset de prueba llega al expediente con evidencia; el despacho entra por investigación manual y produce defensa verificable. Guardar latencia, tokens y llamadas.

## H10–18: profundidad y cobertura

- **A:** ronda 2, expansión única, dos reintentos dirigidos, errores/timeouts, idempotencia y lease. Pipeline de corrida.
- **B:** completar D1/D3/D4/F3/F4/R3/T2: **14/14**. Validar cinco tipologías y ocho trampas; métricas, baseline e IBM normalizado.
- **Ingesta:** cerrar mapping declarativo, staging y promoción validada de19; datos ambiguos requieren confirmación. Probar al menos un CSV desconocido compatible además de adaptadores conocidos.
- **C:** explorador, mapa, estadísticas/comparación, bitácora cruda; editor/chat contra contrato de versiones.
- **Producto:** ChartPanel con vistas compatibles, filtros de fechas y CSV; hoja/editor Docs, autosave y chat con propuestas. A conecta los dos workflows de voz y prueba idempotencia; B revisa privacidad y transición de cierre.
- **Gate H18:** corrida completa sin duplicados ni mezcla de experimentos; pruebas específicas de frontera, defensa y reintento.

## H18–26: integrar todo el alcance

- **A:** backend de editor con selección, preguntas y versiones; validar citas al guardar. Probar cuota, recuperación y presupuesto global.
- **B:** ejecutar IBM, perfil grande y baseline; preparar el manifiesto de la semilla reservada y cerrar casos de borde de SQL/RPC. La evaluación reservada espera al cierre de calibración.
- **C:** diff, aceptar/revertir, exportaciones Markdown/PDF y CSV, filtros, recorridos entre vistas y grafo con ejecuciones reales.
- **Producto:** completar descargas JSON, notificaciones/toasts, preferencias, filtros guardados, motion y responsive. Probar llamada autorizada extremo a extremo, callback y rechazo de firma; una solicitud completa produce un solo evento. Chat propone → usuario aplica → nueva versión validada; una pregunta no modifica el documento.
- **Gate H24–26:** checklist final integrado. Una pantalla alimentada solo con fixtures no acredita una función terminada.

## H26–32: medir y corregir

- Diagnosticar en orden: datos → selección → herramientas → investigación/defensa → clasificación → métricas → UI.
- Comparar al menos tres corridas con snapshot y configuración registrados; una variable por comparación. Congelar configuración a H30 y comprobar la semilla reservada entre H30–32 sin reajustar contra ella.
- Mostrar TP/FP/FN/TN, FPR con numerador/denominador, cobertura y no concluyentes. Evaluar cadena y evidencias sin propagar automáticamente el nivel a todos los vecinos.
- **Gate H32:** demo estable en producción, cobertura documentada y latencia medida. Congelar funciones nuevas.

## H32–36: demo y entrega

Ensayar dos veces los cuatro minutos: cadena, defensa legítima, citas, métricas e IBM. Investigación en vivo de un caso medido, comparativas ya procesadas. Grabar respaldo **a más tardar H33**; conservar snapshot, exportaciones y arranque local.

Descanso por relevos con traspaso escrito de estado, siguiente gate y bloqueos. Siempre queda alguien responsable de integración; las horas de revisión humana también cuentan.

## Qué tomará más tiempo

**Integrar y depurar datos → herramientas → agentes → defensa → métricas, más editor y notificación: reservar 13–19 horas repartidas entre H4 y H26.** IDs, importes, fechas, tareas asíncronas, estado de las defensas y reintentos determinan el resultado. La IA puede generar esos módulos rápido; comprobar sus interacciones exige ejecuciones.

Estimaciones de dedicación por carril, solapadas y no sumables al reloj:

- Generador, normalización y comprobación de trampas: **4–6 h**, con ajustes al medir.
- SQL/RPC, aislamiento y evidencia: **5–8 h**.
- UI completa, grafo, diseño y editor: **12–18 h**. El editor con selección, diff, autosave, citas y exportación es la parte de producto más lenta; construir un editor de texto desde cero no entra en esta estimación.
- Importador asistido desconocido, además de loaders conocidos: **3–5 h estimadas en B**. La ambigüedad semántica de moneda/fechas/identidad y revisión humana puede superar el tiempo de programación; no bloquear el primer caso por intentar soportar todo formato.
- Evaluación, corrección y estabilidad: **6–8 h protegidas**, además de pruebas tempranas.

La ampliación agrega aproximadamente **4–6 h a C, 3–5 h a A y 1–2 h a B**, solapadas: son estimaciones, no tiempos medidos. Telefonía puede bloquear por configuración externa aunque su prompt sea sencillo. Mantener H26–32 para evaluación; si el acceso de voz no está resuelto en H4, registrar el bloqueo y su impacto sin presentar una llamada simulada como real. Las 36 h siguen siendo un objetivo condicionado a tres carriles efectivos y componentes reutilizables, no una garantía por disponer de más IA.

Medir solicitudes reales al modelo: una invocación de agente puede producir varias. No presupuestar una corrida como si cada especialista hiciera una única llamada.

## Si un gate se retrasa

No se recorta alcance automáticamente. Concentrar ayuda 30–45 minutos en la primera dependencia rota; los otros carriles siguen contra contratos. Conservar la función mediante alternativas previstas: ciclos en Python, worker reutilizable, paginación o perfil de datos más pequeño declarado.

Actualizar fecha estimada y margen. Si los tiempos medidos superan H36, comunicar qué falta y por qué; más IA no convierte una estimación incumplida en una garantía.

## Checklist final: nada se pierde

- [ ] 14 pistas, cinco familias, cinco tipologías, ocho trampas y pares por giro.
- [ ] Generador pequeño/grande, 69-B, IBM, snapshots y ground truth separado de agentes.
- [ ] Once herramientas, logging, caché, límites, validación y montos sin doble conteo.
- [ ] Cinco especialistas, pizarrón, dos rondas, frontera, Auditor, Defensor, Réplica, Validador, Auditor Final, dos reintentos y redactor.
- [ ] Seis workflows funcionales (cuatro forenses + dos de notificación) y worker técnico; editor/chat, selección e historial.
- [ ] Cola, corridas/comparación, cluster, detalle, entidad, mapa, bitácora, estadísticas y expediente; realtime, Markdown/PDF y CSV.
- [ ] Diseño 15 completo: login demo, perfil, historial de investigaciones, sugerencias con contexto, fechas flexibles, vistas de gráficas, documento editable/diff, JSON, favicon, animaciones y notificaciones.
- [ ] Migraciones 006/007, datos de perfil privados, cierre validado → outbox → ElevenLabs, consentimiento, callback firmado, deduplicación y fallo de llamada visible sin invalidar el reporte.
- [ ] Kit de arranque/subagentes, proveedor decidido y medido, checkpoints/fencing/ledger;008 y mapping validado sin fuga de etiquetas ni campos inventados.
- [ ] Baseline, tres corridas, semilla reservada, cobertura, coste/latencia, dos ensayos y video.
