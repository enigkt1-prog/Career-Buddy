"""Tier-1 regex categorisation backfill (workplan v6 Step 3).

Reads ``select id, role_title from jobs where is_active and role_category
is null``, runs :func:`tier1_classify` on each title. Non-None results are
written back via ``update jobs set role_category = $1 where id = $2``.
None results are counted as ``tier2_pending``.

No LLM calls. Tier-1 regex is deterministic and high-precision; titles
that don't match are reported separately, not gated.
"""

from __future__ import annotations

import sys

from rich.console import Console

from ..classify import tier1_classify
from ..db import connect

console = Console()


def main() -> int:
    updated = 0
    pending = 0
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select id::text, role_title
            from jobs
            where is_active = true and role_category is null;
            """
        )
        rows = list(cur.fetchall())
    console.print(f"[bold]classify[/bold]: {len(rows)} active rows pending classification")

    if not rows:
        console.print("[green]nothing to classify[/green]")
        return 0

    with connect() as conn:
        with conn.cursor() as cur:
            for job_id, title in rows:
                category = tier1_classify(title)
                if category is None:
                    pending += 1
                    continue
                cur.execute(
                    "update jobs set role_category = %s where id = %s;",
                    (category.value, job_id),
                )
                updated += 1
        conn.commit()

    matched = updated + pending
    coverage = (updated / matched) if matched else 0.0
    console.print(
        f"  updated      : {updated}\n"
        f"  tier2_pending: {pending}\n"
        f"  coverage     : {coverage:.0%} of considered rows matched a Tier-1 pattern"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
