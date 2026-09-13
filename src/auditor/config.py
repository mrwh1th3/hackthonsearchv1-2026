"""Constantes que deciden. Cambiar un umbral aquí cambia el resultado; nada más lo hace."""

# detectores
RECENT_REGISTRATION_DAYS = 180          # tope de "alta reciente"; el perfil lo baja si el padrón es joven
RECENT_REGISTRATION_QUANTILE = 0.25     # reciente = en el cuartil inferior de antigüedad del padrón del estate
LIMIT_CANDIDATES = [50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 500_000, 1_000_000]
NEAR_LIMIT_RATIO = 0.85
OBSERVED_LIMIT_MIN_ORDERS = 5            # aprobador con historial suficiente para inferir su tope
OBSERVED_LIMIT_ROUND = 5_000                 # orden "justo debajo" del límite de aprobación
QUARTER_END_DAYS = 7

# perfilado (profile.py)
PO_MATCH_TOLERANCE = 0.005              # orden ↔ factura: mismo monto ±0.5% en la base detectada
PO_MATCH_DAYS = 45                      # orden emitida hasta 45 días antes de la factura
PO_BASE_DOMINANCE = 0.8                 # una base (total/subtotal) gana si explica ≥80% de las coincidencias

# puntaje de evidencia (investigate.py): se acusa con puntaje ≥ umbral y sin exculpación
PHANTOM_WEIGHTS = {"efos_definitivo": 2, "efos_presunto": 1, "recent_registration": 1,
                   "no_ledger_approver": 1, "majority_undocumented": 1}
PHANTOM_THRESHOLD = 2
ROUND_TRIP_HOP_MIN_RATIO = 0.85         # cada salto del ciclo conserva ≥85% del anterior
ROUND_TRIP_CHAIN_MAX_DAYS = 60          # ciclo de 3–4 saltos completo dentro de esta ventana
ROUND_TRIP_MAX_HOPS = 4
PARTIAL_COLLECTION_MIN = 0.10           # abonos ligados a la factura que suman ≥10% = hay cobranza real
FIXED_FEE_MIN_GAP_DAYS = 25             # cuota fija: montos idénticos separados ≥25 días

# investigadores
SPLIT_WINDOW_DAYS = 21                  # órdenes fraccionadas: todas dentro de esta ventana
SPLIT_PROVEN_WINDOW_DAYS = 14
ROUND_TRIP_MAX_DAYS = 20                # regreso de fondos tras el pago
ROUND_TRIP_MIN_RATIO = 0.80
KICKBACK_TIMING_DAYS = 15               # transferencia al empleado tras el pago al proveedor
UNCOLLECTED_MIN_AGE_DAYS = 30           # una factura más joven que esto aún puede cobrarse
PPD_GRACE_DAYS = 90
AMOUNT_MATCH = 0.01

# validador (igual que spec/forensic-auditor/validate_format.py)
MIN_EXHIBITS = 3
MAX_NARRATIVE_WORDS = 150
PESO_TOLERANCE = 0.02

# costo (supuestos declarados en el expediente)
USD_TO_MXN = 18.0
PRICE_USD_PER_MTOK = {"claude-sonnet-5": (3.0, 15.0), "claude-opus-5": (5.0, 25.0)}
DEFAULT_MODEL = "claude-sonnet-5"
