# n8n/prompts

Dueño: **forense-prompts**. Bloque común y un archivo por rol LLM; manifest con SHA-256
(`version_prompts`). Fuente de contenido: `08-prompts.md`; runtime y validación: `17 §7–8`;
secciones fijas del expediente: `21 §4`; trampas legítimas: `02`; mapper de ingesta: `19`.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `comun.md` | Bloque común, se antepone a **todos** los roles (incluido el mapper). |
| `esp-documental.md` … `esp-externo.md` | Los cinco especialistas, uno por familia. |
| `auditor.md`, `defensor.md`, `replica.md`, `redactor.md`, `editor.md` | Roles de cierre. |
| `mapper.md` | Mapeador de ingesta (19). No usa `runtime.contexto`. |
| `fewshot-*.md` | Ejemplo adversarial por familia (trampa legítima de 02). **Variante**, ver abajo. |
| `ensamblar.mjs` | Ensamblado por rol: system, mensaje inicial, allowlist y contrato de salida. |
| `manifest.json` / `manifest.mjs` | Hashes, `version_prompts` y política por rol. |

El Auditor Final no tiene archivo: es código determinista y no hace llamadas al modelo (03).

## Cómo se ensambla

```js
import { ensamblar } from './n8n/prompts/ensamblar.mjs';
const { system, messages_iniciales, tools_permitidas, schema_salida, truncado, meta } =
  ensamblar('documental', paqueteContexto, { fewshot: false, ambito_techo: 'total', directriz });
```

Orden del `system`: bloque común → archivo del rol → (few-shot, si la variante lo pide) →
contrato de salida **renderizado desde los schemas de contracts** → allowlist de herramientas
→ identidad y límites del runner. El paquete de contexto va en el mensaje de usuario, con la
directriz al final y marcada como tarea subordinada.

Lo que el ensamblador impide antes de llamar al modelo, con código de error tipificado:
`senal_ajena_en_r1`, `pista_de_familia_ajena`, `hipotesis_libre`, `evidencia_no_validada`,
`dictamen_ausente`, `tools_no_permitidas`, `contexto_invalido`, `rol_no_coincide`,
`ambito_techo_invalido`, y los cuatro del reintento (`motivo_reintento_invalido`,
`reintento_no_disponible`, `reintento_sin_intento`, `motivo_reintento_ausente`).

El mapper se ensambla con `ensamblarMapper(perfilIngesta)`: su entrada es el perfil
sanitizado de 19, no `runtime.contexto`.

## Techos

12.000 caracteres para especialistas, 24.000 para los roles de cierre (08, reafirmado en
17 §7). `ambito_techo` decide qué se mide:

