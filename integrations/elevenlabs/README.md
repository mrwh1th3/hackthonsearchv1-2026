# integrations/elevenlabs

Dueño: **forense-voice**. Adaptador de aviso telefónico ElevenLabs: payload, verificación HMAC de cuerpo crudo, dedupe, máquina de estados y mapeo de callback. ESM puro, cero dependencias externas, cero red, cero llamadas reales. Implementa la lógica descrita en `16-notificaciones-elevenlabs.md`.

**Estado real (H5):** la cuenta ElevenLabs tiene cero números salientes; nadie ha llamado a nadie desde este repo. `n8n/runtime/voz-adaptador.mjs` (dueño: forense-runtime) es un STUB que hoy rechaza todo callback a propósito — este paquete es la implementación real que puede sustituirlo cuando el runtime conecte los workflows `FORENSE_notificar_completada` / `FORENSE_resultado_llamada`.

## Relación con `n8n/runtime/voz-adaptador.mjs` (léase antes de conectar)

`voz-adaptador.mjs` fija el vocabulario que este paquete respeta al pie de la letra:

| Export del stub | Aquí | Igual / distinto |
|---|---|---|
| `ESTADOS_LLAMADA` | `estados.mjs` | Idéntico (mismos 9 valores, mismo orden) |
| `ErrorVoz` | `estados.mjs` | Idéntica clase (`codigo`, `mensaje`) |
| `ENDPOINT_LLAMADA` | `payload.mjs` | Idéntico valor |
| `RUTA_CALLBACK`, `TOLERANCIA_FIRMA_S` | `hmac.mjs` | Idéntico valor (300 s) |
| `VARIABLES_PERMITIDAS` | `payload.mjs` | Idéntico valor (las mismas 4 claves) |
| `estadoDesdeCallback(evento)` | `callback.mjs` | Misma firma y forma `{estado, aviso_entregado}`. **Diferencia deliberada:** `aviso_entregado` ausente es `null` (desconocido), no `false` — el stub usaba `false` implícito; `product.llamada.aviso_entregado` en contracts es `boolean\|null`, y 16 línea 88 exige tratar la ausencia de evidencia como desconocida, nunca como negada. |
| `verificarFirma(...)` | `hmac.mjs` | El stub usa forma objeto `{crudo, firma, ahora_ms, tolerancia_s}` y siempre devuelve `valido:false` (placeholder). Aquí la firma canónica es **posicional** `(rawBody, headers, secreto, ahora, opciones?)` con una implementación real; la forma objeto del stub también funciona (ver tests) para que un import literal no rompa, pero el runtime debe migrar a la forma posicional al conectar de verdad. |
| `construirLlamada(...)` | `payload.mjs` → `construirPayload(evento, perfil, config)` | No es la misma firma a propósito: el stub recibe primitivos ya resueltos (`to_number`, `variables`); `construirPayload` resuelve esos primitivos DESDE `perfil`/`evento`/`config`, que es lo que el runtime realmente tiene disponible tras leer DB. Es la función que el workflow debe llamar. |

Import recomendado para el runtime: `import { ... } from '../../integrations/elevenlabs/index.mjs'` (re-exporta todo lo de la tabla).

## API

### `construirPayload(evento, perfil, config)` — `payload.mjs`

- `evento`: forma `product.evento_completa` (contracts). Solo se leen `event_id` e `investigacion_id`; **cualquier otro campo del evento se ignora, incluido un `telefono` inyectado** — el número sale únicamente de `perfil.telefono_e164` (16 línea 59, línea 128).
- `perfil`: forma `product.perfil` (contracts): `telefono_e164`, `llamadas_activadas`, `consentimiento_at`, `nombre`.
- `config`: `{ agent_id, agent_phone_number_id, ruta_reporte? }`.

Devuelve, en orden de validación determinista (teléfono → preferencia → consentimiento → formato de teléfono → configuración):

```js
// enviable
{ omitida: false, motivo: null, cuerpo: { agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data: { dynamic_variables } }, llamada: {/* product.llamada */} }
// omitida
{ omitida: true, motivo: 'sin_telefono'|'llamadas_desactivadas'|'sin_consentimiento'|'telefono_invalido'|'configuracion_incompleta', cuerpo: null, llamada: {/* product.llamada, estado:'omitida' */} }
```

