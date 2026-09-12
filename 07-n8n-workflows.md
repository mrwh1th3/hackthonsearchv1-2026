# 07 — Workflows de n8n

Proyecto "Forense" en el n8n autohospedado del VPS. Se conservan **cuatro workflows funcionales forenses**: corrida, investigación, reintento y editor. Se añade **un worker técnico reutilizable** para ejecutar tareas asíncronas de los cinco especialistas; no cinco implementaciones duplicadas. Un Error Trigger puede vivir en el propio workflow como entrada separada, o centralizarse en un archivo técnico adicional si la instancia lo requiere. Exportar todos a `n8n/workflows/*.json` después de cada cambio.

**Implementación vigente:** 17 convierte esta secuencia en pasos/checkpoints persistidos; para API se usa HTTP Messages explícito, no nodo AI Agent opaco. 20 evalúa la alternativa existente Claude Code/Actions antes de escoger proveedor. No implementar dos loops a la vez. Los pasos siguientes describen lógica, no una única ejecución n8n esperando minutos.

La ampliación de producto suma `forense-notificar-completada` y `forense-resultado-llamada` (§16): **seis workflows funcionales**, más worker y manejo técnico de errores. Su activación requiere migraciones 006/007. Se conservan los cuatro originales.

**Orden:** `001_schema → 002_views (incluye utilidades/log/presupuesto) → fixture db/seeds/seed_fake.sql → 003_pistas → 004_clusters → 005_rpc`. El fixture habilita pruebas de SQL tempranas; la activación completa requiere las cinco migraciones, pruebas RPC y prompts versionados. Cronograma: `12-plan-36h.md`. Importar primero worker/editor/reintento y resolver sus IDs antes de conectar investigación y corrida. El reintento retorna al padre; no invoca recursivamente investigación.

## Configuración y verificación de la instancia

- Registrar versión exacta de n8n y `typeVersion` de nodos exportados. Hacer un smoke de herramienta, JSON válido, error, dos workers simultáneos y barrera antes de construir todo.
- Modelo efectivo por rol se resuelve y fija tras preflight de cuenta/proveedor; no asumir disponibilidad de `claude-sonnet-4-6`. API y OAuth de Claude Code son perfiles distintos (20).
- Temperatura 0 cuando la versión/modelo lo soporte: reduce variación, no garantiza reproducibilidad. Guardar modelo, prompts/reglas, snapshot y parámetros.
- Registrar usage y IDs realmente expuestos por el proveedor; ausente es null. Perfil API guarda cada request y par tool_use/tool_result explícitamente; perfil CLI documenta sus límites de observabilidad. No extraer ni mostrar razonamiento privado.
- Cada RPC registra su llamada/resultado una vez. El runner registra resúmenes de acciones, requests LLM y errores sin duplicar esos eventos. La UI muestra acciones/evidencia y explicación breve.
- JSON Schema por rol + validación backend de tipos/enums/IDs/soporte. Parse inválido permite una reparación acotada dentro del presupuesto y luego falla con motivo visible; no depende de un parser LLM oculto de n8n.
- `Max Iterations` limita ejecuciones del modelo, **no sustituye** al contador atómico de herramientas. La fuente única es `03-arquitectura-agentica.md`: D/F/R 8/4, T 6/3, E 4/2; Auditor 12, Defensor 15 herramientas. Caso: 120 herramientas/100 requests LLM, incluidos reintentos y con reserva de cierre.
- Réplica, Redactor y Editor usan el adapter sin tools; no crear nodos AI Agent vacíos ni otro runtime separado.

