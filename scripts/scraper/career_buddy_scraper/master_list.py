"""VC master list builder (Phase A).

Pulls VC firm records from public aggregators, dedupes by registered domain,
and persists the result to Supabase (``vcs`` table). JSON export remains as
an optional cache / debug aid.

Sources for v0.1:

- **OpenVC** — free CSV export at https://www.openvc.app/. Manually placed at
  ``data/sources/openvc.csv`` for v0.1; Phase A.1 adds an automated fetcher.
- **EU-Startups directory** — scraped HTML; deferred until openvc.csv is in.
- **Notion seed** — pre-classified Tier-1 VCs (Cherry, Picus, Earlybird, etc.)
  exported from the Karriere workspace.

This module is the *deduper + persister*, not the *fetcher*. Each source
produces an iterable of ``VcRecord`` candidates; ``merge`` collapses them.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path

import psycopg
import tldextract
from psycopg.types.json import Jsonb  # noqa: F401  (kept for future jsonb fields)

from .db import connect
from .models import VcRecord


def normalize_domain(raw: str) -> str:
    """Reduce ``raw`` to its registered domain, lowercase, no scheme/path."""
    extracted = tldextract.extract(raw.strip())
    top = extracted.top_domain_under_public_suffix
    if not top:
        return raw.strip().lower()
    return top.lower()


def merge(candidates: Iterable[VcRecord]) -> list[VcRecord]:
    """Collapse multiple records per domain into one, preferring populated fields."""
    by_domain: dict[str, VcRecord] = {}
    for cand in candidates:
        key = normalize_domain(cand.domain)
        cand = cand.model_copy(update={"domain": key})
        existing = by_domain.get(key)
        if existing is None:
            by_domain[key] = cand
            continue
        merged_fields: dict[str, object] = {}
        for field_name in VcRecord.model_fields:
            existing_value = getattr(existing, field_name)
            cand_value = getattr(cand, field_name)
            if not existing_value and cand_value:
                merged_fields[field_name] = cand_value
            elif field_name == "sources":
                merged_fields[field_name] = sorted({*existing.sources, *cand.sources})
            elif field_name == "sector_tags":
                merged_fields[field_name] = sorted({*existing.sector_tags, *cand.sector_tags})
        if merged_fields:
            by_domain[key] = existing.model_copy(update=merged_fields)
    return sorted(by_domain.values(), key=lambda v: v.domain)


def write_json(records: list[VcRecord], path: Path) -> None:
    """Persist ``records`` as a deterministic JSON list (cache / debug)."""
    serialised = [r.model_dump(mode="json", exclude_none=False) for r in records]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(serialised, indent=2, sort_keys=True) + "\n", encoding="utf-8")


_UPSERT_SQL = """
insert into vcs (
  domain, name, careers_url, stage_focus, sector_tags, geography,
  portfolio_companies_url, tier, aum_bucket, sources, notes
) values (
  %(domain)s, %(name)s, %(careers_url)s, %(stage_focus)s, %(sector_tags)s,
  %(geography)s, %(portfolio_companies_url)s, %(tier)s, %(aum_bucket)s,
  %(sources)s, %(notes)s
)
on conflict (domain) do update set
  name = excluded.name,
  careers_url = coalesce(excluded.careers_url, vcs.careers_url),
  stage_focus = coalesce(excluded.stage_focus, vcs.stage_focus),
  sector_tags = (
    select array(
      select distinct unnest(coalesce(vcs.sector_tags, '{}') || coalesce(excluded.sector_tags, '{}'))
    )
  ),
  geography = coalesce(excluded.geography, vcs.geography),
  portfolio_companies_url = coalesce(
    excluded.portfolio_companies_url, vcs.portfolio_companies_url
  ),
  tier = coalesce(excluded.tier, vcs.tier),
  aum_bucket = coalesce(excluded.aum_bucket, vcs.aum_bucket),
  sources = (
    select array(
      select distinct unnest(coalesce(vcs.sources, '{}') || coalesce(excluded.sources, '{}'))
    )
  ),
  notes = coalesce(excluded.notes, vcs.notes)
returning (xmax = 0) as inserted;
"""


def upsert_into_supabase(records: list[VcRecord]) -> tuple[int, int]:
    """Upsert ``records`` into ``vcs``. Returns (inserted, updated) counts.

    Defensive: normalizes domains and unions duplicate inputs before writing,
    so callers can pass raw scraper output without first running ``merge``.
    """
    merged = merge(records)
    inserted = 0
    updated = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for r in merged:
                payload = r.model_dump(mode="json", exclude_none=False)
                payload["stage_focus"] = r.stage_focus.value if r.stage_focus is not None else None
                cur.execute(_UPSERT_SQL, payload)
                row = cur.fetchone()
                if row and row[0]:
                    inserted += 1
                else:
                    updated += 1
        conn.commit()
    return inserted, updated


def fetch_all_from_supabase() -> list[VcRecord]:
    """Read every row of ``vcs`` back as ``VcRecord``s. Useful for diffs / tests."""
    with connect() as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            select domain, name, careers_url, stage_focus, sector_tags, geography,
                   portfolio_companies_url, tier, aum_bucket, sources, notes
            from vcs
            order by domain;
            """
        )
        rows = cur.fetchall()
    return [VcRecord.model_validate(row) for row in rows]