- `'paquete'` (**por defecto**, decisión H3 de `reports/handoff/DECISIONES.md`): sólo el
  paquete de contexto. Lectura literal de 17 §7 ("los límites de caracteres del paquete
  inicial").
- `'total'`: `system` + mensaje inicial. Lectura estricta; sigue disponible y probada.

Medido con los fixtures de contracts: el `system` de un especialista ocupa **8.9k–9.7k**, así
que en ámbito `'total'` quedan ~2.2k para los datos —una o dos pistas a tamaño máximo— y con
`fewshot` activo quedan ~600. Por eso el ámbito por defecto es `'paquete'`: con `'total'`, el
peor caso del contrato dejaba al especialista sin una sola pista que investigar. Es una
decisión de configuración del runtime, no del prompt.

El `system` tiene además su propio techo **medido y por rol** (`TECHO_SYSTEM_POR_ROL`,
`techoSystem(rol)`; decisión H7 de `reports/handoff/DECISIONES.md`):

| Rol | Techo del system | Por qué |
|---|---|---|
| Los cinco especialistas | **10.000** | comparten un techo de paquete de 12k con las pistas: pasar de 10k deja al especialista sin datos que investigar |
| Auditor, Defensor, Réplica, Redactor, Editor | **12.000** | techo de paquete de 24k; su system no compite con pistas y mide ~10.0k–10.1k |
| Mapper (19) | **12.000** | no compite con pistas; mide ~8k |

Sustituye al escalar único de 10.000 de H3, con el que los cinco roles de cierre quedaban
"sobre techo" por unos cien caracteres sin que eso significara nada. `TECHO_SYSTEM_CARACTERES`
sobrevive como **alias deprecado** del techo que sí aprieta (el del especialista).

No aborta el ensamblado: lo vigilan los tests y cada ensamblado lo reporta en
`meta.caracteres_system`, `meta.techo_system` y `meta.system_sobre_techo`, para que el
runtime lo registre. Un caso lo rebasa a propósito y está medido: la variante `fewshot`
(~10.5k–11.4k contra el techo de 10k del especialista; en ámbito `'total'` el financiero ya
no cabe y el ensamblador lo dice con `bloque_obligatorio_no_cabe` en vez de recortar el
system: esa variante se usa con el ámbito por defecto).

Cuando no cabe, se omiten **bloques completos** (nunca medio JSON ni medio bloque de dato no
confiable), se devuelve `truncado: true`, y el mensaje incluye un aviso con los IDs
recuperables y la instrucción de declarar `cobertura_incompleta`.

## Variantes y versionado (loop de 10)

`version_prompts` es el hash de **toda** esta carpeta (salvo `manifest.json`): los `.md`, el
ensamblador y el manifest. Es un superconjunto deliberado —cambiar este README también lo
mueve— porque es preferible reportar de más que comparar dos corridas creyendo que usaron el
mismo prompt cuando no fue así.

```bash
node n8n/prompts/manifest.mjs --check   # falla (exit 1) si algo cambió sin regenerar
node n8n/prompts/manifest.mjs --write   # regenera manifest.json
node --test "tests/prompts/*.test.mjs"  # 105 pruebas; incluye el check anterior
```

**Después de editar cualquier prompt hay que regenerar el manifest**, o el test falla y la
corrida quedaría etiquetada con una `version_prompts` que no corresponde.

Una **variante** es la misma carpeta con una opción de ensamblado distinta. Hoy hay una:
`fewshot`, que añade al system el ejemplo adversarial de la familia (trampa de 02). Está
**apagada por defecto** porque se come ~1.6k del presupuesto y en ámbito `'total'` deja al
especialista sin datos (o directamente no cabe).
`meta.variante_prompt` la nombra (`documental` vs `documental+fewshot`) y el manifest lista
las variantes posibles; el runtime la usa para calcular `prompt_hash` y registrarla junto a
`version_prompts` en `corridas`.

La segunda variante es el **reintento**. Cuando el auditor de proceso rechaza un intento, el
siguiente se ensambla con `{ motivo_reintento }` y uno de los cinco motivos tipificados
(`evidencia_insuficiente`, `cadena_incompleta`, `defensa_no_considerada`, `evidencia_invalida`,
`contradiccion`). Sólo reintentan los siete roles que investigan: los cinco especialistas, el
Auditor y el Defensor. Cambia el texto del mensaje —el bloque `## Reintento`, con la
instrucción propia de ese motivo— y no cambian el system, la allowlist, el contrato de salida
ni el techo; el bloque compite por el mismo presupuesto que los datos. Reintentar no sube el
nivel (lo calcula código) ni convierte la falta de pruebas en explicación inocente.

El ensamblador rechaza con código tipificado el reintento **mal** declarado:
`motivo_reintento_invalido` (motivo fuera de la lista), `reintento_no_disponible` (rol que no
reintenta) y `reintento_sin_intento` (motivo con `intento=0`: mentiría al modelo).

El reintento **incompleto** ya no se rechaza (decisión H7). Si el paquete declara `intento≥1`
y el ensamblado no recibe motivo, `ensamblar()` no lanza: degrada. Añade un bloque de
reintento genérico que le dice al modelo exactamente lo que no sabe —«el motivo tipificado no
llegó a este ensamblado, no lo supongas ni lo inventes»—, marca la variante como
`<rol>+reintento:sin_motivo` y deja el hueco en `meta.aviso_reintento` para que el runtime lo
registre en bitácora. El motivo del cambio: el runtime no siempre puede recuperar el motivo
del intento anterior (un checkpoint reanudado tras un fallo lo pierde) y abortar el ensamblado
convertía un dato faltante en un caso sin investigar. `sin_motivo` **no es un motivo**: no
está en `MOTIVOS_REINTENTO` y `meta.motivo_reintento` sigue siendo `null`.

### Gramática exacta de `meta.variante_prompt`

Es el nombre canónico de la variante y lo construye `ensamblar()` en un orden **fijo**. No es
prosa: hay un test que lo fija (`tests/prompts/reintento.test.mjs`), porque el runtime lo usa
para calcular `prompt_hash` y 10 compara corridas por ese nombre.

```
variante_prompt := <rol> [ "+fewshot" ] [ "+reintento:" <motivo> | "+reintento:sin_motivo" ]

<rol>     := documental | financiero | relacional | temporal | externo
           | auditor | defensor | replica | redactor | editor | mapper
<motivo>  := evidencia_insuficiente | cadena_incompleta | defensa_no_considerada
           | evidencia_invalida | contradiccion
```

Reglas de la gramática, todas verificadas por los tests:

- **Separador** `+`, **sin espacios**. El separador del motivo es `:`, no `+`.
- **Orden fijo**: rol, luego `fewshot`, luego `reintento:…`. Nunca al revés; no hay otra
  permutación válida, aunque el conjunto de partes sea el mismo.
- **Sin variante no hay sufijo**: el nombre de un ensamblado base es el rol a secas
  (`documental`), no `documental+base` ni `documental+`.
- `fewshot` sólo existe para los cinco especialistas (`FEWSHOT_POR_ROL`).
- `reintento:<motivo>` sólo existe para los siete roles que investigan
  (`ROLES_CON_REINTENTO`) y con `intento≥1`.
- `reintento:sin_motivo` es el caso degradado de H7 (`intento≥1` sin motivo). **`sin_motivo`
  no es un motivo**: no está en `MOTIVOS_REINTENTO`, `meta.motivo_reintento` sigue siendo
  `null` y el hueco viaja en `meta.aviso_reintento`.
- Los dos sufijos de reintento son **excluyentes**: o hay motivo tipificado, o no lo hay.

Ejemplos válidos:

```
redactor
documental
documental+fewshot
auditor+reintento:contradiccion
financiero+fewshot+reintento:evidencia_invalida
temporal+reintento:sin_motivo
```

Las 42 combinaciones de reintento no se listan en `variantes`: el manifest publica los ejes
(`motivos_reintento`, `roles_con_reintento`), la regla de nombre
(`sufijo_variante_reintento`) y la variante degradada (`variante_reintento_sin_motivo`).

### Cómo se compone `prompt_hash`

`prompt_hash` identifica **qué prompt exacto** se le mandó al modelo, y se persiste en
`ejecuciones_agente` y en `corridas` junto a `version_prompts`. La regla es:

```
prompt_hash := <version_prompts> ":" <variante_prompt>
```

`version_prompts` son los 12 primeros hex del sha256 de los sha256 de **todos** los archivos
de esta carpeta salvo `manifest.json`, ordenados por nombre (`regla_hash` del manifest). Se
obtiene sin calcularlo a mano:

```bash
node -e "console.log(require('./n8n/prompts/manifest.json').version_prompts)"
# p. ej. e2a05579a8bf   (cambia con cualquier edición de la carpeta, este README incluido)
```

Ejemplo completo, con esa `version_prompts` de ejemplo:

```
prompt_hash = "e2a05579a8bf" + ":" + "documental+fewshot"
            = e2a05579a8bf:documental+fewshot
```

Aquí no se escribe ninguna `version_prompts` literal como valor vigente: este README entra en
el hash, así que cualquier literal que se escribiera quedaría obsoleto en el mismo commit que
lo escribe. El valor vigente es siempre el del `manifest.json`.

> **Hueco conocido (no es de esta carpeta).** El runtime, cuando arma el cuerpo con el
> catálogo embebido y no le llega un `prompt_hash`, usa el **rol** en vez de la variante
> (`n8n/runtime/nodos/construir-cuerpo.mjs`: `` `${catalogo.version_prompts}:${rol}` ``). Con
> ese fallback, `documental` y `documental+fewshot` comparten `prompt_hash` y el loop de 10 no
> puede distinguir las dos corridas. Ese archivo es de forense-runtime: la gramática de arriba
> es la que debe producir, y el cambio está pedido al coordinador.

Procedimiento de comparación (10 §Loop de iteración), **una cosa por corrida**:

1. Editar un prompt **o** cambiar una variante. Nunca las dos a la vez.
2. `node n8n/prompts/manifest.mjs --write` y `node --test "tests/prompts/*.test.mjs"`.
3. Anotar la nueva `version_prompts` y la variante en la corrida nueva
   (`corrida_origen_id` de la anterior, mismo `dataset_hash` y misma `fecha_corte`).
4. Comparar en `/estadisticas`. La métrica que manda es **FPR sobre trampas**: si sube el
   recall pero sube la FPR, el cambio se revierte.
5. Si el cambio se conserva, dejar constancia en `reports/handoff/DECISIONES.md` con la
   `version_prompts` anterior y la nueva.

Los `fewshot-*.md` son el primer experimento pensado para ese loop: enseñan exactamente la
trampa legítima que mide la FPR, y por eso su efecto se mide, no se presupone.

## Reglas que no se negocian aquí

- El nivel lo calcula código determinista. Ningún prompt lo decide ni lo sugiere.
- `definitivo` no es un nivel de este sistema: es el estatus que publica la autoridad en la
  lista 69-B. El nivel máximo es `presuncion_alta`.
- Todo texto libre (`descripcion_untrusted`, `razon_social_untrusted`,
  `referencia_untrusted`, el resumen de una pista, el titular de una señal, el texto del
  documento del editor y la directriz del usuario) viaja dentro de un bloque
  `<<<DATO_NO_CONFIABLE …>>> … <<<FIN_DATO_NO_CONFIABLE>>>`: es dato, nunca instrucción.
- Los ejemplos de los prompts usan fuentes sintéticas con prefijo `DEMO:`, separadas del
  dataset y de la semilla reservada de evaluación.
