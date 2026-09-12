# 06 — Pistas SQL y herramientas del agente

**Contrato previo:** `001_schema.sql` crea tablas; `002_views.sql` crea utilidades, logger, presupuesto/leases y agregados. Este documento mezcla SQL de referencia con pseudocódigo explícito; solo las implementaciones completas van a migraciones ejecutables. Todas las lecturas derivan `corrida_id` y `fecha_corte` desde el caso/tarea, según §05.

## Parte A: el motor de pistas (`003_pistas.sql`)

Cada pista es una función `forense.pista_XX(p_corrida uuid) returns int` que inserta filas en `forense.pistas` y devuelve cuántas insertó. Un orquestador las llama todas:

```sql
create or replace function forense.correr_pistas(p_corrida uuid) returns jsonb
language plpgsql as $$
declare fam text[]; r jsonb := '{}'::jsonb;
begin
  select familias_evaluables into fam from forense.corridas where id = p_corrida and estado = 'lista';
  if not found then
    return jsonb_build_object('error', 'corrida no preparada');
  end if;
  refresh materialized view forense.v_pares_giro;
  if 'D' = any(fam) then
    r := r || jsonb_build_object('D1', forense.pista_d1(p_corrida), 'D2', forense.pista_d2(p_corrida),
                                 'D3', forense.pista_d3(p_corrida), 'D4', forense.pista_d4(p_corrida));
  else
    perform forense.marcar_no_evaluable(p_corrida, array['D1','D2','D3','D4']);
  end if;
  -- idem F, R, T, E
  return r;
end $$;
```

`marcar_no_evaluable` inserta una fila con `estado='no_evaluable'` por cada RFC, para que la UI las muestre tachadas con el motivo.

El bloque anterior es un **esqueleto**: implementar las 14 funciones y las ramas F/R/T/E antes de aplicar la migración. `correr_pistas` reclama la corrida atómicamente, pasa a `procesando` y no admite otra evaluación concurrente. Cada pista usa `huella` determinista y `ON CONFLICT` para no duplicarse al reintentar. Una corrida ya cerrada permanece inmutable; cambios de reglas o prompts generan otra corrida. Refrescar pares una vez por carga, antes del fan-out; no hacerlo dentro de cada herramienta.

### Patrón de referencia: R2 (ciclos y cadenas de facturas)

Es la más compleja; sirve de plantilla para las demás.

```sql
create or replace function forense.pista_r2(p_corrida uuid) returns int
language plpgsql as $$
declare n int;
begin
  with recursive f as (
    select emisor_rfc, receptor_rfc, uuid, total, fecha
    from forense.cfdi
    where corrida_id = p_corrida and tipo = 'I' and not cancelado
      and fecha <= (select fecha_corte from forense.corridas where id=p_corrida)
  ),
  camino as (
    select emisor_rfc as origen, receptor_rfc as actual,
           array[emisor_rfc, receptor_rfc] as ruta, array[uuid] as uuids,
           total as monto_ini, total as monto_act,
           fecha as f_ini, fecha as f_act, 1 as saltos
    from f
    union all
    select c.origen, f.receptor_rfc,
           c.ruta || f.receptor_rfc, c.uuids || f.uuid,
           c.monto_ini, f.total, c.f_ini, f.fecha, c.saltos + 1
    from camino c
    join f on f.emisor_rfc = c.actual
    where c.saltos < 5 and c.actual <> c.origen
      and not (f.receptor_rfc = any(c.ruta[2:]))
      and f.fecha >= c.f_act
      and f.fecha <= c.f_ini + interval '30 days'
      and abs(f.total - c.monto_act) / nullif(c.monto_act,0) <= 0.15
  )
  insert into forense.pistas (corrida_id, codigo, familia, rfc, score, detalle, huella)
  select p_corrida, 'R2', 'R', origen, least(1, saltos / 4.0),
         jsonb_build_object(
           'tipo', case when actual = origen then 'ciclo' else 'cadena' end,
           'ruta', ruta, 'uuids', uuids,
           'monto_ini', monto_ini, 'monto_fin', monto_act,
           'dias', extract(day from f_act - f_ini)),
         md5(array_to_string(uuids, ','))
  from camino
  where (actual = origen and saltos >= 3)
     or (saltos >= 4 and monto_act < monto_ini * 0.97 and monto_act > monto_ini * 0.70)
  on conflict (corrida_id, codigo, rfc, huella) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
```

