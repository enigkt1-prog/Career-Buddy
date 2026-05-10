"""Backfill structured JD attributes (years, salary, languages) on the
``jobs`` table from existing description + requirements text.

Usage::

    uv run python -m career_buddy_scraper.cli.enrich_jobs
    uv run python -m career_buddy_scraper.cli.enrich_jobs --force
    uv run python -m career_buddy_scraper.cli.enrich_jobs --limit 200

Default scope: rows where is_active=true AND description IS NOT NULL.
``--force`` re-extracts even when years_min / salary_min / languages_required
are already populated.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from typing import Any

from rich.console import Console

from ..db import connect, load_env
from ..jd_attrs import extract_all, extract_more

load_env()

console = Console()

BATCH_SIZE = 200


def _select_sql(force: bool, limit: int | None) -> tuple[str, list[Any]]:
    where = ["is_active = true"]
    params: list[Any] = []
    if not force:
        where.append(
            "(years_min is null and salary_min is null "
            "and (languages_required = '{}' or languages_required is null) "
            "and level is null and country is null)"
        )
    sql = (
        "select id::text, role_title, location, description, requirements "
        "from jobs where "
        + " and ".join(where)
        + " order by id"
    )
    if limit:
        sql += " limit %s"
        params.append(limit)
    return sql, params


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    select_sql, params = _select_sql(force=args.force, limit=args.limit)
    counters: dict[str, int] = defaultdict(int)
    by_attr: dict[str, int] = defaultdict(int)
    pending: list[tuple[str, dict[str, object]]] = []

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(select_sql, params)
            rows = cur.fetchall()

        console.print(f"[bold]enrich jobs[/bold]: {len(rows)} candidates")
        for job_id, role_title, location, description, requirements in rows:
            counters["total_seen"] += 1
            try:
                attrs = extract_all(description or "", requirements or "")
                more = extract_more(role_title or "", location, description or "", requirements or "")
                attrs.update(more)
            except Exception as e:
                counters["errored"] += 1
                console.print(f"[red]  {job_id} extract failed: {e}[/red]")
                continue
            has_signal = any(v not in (None, [], "", False) for v in attrs.values())
            # --force also clears stale values when current extraction yields none.
            if has_signal or args.force:
                pending.append((job_id, attrs))
                if attrs.get("years_min") is not None:
                    by_attr["years"] += 1
                if attrs.get("salary_min") is not None:
                    by_attr["salary"] += 1
                if attrs.get("languages_required"):
                    by_attr["languages"] += 1
                if attrs.get("level") is not None:
                    by_attr["level"] += 1
                if attrs.get("country") is not None:
                    by_attr["country"] += 1
                if attrs.get("visa_sponsorship") is not None:
                    by_attr["visa"] += 1
                if attrs.get("is_international"):
                    by_attr["international"] += 1
            if not has_signal:
                counters["skipped_no_signal"] += 1

        console.print(f"  ready: {len(pending)} updates")

        if args.dry_run or not pending:
            _print_summary(counters, by_attr)
            return 0

        with conn.cursor() as cur:
            for chunk_start in range(0, len(pending), BATCH_SIZE):
                chunk = pending[chunk_start : chunk_start + BATCH_SIZE]
                payload = [
                    (
                        a["years_min"], a["years_max"],
                        a["salary_min"], a["salary_max"], a["salary_currency"],
                        a["languages_required"],
                        a.get("level"),
                        a.get("country"), a.get("city"),
                        a.get("visa_sponsorship"),
                        a.get("is_international", False),
                        jid,
                    )
                    for jid, a in chunk
                ]
                cur.executemany(
                    """
                    update jobs
                       set years_min = %s, years_max = %s,
                           salary_min = %s, salary_max = %s, salary_currency = %s,
                           languages_required = coalesce(%s, languages_required),
                           level = %s::job_level,
                           country = %s, city = %s,
                           visa_sponsorship = %s,
                           is_international = %s
                     where id = %s
                    """,
                    payload,
                )
                conn.commit()
                counters["updated"] += len(chunk)
                console.print(f"  [green]committed batch {chunk_start}-{chunk_start + len(chunk)}[/green]")

    _print_summary(counters, by_attr)
    return 0


def _print_summary(counters: dict[str, int], by_attr: dict[str, int]) -> None:
    console.print()
    console.print("[bold]summary[/bold]")
    for k in ("total_seen", "updated", "skipped_no_signal", "errored"):
        console.print(f"  {k:30} {counters.get(k, 0):>6}")
    console.print()
    console.print("[bold]by attribute[/bold]")
    for k in ("years", "salary", "languages", "level", "country", "visa", "international"):
        console.print(f"  {k:14} {by_attr.get(k, 0):>6}")


if __name__ == "__main__":
    sys.exit(main())
