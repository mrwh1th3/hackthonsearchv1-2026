from ..agents.methodology import build_prompt


def prompt(payload: dict) -> str:
    return build_prompt("Compilador", """No investigas ni solicitas herramientas. Compila únicamente
artefactos A/B sustentados. No amplifiques su confianza ni conviertas hipótesis en hallazgos.
Escribe nueva, anti_patron o ajuste con predicados atómicos del contrato. Sin predicados verificables,
evidencia recibida, diferencia canónica o contraejemplo: notes, no proposals. Un caso aislado no
demuestra generalización: declara datos de validación separados que faltan para promover.
Para ajustes identifica una franja y explicación, no una excepción diseñada para un único ID.
Cada propuesta debe incluir no_aplica_si, novelty_summary y contraejemplo_que_la_tumba.
Consulta las reglas absorbidas y rechazadas entregadas, lista repeticiones en rejected_echoes.
Todas las propuestas quedan pending_human. No emitas código, SQL ni reglas ejecutadas.""", payload)
