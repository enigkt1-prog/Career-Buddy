"""Tests for the Notion-export loader."""

from __future__ import annotations

import json
from pathlib import Path

from career_buddy_scraper.models import StageFocus
from career_buddy_scraper.sources.notion_seed import load_and_validate


def test_happy_path_loads_two_valid_records(tmp_path: Path) -> None:
    src = tmp_path / "notion.json"
    src.write_text(
        json.dumps(
            [
                {
                    "name": "Cherry Ventures",
                    "domain": "cherry.vc",
                    "careers_url": "https://www.cherry.vc/careers",
                    "stage_focus": "seed",
                    "sector_tags": ["generalist"],
                    "geography": "DACH",
                },
                {
                    "name": "Atomico",
                    "domain": "atomico.com",
                    "careers_url": "https://www.atomico.com/careers",
                    "stage_focus": "series-a",
                    "geography": "Pan-EU",
                    "sources": ["notion", "manual"],
                },
            ]
        ),
        encoding="utf-8",
    )
    records, errors = load_and_validate(src)
    assert len(records) == 2
    assert errors == []
    cherry, atomico = records
    assert cherry.name == "Cherry Ventures"
    assert cherry.tier == 1
    assert cherry.sources == ["notion"]
    assert cherry.stage_focus == StageFocus.SEED
    assert atomico.tier == 1
    assert sorted(atomico.sources) == ["manual", "notion"]
    assert atomico.stage_focus == StageFocus.SERIES_A


def test_validation_failure_is_collected_not_raised(tmp_path: Path) -> None:
    src = tmp_path / "notion.json"
    src.write_text(
        json.dumps(
            [
                {"name": "Cherry Ventures", "domain": "cherry.vc"},
                {"name": "Bogus Entry"},  # missing required `domain`
                {"name": "Atomico", "domain": "atomico.com"},
            ]
        ),
        encoding="utf-8",
    )
    records, errors = load_and_validate(src)
    assert len(records) == 2
    assert len(errors) == 1
    assert errors[0]["index"] == 1
    assert "domain" in str(errors[0]["error"]).lower()