`llamada` valida contra `contracts` `product.llamada` en ambos casos (`validateContract('product.llamada', resultado.llamada).ok === true`) y es la fila que el backend inserta en `forense.llamadas_notificacion`. Lanza `ErrorVoz` (no devuelve `{omitida}`) si una variable dinámica contiene forma de RFC o de monto: eso es un bug de datos aguas arriba, no un motivo de omisión normal.

### `verificarFirma(rawBody, headers, secreto, ahora, opciones?)` — `hmac.mjs`

HMAC-SHA256 sobre el **cuerpo crudo** (nunca el objeto reserializado). Devuelve `{valido, motivo}`; motivos: `cuerpo_no_crudo`, `secreto_no_configurado`, `sin_firma`, `firma_malformada`, `fuera_de_ventana`, `firma_invalida`.

**Supuesto explícito (sin cuenta real verificada):** esquema de firma tipo Svix/Stripe, header `elevenlabs-signature: t=<epoch_s>,v0=<hex hmac-sha256 de "<t>.<crudo>">`. Es el único convenio con evidencia en el repo (el propio stub ya espera `t=`). Parametrizado vía `opciones = {header, prefijoTimestamp, prefijoFirma, separador, construirMensaje, ventanaS}` para que confirmar el formato real de ElevenLabs sea un cambio de configuración, no una reescritura. **Acción pendiente del integrador:** confirmar el header/formato real contra la documentación de la cuenta cuando exista número, y ajustar `OPCIONES_POR_DEFECTO`.

### Dedupe — `dedupe.mjs`

Puro, en memoria (`crearAlmacenDedupe()`). **No sustituye** la barrera durable real: `eventos_salida` unique(investigacion_id,tipo) y `llamadas_notificacion` unique(event_id,intento) de la migración 007. Sirve para que el runtime tenga una decisión testeada antes de depender solo de que un INSERT choque.

- `reservarSolicitud(almacen, {event_id})` → `{reservado, motivo}`. Cinco entregas del mismo webhook de outbox reservan una sola vez.
- `liberarParaReintentoManual(almacen, {event_id})` → libera la reserva; llamar SOLO desde el flujo de reintento manual auditado (16 línea 29), nunca automáticamente.
- `registrarCallback(almacen, {event_id, conversation_id, call_sid})` → `{nuevo, motivo, clave}`. Correlaciona por `conversation_id` o `call_sid`; si el proveedor no manda ninguno, cae a `event_id`.

### Máquina de estados — `estados.mjs`

`ESTADOS_LLAMADA` = `pendiente, solicitando, aceptada, en_curso, finalizada, fallida, sin_respuesta, omitida, resultado_desconocido`. `ESTADOS_TERMINALES` = todos menos `pendiente/solicitando/aceptada/en_curso`.

- `transicionarEstado(estadoActual, señal)` → `{estado, cambio, motivo}`. `señal` es el nombre del estado destino (o `'timeout'`, válvula universal a `resultado_desconocido` desde cualquier estado no terminal). **Nunca lanza** por una transición inválida/duplicada/tardía: un estado terminal es absorbente (`cambio:false, motivo:'estado_terminal'`); no hay redial automático.
- `marcarTimeout(estadoActual)` → atajo de `transicionarEstado(estadoActual, 'timeout')`, para cuando el POST saliente expira sin callback.
- `reintentoManual(llamadaActual)` → fila del **siguiente intento** (nunca reescribe la anterior), solo desde `fallida/sin_respuesta/resultado_desconocido` y hasta `intento < 3` (límite de `product.llamada`). Lanza `ErrorVoz` fuera de esas condiciones — el reintento es explícito y auditado, no un efecto de este módulo por sí solo.

### Callback — `callback.mjs`

- `resultadoDesdeCallback(cuerpoYaParseado)` → `{estado, aviso_entregado, solicita_no_llamar, numero_equivocado, conversation_id, call_sid}`. Mapea `type`/`status` del proveedor a `ESTADOS_LLAMADA`; un tipo no reconocido es `resultado_desconocido`, nunca se inventa un estado intermedio sin evidencia (16 línea 27). Los tres campos de evaluación son `null` (desconocido) salvo que `analysis.<campo>` sea explícitamente `true`/`false`; `aviso_entregado:true` además exige `estado === 'finalizada'`.
- `estadoDesdeCallback(evento)` → alias reducido `{estado, aviso_entregado}`, ver tabla de compatibilidad arriba.
- `procesarCallback({rawBody, headers, secreto, ahora, opcionesFirma, estadoActual, almacenDedupe})` → pipeline completo (firma → JSON → dedupe → transición). Nunca lanza; siempre `{aceptado, motivo?}` para que el workflow decida el código HTTP.

