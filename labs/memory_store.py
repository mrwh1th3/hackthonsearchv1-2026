"""File memory with locked append and explicit human-only promotion."""
from __future__ import annotations

import fcntl
import json
from pathlib import Path


class MemoryStore:
    def __init__(self, root: Path):
        self.root = root
        self.seed = Path(__file__).parent / "memory"

    def load(self) -> dict:
        result = {}
        for key, filename in (("canonical_typologies", "typologies_canonical.json"), ("anti_patterns", "anti_patterns.json")):
            path = self.root / filename
            if not path.exists():
                path = self.seed / filename
            result[key] = json.loads(path.read_text()) if path.exists() else []
        for key in ("absorbed", "rejected", "pending"):
            path = self.root / "proposals" / f"{key}.jsonl"
            result[key] = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
        # Absorbed is not written by the runner; approved rules must explicitly enter canonical context.
        result["canonical_typologies"] += result["absorbed"]
        return result

    def append_pending(self, run_id: str, proposals: list[dict]) -> None:
        path = self.root / "proposals" / "pending.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                handle.seek(0)
                existing = {(item["run_id"], item["id"]) for line in handle for item in [json.loads(line)]}
                for proposal in proposals:
                    if (run_id, proposal["id"]) not in existing:
                        handle.write(json.dumps(dict(proposal, run_id=run_id, status="pending_human"), ensure_ascii=False) + "\n")
                handle.flush()
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
