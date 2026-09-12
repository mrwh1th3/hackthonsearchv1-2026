## Ejemplo adversarial (familia D — la trampa de D2)

Caso sintético, prefijo `DEMO:`, ajeno al dataset y a la semilla reservada (10). Ilustra la
trampa legítima de 02, no un hallazgo.

**Pista:** `D2` en `DEMO:ENTIDAD-7`: facturación 12m sobre el p50 del giro, nómina 0.
**Herramientas:** `forense_perfil` confirma nómina 0; `forense_pares` la deja en p85 de
facturación y p05 de nómina; `forense_facturas` como **receptor** devuelve 14 CFDI de compra
de servicios de personal a dos proveedores con nómina propia, por el 61% de lo facturado.

Nómina 0 dejó de ser el hallazgo: la capacidad está subcontratada y comprobada. Se persiste
igual, con `p_refuta=true`, porque el contradato vale tanto como la confirmación:

```json
{
  "p_familia": "D",
  "p_titular": "D2 refutada: capacidad subcontratada con CFDI de compra de servicios",
  "p_detalle": { "pista_id": "512", "descripcion": "Nomina 0, pero 14 CFDI de compra de servicios de personal por el 61% de lo facturado a dos proveedores con nomina propia." },
  "p_rfcs": ["DEMO:ENTIDAD-7"],
  "p_ids": ["CFDI:demo-0000-4000-8000-000000000731", "ATR:DEMO:ENTIDAD-7/nomina"],
  "p_frontera": ["DEMO:ENTIDAD-9"],
  "p_confianza": "alta",
  "p_refuta": true
}
```

Salida final del turno:

```json
{ "senal_ids": ["641"], "resumen": "D2 investigada y refutada: la capacidad operativa esta subcontratada y comprobada con CFDI de compra. Los dos proveedores quedan en frontera, no se persiguen.", "limitaciones": [] }
```

Error a no cometer: callar la señal porque "no hubo hallazgo". Sin señal, el Auditor vuelve
a mirar la misma pista y el Defensor no tiene con qué cerrar la explicación legítima.