**Al materializar R2:** aplicar la ventana de observación de `corridas.fecha_corte`; normalizar la rotación de ciclos para no contar A→B→C→A y B→C→A→B como hallazgos distintos; acotar expansión por nodo, tiempo y número de rutas. El ejemplo limita profundidad pero no evita una explosión combinatoria en un hub. Para cadenas, hacer que el decrecimiento por salto coincida con el catálogo de §02; el filtro del ejemplo sobre montos inicial/final no sustituye esa comprobación.

**Plan B de rendimiento:** `eval/cycles_networkx.py` conserva la misma semántica, límites e IDs y escribe pistas idempotentes. R2 se aplica a CFDI; **IBM AML no tiene CFDI** y usa el detector financiero F4 sobre movimientos, no esta CTE de R2. Medir con las ~200k transferencias seleccionadas antes de afirmar tiempos; tanto SQL como NetworkX necesitan límites en grafos densos.

### Selección de candidatos

```sql
create or replace function forense.score_entidad(p_corrida uuid)
returns table (rfc text, score numeric, familias text[]) language sql as $$
  select rfc, sum(score) as score, array_agg(distinct familia) as familias
  from forense.pistas
  where corrida_id = p_corrida and estado = 'disparada'
  group by rfc
  having count(distinct familia) >= 2
      or bool_or(codigo = 'E1' and (detalle->>'estatus') = 'definitivo' and (detalle->>'saltos')::int = 0)
  order by 2 desc
$$;
```

Este `having` **es** la regla de dos familias aplicada en la entrada: un RFC con tres pistas de la misma familia no entra a la cola. Ahorra tiempo de agente y evita el falso positivo desde el origen.

**Dos entradas adicionales explícitas:** la investigación manual por RFC/UUID permite revisar un caso de una sola familia, incluido el despacho con R1, sin relajar el dictamen; una corrida financiera IBM AML selecciona candidatos F2/F4 en modo exploratorio aunque solo haya `{F}`. Registra `modo='exploratorio_financiero'` en la configuración/contexto de la corrida y no produce automáticamente presunción fiscal. Para IBM, marcar D/R/T/E no evaluables y adaptar F2 a los campos realmente disponibles; si faltan titularidad o saldos, el resultado declara esas comprobaciones no evaluables.

## Parte B: clustering (`004_clusters.sql`)

Los cuerpos siguientes son **pseudocódigo, no funciones SQL ejecutables**. Implementarlos después de `score_entidad`; usan el logger/leases de 002, nunca un helper que recién se cree en 005.

```sql
create or replace function forense.armar_clusters(p_corrida uuid) returns int
language plpgsql as $$
-- 1. candidatos := forense.score_entidad(p_corrida)
-- 2. por cada candidato: ego-network de 2 saltos sobre facturas ∪ movimientos
-- 3. fusionar ego-networks con solape > 50%
-- 4. si |cluster| > 40: partir por densidad de aristas, marcar cortes como frontera
-- 5. insert into forense.clusters con score = suma de scores de sus candidatos
$$;

create or replace function forense.expandir_cluster(p_cluster uuid, p_rfcs text[]) returns int
language plpgsql as $$
-- agrega los RFC de frontera al array rfcs, marca expandido = true,
-- recalcula n_cfdi / n_movimientos, incrementa version_contexto,
-- invalida caché del contexto anterior y escribe cluster_expandido en bitacora
$$;
```

## Parte C: herramientas del agente (`005_rpc.sql`)

**Regla absoluta:** toda RPC recibe `p_caso`, `p_agente` y `p_tarea` fijos del runner, escribe `tool_call` antes y `tool_result` después con duración y marca el texto libre con sufijo `_untrusted`. La tarea determina ronda, intento y versión de contexto. El LLM solo decide los argumentos de investigación; no puede elegir caso, corrida, identidad de agente ni presupuesto. Solo se cachean lecturas de hechos inmutables; señales, pistas/estados, evidencia y escrituras nunca se cachean.

Esto es lo que hace que la trazabilidad no dependa de que el agente reporte bien lo que hizo. El agente **no puede** llamar una herramienta sin dejar rastro.

### El logger

