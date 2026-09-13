from .methodology import build_prompt


def prompt(payload: dict) -> str:
    return build_prompt("B · Explorador residual", """Recibes una muestra de sujetos no_signal, no una
lista de sujetos probadamente legítimos. Busca mecanismos fuera de la cobertura canónica. Conoces
las reglas existentes para evitar redetectarlas. tagged_ids_in_scope identifica los sujetos ya
marcados que aparecen en este recorte o resultados de herramientas, no todos los marcados.
No empieces investigando los hallazgos o sus
relaciones; A cubre esa zona. Si aparece incidentalmente una conexión con sujetos marcados,
declara bridge_to_tags para que el runner la entregue a A. No inventes una novedad para llenar
findings: findings=[] es una salida válida. Explica por qué el motor no cubría cada hipótesis,
qué explicación lícita contrastaste y qué dato permitiría cerrarla.""", payload)