Fuentes primarias consultadas el 11-09-2026: [orden de ramas](https://docs.n8n.io/build/flow-logic/understand-execution-order), [sub-workflows](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow), [AI Agent](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent), [iteraciones/pasos/streaming](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent), [Error Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger). Validar en la versión instalada; la documentación no garantiza tokens en los pasos ni un bug universal de streaming.

## Concurrencia, estados e idempotencia

Las ramas de un mismo workflow se ejecutan por turno con orden v1 de n8n. `Loop Over Items(batchSize=4)` agrupa items, pero no demuestra que cuatro investigaciones ni cinco agentes corran simultáneamente.

El patrón es **despachar sub-workflows sin esperar su finalización**, guardar IDs de tareas y esperar sus estados terminales en Postgres. Worker genérico con input `{tarea_id}`. Máximo inicial: 4 clusters activos/8 tareas LLM globales; un claim atómico mantiene el límite también para sub-workflows. Medir solapamiento real con `iniciado/terminado`.

`forense.tareas_agente` guarda `caso_id,cluster_id,agente,ronda,intento,version_contexto`, estado, `idempotency_key`, lease y ejecución n8n. La barrera espera **el conjunto despachado** hasta que todas estén `completada|error|timeout|omitida`. Familia no evaluable: `omitida` con `resultado.motivo_omision='no_evaluable'`. Error/timeout son limitaciones, no ausencia de fraude. Toda barrera tiene deadline.

Auditor y Defensor también crean tareas antes de usar RPC, aunque sus nodos vivan en el workflow de investigación: necesitan `p_tarea` válido y consumen la misma cuota global. Réplica y Redactor contabilizan requests/tiempo bajo el caso y reclaman slot global; no quedan fuera del límite por usar nodos distintos. Las operaciones del editor llevan ID propio y presupuesto separado, con unicidad por operación para admitir varias ediciones del mismo caso.

Reclamar cluster mediante operación atómica con `lease_owner/lease_expires_at` **antes** de crear caso; renovar mientras trabaja y liberar al cerrar. El reconciliador de la corrida recupera leases vencidos/tareas huérfanas. No mantener `pg_advisory_lock` entre nodos: es de sesión y no se garantiza que usen la misma conexión. [PostgreSQL: advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

Cada transición de `casos.estado` se **persiste en DB** junto a su evento: Set por sí solo no actualiza Realtime. Misma clave de idempotencia devuelve la corrida/caso/tarea existente. Los callbacks tardíos comprueban lease, intento y versión de contexto antes de escribir. Resultados y eventos usan transacciones cortas.

## 1. `forense-correr-pipeline`

Los endpoints de corrida e investigación reciben del BFF `investigacion_id` y referencia al contexto/directriz versionados en DB (15/16). Los despachos de clusters heredan ese ID: no crean solicitudes de producto nuevas ni avisos por subcaso. Las entradas técnicas de evaluación pueden omitirlo y no generan llamadas. Resolver permisos/contexto desde DB, no aceptar instrucciones de sistema ni destinatarios telefónicos del payload.

Webhook autenticado `POST /webhook/forense/corrida`. Body: `{corrida_id?,corrida_origen_id?,dataset?,nombre,version_prompts,notas,idempotency_key}`. `dataset` selecciona un origen autorizado, nunca una URL arbitraria.

1. Validar input/idempotencia. Reutilizar corrida `lista`, o crear una `preparando` y **cargar/clonar su snapshot completo**. Una corrida vacía no se investiga. Persistir ID y responder `202` para seguimiento por UI.
2. Verificar conteos, integridad, `dataset_hash`, `fecha_corte` y `familias_evaluables`; marcar `lista`. Importación fallida: `error` con causa.
3. Ejecutar `forense.correr_pistas(corrida_id)` con la corrida todavía `lista`: esa función hace el claim atómico a `procesando`. Luego ejecutar `forense.armar_clusters(corrida_id)`. No anticipar el cambio de estado desde n8n.
4. Leer clusters por score; despachar hasta 4 investigaciones asíncronas y reponer slots al terminar. Input `{cluster_id,corrida_id,idempotency_key}`. Conservar la cola restante si termina el tiempo disponible.
5. Esperar todos los clusters admitidos; reconciliar errores/timeouts y leases. No cerrar corrida al terminar de **despachar**.
6. Ejecutar `SELECT forense.v_metricas_corrida(corrida_id)`: pese al prefijo histórico, el contrato de `05/10` es una función `RETURNS jsonb` con parámetro `p_corrida uuid`. Guardar `fin`, métricas y `completada` con conteos completados/en cola/error y cobertura; usar `error` si falla antes de producir resultados utilizables.

Tiempo aún no medido. Benchmark: 1 cluster y después 4 concurrentes; registrar p50/p95, requests/minuto y throttling. Los 12–18 minutos para 12 clusters eran una hipótesis, no un resultado.

## 2. `forense-investigar-cluster`

Entradas: Execute Sub-workflow Trigger y webhook autenticado `POST /webhook/forense/investigar`. Modo manual: `{corrida_id,origen,valor,idempotency_key}`. Primero resuelve/arma cluster en el snapshot existente y **después** lo reclama.

### Preparación y ronda 1

1. Verificar corrida lista/procesando y pertenencia del cluster; claim con lease. Si ya tiene caso activo, devolver su ID; ocupado queda `en_cola` sin duplicar caso.
2. Crear caso una vez, guardar `n8n_execution_id,intento=0`; emitir `caso_creado`, `cluster_armado`, `pista_cargada`.
3. Cargar contexto resumido/pistas por familia; persistir `ronda1` y `ronda_inicio`.
4. Crear cinco tareas `(caso_id,ronda=1,intento=0,agente,version_contexto)`; omitir familias no evaluables. Despachar al worker y esperar barrera persistida; cada especialista sólo ve sus pistas.
5. Emitir `ronda_fin` con resultados/limitaciones. Cero señales también exige resultado explícito y tarea completada.

### Frontera y ronda 2

6. Evaluar frontera y disparos de `03`. Una expansión consume la única cuota del cluster, agrega RFC/aristas, recalcula contexto/pistas afectadas e incrementa `version_contexto`.
7. **No volver a ronda 1.** Unir/desduplicar especialistas despertados por señales y datos nuevos; filtrar familias evaluables. Conjunto vacío pasa a Auditoría.
8. Persistir `ronda2`, `despertar`/`ronda_inicio`; crear tareas sólo para el conjunto, con `ronda=2,intento=0`. Enviar titulares/IDs/objetivo; consultar detalles con `forense_leer_senal` y registrar `senal_leida`.
9. Esperar esas tareas, emitir `ronda_fin` y registrar frontera material pendiente. No usar un Merge que espere cinco ramas cuando se despertaron dos.

### Auditoría, defensa y réplica

10. Persistir `auditando`; cargar señales vigentes del caso y contradicciones. Filtrar por caso/corrida y revisiones, no sólo cluster.
11. Auditor con herramientas de `06`, hasta 12 llamadas; JSON de `08`. Registrar evidencia propuesta/hipótesis y pistas corroboradas por soporte específico; no confirmar todas las pistas del cluster.
12. Validar técnicamente evidencia propuesta: pertenencia, valores y soporte resueltos desde DB. Un ID existente no demuestra la hipótesis.
13. Persistir `defendiendo`; Defensor con hasta 15 herramientas, caso/evidencia/checklist. Insertar argumentos con `evidencia_objetivo_ids`; verificar técnicamente referencias **antes** de Réplica. Emitir `defensa_inicio`/`defensa_argumento`.
14. Persistir `replicando`; cadena LLM sin tools, una pasada sobre evidencia/argumentos verificados. Resolución por `defensa_id`.
15. Aplicar resolución atómicamente en `casos.evaluacion_pistas[pista_id]` y sólo en evidencias objetivo. Nunca cambiar `pistas.estado` global por una defensa de un caso: otros clusters pueden compartir esa pista. Aceptación: `evidencia.refutada=true`; `validada = valida_tecnica AND NOT refutada`. Conservar historial y emitir `replica`.

### Validación, reintentos y dictamen

16. Persistir `validando`; `forense_validar_evidencia` preserva refutaciones. Construir paquete de pistas, evidencia, cobertura/tareas y pendientes comprobables; emitir `validacion`.
17. Auditor Final en código devuelve reintento sólo para objetivo concreto. Una familia aislada sin datos adicionales posibles produce `no_concluyente`.
18. Si hay rechazo reparable, presupuesto y `n_reintentos < 2`, claim atómico: `UPDATE ... SET n_reintentos=n_reintentos+1 ... WHERE n_reintentos<2 RETURNING n_reintentos`. Autoriza **1 y 2**; emitir `rechazo_auditor_final`/`reintento_inicio`.
19. Llamar `forense-reintento`, esperar y reanudar donde indica: Auditoría para nuevas señales; Defensa para trampa pendiente; Réplica tras defensa reparada. No crear caso ni repetir preparación.
20. Si no procede otro intento, guardar nivel permitido por la evidencia y límites: **nunca forzar presunción**. Guardar familias, monto deduplicado y `dictamen` con regla. Calcular además `casos.resultado_por_rfc` sobre evidencia con `rfcs_afectados` de cada RFC; no heredar el nivel principal a satélites. Esos resultados alimentan las métricas por RFC de `10`.

### Redacción, cierre y errores

21. Persistir `redactando`; cargar sólo hechos validados, defensas/resoluciones verificadas, pistas y dictamen. Redactor sin tools recibe límites explícitos; emitir `redaccion_inicio`.
22. Validar citas y coincidencia de nivel/monto; guardar expediente versión 1 (o siguiente si continuación autorizada). Si falla tras reparación acotada, conservar dictamen estructurado y error de expediente. Emitir `redaccion_fin` cuando termine.
23. Guardar terminal `dictaminado|error`, `terminado,duracion_ms`, herramientas/tokens disponibles y liberar lease. Presupuesto agotado conserva parcial con `no_concluyente` si corresponde.

24. Notificar al agregador de `investigaciones` con `investigacion_id`: comprobar objetivos y reportes del manifiesto. Solo el agregador puede transicionar a `investigacion_completa` y emitir el outbox de §16; ningún especialista, redactor o subcaso marca el teléfono por su cuenta.

Error Trigger es entrada de **otra ejecución**, no un catch de la rama normal. Resolver caso/tarea por `execution.id` persistido, registrar causa y cerrar/liberar con comprobación de propietario. Si cae el proceso, leases vencidos y reconciliador evitan bloqueos. Error Trigger no corre en tests manuales de n8n: probar con webhook automático y fallo controlado. Una tarea fallida pasa por la barrera para conservar resultados de las demás.

## Worker técnico `forense-ejecutar-agente`

Input `{tarea_id}`. Claim de tarea/slot global y cargar caso, corrida, agente, ronda, intento y contexto desde DB. **`p_tarea` y `p_caso` fijos**; `p_agente/p_ronda` derivados si la firma los exige. Sólo argumentos permitidos de investigación usan `$fromAI(...)`.

Rutas: Documental (`perfil,facturas,pares`), Financiero (`conciliar,seguir_dinero,facturas`), Relacional (`relacionados,ciclos,facturas`), Temporal (`perfil,facturas,pares`), Externo (`listas,relacionados`); todos escriben señales y en ronda informada pueden leerlas. Son RPC `forense_*` de `06`.

HTTP: `POST https://<proj>.supabase.co/rest/v1/rpc/<nombre>`, headers `apikey` y `Authorization: Bearer <service_role>` desde credencial servidor. Las herramientas de `06` son wrappers `public.forense_*`: usar perfil `public`/predeterminado, **no** `Content-Profile: forense`. El schema `forense` se selecciona únicamente para lecturas directas autorizadas de sus tablas/vistas, según `05`.

Aplicar deadline, presupuestos y herramientas por rol; registrar trazas/uso disponible. Terminar `completada|error|timeout`, liberar slot/lease y guardar resultado compacto. Errores transitorios de API permiten backoff corto y acotado con idempotencia dentro del presupuesto; no duplican señales ni consumen otro intento forense.

## 3. `forense-reintento`

Input `{caso_id,intento,motivo,objetivo}` tras claim del padre. `intento` sólo 1 o 2; no incrementar otra vez.

- `evidencia_insuficiente`: especialistas con comprobación concreta pendiente en familia evaluable, no todos los faltantes por defecto.
- `cadena_incompleta`: Financiero/Relacional con ruta concreta; expandir sólo si queda cuota. Si se consumió, registrar límite.
- `defensa_no_considerada`: volver a Defensor con trampa/evidencias objetivo.
- `evidencia_invalida`: autor correspondiente con IDs/causas de descarte.
- `contradiccion`: autores afectados con ambos hechos y punto exacto de conflicto.

Tareas con `ronda=2` (revisión informada), `intento=1/2` y contexto vigente. Escribir señales nuevas enlazadas a las previas, preservar historia y retornar `{reanudar_en,limitaciones}`. Si cambia evidencia, repetir validaciones/defensas aplicables antes del dictamen.

## 4. `forense-editar-expediente`

Webhook servidor `POST /webhook/forense/editar`: `{caso_id,instruccion,seleccion?,version_base,directriz_id?,modo:pregunta|propuesta,idempotency_key}`. El BFF normaliza el contrato de §15, propietario e IDs; la selección incluye rango, bloques y hash del texto.

1. Cargar versión base, evidencia/argumentos verificados y dictamen; persistir mensaje de usuario.
2. Editor sin tools devuelve `{modo,mensaje,contenido?}`: `fragmento|documento|respuesta`. Opinión/resumen/pregunta no crea versión.
3. Validar que no introduce IDs ajenos, montos distintos ni cambio de nivel. Verificar selección contra `version_base`; si cambió el documento, conflicto conservando el borrador.
4. Si modifica, persistir `propuestas_edicion` con patch/diff/citas y responder `propuesta_id`. Todavía no cambia el expediente. Pregunta solo guarda chat.
5. Aplicar es operación determinista del BFF: verificar propuesta/version_base y autorización; crear versión con JSON TipTap + Markdown derivado, validar y marcar propuesta aplicada en transacción. Doble envío devuelve la misma versión. Descartar registra estado sin crear versión. Nunca `max+1` sin bloqueo/control concurrente.

Revertir envía `accion='revertir',version_objetivo,version_base,idempotency_key` al backend: copiar la versión elegida a una nueva tras comprobar estado actual, sin LLM ni borrado. La edición manual/autoguardado conserva borrador con estado de revisión; solo un reporte validado puede publicarse como entrega. Ninguna edición reactiva una notificación de fin ya emitida.

## Code node: Auditor Final (`n8n/code/auditor-final.js`)

Entrada preparada por backend, nunca JSON de agente sin validar. `pistas` combina catálogo y `casos.evaluacion_pistas` del caso; no usa estados globales de otros casos. `pendientes` contiene motivos/objetivos tipificados con `reparable` boolean; `cobertura_completa` proviene de tareas/errores/frontera/presupuestos. La validación previa comprueba sustento y familia de cada hecho según catálogo; no basta contar etiquetas de agentes. El mismo criterio se aplica por RFC con sus evidencias/limitaciones filtradas.

```js
const x = $input.first().json;
const pistas = x.pistas ?? [];
const ev = (x.evidencia ?? []).filter(e =>
  e.valida_tecnica === true && e.refutada !== true && e.validada === true);
const permitidas = new Set(['D', 'F', 'R', 'T', 'E']);
const familias = new Set(ev.map(e => e.familia).filter(f => permitidas.has(f)));
const pendientes = x.pendientes ?? [];
const prioridades = ['evidencia_invalida', 'contradiccion',
  'defensa_no_considerada', 'cadena_incompleta', 'evidencia_insuficiente'];
const pendiente = prioridades.map(m => pendientes.find(p =>
  p.motivo === m && p.reparable === true && p.objetivo)).find(Boolean);
const puedeReintentar = Number(x.caso.n_reintentos) < 2
  && x.presupuesto.permite_reintento === true;
const rechazo = pendiente && puedeReintentar
  ? { motivo: pendiente.motivo, objetivo: pendiente.objetivo } : null;
const completo = x.cobertura_completa === true && pendientes.length === 0;
const todasRefutadas = pistas.length > 0
  && pistas.every(p => p.estado === 'refutada');
const e1def = ev.some(e => e.pista_codigo === 'E1' && e.familia === 'E'
  && e.hecho_validado?.estatus === 'definitivo'
  && e.hecho_validado?.saltos === 0);
let nivel;
if (!completo) nivel = 'no_concluyente';
else if (todasRefutadas) nivel = 'anomalia_explicada';
else if (ev.length === 0 && pistas.length === 0) nivel = 'sin_hallazgos';
else if (familias.size >= 3 || (familias.size >= 2 && e1def)) nivel = 'presuncion_alta';
else if (familias.size >= 2) nivel = 'presuncion';
else nivel = 'no_concluyente';

// monto_centavos: entero decimal resuelto desde NUMERIC de DB, no del modelo.
// El mismo CFDI citado por varias familias cuenta una vez.
const porFactura = new Map();
for (const e of ev.filter(e => e.tipo === 'cfdi')) {
  const centavos = e.hecho_validado?.monto_centavos;
  if (!/^[0-9]+$/.test(String(centavos ?? ''))) {
    throw new Error(`Monto validado ausente/inválido para ${e.ref_id}`);
  }
  const valor = BigInt(centavos);
  if (porFactura.has(e.ref_id) && porFactura.get(e.ref_id) !== valor) {
    throw new Error(`Monto inconsistente para ${e.ref_id}`);
  }
  porFactura.set(e.ref_id, valor);
}
const monto = [...porFactura.values()].reduce((s, v) => s + v, 0n);
const ordenadas = [...familias].sort();
return [{ json: { rechazo, nivel, familias: ordenadas,
  monto_en_riesgo_centavos: monto.toString(),
  regla: `${ordenadas.length} familia(s) sustentadas: ${ordenadas.join(', ')} → ${nivel}`,
  limitaciones: pendientes.map(p => p.motivo),
} }];
```

`no_concluyente` también es válido. `sin_hallazgos`/`anomalia_explicada` no se reintentan para subir el nivel. El constructor de `pendientes` prueba trampas no examinadas, IDs inválidos, contradicciones y frontera material; sus contratos/fixtures preceden al Code node. Centavos se convierten a `casos.monto_en_riesgo` usando `NUMERIC` en SQL.

## Credenciales

- `Forense Supabase`: credencial servidor con ambos headers y perfil de schema cuando aplique.
- `Forense Postgres`: SQL administrativo/lecturas agregadas; sin locks de sesión entre nodos.
- `Anthropic Forense`: API key con modelo y saldo comprobados en hora 0.

La service-role nunca sale de n8n/backend. El frontend lee con RLS y llama webhooks autenticados/autorizados; esconder la clave no protege por sí solo un webhook que acepte cualquier corrida o caso.
