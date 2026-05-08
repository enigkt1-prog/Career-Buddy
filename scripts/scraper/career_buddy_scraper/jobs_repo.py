"""Repository for the ``jobs`` Postgres table.

Upsert + mark-stale + read helpers. Owned by the orchestrator.

Upsert semantics (per workplan v6 Step 2b):

- conflict key: ``(company_domain, role_title, url)``,
- on conflict: bump ``last_seen_at`` to ``now()``, set ``is_active = true``,
  refresh ``description`` / ``requirements`` / ``raw_payload``,
  ``posted_date = coalesce(excluded.posted_date, jobs.posted_date)``,
- ``first_seen_at`` is **never** overwritten,
- ``HttpUrl`` round-trips through ``str()``.

Mark-stale semantics:

- only ``(company_domain, ats_source)`` pairs in ``touched`` are eligible,
- of those, only rows with ``last_seen_at < now() - 48 h`` and
  ``is_active = true`` are deactivated,
- returns the set of affected pairs (so the caller can assert
  ``affected ⊆ touched``).
"""

from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from .db import connect
from .models import CanonicalJob

UPSERT_SQL = """
insert into jobs (
  company_name, company_domain, role_title, role_category, location,
  location_normalized, is_remote, employment_type, url, description,
  requirements, posted_date, ats_source, raw_payload
) values (
  %(company_name)s, %(company_domain)s, %(role_title)s, %(role_category)s,
  %(location)s, %(location_normalized)s, %(is_remote)s, %(employment_type)s,
  %(url)s, %(description)s, %(requirements)s, %(posted_date)s,
  %(ats_source)s, %(raw_payload)s
)
on conflict (company_domain, role_title, url) do update set
  company_name = excluded.company_name,
  role_category = coalesce(excluded.role_category, jobs.role_category),
  location = coalesce(excluded.location, jobs.location),
  location_normalized = coalesce(excluded.location_normalized, jobs.location_normalized),
  is_remote = excluded.is_remote,
  employment_type = coalesce(excluded.employment_type, jobs.employment_type),
  description = coalesce(excluded.description, jobs.description),
  requirements = coalesce(excluded.requirements, jobs.requirements),
  posted_date = coalesce(excluded.posted_date, jobs.posted_date),
  raw_payload = excluded.raw_payload,
  last_seen_at = now(),
  is_active = true
returning (xmax = 0) as inserted;
"""


def _record_to_payload(r: CanonicalJob) -> dict[str, Any]:
    return {
        "company_name": r.company_name,
        "company_domain": r.company_domain.lower(),
        "role_title": r.role_title,
        "role_category": r.role_category.value if r.role_category is not None else None,
        "location": r.location,
        "location_normalized": r.location_normalized,
        "is_remote": r.is_remote,
        "employment_type": r.employment_type,
        "url": str(r.url),
        "description": r.description,
        "requirements": r.requirements,
        "posted_date": r.posted_date,
        "ats_source": r.ats_source.value,
        "raw_payload": Jsonb(r.raw_payload or {}),
    }


def upsert_jobs(records: list[CanonicalJob]) -> tuple[int, int]:
    """Upsert ``records`` into ``jobs``. Returns ``(inserted, updated)``."""
    if not records:
        return (0, 0)
    inserted = 0
    updated = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for r in records:
                cur.execute(UPSERT_SQL, _record_to_payload(r))
                row = cur.fetchone()
                if row and row[0]:
                    inserted += 1
                else:
                    updated += 1
        conn.commit()
    return inserted, updated


def mark_stale(touched: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """Deactivate rows in ``touched`` not seen in the last 48 h.

    Returns the set of ``(company_domain, ats_source)`` pairs actually
    affected so the caller can assert ``affected ⊆ touched``.
    """
    if not touched:
        return set()
    placeholders = ",".join(["(%s, %s)"] * len(touched))
    sql = f"""
    update jobs set is_active = false
    where (company_domain, ats_source) in ({placeholders})
      and last_seen_at < now() - interval '48 hours'
      and is_active = true
    returning company_domain, ats_source;
    """
    params: list[str] = [v for pair in touched for v in pair]
    affected: set[tuple[str, str]] = set()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            for company_domain, ats_source in cur.fetchall():
                affected.add((company_domain, ats_source))
        conn.commit()
    return affected


def count_active() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from jobs where is_active = true;")
        row = cur.fetchone()
    return int(row[0]) if row else 0


def count_by_ats_source() -> dict[str, int]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select ats_source, count(*) from jobs where is_active = true group by ats_source;"
        )
        rows = cur.fetchall()
    return {str(src): int(cnt) for src, cnt in rows}


def cleanup_smoke_test_rows() -> int:
    """Whitelisted destructive op: scoped delete for synthetic test rows.

    See workplan v6 Hard Rules — both predicates required.
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                delete from jobs
                 where company_domain = 'smoke-test.invalid'
                   and raw_payload->>'smoke_test' = 'true'
                """
            )
            count = cur.rowcount
        conn.commit()
    return count
