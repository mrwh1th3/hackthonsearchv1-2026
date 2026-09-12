# 21 — Criterios del juez principal e inyección en vivo

**Fuente:** grabación Plaud del 2026-09-11 20:18 (7 min 13 s), sesión informativa del juez principal de Infosys sobre el reto de fraude. Transcripción leída íntegra por el coordinador en H0; este documento resume lo dicho, contrasta con el diseño 00–20 y fija los cambios. Es normativo: donde discrepe con 00–20, prevalece 21 y se registra la decisión en `reports/handoff/DECISIONES.md`.

## 1. Lo que dijo el juez (paráfrasis fiel, por orden)

1. **Riesgo de proveedor.** Una empresa trata con un proveedor que no es legítimo y, cuando lo descubre, ya está "on the hook". Quieren identificar esas transacciones rápido y poder actuar.
2. **Tendencia, no una transacción rara.** "Dada la lista de transacciones de una empresa, hay que encontrar una *tendencia*. No queremos acusar a nadie por una o dos transacciones raras." Explícito: *no es detección de anomalías*.
3. **Explicar por qué hiciste lo que hiciste.** "Tuviste este cambio, este conjunto de transacciones, esta empresa, seguiste el dinero, y por eso crees que no es legítimo y por eso esa empresa queda marcada." Y la frase clave: **"¿Por qué esa fue marcada como fraude y esta otra no?"** El sistema tiene que mostrar por qué decidió.
4. **Datos.** Datos abiertos que ya publica el gobierno, datasets de Kaggle, o **dataset sintético propio** si entiendes bien el problema. "La mayor parte del tiempo se va en los datos": entenderlos, validar que estén correctos y que dirijan a la IA, no al revés.
5. **Modelos.** Gemini, Anthropic, OpenAI, Hugging Face: cualquiera, "mientras funcione".
6. **El camino, no solo el destino.** Van a evaluar cómo se llegó del enunciado a la solución: decisiones bajo ambigüedad, ruta documentada.
7. **Prueba de inyección en vivo.** "Si tu sistema está corriendo y le *inyectamos* algo, ¿qué pasa? Inyectamos datos sintéticos (fraudulentos). ¿Cómo reacciona el sistema? ¿Y cómo se explica?" Es criterio primario de puntuación.
8. **Auditoría regulatoria.** El gobierno audita el sistema antes de que salga; "no puede decir *encontré la respuesta*: ¿cuál fue el camino?".
9. **Mentalidad de fundador.** Presentar como quien pide inversión: conocer capacidades y límites, ser creativo, ir más allá del baseline, divertirse.

## 2. Contraste con el diseño y cambios obligatorios

| Punto del juez | Ya cubierto por 00–20 | Cambio que se añade |
|---|---|---|
| Tendencia sobre el tiempo | Ventanas de 12 m, pares por giro, T1/T2, regla de dos familias | **Sección "Trayectoria" obligatoria** en el expediente (serie mensual del RFC/cluster con eventos marcados: alta, primer CFDI, pico, silencio, publicación 69-B) y `ChartPanel` de trayectoria en `/casos/[id]` y `/entidades/[rfc]`. El Redactor la redacta a partir de una serie calculada por SQL (`forense.v_trayectoria_rfc`), nunca la inventa. |
| "Por qué esta sí y aquella no" | Defensor, Réplica, dictamen determinista, `anomalia_explicada` | **Panel "Contraste"** en cada caso dictaminado: el RFC comparable más cercano (mismo giro, pistas solapadas) con resultado distinto y la razón tipificada (defensa aceptada, familia faltante, cobertura). Vista SQL `forense.v_contraste_caso`; sin LLM. Prioridad H18–26. |
| Explicación como expediente de fiscalía | Citas por ID, bitácora, validador | Se conserva. Añadir al expediente la cadena explícita **"cambio → transacciones → empresa → dinero → conclusión"** como sección fija (ver §4). |
| Datos: abiertos, Kaggle, sintético | 69-B real, IBM AML, generador con trampas | Se conserva. El generador es el dataset principal; IBM demuestra portabilidad. Documentar en el pitch que el dataset con ground truth **es parte de la solución**. |
| El camino documentado | ESTADO.md previsto | **`reports/handoff/DECISIONES.md`**: bitácora de decisiones con fecha, evidencia y alternativa descartada, desde H0. Ruta `/metodo` en la webapp que renderiza ese registro y el mapa de gates (estática, sin backend). |
| Inyección en vivo | Corridas aisladas (regla 10), ingesta 19 | **Flujo de inyección** de §3: nuevo, crítico, gate propio. |
| Mentalidad de fundador | 13-demo | Addendum al guion: abrir con capacidades y límites medidos; cerrar con costo por caso y qué falta para producción. |

