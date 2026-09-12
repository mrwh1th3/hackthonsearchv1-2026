"""Capa opcional de LLM con casete de grabación/reproducción.

El LLM solo redacta el argumento del abogado del diablo que aparece en el expediente;
no cambia montos, evidencia ni confianza (esas salen de SQL y reglas).

  off     sin llamadas (por defecto): 0 llamadas, MXN 0
  record  llama a la API y guarda cada respuesta con su uso de tokens en el casete
  replay  lee el casete; sin red. Falla si falta una entrada."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .config import DEFAULT_MODEL, PRICE_USD_PER_MTOK, USD_TO_MXN


class LLM:
    def __init__(self, mode: str = "off", cassette: str | None = None, model: str = DEFAULT_MODEL):
        if mode not in ("off", "record", "replay"):
            raise ValueError(f"unknown llm mode {mode}")
        if mode != "off" and not cassette:
            raise ValueError("--cassette is required for record/replay")
        self.mode, self.model = mode, model
        self.path = Path(cassette) if cassette else None
        self.tape: dict = {}
        if self.path and self.path.exists():
            self.tape = json.loads(self.path.read_text())
        if mode == "replay" and not self.tape:
            raise FileNotFoundError(f"cassette {cassette} is empty or missing")
        self.calls = 0
        self.cost_mxn = 0.0
        self.by_role: dict[str, float] = {}
        self.last_usage: dict = {}

    def _cost(self, usage: dict) -> float:
        pin, pout = PRICE_USD_PER_MTOK.get(self.model, PRICE_USD_PER_MTOK[DEFAULT_MODEL])
        tokens_in = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) * 1.25 \
            + usage.get("cache_read_input_tokens", 0) * 0.1
        return (tokens_in * pin + usage.get("output_tokens", 0) * pout) / 1e6 * USD_TO_MXN

    def ask(self, role: str, system: str, prompt: str, max_tokens: int = 400) -> str | None:
        if self.mode == "off":
            return None
        key = hashlib.sha256(json.dumps([self.model, system, prompt, max_tokens]).encode()).hexdigest()
        if self.mode == "replay":
            if key not in self.tape:
                raise KeyError(f"cassette has no entry for {role} call {key[:12]}")
            entry = self.tape[key]
        else:
            import anthropic  # solo en modo record
            client = anthropic.Anthropic()
            msg = client.messages.create(model=self.model, max_tokens=max_tokens, system=system,
                                         messages=[{"role": "user", "content": prompt}])
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            entry = {"role": role, "text": text, "usage": msg.usage.model_dump()}
            self.tape[key] = entry
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.tape, indent=1, sort_keys=True, ensure_ascii=False))
        self.last_usage = entry["usage"]
        cost = self._cost(entry["usage"])
        self.calls += 1
        self.cost_mxn += cost
        self.by_role[role] = self.by_role.get(role, 0.0) + cost
        return entry["text"]


CHALLENGER_SYSTEM = ("You are the defence counsel in a forensic audit. Given a candidate finding built from "
                     "database records, write the strongest innocent explanation in at most 70 words, then one "
                     "sentence on which record would refute it. Use only the facts given. Plain English.")
