"""Presentation of existing evidence as connected paths, without inferring new edges.

Investigators may record several parallel payments in one ordered list. A flat
list of those payments is not a single path. Partitioning only at discontinuities
preserves each original step and its order; it makes no new claim about cash flow.
"""
from __future__ import annotations


def split_connected_trails(trail: list[dict]) -> list[list[dict]]:
    """Return consecutive connected paths containing every input step once.

    Equal-valued input steps remain distinct observations. Do not deduplicate,
    reorder, reverse, aggregate, or insert edges to make a path connect.
    """
    paths: list[list[dict]] = []
    for step in trail:
        if not paths or paths[-1][-1]["to"] != step["from"]:
            paths.append([])
        paths[-1].append(dict(step))
    return paths


def representative_trail(trail: list[dict]) -> list[dict]:
    """Choose the longest existing connected path; ties keep original order."""
    return max(split_connected_trails(trail), key=len, default=[])