Se define en **002_views.sql**, antes de pistas y clustering. La firma conserva argumentos opcionales para eventos del sistema; las RPC resuelven cluster/intento/tarea desde contexto validado. El logger nunca recibe esos datos del LLM.

```sql
create or replace function forense.log(
  p_caso uuid, p_agente text, p_tipo text, p_payload jsonb,
  p_dur int default null, p_tin int default null, p_tout int default null,
  p_modelo text default null, p_ronda int default null, p_cluster uuid default null,
  p_tarea uuid default null, p_corrida uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into forense.bitacora
    (caso_id, cluster_id, seq, ronda, agente, tipo_evento, payload, duracion_ms, tokens_in, tokens_out, modelo, tarea_id, intento, corrida_id)
  values
    (p_caso, coalesce(p_cluster, (select cluster_id from forense.casos where id=p_caso)),
     forense.next_seq(p_caso), p_ronda, p_agente, p_tipo, p_payload, p_dur, p_tin, p_tout, p_modelo,
     p_tarea, coalesce((select intento from forense.tareas_agente where id=p_tarea),0),
     coalesce((select corrida_id from forense.casos where id=p_caso),
              (select corrida_id from forense.tareas_agente where id=p_tarea), p_corrida))
$$;
```

Para carga, pistas y clustering sin caso, el llamador de sistema proporciona `p_corrida`. Si hay caso/tarea se deriva de ellos y se rechaza un `p_corrida` contradictorio al validar el contexto. Toda fila de bitácora queda asociada a una corrida, incluidos los eventos anteriores al fan-out.

### El control de presupuesto

La configuración única de §03 define límites por tarea/agente y el techo del caso: **120 tool calls**, de las que **27 quedan reservadas para Auditor y Defensor**. Una expansión o un reintento no reinicia el total. El conteo por tarea distingue `(ronda, intento, version_contexto)`; cada cache hit consume llamada de herramienta porque también consume una interacción del agente. Las solicitudes al modelo tienen un contador separado en el runner: `Max Iterations` no representa ninguna de esas dos cuotas.

**Pseudocódigo del helper en 002:** `reservar_tool(p_caso,p_tarea,tool,args)` bloquea la fila del caso (`FOR UPDATE`), valida tarea/lease/contexto, comprueba límite por tarea y total/reserva, incrementa el contador y escribe `tool_call` dentro de la misma transacción. Devuelve `{ok, corrida_id, cluster_id, fecha_corte, version_contexto, ronda, intento, agente}`. Todos los wrappers usan este helper; una consulta `count(*) < limite` separada de la inserción permite sobrepasar la cuota con agentes concurrentes.

Al agotarse, la RPC devuelve `{"error":"presupuesto agotado"}` y escribe `presupuesto_agotado`.

### Plantilla de referencia (aplicar a las otras 10 herramientas)

El SQL siguiente requiere el helper `reservar_tool` de 002 ya implementado. Muestra una lectura cacheable del dominio, seguida de pistas actuales sin caché. Al materializar, validar también los límites y la pertenencia de los RFC al caso/cluster o a una frontera permitida, y completar manejo de errores.

