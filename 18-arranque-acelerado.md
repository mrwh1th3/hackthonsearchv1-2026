# 18 — Arranque acelerado con Claude Code

## Estado real

El corte de contratos sí está materializado: `contracts/README.md`, schemas2020-12, fixtures de UI/protocolo y tests Ajv. El usuario autorizó este andamio previo; no es la aplicación ni una investigación funcionando. Consumidores reutilizan el release y solicitan cambios al coordinador.

Este repositorio contiene especificaciones y un kit de arranque, no todavía la aplicación ni workflows de producción. Se detectó Node 22.19.0 y Claude Code 2.1.269 localmente; Git no tiene commit inicial ni remote. No se comprobaron credenciales externas. El kit no lanza agentes ni consume APIs por abrirlo.

`node scripts/launch.mjs --check` revisa el arranque local sin red ni mostrar secretos. `--start` inicia una sesión interactiva de Claude Code con el prompt de `ARRANQUE.md`, solo cuando las condiciones de lanzamiento estén cubiertas. No configura otras cuentas ni compra capacidad.

## Datos que faltan

Completar `launch.config.json` con información NO secreta después de responder:

- Inicio permitido y horas restantes; personas que supervisan; máximo de builders concurrentes.
- Claude Code disponible y modelos habilitados en esa cuenta. Los subagentes usan la cuenta de la sesión principal; no suman automáticamente dos cuentas Max ni recursos de Codex.
- URL/versión/método de instalación n8n, CPU/RAM y acceso por MCP/SSH/API ya configurado; permiso exacto sobre entorno dedicado.
- Confirmado por usuario: cuenta n8n `victorinbm2006`, repo probable `hackthonmty2026`, conexiones MCP ya preparadas en Claude. Aún faltan identificación inequívoca y prueba de lectura; no tocar proyectos ajenos aunque compartan cuenta.
- Proyecto Supabase dedicado vacío o con migraciones aplicadas; URL, referencia e identidad del proyecto, no claves en chat.
- Repo remoto, permisos de publicación y proyecto Vercel; dominio/app base.
- API Anthropic: credencial ya instalada, IDs de modelos realmente disponibles, presupuesto USD y rate limits. No asumir saldo por suscripciones de programación.
- ElevenLabs: cuenta, agente/número saliente configurados y destino de prueba consentido. Datasets locales o accesos 69-B/IBM.

Credenciales se configuran fuera de Git en el entorno o gestores de credenciales. Registrar nombre y disponibilidad, no valor. El preflight local no demuestra autenticación ni saldo.

## Modelo de delegación

Coordinador principal `opus`; modelos son alias de Claude Code, no IDs API. Resolver modelo efectivo al arrancar y dejarlo en bitácora de desarrollo. Predeterminado 3 builders simultáneos, ampliable a 4 si recursos/cuota lo permiten. No lanzar todos por nombre a la vez.

- `forense-db` · opus: `db/`, `generator/`, `loaders/`, `eval/`; orden de migraciones, control transaccional y datos.
- `forense-runtime` · opus: `n8n/runtime/`, `n8n/workflows/`, `n8n/tests/`; loop HTTP, scheduler, ledger, export/import. No editar prompts del otro worker.
- `forense-prompts` · opus: `n8n/prompts/`, `tests/prompts/`; roles, paquetes de contexto, ejemplos adversariales. Schemas compartidos se solicitan al coordinador.
- `forense-webapp` · sonnet: `web/` excepto editor y módulos de voz reservados; shell, gráficos, perfil, historial, BFF/sesión y notificaciones internas.
- `forense-editor` · opus: `web/components/editor/`, `web/lib/document/`, `web/app/api/reportes/`, `tests/editor/`; TipTap JSON, selección, versiones, diff y exportación. Montaje en rutas y dependencias se solicita al coordinador.
- `forense-voice` · sonnet: `integrations/elevenlabs/`, `tests/voice/`; payload, HMAC, dedupe, contrato de callback. Runtime integra workflows y DB crea tablas; no invade sus archivos.
- `forense-qa` · opus: `tests/integration/`, `tests/e2e/`, `reports/qa/`; regresión y seguridad. No arregla silenciosamente código ajeno; devuelve fallo reproducible al dueño.
- `forense-docs` · haiku: `reports/handoff/`, `RUNBOOK.md`; empaquetado y documentación de resultados comprobados, sin decidir arquitectura ni evaluar fraude.

