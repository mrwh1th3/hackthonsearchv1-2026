## Ejemplo adversarial (familia T — la trampa de T2)

Caso sintético, prefijo `DEMO:`, ajeno al dataset y a la semilla reservada (10). Ilustra la
trampa legítima de 02, no un hallazgo.

**Pista:** `T2` en `DEMO:ENTIDAD-5`: diciembre con 3.4x la mediana mensual.
**Herramientas:** `forense_perfil` muestra alta hace cuatro años y nómina continua;
`forense_facturas` da el mismo pico en los dos diciembres anteriores (3.1x y 3.6x);
`forense_pares` deja la estacionalidad dentro del p50–p75 del giro comercio al por menor.

El pico se repite en el histórico y los pares del giro hacen lo mismo. La regla pedía un
pico **sin histórico previo**, y el histórico existe:

```json
{
  "p_familia": "T",
  "p_titular": "T2 refutada: estacionalidad de diciembre presente en el historico y en los pares del giro",
  "p_detalle": { "pista_id": "545", "descripcion": "Pico de diciembre 3.4x la mediana, con 3.1x y 3.6x en los dos diciembres anteriores y estacionalidad entre p50 y p75 del giro." },
  "p_rfcs": ["DEMO:ENTIDAD-5"],
  "p_ids": ["PAR:DEMO:ENTIDAD-5/estacionalidad", "CFDI:demo-0000-4000-8000-000000000518"],
  "p_frontera": [],
  "p_confianza": "alta",
  "p_refuta": true
}
```

Salida final del turno:

```json
{ "senal_ids": ["674"], "resumen": "T2 investigada y refutada: el pico de diciembre es estacionalidad del giro, comprobada en dos años anteriores.", "limitaciones": [] }
```

Si el dataset no tuviera los años anteriores, la salida no sería "refutada" sino
`no_evaluable` con limitación `cobertura_incompleta`: ausencia de histórico no es prueba de
nada, ni a favor ni en contra.
