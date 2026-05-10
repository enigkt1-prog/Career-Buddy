"""Tier-1 + Tier-1.5 regex classification with dry-run audit + race-safe writes.

Reads `select id, role_title from jobs where is_active and role_category
is null`, runs `classify_title` (Tier-1 then Tier-1.5) on each. Default
mode is dry-run: writes audit CSV, prints aggregate counts and per-category
samples, but does NOT mutate the DB. Pass `--write` to apply.

Audit CSV columns: id (uuid), title, proposed_category, source, written_at.
The `written_at` column is set only when --write is on; in dry-run mode it
is empty (audit reflects what WOULD be written).

Race-safe writes: each UPDATE is `WHERE id = %s AND role_category IS NULL`
so a row classified between SELECT and UPDATE is skipped (rowcount=0,
counted as `skipped_race`).

Rollback recipe (for a given audit CSV):

    CREATE TEMP TABLE audit_run (
        id uuid, title text, proposed_category text,
        source text, written_at timestamptz
    );
    \\copy audit_run FROM 'audit/classify-<ts>.csv' csv header;

    UPDATE jobs j
       SET role_category = NULL
      FROM audit_run a
     WHERE j.id = a.id
       AND j.role_category = a.proposed_category;
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from rich.console import Console
from rich.table import Table

from ..classify import classify_title
from ..db import connect

console = Console()

CLASSIFIER_NAME = "tier1+tier15"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument(
        "--write",
        action="store_true",
        help="Apply DB writes. Default is dry-run (audit CSV only).",
    )
    p.add_argument(
        "--audit-dir",
        default="audit",
        help="Directory for audit CSVs (default: audit/).",
    )
    p.add_argument(
        "--samples",
        type=int,
        default=10,
        help="Number of random sample titles to print per category (default: 10).",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    mode = "WRITE" if args.write else "DRY-RUN"
    console.print(f"[bold]classify[/bold] mode=[cyan]{mode}[/cyan]")

    # Pull NULL rows.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select id::text, role_title
            from jobs
            where is_active = true and role_category is null;
            """
        )
        rows = list(cur.fetchall())

        cur.execute("select count(*) from jobs where is_active = true;")
        row = cur.fetchone()
        total_active = int(row[0]) if row else 0
        cur.execute(
            "select count(*) from jobs where is_active = true and role_category is not null;"
        )
        row = cur.fetchone()
        already_classified = int(row[0]) if row else 0

    console.print(
        f"  total_active        : {total_active}\n"
        f"  already_classified  : {already_classified}\n"
        f"  pending (NULL)      : {len(rows)}"
    )
    if not rows:
        console.print("[green]nothing to classify[/green]")
        return 0

    # Classify every row in memory.
    proposals: list[tuple[str, str, str | None, str]] = []  # (id, title, cat_str, source)
    for job_id, title in rows:
        cat_obj, source = classify_title(title)
        proposals.append((job_id, title, cat_obj.value if cat_obj else None, source))

    # Aggregate counts.
    by_cat: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for p_id, p_title, p_cat, _p_src in proposals:
        key = p_cat if p_cat else "_residual_none"
        by_cat[key].append((p_id, p_title))

    # Print breakdown.
    table = Table(title="Proposed classification breakdown")
    table.add_column("category", style="cyan")
    table.add_column("count", justify="right", style="magenta")
    for key in sorted(by_cat.keys(), key=lambda k: -len(by_cat[k])):
        table.add_row(key, str(len(by_cat[key])))
    console.print(table)

    # Per-category samples.
    rng = random.Random(0)
    for key, items in by_cat.items():
        if not items:
            continue
        sample = rng.sample(items, k=min(args.samples, len(items)))
        console.print(f"\n[bold]{key}[/bold] — {len(items)} rows, {len(sample)} sample(s):")
        for _id, title in sample:
            console.print(f"  · {title}")

    # Write audit CSV.
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    audit_dir = Path(args.audit_dir)
    audit_dir.mkdir(parents=True, exist_ok=True)
    audit_path = audit_dir / f"classify-{ts}.csv"

    written_at_value = ""  # populated below if --write
    audit_rows: list[dict[str, str]] = []
    for p_id, p_title, p_cat, p_src in proposals:
        if p_cat is None:
            continue  # residual not in audit (nothing proposed)
        audit_rows.append({
            "id": p_id,
            "title": p_title,
            "proposed_category": p_cat,
            "source": p_src,
            "written_at": "",
        })

    # Apply writes if requested.
    updated_tier1 = 0
    updated_tier15 = 0
    skipped_race = 0
    run_id = str(uuid.uuid4())

    if args.write:
        write_ts = datetime.now(UTC)
        written_at_value = write_ts.isoformat()

        with connect() as conn, conn.cursor() as cur:
            # Open a run row so quota tracker counts in-progress writes.
            cur.execute(
                """
                insert into classify_runs (run_id, classifier)
                values (%s, %s);
                """,
                (run_id, CLASSIFIER_NAME),
            )
            conn.commit()

        with connect() as conn:
            with conn.cursor() as cur:
                for p_id, _p_title, p_cat, p_src in proposals:
                    if p_cat is None:
                        continue
                    cur.execute(
                        """
                        update jobs set role_category = %s
                         where id = %s and role_category is null;
                        """,
                        (p_cat, p_id),
                    )
                    if cur.rowcount == 0:
                        skipped_race += 1
                        continue
                    if p_src == "tier1":
                        updated_tier1 += 1
                    else:
                        updated_tier15 += 1
                # Close out the run row.
                cur.execute(
                    """
                    update classify_runs
                       set jobs_written = %s,
                           last_updated_at = now(),
                           finished = true
                     where run_id = %s;
                    """,
                    (updated_tier1 + updated_tier15, run_id),
                )
            conn.commit()

        # Stamp written_at into audit rows that we actually wrote.
        for arow in audit_rows:
            arow["written_at"] = written_at_value

    # Persist audit CSV (always — even in dry-run).
    with audit_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "title", "proposed_category", "source", "written_at"],
        )
        writer.writeheader()
        writer.writerows(audit_rows)

    # Final report.
    proposed_specific = sum(1 for _x, _y, c, s in proposals if c and s == "tier1")
    proposed_other = sum(1 for _x, _y, c, s in proposals if c and s == "tier15")
    residual = sum(1 for _x, _y, c, _z in proposals if c is None)

    console.print()
    console.print("[bold]Final report[/bold]")
    console.print(f"  audit CSV           : {audit_path}")
    console.print(f"  ran on              : {len(rows)} pending NULL rows")
    console.print(f"  proposed tier1      : {proposed_specific}")
    console.print(f"  proposed tier15→OTHER: {proposed_other}")
    console.print(f"  residual_none       : {residual}")
    if args.write:
        console.print(f"  [green]written tier1[/green]      : {updated_tier1}")
        console.print(f"  [green]written tier15→OTHER[/green]: {updated_tier15}")
        console.print(f"  skipped_race        : {skipped_race}")
        console.print(f"  run_id              : {run_id}")
    coverage_after = (already_classified + updated_tier1 + updated_tier15) / max(total_active, 1)
    console.print(f"  coverage after      : {coverage_after:.0%} of total_active")
    return 0


if __name__ == "__main__":
    sys.exit(main())
