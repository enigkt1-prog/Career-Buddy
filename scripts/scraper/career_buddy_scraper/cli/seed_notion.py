"""Seed the ``vcs`` table from a Notion-export JSON file.

Usage::

    uv run python -m career_buddy_scraper.cli.seed_notion \\
        artifacts/notion-vcs-20260508.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from rich.console import Console

from ..master_list import upsert_into_supabase
from ..sources.notion_seed import load_and_validate

console = Console()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Path to the Notion-export JSON file.")
    args = parser.parse_args(argv)

    path = Path(args.path).resolve()
    if not path.exists():
        console.print(f"[red]not found: {path}[/red]")
        return 1

    records, errors = load_and_validate(path)
    if errors:
        console.print(f"[yellow]{len(errors)} validation errors (rows skipped)[/yellow]")
        for err in errors:
            console.print(f"  · row {err['index']}: {str(err['error']).splitlines()[0]}")

    if not records:
        console.print("[red]no valid records to upsert[/red]")
        return 2

    console.print(f"[cyan]upserting {len(records)} records into vcs[/cyan]")
    inserted, updated = upsert_into_supabase(records)
    console.print(f"[green]done[/green]: inserted={inserted}, updated={updated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