Coordinador posee `contracts/`, archivos raíz, lockfiles, configuración, estructura compartida, montaje de rutas, integración y registro de decisiones. Nadie instala dependencias en paralelo sobre el mismo lockfile. El editor y voz tienen rutas reservadas desde el scaffold inicial para evitar colisiones posteriores.

## Oleadas, no nueve contextos gigantes

0. Antes del evento se pueden leer documentación/preflight si las reglas lo permiten; H0–15 min es la meta agresiva para scaffold, contratos mínimos y baseline revisado. Si requiere20–40 min, reportar desplazamiento de H1, no fingir recuperación instantánea. No generar la app entera antes de congelar IDs.
1. DB + runtime + webapp. Prompts se despacha como cuarto solo si hay capacidad; si no, al liberar el primer slot. Cada uno entrega un corte integrable en 45–90 min. Runtime/UI usan fixtures versionados mientras llega DB.
2. Continuar pendientes; editor + voz + QA según slots. QA empieza con contratos desde la primera integración, no espera a H26. Autor original corrige fallos de su módulo.
3. Integrar endpoints y workflows reales, pruebas de recuperación, carga y trazabilidad; docs empaqueta evidencia. Preservar H26–32 de evaluación y H33 de video del plan 12.

Son ondas de trabajo dentro de las 36 h, no una nueva promesa de terminar todo en 6 h. Acelerar eliminando decisiones repetidas, nodos duplicados y espera de dependencias; no eliminando controles ni funcionalidades.

## Aislamiento, Git y cuentas

Cada worker tiene `isolation: worktree`; `.claude/settings.json` fija base HEAD. Antes de abrirlo debe existir commit con docs/scaffold/contratos. Los cambios sin commit NO aparecen mágicamente en worktrees. El preflight bloquea si faltan HEAD o archivos del kit sin versionar/modificados respecto a HEAD.

Crear el baseline solo con archivos revisados, sin `.env`, credenciales ni datos. No `git add .` ciego. La integración local de entregas sigue ownership y pruebas; no borrar worktrees ni sobrescribir archivos del usuario. Si no se autorizó publicar, todo queda local. Si el entorno no admite worktrees, pedir decisión antes de cambiar a escritura compartida.

Los workers no tienen herramienta Agent: la delegación es centralizada por política, aunque la versión de Claude pueda soportar anidamiento. Sin Agent Teams experimentales, sin `bypassPermissions`, sin cambio de modelo silencioso al agotar cuota. Otras cuentas/sesiones se incorporan por decisión humana y tareas no solapadas.

## Prompt de delegación obligatorio

Cada encargo lleva objetivo acotado, nombre de agente, rutas propias, docs a leer, versión de contratos, inputs disponibles, dependencias, pruebas, prohibiciones y criterio de entrega. Debe decir: “No estás solo; no reviertas cambios ajenos. No edites fuera de tu ownership; devuelve las solicitudes de contrato al coordinador”.

Entrega: archivos/commit o worktree devueltos, comandos ejecutados y resultados, supuestos, dependencias pendientes y próximo corte. Ningún “listo” sin evidencia. El coordinador integra por diff y corre pruebas, no confía en resúmenes sin verificar.

## Qué se puede hacer mientras faltan accesos

Contratos, tests locales, fixtures, componentes, schemas, adaptadores y archivos de workflows inactivos contra versión conocida. No marcar autenticación, llamadas, RLS ni rendimiento como comprobados mediante mocks. Falta versión n8n: preparar módulos puros/manifest de nodos, no inventar `typeVersion` ni IDs importables certificados.

La aprobación del hackathon es un gate independiente: mientras no esté confirmado el inicio, solo documentación/andamio permitido. Despliegues, migraciones remotas y llamadas requieren alcance/configuración autorizados. Un archivo de configuración no sustituye aprobación de la plataforma.

## Fuentes del mecanismo de arranque

[Subagentes de Claude Code](https://code.claude.com/docs/en/sub-agents), [worktrees](https://code.claude.com/docs/en/worktrees), [modelos](https://code.claude.com/docs/en/model-config) y [Agent Teams](https://code.claude.com/docs/en/agent-teams), consultados el 11-09-2026. Validar compatibilidad con la instalación; los alias no garantizan acceso a una versión concreta.
