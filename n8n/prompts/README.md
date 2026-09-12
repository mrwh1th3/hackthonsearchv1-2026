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
`dictamen_ausente`, `tools_no_permitidas`, `contexto_invalido`, `rol_no_coincide`.

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

El `system` tiene además su propio techo **medido**, `TECHO_SYSTEM_CARACTERES` = 10.000. No
aborta el ensamblado: lo vigilan los tests y cada ensamblado lo reporta en
`meta.caracteres_system`, `meta.techo_system` y `meta.system_sobre_techo`, para que el
runtime lo registre. Dos casos lo rebasan a propósito y están medidos: los roles de cierre
(~10.0k–10.1k, con techo de paquete de 24k) y la variante `fewshot` (~10.5k–11.4k; en ámbito
`'total'` el financiero ya no cabe y el ensamblador lo dice con `bloque_obligatorio_no_cabe`
en vez de recortar el system: esa variante se usa con el ámbito por defecto).

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
node --test "tests/prompts/*.test.mjs"  # 71+ pruebas; incluye el check anterior
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