## 3. Inyección en vivo: contrato

**Principio:** una inyección **nunca muta un snapshot existente**. Crea una corrida nueva (`corrida_origen_id = base`) que clona el snapshot base y añade las filas inyectadas; recalcula pistas y clusters; despacha **primero** los clusters que contienen RFC inyectados; los demás quedan `en_cola`. Así se respeta la regla 10 y el juez ve la reacción en segundos/minutos sin perder la corrida de referencia.

### 3.1 Entrada

- UI `/datos` → modo **"Inyectar datos en vivo"**: pegar filas (CSV/JSON) o subir archivos pequeños por tabla canónica: `contribuyentes`, `cuentas`, `cfdi`, `complementos_pago`, `movimientos`, `atributos_entidad`, `listas_sat`. Se aceptan también columnas en inglés del formato de inyección del juez si el mapper 19 las resuelve; ambigüedad → confirmación, nunca adivinar.
- BFF `POST /api/inyecciones` → valida sesión → n8n `POST /webhook/forense/inyectar` `{corrida_base_id, ingesta_id, idempotency_key, prioridad:'inyectados'}`.
- Validación determinista (19): claves, FK contra el snapshot base **más** las filas nuevas, moneda, fechas ≤ `fecha_corte` de la base (si una fila supera la fecha de corte, la corrida nueva adopta la fecha máxima inyectada y lo declara), duplicados contra la base (mismo UUID = rechazo con motivo), sin etiquetas.
- Los RFC nuevos sin fila en `contribuyentes` se crean como **entidad técnica incompleta** (`giro` NULL) y se declara cobertura parcial; no se inventan atributos.

### 3.2 Persistencia (migración aditiva `008_ingesta.sql`)

`forense.inyecciones`: `id uuid`, `ingesta_id`, `corrida_base_id`, `corrida_nueva_id`, `perfil_id`, `origen ('ui'|'api'|'ensayo')`, `hash_payload`, `filas_por_tabla jsonb`, `rfcs_afectados text[]`, `estado ('recibida'|'validada'|'rechazada'|'snapshot_creado'|'pistas_recalculadas'|'investigando'|'completada'|'error')`, `diagnostico jsonb`, `creado`, `terminado`. RPC de sistema `forense.clonar_corrida_con_inyeccion(p_base uuid, p_ingesta uuid) returns uuid`: transacción única, copia tablas de dominio + `ground_truth` (sin etiquetas para las filas nuevas salvo que el ensayo las declare en `eval/`), inserta filas nuevas, calcula `dataset_hash` nuevo y deja la corrida `lista`. Cada evento se escribe en `bitacora` con `corrida_id` de la corrida nueva y `tipo_evento='inyeccion'` (se añade al enum de 05).

### 3.3 Reacción visible

- Ruta `/inyecciones/[id]`: timeline **recibida → validada → snapshot N+1 → pistas recalculadas → clusters afectados → investigación → dictamen**, con timestamps reales; nada se anima sin evento persistido.
- **Diff antes/después**: para cada RFC afectado, pistas nuevas frente a la corrida base, nivel anterior (si existía caso) y nivel nuevo, familias, y enlace al caso. Esta pantalla responde literalmente a "¿qué pasó y cómo se explica?".
- El expediente del caso nuevo incluye la sección "Trayectoria" y la cadena de §4.

### 3.4 Ensayo obligatorio