```sql
create or replace function public.forense_perfil(
  p_caso uuid, p_agente text, p_rfc text, p_tarea uuid, p_ronda int default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t0 timestamptz := clock_timestamp(); r jsonb; h text; contexto jsonb; cache_hit boolean;
  v_corrida uuid; v_cluster uuid; v_corte timestamptz; v_version int;
begin
  contexto := forense.reservar_tool(p_caso, p_tarea, 'perfil', jsonb_build_object('rfc', p_rfc));
  if not coalesce((contexto->>'ok')::boolean, false) then
    return contexto;
  end if;
  -- Identidad autorizada: se deriva de la tarea, nunca de args generados por IA.
  p_agente := contexto->>'agente';
  p_ronda := (contexto->>'ronda')::int;
  v_corrida := (contexto->>'corrida_id')::uuid;
  v_cluster := (contexto->>'cluster_id')::uuid;
  v_corte := (contexto->>'fecha_corte')::timestamptz;
  v_version := (contexto->>'version_contexto')::int;
  h := md5(jsonb_build_object('rfc',p_rfc,'fecha_corte',v_corte)::text);
  select resultado into r from forense.tool_cache tc
   where tc.corrida_id=v_corrida and tc.cluster_id=v_cluster
     and tc.version_contexto=v_version and tc.herramienta='perfil' and tc.args_hash=h;
  cache_hit := r is not null;
  if r is null then
  with facturas_ventana as (
    select * from forense.cfdi
     where corrida_id=v_corrida
       and fecha > v_corte - interval '12 months' and fecha <= v_corte
  )
  select jsonb_build_object(
    'rfc', c.rfc, 'giro', c.giro, 'tipo_persona', c.tipo_persona,
    'fecha_alta', c.fecha_alta, 'empleados_declarados', c.empleados_declarados,
    'razon_social_untrusted', c.razon_social,
    'facturado_12m', (select coalesce(sum(total),0) from facturas_ventana where emisor_rfc=c.rfc and tipo='I' and not cancelado),
    'recibido_12m',  (select coalesce(sum(total),0) from facturas_ventana where receptor_rfc=c.rfc and tipo='I' and not cancelado),
    'nomina_12m',    (select coalesce(sum(total),0) from facturas_ventana where emisor_rfc=c.rfc and tipo='N' and not cancelado),
    'n_clientes',    (select count(distinct receptor_rfc) from facturas_ventana where emisor_rfc=c.rfc and tipo='I' and not cancelado),
    'n_proveedores',(select count(distinct emisor_rfc) from facturas_ventana where receptor_rfc=c.rfc and tipo='I' and not cancelado),
    'tasa_cancelacion',(select round(avg(cancelado::int),3) from facturas_ventana where emisor_rfc=c.rfc and tipo='I'),
    'cuentas', (select jsonb_agg(clabe) from forense.cuentas where corrida_id=v_corrida and rfc_titular=c.rfc),
    'listas_sat', (select jsonb_agg(jsonb_build_object('lista',lista,'estatus',estatus,'fecha',fecha_publicacion))
                   from forense.listas_sat where corrida_id=v_corrida and rfc=c.rfc and fecha_publicacion <= v_corte::date)
  ) into r
  from forense.contribuyentes c where c.corrida_id=v_corrida and c.rfc=p_rfc;

  r := coalesce(r, jsonb_build_object('error','rfc no encontrado'));
  insert into forense.tool_cache (corrida_id, cluster_id, version_contexto, herramienta, args_hash, resultado)
    values (v_corrida, v_cluster, v_version, 'perfil', h, r)
    on conflict do nothing;
  end if;

  r := r || jsonb_build_object('pistas', coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'codigo',p.codigo,'familia',p.familia,'score',p.score,
      'estado',coalesce(k.evaluacion_pistas->p.id::text->>'estado',p.estado),'detalle',p.detalle))
      from forense.pistas p join forense.casos k on k.id=p_caso
     where p.corrida_id=v_corrida and p.rfc=p_rfc
  ), '[]'::jsonb));

  perform forense.log(p_caso, p_agente, 'tool_result',
    jsonb_build_object('tool','perfil','result',r,'cache',cache_hit),
    (extract(epoch from clock_timestamp()-t0)*1000)::int, null,null,null,p_ronda,v_cluster,p_tarea);
  return r;
end $$;
```

### Las 11 herramientas

Todas en el schema `public` (para que PostgREST las exponga), prefijo `forense_`, firma que empieza con `p_caso, p_agente`, incluye `p_tarea` fijo y termina con `p_ronda`. Ronda, intento y agente se contrastan o derivan desde `tareas_agente`, nunca desde `$fromAI(...)`.