## Columnas que este paquete espera de `forense.llamadas_notificacion` (007)

Según `16-notificaciones-elevenlabs.md` §5 línea 107, con el mapeo a lo que produce este paquete:

| Columna | Origen aquí |
|---|---|
| `event_id` | `evento.event_id` (contracts `product.evento_completa`) |
| `intento` | `construirPayload` fija `1`; `reintentoManual` produce `intento+1` (máx. 3) |
| `estado` | `ESTADOS_LLAMADA`; transiciones vía `transicionarEstado`/`procesarCallback` |
| `destino_enmascarado` | `enmascararTelefono(perfil.telefono_e164)`, patrón `^\*{4,}[0-9]{0,4}$` (contracts `product.llamada`) — la columna real guarda el destino privado completo; lo enmascarado es lo que sale por BFF |
| `perfil_id` | `evento.perfil_id`, no lo produce este paquete (el backend lo copia del evento) |
| `agent_id` | `config.agent_id` usado en `construirPayload` |
| `conversation_id` | de la respuesta del POST a ElevenLabs (fuera de este paquete) o del callback (`resultadoDesdeCallback().conversation_id`) |
| `call_sid` | idem, `resultadoDesdeCallback().call_sid` — **no existe en el DTO `product.llamada`** (`additionalProperties:false`); es solo de la tabla, no lo pongan en el objeto que se valida contra el contrato |
| `provider_payload` | cuerpo de la respuesta/callback del proveedor; este paquete no lo trunca ni lo elige, eso es responsabilidad del backend |
| `aviso_entregado` | `resultadoDesdeCallback().aviso_entregado` (`boolean\|null`) |
| `error` | técnico (`fallo_transitorio`, etc. — enum de `contracts` `common.error`), no lo produce este paquete salvo que se capture un `ErrorVoz` |

## Trazabilidad (regla 2 de CLAUDE.md)

Este paquete no escribe en `forense.bitacora` ni en ninguna tabla: es una librería pura. El **caller** (runtime/BFF) debe registrar, con `event_id`/`investigacion_id` correlacionables:

- `llamada_solicitada` cuando `reservarSolicitud` reserva y `construirPayload` no devuelve `omitida`.
- `llamada_resultado` en cada `procesarCallback` aceptado no duplicado (incluye omitida, fallida, sin_respuesta, resultado_desconocido — todo resultado dificulta, no solo el éxito).

Sin ese evento persistido, el paso "no existió" según la regla 2.

## Configuración del agente

`agente-notificador-forense.json` documenta la configuración deseada del agente "Notificador Forense" (16 §4): idioma es-MX, sin base documental, sin herramientas de investigación, sin marcar nuevos números, solo `end_call` como herramienta de sistema, primer mensaje y prompt literales de 16, duración objetivo 20–40 s / máxima 60 s. **No es un payload probado contra la API real** (cero cuenta verificada, ver `_meta` dentro del JSON) — es la especificación para crearlo a mano o por API cuando exista número.

## Ejecutar los tests

```sh
npm ci --prefix contracts --ignore-scripts   # una vez, para poder validar contra contracts
node --test "tests/voice/*.test.mjs"
```

48 tests, cero red, cero credenciales. Los tests importan `validateContract` de `contracts/index.mjs` en modo lectura (no se toca `contracts/`).

## Pendiente para el integrador (no bloquea esta entrega)

1. Confirmar el formato real de la firma del webhook de ElevenLabs contra la cuenta cuando exista número, y ajustar `OPCIONES_POR_DEFECTO` en `hmac.mjs` (hoy es un supuesto documentado, no una verificación).
2. Decidir si el runtime importa `verificarFirma` en su forma posicional (recomendado) o sigue usando la forma objeto de compatibilidad.
3. El backend, no este paquete, es responsable de: enmascarar `destino_enmascarado` antes de exponerlo por BFF, elegir qué guardar en `provider_payload`, y emitir `llamada_solicitada`/`llamada_resultado` en `actividad_producto`/`bitacora`.
