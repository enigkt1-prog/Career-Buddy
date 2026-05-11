"""Pydantic models mirroring ``data/schema.sql``.

Single source of truth: ``data/schema.sql``. When the SQL schema changes,
update these models and re-run mypy.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class AtsSource(StrEnum):
    GREENHOUSE = "greenhouse"
    LEVER = "lever"
    ASHBY = "ashby"
    WORKABLE = "workable"
    PERSONIO = "personio"
    RECRUITEE = "recruitee"
    WORKDAY = "workday"
    SMARTRECRUITERS = "smartrecruiters"
    YC_WAAS = "yc-waas"
    WELLFOUND = "wellfound"
    CUSTOM = "custom"
    MANUAL = "manual"


class RoleCategory(StrEnum):
    FOUNDERS_ASSOCIATE = "founders-associate"
    BIZOPS = "bizops"
    STRATEGY = "strategy"
    BD = "bd"
    CHIEF_OF_STAFF = "chief-of-staff"
    INVESTMENT_ANALYST = "investment-analyst"
    OTHER = "other"


class StageFocus(StrEnum):
    PRE_SEED = "pre-seed"
    SEED = "seed"
    SERIES_A = "series-a"
    SERIES_B = "series-b"
    GROWTH = "growth"
    MIXED = "mixed"


class CanonicalJob(BaseModel):
    """One row in the ``jobs`` Postgres table."""

    company_name: str
    company_domain: str
    role_title: str
    role_category: RoleCategory | None = None
    location: str | None = None
    location_normalized: str | None = None
    is_remote: bool = False
    employment_type: str | None = None
    url: HttpUrl
    description: str | None = None
    requirements: str | None = None
    posted_date: date | None = None
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True
    ats_source: AtsSource
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class VcRecord(BaseModel):
    """One row in ``vc_master_list.json``."""

    name: str
    domain: str
    careers_url: str | None = None
    stage_focus: StageFocus | None = None
    sector_tags: list[str] = Field(default_factory=list)
    geography: str | None = None
    portfolio_companies_url: str | None = None
    tier: int | None = None
    aum_bucket: str | None = None
    sources: list[str] = Field(default_factory=list)
    notes: str | None = None