| RPC | Args propios | Devuelve | La usan |
|---|---|---|---|
| `forense_perfil` | `p_rfc` | Perfil agregado + cuentas + listas + pistas del RFC | todos |
| `forense_facturas` | `p_rfc, p_rol, p_desde, p_hasta, p_limite, p_cursor?` | ≤50 CFDI: uuid, contraparte, fecha, total, método, clave, cancelado, `descripcion_untrusted`; cursor keyset estable `(fecha,uuid)` | D, F, R, T |
| `forense_conciliar` | `p_uuid` | CFDI + movimientos candidatos (±7d, ±2%) + complementos + `estado`: `pagado_directo` / `pagado_tercero` / `sin_pago` / `ppd_sin_complemento` | F |
| `forense_seguir_dinero` | `p_cuenta, p_desde, p_saltos (≤4), p_monto_min` | Árbol de movimientos salientes con tipo de destino (moral/física/efectivo) y % conservado por salto | F |
| `forense_relacionados` | `p_rfc` | RFC que comparten atributos (atributo, valor, lista) + si se facturan entre sí + si hay flujo de dinero entre ellos | R, E |
| `forense_ciclos` | `p_rfc, p_prof (≤5)` | Ciclos y cadenas de facturas que pasan por el RFC: ruta, uuids, montos, días | R |
| `forense_pares` | `p_rfc` | Métricas del RFC contra p10/p50/p90 de su giro | D, T |
| `forense_listas` | `p_rfc, p_saltos (≤2)` | Estatus 69-B propio y de contrapartes cercanas, con fechas de publicación | E |
| `forense_leer_senal` | `p_senal_id` | El `detalle` completo de una señal del pizarrón autorizado | especialistas en ronda 2; Auditor/Defensor sobre su paquete vigente |
| `forense_escribir_senal` | `p_familia, p_titular, p_detalle, p_rfcs, p_ids, p_frontera, p_confianza, p_refuta` | id de la señal | especialistas |
| `forense_registrar_evidencia` | `p_items[]` | ids insertados | auditor, especialistas |

### Herramientas de sistema (no las llama el LLM)

| Función | Qué hace |
|---|---|
| `forense_validar_evidencia(p_caso)` | Comprueba ID, tipo, corrida, RFC/cadena y ventana temporal; recalcula montos y hecho alegado; valida la relación pista/familia. Guarda `valida_tecnica` y `hecho_validado`; calcula `validada = valida_tecnica AND NOT refutada`. Log de validadas/descartadas y motivo por fila. Un ID existente no demuestra por sí solo el hallazgo. |
| `forense_evaluar_frontera(p_cluster)` | Junta `frontera` de todas las señales del cluster, devuelve RFC nuevos con facturación relevante. Decide si vale la pena expandir |
| `forense_despertar(p_cluster)` | Aplica la tabla de disparo de `03-arquitectura-agentica.md` sobre las señales de ronda 1 y devuelve qué especialistas corren en ronda 2 |

El validador procesa también defensas citadas antes de aceptarlas. La réplica solo marca `refutada=true` sobre `defensas.evidencia_objetivo_ids` y actualiza `casos.evaluacion_pistas` para esas pistas; **nunca modifica el estado de detección global en `pistas`**. Una nueva validación no revierte la refutación. IDs compuestos como atributos y listas incluyen todos los componentes de su clave; ciclos y pares se reconstruyen desde IDs base, no desde un texto inventado. Duplicados se consolidan antes del dictamen y el monto en riesgo suma CFDI únicos con valores de la base, sin contar la misma factura citada por tres agentes tres veces.

La atribución también se valida: `evidencia.rfcs_afectados` debe concordar con emisor/receptor, titularidad y rol probado en la cadena. El backend produce `casos.resultado_por_rfc` con nivel/evidencia por RFC; una cuenta vecina o un satélite sin evidencia propia no hereda el nivel del caso principal. El envelope del dictaminador incluye `cobertura_completa`, `pendientes` y `conflictos` tipificados; datos faltantes pueden llevar a `no_concluyente`, no a una explicación legítima inventada.

Todas las mutaciones (`escribir_senal`, `registrar_evidencia`, cambios de estado, versiones de expediente) requieren una clave de idempotencia fijada por la tarea/operación. Un retry de HTTP no inserta nuevos hallazgos ni nuevas versiones. Las lecturas de señales solo permiten caso/cluster/contexto autorizados, y los resultados provenientes de otra corrida se rechazan aunque el ID exista.

### Reglas de diseño de las herramientas

