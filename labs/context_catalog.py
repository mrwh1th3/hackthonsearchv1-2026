"""Offline, explicitly dated sector references; no fuzzy sector inference or network I/O."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import ipaddress
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

CATALOG_ROOT = Path(__file__).parent / "context_catalog"
SOURCE_FIELDS = ("title", "url", "published_at", "event_date", "jurisdiction", "legal_status")
MECHANISM_TEXT = ("name", "vulnerability", "distinctive_detail")
MECHANISM_LISTS = ("actions", "concealment", "observable_signals", "licit_alternatives", "disconfirming_evidence", "source_urls")


def normalize_alias(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", "".join(c for c in value if not unicodedata.combining(c))).replace("_", " ").split())


def timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Catalog timestamps must include a timezone")
    return parsed


def source_url(value: str) -> bool:
    """Reject private/literal addresses without resolving DNS during offline lookup."""
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port not in (None, 443):
            return False
        if "." not in host or host.endswith((".localhost", ".local", ".internal")):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


class ContextCatalog:
    def __init__(self, root: Path | str | None = None):
        self.root = Path(root) if root is not None else CATALOG_ROOT

    def find(self, giro: str, ttl_days: int = 30) -> dict | None:
        matches = []
        for path in sorted(self.root.glob("*.json")):
            try:
                if path.stat().st_size > 2_000_000:
                    continue
                document = json.loads(path.read_text())
                if document.get("schema_version") != 1:
                    continue
                researched = timestamp(document["researched_at"])
                for entry in document.get("sectors", [])[:100]:
                    names = [entry.get("id", ""), entry.get("giro", ""), *entry.get("aliases", [])[:30]]
                    if normalize_alias(giro) not in {normalize_alias(name) for name in names if isinstance(name, str)}:
                        continue
                    if self.valid(entry, researched):
                        matches.append((entry, researched, path.name))
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                continue
        # Ambiguous aliases must not silently assign a sector.
        if len(matches) != 1:
            return None
        entry, researched, filename = matches[0]
        refresh_after = researched + timedelta(days=ttl_days)
        stale = datetime.now(timezone.utc) >= refresh_after
        limitations = list(entry.get("limitations", [])) + [
            "Five documented case references were curated from opened primary sources; their allegations and legal status are preserved, not independently adjudicated.",
            "This is a dated selection, not a claim to contain the five latest cases worldwide. External cases are not evidence about this dataset.",
        ]
        if stale:
            limitations.append("The bundled sector reference is past its refresh date; use as dated background while an update is unavailable.")
        return {"schema_version": 1, "giro": entry["giro"], "requested_giro": giro, "sector_id": entry["id"],
                "aliases": entry.get("aliases", []), "status": "partial", "origin": "bundled_catalog",
                "reference_status": "primary_sources_opened_not_independently_adjudicated",
                "catalog_file": filename, "case_count": 5, "as_of": researched.isoformat(),
                "researched_at": researched.isoformat(), "refresh_after": refresh_after.isoformat(),
                "freshness": "stale" if stale else "fresh", "cache_hit": True, "current_usage": None,
                "mechanisms": entry["mechanisms"], "normal_operations": entry["normal_operations"],
                "sources": entry["sources"], "limitations": limitations}

    @staticmethod
    def valid(entry: dict, researched: datetime) -> bool:
        if not isinstance(entry.get("id"), str) or not entry["id"] or not isinstance(entry.get("giro"), str):
            return False
        if researched > datetime.now(timezone.utc) + timedelta(minutes=5):
            return False
        sources, mechanisms = entry.get("sources", []), entry.get("mechanisms", [])
        if len(sources) != 5 or len(mechanisms) != 5:
            return False
        urls = set()
        for source in sources:
            if any(not isinstance(source.get(key), str) for key in SOURCE_FIELDS):
                return False
            if not source["title"] or not source["legal_status"] or not source_url(source["url"]):
                return False
            if source.get("verification") != "opened_primary_source" or timestamp(source["checked_at"]) > datetime.now(timezone.utc) + timedelta(minutes=5):
                return False
            urls.add(source["url"])
        if len(urls) != 5:
            return False
        covered = set()
        for mechanism in mechanisms:
            if any(not isinstance(mechanism.get(key), str) or not mechanism[key] for key in MECHANISM_TEXT):
                return False
            if any(not isinstance(mechanism.get(key), list) or not mechanism[key] or not all(isinstance(item, str) for item in mechanism[key]) for key in MECHANISM_LISTS):
                return False
            cited = set(mechanism["source_urls"])
            if not cited <= urls:
                return False
            covered.update(cited)
        return covered == urls and all(isinstance(entry.get(key), list) and all(isinstance(item, str) for item in entry[key]) for key in ("normal_operations", "limitations"))
