# eval/inyecciones — ensayo obligatorio de inyección en vivo (21 §3.4)

Tres paquetes listos para la prueba que el juez anunció: **"si tu sistema está
corriendo y le inyectamos algo, ¿qué pasa y cómo se explica?"**. Cada uno está
en el formato `product.inyectar` de `contracts/` v1 (validado con ajv) y se
inyecta sin tocar el snapshot base: `forense.clonar_corrida_con_inyeccion` crea
una **corrida nueva** con `corrida_origen_id = base`.

`corrida_base_id` apunta a **gen-v1** (`3fc52b5a-3e4b-54f4-a714-b3303b6f0347`).
Para inyectar sobre otro snapshot hay que sustituir ese campo; los RFC y CLABE
de la base que cada paquete referencia (`ASE250301Z86`, `ULI141106W91`,
`CLU190919B42`, `COR141025P88`, `IND121121C52` y sus cuentas) solo existen en
gen-v1, así que un base distinto exige revisar las contrapartes.

## Cómo se ejecuta

```sql
-- 1. registrar (deja evento 'inyeccion' en bitácora)
select forense.registrar_inyeccion(
  '3fc52b5a-3e4b-54f4-a714-b3303b6f0347'::uuid,
  pg_read_file('eval/inyecciones/a-carrusel-nuevo.json')::jsonb,  -- o el payload del webhook
  'ensayo', 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid);

-- 2. validar (FK contra base + filas nuevas, duplicados, moneda, fechas)
select forense.validar_inyeccion('<ingesta_id>');

-- 3. clonar + inyectar en una sola transacción
select forense.clonar_corrida_con_inyeccion(
  '3fc52b5a-3e4b-54f4-a714-b3303b6f0347'::uuid, '<ingesta_id>');

-- 4. recalcular y priorizar
select forense.correr_pistas('<corrida_nueva>');
select forense.armar_clusters('<corrida_nueva>');
select * from forense.clusters_afectados('<inyeccion_id>');
```

En producción el disparo es `POST /webhook/forense/inyectar` con
`{corrida_base_id, ingesta_id, idempotency_key, prioridad:'inyectados'}`
(MANIFEST §7); estas funciones son las que ese workflow invoca.

El estado completo para `/inyecciones/[id]` sale de
`forense.estado_inyeccion(<inyeccion_id>)`, que incluye el **timeline
persistido** (`recibida → validada → snapshot_creado → …`). Nada se anima sin
evento en `forense.bitacora`.

## (a) `a-carrusel-nuevo.json` — carrusel nuevo de 3 RFC

| | |
|---|---|
| RFC nuevos | `CRR250901AA1`, `CRR250902BB2`, `CRR250903CC3` |
| Filas | 3 contribuyentes, 3 cuentas, 6 atributos, 3 CFDI, 3 movimientos |
| Contrapartes de la base | ninguna: el carrusel es autocontenido |

Ciclo de facturas de tres saltos (1,200,000 → 1,150,000 → 1,105,000) en 15 días,
ciclo de dinero que lo acompaña, y los tres RFC comparten domicilio,
representante, email y teléfono.

**Resultado esperado:** `R1` (atributos compartidos, ≥3 RFC, y además
`se_facturan_entre_si = true`), `R2` (ciclo de 3 saltos con montos dentro de
±15% y ventana ≤30 días) y `T1` (alta de septiembre 2025, todo el volumen en un
trimestre y ≥2 meses de silencio hasta el corte). Dos familias (R y T) ⇒ los
tres RFC entran al selector y quedan **en un mismo cluster**. Es el paquete que
mide la latencia recibida→dictamen.

## (b) `b-retorno-efos-existente.json` — retorno hacia un EFOS de gen-v1

| | |
|---|---|
| RFC nuevos | `RET251001DD4` (moral), `PFR251001EE5` (física) |
| RFC de la base afectados | `ASE250301Z86` (69-B **definitivo** desde 2025-10-01), `ULI141106W91` |
| Filas | 2 contribuyentes, 2 cuentas, 2 CFDI, 4 movimientos |

`ASE250301Z86` factura 2,400,000 a la entidad nueva, que **sí paga** (por eso
`F1` pasa limpio: el pago existe). El EFOS dispersa 2,300,000 a una persona
física y de ahí regresan 2,250,000 a la cuenta de origen.