`eval/inyecciones/` con tres paquetes listos y documentados: (a) **carrusel nuevo** de 3 RFC con ciclo de facturas y dinero; (b) **retorno** hacia un EFOS existente; (c) **trampa legítima** (comercializadora de margen delgado con compras reales) que debe cerrar `anomalia_explicada`. Medir latencia recibida→dictamen de cada uno y registrarla en ESTADO.md. El paquete (c) es la prueba en vivo de "por qué esta no".

### 3.5 Gates

- H10–18: `008` + RPC de clonación + webhook `inyectar` + prioridad de clusters afectados; latencia medida con (a).
- H18–26: `/inyecciones/[id]` con diff y trayectoria; (b) y (c) ensayados.
- H32: ensayo cronometrado de los tres paquetes en producción; si la latencia supera el tiempo de exposición, mostrar la ejecución guardada identificada como tal.

## 4. Sección fija del expediente: cadena de explicación

El Redactor produce, además de las ocho secciones existentes, una sección **"Cadena de explicación"** con cinco pasos numerados y citados: (1) qué cambió o qué pista disparó; (2) qué conjunto de transacciones (IDs, ventana, montos); (3) qué empresa y sus relaciones; (4) a dónde fue el dinero; (5) por qué se concluye el nivel y qué explicación legítima se probó y falló. El validador exige que cada paso cite al menos un ID validado o declare "sin evidencia" explícitamente. El Editor puede reescribirla pero no eliminarla ni alterar sus citas.

## 5. Decisiones H0 (2026-09-11, coordinador)

- **Inicio confirmado** por el usuario ("arranca YA todo el proyecto"). `launch.config.json: hackathon_started=true`.
- **Proveedor: `messages_api`.** Motivos: la inyección en vivo exige latencia de despacho baja y 8 tareas LLM concurrentes; el sistema de Actions existente (`mrwh1th3/eximapp`, workflows `ai-loop.yml`/`change-loop.yml`, auditados en solo lectura) es una cola Supabase + `repository_dispatch` + cron con **un runner**, ≤3 jobs por run, ≤14 min por job y Claude Code CLI con OAuth: sin observabilidad por request ni concurrencia suficiente. Queda como fallback documentado si la API no tiene saldo; no se construyen dos runtimes. **Dependencia abierta:** `ANTHROPIC_API_KEY` no existe en el entorno local; en n8n existe la credencial `Anthropic account` (tipo anthropicApi, proyecto personal de victorinbm2006) cuyo saldo, modelos accesibles y rate limits no están verificados. El smoke H1 la prueba con una llamada con herramienta; si falla, el usuario aporta una credencial `Anthropic Forense` con saldo.
- **Destinos resueltos:** GitHub `mrwh1th3/hackthonsearchv1-2026` (origin; **es público**, 11 pedía privado: decisión del usuario); `hackthonmty2026` está vacío y `hackthonsearchv1` también. n8n: proyecto personal de `jm.paniaguaamate@gmail.com` (`n0vtYcnvIW4LpWOE`), sin proyectos de equipo → workflows con prefijo `FORENSE_`, inactivos hasta smoke. Supabase: org free `victorinbm2006@gmail.com's Org`, sin proyecto forense; la creación a costo 0 fue **rechazada en H0 por el límite de 2 proyectos free activos** (ambos de clientes): bloqueo registrado, decisión del usuario (pausar/upgrade). Desarrollo contra Postgres 17 local hasta entonces. Vercel: equipo `victorinbm2006-1539s-projects` (hobby), sin proyecto forense; se crea cuando `web/` compile. ElevenLabs: dos agentes de clientes y **cero números salientes**: llamadas bloqueadas externamente; se entrega adaptador + tests sin llamadas.
- **Builders:** cuatro concurrentes en oleada 1 (db, runtime, webapp, prompts). Decisión humana derivada del "todo" del usuario; reversible a tres.
- **Postgres local** vía Homebrew para pruebas de migraciones; migraciones remotas solo por el coordinador vía MCP.
- **Nunca** proyectos de clientes (biolimpieza, eqro, exim, vimaa) aunque compartan cuenta.
