# tests/prompts/fixtures

Dueño: **forense-prompts**. Fixtures adversariales y de borde que **no** pertenecen a
`contracts/fixtures/valid` porque no son ejemplos de uso correcto. Todos derivan de los
fixtures válidos del coordinador; ninguno sustituye a un contrato.

Son datos sintéticos de prueba: no proceden de ningún contribuyente ni de la semilla de
evaluación, y no participan en métricas (10).

| Archivo | Para qué |
|---|---|
| `contexto-r1-inyeccion.json` | Instrucción hostil dentro de `pista.resumen`, con intento de cerrar el bloque `DATO_NO_CONFIABLE` desde el propio dato. Cumple `runtime.contexto`. |
| `contexto-r2-inyeccion-titular.json` | Instrucción hostil en el titular de una señal ajena legítima de ronda 2. Cumple `runtime.contexto`. |
| `contexto-editor-inyeccion.json` | "NOTA AL EDITOR" dentro del texto del documento: el texto del documento es dato, no instrucción. Cumple `runtime.contexto`. |
| `envelope-facturas-inyeccion.json` | `tools.envelope` con `descripcion_untrusted` y `razon_social_untrusted` hostiles. Cumple `tools.envelope`. |
| `perfil-ingesta-inyeccion.json` | Perfil de ingesta (19) con nombres de columna y ejemplos hostiles, más una columna de etiqueta (`is_laundering`). No es un `runtime.contexto`. |
| `contexto-r1-senal-ajena.json` | Fuga de titulares a un especialista en ronda 1. **Inválido a propósito**: lo rechazan el contrato y la ACL del ensamblador. |
| `contexto-r1-familia-ajena.json` | Pista de familia F en el especialista documental. **Inválido a propósito.** |
| `contexto-redactor-hipotesis.json` | Hipótesis libre del Auditor en el paquete del Redactor. **Inválido a propósito.** |
| `contexto-redactor-evidencia-no-validada.json` | Evidencia con `validada=false`. **Inválido a propósito.** |
| `contexto-redactor-sin-dictamen.json` | Redactor sin dictamen determinista. **Inválido a propósito.** |
| `contexto-r1-techo.json` | Peor caso admitido por el contrato: 40 pistas con `resumen` al máximo (1200). Cumple `runtime.contexto` y fuerza el truncado por bloques completos. |

Los marcados **inválido a propósito** comprueban defensa en profundidad: el contrato
`runtime.contexto` los rechaza por schema y el ensamblador los rechaza antes con un código
tipificado (`senal_ajena_en_r1`, `pista_de_familia_ajena`, `hipotesis_libre`,
`evidencia_no_validada`, `dictamen_ausente`) que el runtime puede registrar en bitácora.
