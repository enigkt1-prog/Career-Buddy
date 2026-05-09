"""Tier-2 LLM classifier using Gemini for jobs Tier-1 regex did not match.

Reads ``jobs`` rows where ``is_active = true and role_category is null``.
Batches 500 titles per Gemini call, asks for category from the 7-value
enum, writes results back. Free-tier budget on gemini-2.5-flash is
20 RPD (NOT 1500 — earlier docs were wrong). 500 titles per batch ⇒
~8 calls for 3,800 pending; falls within the 20-RPD limit with margin.
Quota-exhaustion stops cleanly, never auto-pays.
"""

from __future__ import annotations

import json
import sys

from rich.console import Console

from ..db import connect, load_env
from ..gemini_scraper import GeminiScraper, QuotaExhausted

load_env()

console = Console()

CATEGORIES = [
    "founders-associate",
    "bizops",
    "strategy",
    "bd",
    "chief-of-staff",
    "investment-analyst",
    "other",
]

BATCH_SIZE = 500


def _build_prompt(titles: list[tuple[str, str]]) -> str:
    """``titles`` is a list of (job_id, role_title) pairs."""
    lines = [f"{i}: {title}" for i, (_, title) in enumerate(titles)]
    body = "\n".join(lines)
    return f"""You are a precise job-title classifier for a career-tracking app.

For each numbered title below, output ONE of these categories:
- founders-associate (FA, Founder Associate, Founder's Associate, Special Projects)
- bizops (Operating Associate, BizOps, Business Operations, Portfolio Operator)
- strategy (Strategy Associate, Strategy & Operations, Strategic Initiatives)
- bd (Business Development, Partnerships Associate)
- chief-of-staff (CoS, Chief of Staff)
- investment-analyst (Investment Analyst, Investment Associate, Venture Associate)
- other (anything else: engineering, marketing, sales, support, design, research, executive, ops/people/HR generic, etc.)

Return STRICT JSON: a list of objects with keys ``id`` (integer) and
``category`` (one of the seven values above). One per input title, in
the same order. No markdown, no prose.

Titles:
{body}

JSON output:
"""


def _classify_batch(scraper: GeminiScraper, batch: list[tuple[str, str]]) -> dict[int, str]:
    prompt = _build_prompt(batch)
    raw = scraper.query_json(prompt)
    out: dict[int, str] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        idx = entry.get("id")
        cat = entry.get("category")
        if isinstance(idx, int) and isinstance(cat, str) and cat in CATEGORIES:
            out[idx] = cat
    return out


def main() -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select id::text, role_title from jobs
             where is_active = true and role_category is null
             order by id
            """
        )
        pending = list(cur.fetchall())
    console.print(f"[bold]Tier-2 classify[/bold]: {len(pending)} pending titles")
    if not pending:
        console.print("[green]nothing to classify[/green]")
        return 0

    scraper = GeminiScraper()
    if not scraper.api_key and not scraper.cli_path:
        console.print("[red]no Gemini API key and no CLI — abort[/red]")
        return 1

    total_updated = 0
    total_other = 0
    quota_hit = False

    for batch_start in range(0, len(pending), BATCH_SIZE):
        batch = pending[batch_start : batch_start + BATCH_SIZE]
        try:
            mapping = _classify_batch(scraper, batch)
        except QuotaExhausted as e:
            console.print(f"[red]Gemini quota exhausted: {e} — stop[/red]")
            quota_hit = True
            break
        except (ValueError, json.JSONDecodeError) as e:
            console.print(f"[yellow]batch {batch_start} parse error: {e} — skip[/yellow]")
            continue
        # Apply
        with connect() as conn:
            with conn.cursor() as cur:
                for idx, (job_id, _title) in enumerate(batch):
                    cat = mapping.get(idx)
                    if not cat:
                        continue
                    if cat == "other":
                        total_other += 1
                    else:
                        cur.execute(
                            "update jobs set role_category = %s where id = %s;",
                            (cat, job_id),
                        )
                        total_updated += 1
            conn.commit()
        console.print(
            f"  batch {batch_start:>4}-{batch_start + len(batch):>4} "
            f"→ updated {sum(1 for c in mapping.values() if c != 'other')} "
            f"+ other {sum(1 for c in mapping.values() if c == 'other')}"
        )

    console.print()
    console.print(
        f"[bold]Tier-2 done[/bold]: updated {total_updated}, "
        f"classified-as-other {total_other}, "
        f"quota-hit={quota_hit}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
