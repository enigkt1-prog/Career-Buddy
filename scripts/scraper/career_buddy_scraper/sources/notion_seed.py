"""Notion VC export loader.

Reads ``artifacts/notion-vcs-<date>.json`` (produced agent-side by Claude
via the Notion MCP) and validates each row into a :class:`VcRecord`.
Validation errors are printed but never abort the load — invalid rows
are skipped and reported in the return tuple.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from ..models import VcRecord


def load_and_validate(path: Path) -> tuple[list[VcRecord], list[dict[str, object]]]:
    """Read ``path``, validate each entry, return ``(valid_records, errors)``.

    Each row must shape-match :class:`VcRecord`. ``sources`` defaults to
    ``["notion"]`` and ``tier`` defaults to ``1`` if absent.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"{path}: expected top-level JSON list, got {type(raw).__name__}")

    valid: list[VcRecord] = []
    errors: list[dict[str, object]] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            errors.append({"index": index, "error": "row is not a dict", "raw": entry})
            continue
        defaults: dict[str, object] = {"sources": ["notion"], "tier": 1}
        merged: dict[str, object] = {**defaults, **entry}
        if "notion" not in merged.get("sources", []):  # type: ignore[operator]
            sources_value = merged.get("sources", [])
            if isinstance(sources_value, list):
                merged["sources"] = [*sources_value, "notion"]
        try:
            record = VcRecord.model_validate(merged)
        except ValidationError as e:
            errors.append({"index": index, "error": str(e), "raw": entry})
            continue
        valid.append(record)
    return valid, errors