1. **Límites duros en los args.** `p_saltos ≤ 4`, `p_prof ≤ 5`, `p_limite ≤ 50`. Si el agente pide más, se recorta silenciosamente y se anota en el resultado. Un agente no puede provocar una query que tumbe la base.
2. **Nunca devolver `ground_truth`.** Ninguna RPC lo toca. Es lo que hace honestas las métricas.
3. **Sufijo `_untrusted` en todo texto libre.** `descripcion_untrusted`, `razon_social_untrusted`, `referencia_untrusted`.
4. **Resultados compactos.** Tope inicial de 4,000 caracteres JSON por página; recortar filas completas, nunca cortar una cita o JSON a mitad. Devolver `truncado: true`, `has_more` y `next_cursor` cuando queden filas; una herramienta sin mecanismo de continuación declara cobertura incompleta, no promete recuperar el resto. No resumir hechos con otro LLM dentro de una RPC.
5. **Errores como datos, no como excepciones.** `{"error": "..."}` en el retorno, nunca un `raise` que rompa el workflow de n8n.
6. **Trazas de fallos.** Registrar `tool_result` con estado de error para fallos controlados; un fallo de conexión/rollback total lo registra el runner en una llamada posterior. No prometer que una escritura dentro de una transacción fallida sobreviva al rollback. Incluir `toolCallId`/ID de operación del runner para emparejar inicio y resultado.
7. **Permisos por función.** `SECURITY DEFINER SET search_path=''`, nombres de tabla calificados y `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`; conceder las herramientas/mutadores a `service_role`. Las RPC públicas de lectura para UI se autorizan individualmente y no comparten esos privilegios.
8. **Contrato de disponibilidad.** Si faltan datos para comprobar saldo, titularidad, materialidad o histórico anual, devolver `no_evaluable`/`cobertura_incompleta` y el motivo. No convertir falta de datos en fraude ni en una defensa probada.

### Contrato del dispatcher y del contexto

El runtime de §17 usa una única ruta HTTP explícita al modelo; las 11 herramientas siguen siendo las mismas. El dispatcher añade `p_operacion` y el token de fencing del lease a cada llamada, **fuera del schema visible al modelo**. `p_operacion` identifica `(tarea_id, paso, tool_use_id)`: repetir transporte devuelve el resultado registrado y no vuelve a consumir cuota ni insertar señal. Una nueva invocación genuina, incluso con los mismos argumentos o cache hit, sí consume cuota. Reserva, resultado y estado de operación quedan en ledger; un resultado de worker con fencing vencido no puede escribir.

Envelope común: `{ok, data, referencias, cobertura, truncado, has_more, next_cursor, error}`. `error` es `null` o `{codigo,mensaje,reintentable}`; `data` no se interpreta como éxito si `ok=false`. Códigos mínimos: `presupuesto_agotado`, `lease_vencido`, `contexto_invalido`, `argumento_invalido`, `no_evaluable`, `fallo_transitorio`. Los campos de cobertura describen período y datos ausentes; no basta un booleano global.

Paginación: cursor opaco firmado o validado por backend, ligado a corrida, filtros y orden; jamás SQL enviado por modelo. `facturas` usa orden ascendente `(fecha,uuid)` y límites de fecha del snapshot. Para otras listas grandes, añadir `p_cursor?` con orden estable antes de anunciar `has_more=true`; `seguir_dinero` y `ciclos` además devuelven qué ramas/rutas quedaron fuera de sus topes. Los montos mantienen precisión decimal como cadenas; el renderer los formatea, el modelo no los recalcula.

ACL además del allowlist de herramientas:

- Especialista R1: sólo sus pistas de familia; `perfil` filtra pistas y no devuelve señales, hipótesis ni dictamen de otros roles. `leer_senal` denegado.
- Especialista R2/reintento: titulares y señales del snapshot de barrera autorizado, no nuevas escrituras concurrentes. La expansión produce una versión nueva explícita.
- Auditor: señales vigentes de todas las familias del mismo caso; Defensor: propuesta y evidencia objetivo verificadas del mismo caso. Pueden leer detalle aunque su tarea tenga `ronda=1`.
- Ningún rol puede elegir identidad, ampliar conjunto de RFC autorizado, leer otra corrida ni consultar ground truth. ACL comprobada en DB, no sólo en instrucciones.

**Validación de soporte, no de prosa arbitraria:** cada evidencia debe identificar `comprobacion` del catálogo de pista y `referencias` completas. El validador ejecuta una comprobación implementada sobre datos estructurados y produce `hecho_validado`; una descripción libre plausible no sustituye esa comprobación. Si la afirmación requiere interpretar semántica no implementada (entrega real, contrato ambiguo, intención), queda `no_verificable`/hipótesis y no suma familia al dictamen. Citas correctas no garantizan materialidad; no prometer un verificador universal de afirmaciones.
