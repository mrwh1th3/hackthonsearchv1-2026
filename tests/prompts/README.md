# tests/prompts

Dueño: **forense-prompts**. Tests de ensamblado, ACL de contexto, allowlist de herramientas,
techos, léxico, few-shot, trayectoria, reintentos, gramática de variantes y prompt injection
sobre `n8n/prompts`.

```bash
npm ci --prefix contracts --ignore-scripts     # los fixtures válidos salen de contracts
node --test "tests/prompts/*.test.mjs"         # 106 pruebas (incluye el check del manifest)
node n8n/prompts/manifest.mjs --check          # falla si un prompt cambió sin regenerar
```

| Archivo | Qué cubre |
|---|---|
| `acl.test.mjs` | Qué ve cada rol: familia, ronda 1 sin señales ajenas, Redactor sin hipótesis. |
| `ensamblado.test.mjs` | Orden del system, contrato de salida, identidad y límites del runner. |
| `fewshot.test.mjs` | La variante adversarial: system, `variante_prompt` y techos. |
| `gramatica.test.mjs` | La gramática publicada de `meta.variante_prompt` y `prompt_hash`: orden fijo de las partes y README fiel al código. |
| `herramientas.test.mjs` | Allowlist por rol contrastada contra las tablas de 06 y 03. |
| `inyeccion.test.mjs` | Todo texto libre viaja dentro del fence y nadie se escapa de él. |
| `lexico.test.mjs` | Palabras prohibidas y reglas de redacción de los `.md`. |
| `manifest.test.mjs` | `version_prompts`, hashes y política publicada. |
| `reintento.test.mjs` | Motivo tipificado por intento (y la degradación `sin_motivo` de H7): cambia el texto, no el contrato. |
| `techos.test.mjs` | Techos de paquete y de system **por rol** (10k/12k, H7), ámbito por defecto y truncado por bloques. |
| `trayectoria.test.mjs` | Sección 9: la serie de SQL tal cual, o su ausencia declarada. |

`ayuda.mjs` no es un archivo de test: son utilidades compartidas. `fixtures/` guarda los
casos adversariales propios; los válidos se leen de `contracts/fixtures/valid`.
