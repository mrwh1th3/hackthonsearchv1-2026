# 16 — Investigación completa, avisos y agente ElevenLabs

Plan de integración, no llamadas ejecutadas. Una llamada breve avisa al número configurado en el perfil cuando una investigación tiene reporte listo. No requiere un nuevo agente de análisis: ElevenLabs recibe únicamente datos mínimos ya validados.

## 1. Unidad de notificación y nuevo estado

`forense.investigaciones` agrupa una solicitud del usuario, con modo `caso|corrida`, propietario del perfil, IDs de corrida/caso y manifiesto de objetivos. Conserva mensaje/directriz/contexto de inicio. Sus estados de entrega son:

`en_cola → investigando → generando_reporte → investigacion_completa`

Salidas alternativas: `parcial`, `error`, `cancelada`. Este estado de producto es distinto de `casos.nivel` y de los estados técnicos existentes. Una corrida puede haber cerrado técnicamente con tareas parciales sin estar lista para el aviso de finalización.

**Condición de completitud:** todos los objetivos solicitados fueron tratados, no hay tareas/errores operativos sin resolver, existe reporte validado para cada caso del manifiesto y la versión entregada está persistida. En modo caso basta ese caso; en modo corrida se exige el manifiesto completo, no solo los clusters admitidos antes de agotar tiempo. Una conclusión científica `no_concluyente` con trabajo terminado puede entregarse; un fallo operativo pendiente no se disfraza de investigación completa.

Un cierre sin candidatos genera resumen explícito del barrido y cobertura como artefacto de entrega; no inventa un caso. Los subcasos no disparan llamadas de una investigación masiva. Editar el reporte no vuelve a llamar. Nueva directriz crea otra investigación con `investigacion_padre_id` y nueva identidad.

## 2. Transición durable → webhook → llamada

1. El backend valida completitud y publica los IDs/versiones/hash del reporte. Transacción: cambia `investigaciones.estado` a `investigacion_completa`, fija `completada_at` e inserta evento outbox `investigacion.completa` y notificación in-app.
2. Trigger compara estado anterior/nuevo y no actúa si ya estaba completo. Unicidad `(investigacion_id,tipo_evento)` evita duplicados. Ninguna llamada HTTP se hace dentro de esa transacción.
3. Un Database Webhook sobre INSERT de `eventos_salida`, autenticado con secreto de backend, notifica a `POST /webhook/forense/investigacion-completa` en n8n. El workflow vuelve a leer evento/estado desde DB; no confía en un teléfono enviado en el payload. Un reconciliador interno reenvía eventos pendientes si el webhook se pierde.
4. Reclamar evento atómicamente con lease. Comprobar destinatario: perfil propietario, teléfono E.164, preferencia de llamadas vigente y permiso de aviso guardado. Sin teléfono/preferencia: `omitida` con motivo, manteniendo aviso dentro de la app.
5. Crear intento de llamada ligado al evento, congelar destinatario/configuración y reclamar `solicitando` antes del POST. Una llamada por investigación; nunca una por cada cluster o por cada entrega duplicada del webhook.
6. Invocar ElevenLabs, guardar `conversation_id` y `callSid` retornados cuando existan. HTTP exitoso significa solicitud aceptada, no que alguien contestó ni escuchó el aviso.
7. Callback verificado actualiza resultado, guarda actividad y actualiza UI. Fallo de voz no revierte el estado de la investigación ni borra su reporte.

Los estados locales de llamada son `pendiente`, `solicitando`, `aceptada`, `en_curso`, `finalizada`, `fallida`, `sin_respuesta`, `omitida`, `resultado_desconocido`. Mapear solo hechos realmente recibidos: si no hay callback de timbrado, no mostrar “Sonando”. `aviso_entregado` es dato aparte y solo verdadero cuando el análisis/confirmación de llamada lo respalda.

No asumir idempotencia del proveedor. Si el POST tiene timeout después de enviarse, marcar `resultado_desconocido` y reconciliar antes de repetir; no redial automático ciego. Backoff de entrega de outbox no equivale a repetir una llamada aceptada. Reintento manual de llamada es explícito, limitado y auditado.

## 3. API de ElevenLabs y telefonía

Ruta prevista: número Twilio importado/conectado a ElevenLabs, agente configurado y número destino del perfil. Validar credenciales, saldo, restricciones del número/cuenta y destino en H0–1. TTS aislado no hace llamadas telefónicas. Fuente: [API de llamadas salientes](https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/outbound-call).

