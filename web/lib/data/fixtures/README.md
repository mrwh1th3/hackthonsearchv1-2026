# Fixtures locales de UI (forense-webapp)

Estos JSON son **fixtures locales de UI, sin contrato v1.0.0** (no aparecen en
`contracts/release.json`). Alimentan vistas de `09-ui-spec.md`, `15` y `21`
que no tienen todavía un productor real ni schema publicado: mapa de
clusters, grafo, trayectoria, contraste, comparación contra pares,
estadísticas/embudo/confusión e inyección en vivo.

Son datos sintéticos de demostración, no ground truth. Toda vista que los usa
muestra un badge distinto del de contratos v1.0.0 (`FixtureBadge` con
`scope="local"`). Se solicita al coordinador considerar estos shapes para un
contrato v1.1 cuando exista un productor real (forense-runtime/forense-db).

IDs de `corrida`, `caso`, `cluster` y `rfc` se mantienen consistentes con
`contracts/fixtures/valid/{corrida,caso-0,caso-1,caso-2,senal,pista}.json`
para que enlazar entre vistas fixture no produzca 404 falsos.
