## Ejemplo adversarial (familia R — la trampa de R1)

Caso sintético, prefijo `DEMO:`, ajeno al dataset y a la semilla reservada (10). Ilustra la
trampa legítima de 02, no un hallazgo.

**Pista:** `R1` en `DEMO:ENTIDAD-11`: nueve RFC comparten domicilio y teléfono.
**Herramientas:** `forense_relacionados` devuelve los nueve con el mismo domicilio, pero
`se_facturan_entre_si=false` para los 36 pares y sin flujo de dinero entre ellos;
`forense_ciclos` a profundidad 5 no encuentra ciclo ni cadena. El atributo compartido es la
dirección de un despacho contable que aparece como domicilio fiscal de sus clientes.

Compartir domicilio no es compartir operación:

```json
{
  "p_familia": "R",
  "p_titular": "R1 refutada: domicilio de despacho contable, sin facturacion ni dinero entre los RFC",
  "p_detalle": { "pista_id": "534", "descripcion": "Nueve RFC con el mismo domicilio y telefono; 36 pares sin facturacion mutua, sin flujo de dinero y sin ciclo a profundidad 5." },
  "p_rfcs": ["DEMO:ENTIDAD-11"],
  "p_ids": ["ATR:DEMO:ENTIDAD-11/domicilio", "ATR:DEMO:ENTIDAD-12/domicilio"],
  "p_frontera": [],
  "p_confianza": "alta",
  "p_refuta": true
}
```

Salida final del turno:

```json
{ "senal_ids": ["663"], "resumen": "R1 investigada y refutada: el domicilio compartido es de un despacho y no hay operacion entre los RFC. No se expande el cluster por este atributo.", "limitaciones": [] }
```

Error a no cometer: expandir el cluster a los nueve RFC por el atributo. Un coworking
convierte esa expansión en decenas de contribuyentes marcados sin una sola operación.