Request desde n8n/backend, nunca desde navegador:

```http
POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
xi-api-key: <secreto servidor>
Content-Type: application/json
```

```json
{
  "agent_id": "<ELEVENLABS_AGENT_ID>",
  "agent_phone_number_id": "<ELEVENLABS_AGENT_PHONE_NUMBER_ID>",
  "to_number": "<perfil.telefono_e164>",
  "conversation_initiation_client_data": {
    "dynamic_variables": {
      "nombre_usuario": "<nombre de saludo>",
      "referencia_corta": "<ID legible sin datos fiscales>",
      "ruta_reporte": "Historial de investigaciones",
      "completion_event_id": "<uuid>"
    }
  }
}
```

No enviar RFC, montos, sospechas, facturas, dataset ni reporte completo al agente telefónico. Pasar variables normalizadas con límites de longitud. El teléfono se obtiene del perfil del propietario autenticado; jamás de texto libre del prompt o argumentos del LLM.

Respuesta de aceptación: comprobar `success`; persistir IDs de proveedor. Callback `POST /webhook/forense/elevenlabs-resultado`, verificando HMAC con cuerpo crudo y ventana temporal. Deduplicar por evento/identidad del proveedor y correlacionar por conversation/call ID; conservar callbacks que lleguen antes de guardar el POST para conciliación posterior. [Webhooks post-llamada y autenticación](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks).

## 4. Agente: Notificador Forense

Configuración mínima: idioma español de México, voz estándar clara elegida en la cuenta, respuestas breves y duración objetivo 20–40 segundos; límite máximo propuesto 60 segundos. Sin base documental, sin herramientas de investigación y sin capacidad de marcar nuevos números. Herramienta de sistema para terminar llamada. Variables dinámicas según el contrato anterior; [documentación de personalización](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables).

**Primer mensaje:**

> Hola, {{nombre_usuario}}. Soy el asistente de voz de Forense. Tu investigación {{referencia_corta}} terminó y el reporte ya está disponible en el historial de la aplicación.

**Prompt del agente:**

```text
Tu única tarea es avisar que el reporte solicitado ya está disponible.
Habla en español de México, con tono amable, breve y neutral.
Identifícate como asistente de voz de Forense. No afirmes ser una autoridad.
Usa solo nombre_usuario, referencia_corta y ruta_reporte proporcionados.
Indica que puede abrir Forense, entrar a Historial y seleccionar su investigación.
Si pregunta por resultados, explica que los detalles están en el reporte;
no conoces ni inventas conclusiones, montos, niveles o datos de contribuyentes.
Si pide repetir, repite una vez. Si es un número equivocado, discúlpate y termina.
Si no desea más avisos, confirma la preferencia y termina; se registrará para
desactivar llamadas en su perfil. No solicites contraseñas ni datos personales.
Si agradece o confirma, despídete y termina. No prometas SMS ni otras acciones.
Si detectas buzón, deja solo: "Tu reporte de Forense ya está disponible en la app".
```

Evaluación post-llamada: campos propuestos `aviso_entregado`, `solicita_no_llamar`, `numero_equivocado`; son resultados del análisis, no eventos garantizados del proveedor. Registrar evidencia del resultado y tratar ausencia como desconocido. Una petición de no llamar actualiza la preferencia del perfil mediante backend después de verificar/correlacionar el callback, manteniendo auditoría.

## 5. Datos y migraciones aditivas

Conservar 001–005 y fixture temprano. Añadir **006_producto_ui.sql** y **007_notificaciones_voz.sql** después de 005. No renombrar migraciones anteriores; el antiguo seed 006 ya estaba separado en `db/seeds/seed_fake.sql`.

En 006:

- `perfiles`: id, nombre, organización, correo, teléfono E.164 privado, timezone, preferencias, `llamadas_activadas`, aceptación/fecha de permiso, timestamps. Perfil demo compartido explicitado; no fingir identidad individual fuerte.
- `investigaciones`: id, perfil_id, modo, corrida_id/caso_id, investigacion_padre_id, manifiesto de objetivos, estado, mensaje, directriz_id/version, contexto resuelto/hash, timestamps, idempotency_key, `reporte_manifest` y versión entregada.
- `vistas_guardadas`: perfil_id, nombre, ruta, filtros JSON, visualización, versión de esquema.
- `propuestas_edicion`: id, caso_id, perfil_id, version_base, selección/hash, mensaje/directriz, patch/diff, citas, estado propuesta/aplicada/descartada/conflicto, request_id.
- Extender `expedientes` con contenido JSON TipTap y `estado_revision=borrador|validado`; Markdown se mantiene. Ediciones conservan versión base y propuestas aplicadas. El cierre original solo acepta versiones validadas.
- `actividad_producto`: perfil/investigación/caso/request_id, evento, timestamp, IDs y metadata sin secretos; registra directrices, ediciones, aplicaciones, descargas y cambios de preferencias. Los hechos forenses siguen en `bitacora`; la UI combina trazas enlazadas.

En 007:

- `eventos_salida`: id, investigacion_id, tipo, estado, intentos, lease, próximo intento, error; unique(investigacion_id,tipo).
- `notificaciones`: id, perfil_id, event_id, tipo, recurso, título, leida_at, creado; unique(perfil_id,event_id,tipo).
- `llamadas_notificacion`: id, event_id, intento, estado, destino privado, perfil_id, agent_id, conversation_id, call_sid, provider_payload mínimo, aviso_entregado nullable, timestamps/error; unique(event_id,intento), solo un intento activo por evento.
- Función transaccional de finalización/trigger de outbox y lectura privada mediante BFF. Investigación/notificaciones/llamada se actualizan por polling autorizado con destino enmascarado; outbox, teléfono y secretos no se exponen públicamente. No extender las policies públicas de la demo a estas tablas.

Guardar eventos de actividad `investigacion_solicitada`, `directriz_aplicada`, `investigacion_completa`, `reporte_propuesto`, `propuesta_aplicada`, `reporte_exportado`, `llamada_solicitada`, `llamada_resultado` con IDs correlacionables. Eventos forenses previos conservan su catálogo. Fixture de producto separado `db/seeds/seed_producto.sql`, después de 006/007, sin números reales ni envíos externos.

## 6. Endpoints y responsabilidad

Next.js BFF: login/logout de demo, perfil, vistas guardadas, investigación, propuestas/aplicar/descartar, exportación, notificaciones/leídas y prueba de llamada. Valida sesión/scope y llama backend con secretos; el navegador no escribe directo con service_role. Lecturas públicas existentes de datos sintéticos se conservan; datos personales van por BFF o RLS de propietario.

Para este login simbólico, la cookie no es un JWT de Supabase: elegir BFF con polling privado acotado para notificaciones/llamadas, no un canal anon sobre tablas privadas. Añadir CSRF/origen, rate limit, cookies Secure en producción y control server-side del destinatario. RLS por usuario sería una evolución con identidad real, no una capacidad implícita del password compartido. No introducir datos fiscales reales en este workspace demo.

El mecanismo de INSERT de outbox se apoya en [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks); el reconciliador sigue siendo necesario para recuperar eventos pendientes. Habilitarlo solo después de 007, con secreto servidor y validación del evento en DB.

n8n agrega dos workflows funcionales: `forense-notificar-completada` y `forense-resultado-llamada`. Se suman a los cuatro existentes y worker técnico; no sustituyen el investigador. El reconciliador de outbox puede ser otra entrada del workflow notificador. Toda prueba ficticia se etiqueta “Simulada”; un callback real informa del resultado, pero solo evidencia de entrega permite marcar `aviso_entregado=true`.

## 7. Pruebas y aceptación

- Cambio único de estado produce un evento y un aviso; cinco entregas repetidas del webhook no generan cinco llamadas.
- Corrida con varios casos emite un aviso al terminar todo; caso manual emite el suyo; edición y recarga de página no emiten avisos nuevos.
- Perfil sin número/toggle apagado: notificación in-app y llamada omitida. Cambio de preferencia antes del envío se respeta.
- POST aceptado, error explícito, timeout ambiguo, callback duplicado/tardío y fallo de voz no alteran estado forense.
- HMAC inválido rechazado; un usuario no puede inyectar otro teléfono en el prompt ni cambiar event_id para llamar por otra investigación.
- Chat pregunta no crea versión; propuesta no cambia documento; aplicar crea una versión; doble click aplica una vez; conflicto conserva trabajo.
- Una prueba real al número guardado, iniciada explícitamente durante implementación, debe confirmar saludo, cierre y registro. Esta fase de planeación no registra agentes ni marca teléfonos.
