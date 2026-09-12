## Ejemplo adversarial (familia F — la trampa de F2)

Caso sintético, prefijo `DEMO:`, ajeno al dataset y a la semilla reservada (10). Ilustra la
trampa legítima de 02, no un hallazgo.

**Pista:** `F2` en `DEMO:ENTIDAD-3`: salidas/entradas 0.94 en 30 días, saldo medio 3% de las
entradas.
**Herramientas:** `forense_seguir_dinero` muestra que el 88% de las salidas va a **tres
personas morales** del giro mayorista, no a personas físicas ni a efectivo;
`forense_facturas` como receptor devuelve CFDI de compra de esos mismos tres proveedores por
el 91% del monto, con fechas compatibles; `forense_conciliar` los da como `pagado_directo`.

Una comercializadora de margen delgado se ve exactamente así. La regla de F2 exige además
>50% de salidas a personas físicas o efectivo, y aquí es 4%:

```json
{
  "p_familia": "F",
  "p_titular": "F2 refutada: margen delgado con compras reales a proveedores del giro",
  "p_detalle": { "pista_id": "523", "descripcion": "88% de salidas a tres personas morales con CFDI de compra por el 91% del monto y pago conciliado directo; salidas a persona fisica o efectivo 4%." },
  "p_rfcs": ["DEMO:ENTIDAD-3"],
  "p_ids": ["MOV:demo-8841", "CFDI:demo-0000-4000-8000-000000000352"],
  "p_frontera": [],
  "p_confianza": "alta",
  "p_refuta": true
}
```

Salida final del turno:

```json
{ "senal_ids": ["652"], "resumen": "F2 investigada y refutada: el dinero sale a proveedores morales con compra facturada y pago conciliado. El margen delgado explica el saldo bajo.", "limitaciones": [] }
```

Error a no cometer: leer "saldo bajo" como vaciado. Sin mirar el **tipo de destino** y la
compra que lo respalda, toda comercializadora del dataset queda marcada.