**Resultado esperado:** en `RET251001DD4`, `E1` (contraparte con estatus
definitivo a 1 salto, con operaciones **posteriores** a la publicación) y `T1`
⇒ dos familias, entra al selector. En `ASE250301Z86`, que en la corrida base ya
tenía `E1`, aparece además `F2` (pass-through: ratio salidas/entradas 0.96 y
100% de la salida hacia persona física) — ese **delta frente a la corrida base**
es lo que muestra la pantalla de diff. La conciliación limpia es
deliberada: es el caso que una revisión de facturas contra banco no encuentra.

## (c) `c-trampa-comercializadora.json` — trampa legítima

| | |
|---|---|
| RFC nuevos | `TRB190311FF6`, `TRB200714GG7`, `TRB180205HH8` |
| RFC de la base afectados | `CLU190919B42`, `COR141025P88` (proveedores), `ULI141106W91`, `IND121121C52` (clientes) |
| Filas | 3 contribuyentes, 3 cuentas, 3 atributos, 11 CFDI, 7 movimientos |

Comercializadora de margen delgado: vende 3,780,000 y compra 2,650,000 a dos
proveedores **reales de la corrida base**, con pagos bancarios que conciertan
fecha y monto. Comparte piso de oficinas con otras dos empresas del mismo
grupo, y arrastra tres facturas PPD de agosto sin complemento de pago.

**Resultado esperado:** dispara `R1` (tres RFC comparten domicilio) y `F1`
(3 de 5 facturas emitidas sin conciliar, 60%) ⇒ dos familias, **sí entra al
selector**, que es justo lo que se quiere: el caso llega a investigación y el
sistema tiene que explicarlo. El dictamen esperado es **`anomalia_explicada`**,
con estos discriminadores medibles:

- `R1.se_facturan_entre_si = false` y `pct_monto_interno = 0`: comparten
  domicilio pero no se facturan entre sí (despacho/coworking, no cluster).
- `forense_conciliar` sobre las tres PPD devuelve `ppd_sin_complemento` con las
  ventas a crédito a 90 días de dos clientes distintos: crédito comercial.
- `forense_seguir_dinero` desde su cuenta muestra 100% de la salida hacia
  **personas morales** con CFDI de compra que las respalda: no hay
  pass-through, `F2` no dispara.
- Hay nómina (`CFDI` tipo `N`) y empleados declarados: `D2` no dispara.

Si el dictamen sale `presuncion` o `presuncion_alta`, es un **falso positivo** y
cuenta como tal en la FPR sobre trampas de `docs/10`. Este paquete es la prueba
en vivo de "por qué esta no".

**Dónde se mide (corregido en la oleada 5).** `db/tests/assertions_012_gen.sql`
llegó a exigir que la trampa quedara FUERA del selector de dos familias. Eso
contradecía a este mismo paquete —está hecho para cruzarlo— y medía otra cosa:
el falso positivo se mide sobre el **dictamen** (`eval/metricas.py`), no sobre el
selector. Lo que las aserciones de base de datos afirman hoy es lo que sí
depende del paquete y de la corrida:

1. cada RFC inyectado termina en un cluster (el juez sube el paquete y espera
   respuesta; el conteo de RFC que cruzan el selector se registra en el detalle,
   sin exigir un valor),
2. el paquete trae con qué explicar la anomalía y por lo tanto **no** da por sí
   solo evidencia validable de dos familias sin explicación: ≥3 CFDI de compra a
   proveedores reales de la base, ≥3 salidas de dinero a personas morales
   identificadas y cero salidas a un titular que no sea moral, y cero facturación
   entre los tres RFC inyectados,
3. garantizar el cluster no cambia el selector (mismo conteo antes y después):
   se garantiza investigación, no se baja el umbral.

## Qué medir en cada ensayo

Registrar en `reports/handoff/ESTADO.md` (21 §3.4):

1. latencia `recibida → snapshot_creado` (la da `inyecciones.latencias_ms`),
2. latencia `recibida → pistas_recalculadas`,
3. latencia `recibida → dictamen` del primer cluster afectado,
4. pistas nuevas por RFC frente a la corrida base (el diff de `/inyecciones/[id]`),
5. nivel final de cada RFC afectado y, en (c), si hubo falso positivo.

## Lo que estos paquetes **no** son

No llevan `ground_truth`: `clonar_corrida_con_inyeccion` copia las etiquetas de
la base y **no etiqueta las filas nuevas** (la validación rechaza cualquier fila
que traiga `es_fraude`, `tipologia` o similares). Los resultados esperados de
arriba son la hipótesis de diseño del ensayo, no una etiqueta que el sistema
pueda leer: las herramientas del agente nunca ven `ground_truth`.
