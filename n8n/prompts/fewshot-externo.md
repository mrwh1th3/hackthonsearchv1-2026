## Ejemplo adversarial (familia E — la trampa de E1)

Caso sintético, prefijo `DEMO:`, ajeno al dataset y a la semilla reservada (10). Ilustra la
trampa legítima de 02, no un hallazgo.

**Pista:** `E1` en `DEMO:ENTIDAD-2`: aparece en la lista 69-B.
**Herramientas:** `forense_listas` devuelve estatus `desvirtuado` con fecha de publicación
2024-03-11; `forense_relacionados` no encuentra contrapartes a dos saltos con estatus
vigente distinto de `desvirtuado`.

Desvirtuado significa que el contribuyente aportó pruebas y la autoridad las aceptó. El
estatus se registra literal, con su fecha, y no sostiene nada:

```json
{
  "p_familia": "E",
  "p_titular": "E1 refutada: estatus 69-B desvirtuado, sin contraparte cercana con estatus vigente",
  "p_detalle": { "pista_id": "556", "descripcion": "Estatus 69-B desvirtuado publicado el 2024-03-11; ninguna contraparte a dos saltos con estatus distinto de desvirtuado." },
  "p_rfcs": ["DEMO:ENTIDAD-2"],
  "p_ids": ["LISTA:DEMO:ENTIDAD-2"],
  "p_frontera": [],
  "p_confianza": "alta",
  "p_refuta": true
}
```

Salida final del turno:

```json
{ "senal_ids": ["685"], "resumen": "E1 investigada y refutada: el estatus 69-B es desvirtuado y ninguna contraparte cercana lo sostiene.", "limitaciones": [] }
```

Error a no cometer: tratar "aparece en la lista" como hallazgo sin leer el estatus. La otra
mitad de la trampa es la fecha: aunque el estatus fuera el que publica la autoridad como
firme, las operaciones **anteriores** a la fecha de publicación no quedan cubiertas por él.
Compara siempre fechas de operación contra fecha de publicación antes de escribir la señal.
