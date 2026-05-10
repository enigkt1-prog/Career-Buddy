"""Tests for Tier-1 (FA-track) and Tier-1.5 (OTHER) classifiers."""

from __future__ import annotations

import pytest

from career_buddy_scraper.classify import (
    classify_title,
    tier1_classify,
    tier15_classify,
)
from career_buddy_scraper.models import RoleCategory

# ---------------------------------------------------------------------------
# Tier-1 — high-precision FA-track patterns. POSITIVES.
# ---------------------------------------------------------------------------

TIER1_POSITIVES: list[tuple[str, RoleCategory]] = [
    # FA
    ("Founders Associate", RoleCategory.FOUNDERS_ASSOCIATE),
    ("Founder's Associate", RoleCategory.FOUNDERS_ASSOCIATE),
    ("Founder Associate", RoleCategory.FOUNDERS_ASSOCIATE),
    ("Special Projects Lead", RoleCategory.FOUNDERS_ASSOCIATE),
    ("Office of the CEO", RoleCategory.FOUNDERS_ASSOCIATE),
    ("Office of the Founder", RoleCategory.FOUNDERS_ASSOCIATE),
    # CoS
    ("Chief of Staff", RoleCategory.CHIEF_OF_STAFF),
    ("CoS to CEO", RoleCategory.CHIEF_OF_STAFF),
    # BizOps
    ("BizOps Lead", RoleCategory.BIZOPS),
    ("Business Operations Manager", RoleCategory.BIZOPS),
    ("Operating Associate", RoleCategory.BIZOPS),
    ("Portfolio Operator", RoleCategory.BIZOPS),
    ("RevOps Manager", RoleCategory.BIZOPS),
    ("Revenue Ops Lead", RoleCategory.BIZOPS),
    ("Sales Ops Analyst", RoleCategory.BIZOPS),
    ("GTM Ops Manager", RoleCategory.BIZOPS),
    ("Marketing Ops Specialist", RoleCategory.BIZOPS),
    ("Sales Operations Manager", RoleCategory.BIZOPS),
    ("Revenue Operations Lead", RoleCategory.BIZOPS),
    # Strategy
    ("Strategy Associate", RoleCategory.STRATEGY),
    ("Strategy & Operations Manager", RoleCategory.STRATEGY),
    ("Strategic Initiatives Lead", RoleCategory.STRATEGY),
    ("Corporate Strategy Manager", RoleCategory.STRATEGY),
    ("Strategic Planning Associate", RoleCategory.STRATEGY),
    ("Strategic Projects Manager", RoleCategory.STRATEGY),
    # IA
    ("Investment Analyst, Series A", RoleCategory.INVESTMENT_ANALYST),
    ("Investment Associate", RoleCategory.INVESTMENT_ANALYST),
    ("Investment Manager", RoleCategory.INVESTMENT_ANALYST),
    ("Investment Principal", RoleCategory.INVESTMENT_ANALYST),
    ("Venture Associate", RoleCategory.INVESTMENT_ANALYST),
    ("VC Associate", RoleCategory.INVESTMENT_ANALYST),
    # BD
    ("Business Development Manager", RoleCategory.BD),
    ("Partnerships Associate", RoleCategory.BD),
    ("Strategic Partnerships Director", RoleCategory.BD),
    ("Channel Partnerships Manager", RoleCategory.BD),
    ("Alliance Manager", RoleCategory.BD),
    ("Alliance Director", RoleCategory.BD),
]


@pytest.mark.parametrize(("title", "expected"), TIER1_POSITIVES)
def test_tier1_positive(title: str, expected: RoleCategory) -> None:
    assert tier1_classify(title) == expected, f"{title!r} → expected {expected}"


# ---------------------------------------------------------------------------
# Tier-1 NEGATIVES — must NOT fire on these false-positive surfaces.
# (tier1_classify alone — tier15 may still catch them as OTHER.)
# ---------------------------------------------------------------------------

TIER1_NEGATIVES: list[str] = [
    # FA-adjacent but not FA
    "Family Office Associate",          # has "office" + "associate" — must NOT match FA
    "Office Manager",                   # generic admin
    "Founding Engineer",                # NOT founder/founders associate
    # BizOps-adjacent
    "Operations Manager",               # bare ops — no qualifier
    "Operations Associate",             # bare ops
    "Office of Innovation",             # "office of" without founder/ceo
    # Strategy-adjacent
    "Strategic Account Executive",      # strategic + sales — not strategy role
    "Strategic Customer Success",       # strategic + CS — not strategy role
    # BD-adjacent
    "Partner Manager",                  # bare "partner" — too broad
    "Channel Manager",                  # bare "channel" — not BD
    # IA-adjacent
    "Data Analyst",                     # generic analyst
    "Senior Data Analyst",
    "Financial Analyst",
    # Generic engineering/sales/etc.
    "Senior Software Engineer",
    "Growth Marketing Manager",
    "Head of People",
    "Recruiter",
    "Customer Success Manager",
    "UX Designer",
]


@pytest.mark.parametrize("title", TIER1_NEGATIVES)
def test_tier1_negative(title: str) -> None:
    assert tier1_classify(title) is None, f"{title!r} should NOT match Tier-1"


# ---------------------------------------------------------------------------
# Tier-1.5 — OTHER patterns. POSITIVES (all map to OTHER).
# ---------------------------------------------------------------------------

TIER15_POSITIVES: list[str] = [
    # Engineering
    "Senior Software Engineer",
    "Staff Software Engineer - Backend",
    "Senior ML/AI Engineer",
    "AI Scientist - Warsaw",
    "Founding Engineer",
    "Tech Lead, Platform",
    "Engineering Manager - AI/BI",
    "Security Engineer",
    "Solidity Developer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    # Sales
    "Sales Development Representative (Turkey)",
    "Enterprise Sales Executive",
    "Account Executive, EMEA",
    "Account Manager",
    "BDR",
    "SDR",
    "Inside Sales Representative",
    # Marketing / Comms / PR
    "Marketing Manager - Poland",
    "Senior Communications Manager",
    "Growth Marketing Lead",
    "Content Strategist",
    "Brand Manager",
    "Social Media Manager",
    # HR / People / Recruiting
    "Senior People Business Partner - NYC",
    "People Business Partner - NYC",
    "GTM Recruiter, Tokyo",
    "Talent Acquisition Manager",
    "Senior Payroll Associate | Netherlands",
    # Support / Solutions
    "Solutions Engineer",
    "Senior Solutions Architect",
    "Technical Solution Engineer - Interoperabilität (x/f/m)",
    "Customer Success Manager",
    "Technical Account Manager 2 - Tel Aviv",
    "Manager I, IT Support",
    "IT Support Engineer",
    # Design / Product
    "UX Designer",
    "Product Designer",
    "Product Manager, Enterprise",
    "Senior Product Manager",
    # Data / Research
    "Senior Data Scientist (Content, Feeds, Recommendation)",
    "Data Engineer",
    "Competitive Intelligence Lead",
    "Research Scientist",
    "[Expression of Interest] Research Manager, Interpretability",
    # Finance / Legal / Admin
    "Controller",
    "Financial Analyst",
    "Clearing Manager",
    "General Counsel",
    "Office Manager",
    "Family Office Associate",
    "Executive Assistant",
    # Generic ops
    "Warehouse Lead",
    "Operations Specialist",
    # Intern / writer / etc.
    "Software Engineering Internship",
    "Working Student Marketing",
    "Editor",
    # Regional / generic mgmt
    "Country Manager",
    "Team Lead Early Growth Card Reader - English",
]


@pytest.mark.parametrize("title", TIER15_POSITIVES)
def test_tier15_returns_other(title: str) -> None:
    assert tier15_classify(title) == RoleCategory.OTHER, (
        f"{title!r} should be classified as OTHER by Tier-1.5"
    )


# ---------------------------------------------------------------------------
# Tier-1.5 NEGATIVES — FA-track titles must NOT be swallowed as OTHER
# when called via tier15 in isolation. (In practice classify_title runs
# tier1 first — but defense-in-depth: tier15 should not over-match.)
# ---------------------------------------------------------------------------

TIER15_NEGATIVES: list[str] = [
    "Founders Associate",
    "Strategy Associate",
    "BizOps Lead",
    "Investment Manager",
    "Chief of Staff",
    "Strategic Partnerships Director",
    # Random nonsense — should remain unclassified.
    "Astronaut Trainee",
    "Quantum Whisperer",
]


@pytest.mark.parametrize("title", TIER15_NEGATIVES)
def test_tier15_does_not_overmatch(title: str) -> None:
    assert tier15_classify(title) is None, (
        f"{title!r} should NOT be classified as OTHER by Tier-1.5"
    )


# ---------------------------------------------------------------------------
# classify_title — wrapper returns (category, source).
# ---------------------------------------------------------------------------


def test_classify_title_tier1_hit() -> None:
    assert classify_title("Strategy Associate") == (RoleCategory.STRATEGY, "tier1")


def test_classify_title_tier15_hit() -> None:
    assert classify_title("Senior Software Engineer") == (RoleCategory.OTHER, "tier15")


def test_classify_title_no_hit() -> None:
    assert classify_title("Astronaut Trainee") == (None, "none")


def test_classify_title_tier1_takes_precedence_over_tier15() -> None:
    # "Investment Manager" matches Tier-1 (IA) before tier15 sees it.
    assert classify_title("Investment Manager") == (RoleCategory.INVESTMENT_ANALYST, "tier1")


def test_classify_title_sales_operations_is_bizops_not_other() -> None:
    # Tier-1 BIZOPS pattern catches before tier15 sales pattern.
    assert classify_title("Sales Operations Manager") == (RoleCategory.BIZOPS, "tier1")


def test_classify_title_strategic_account_is_other_not_strategy() -> None:
    # Strategy regex requires "strategic (planning|projects)" — bare
    # "strategic" should NOT hit. Sales regex catches as OTHER.
    assert classify_title("Strategic Account Executive") == (RoleCategory.OTHER, "tier15")


def test_classify_title_office_manager_is_other() -> None:
    assert classify_title("Office Manager") == (RoleCategory.OTHER, "tier15")


def test_classify_title_family_office_is_other() -> None:
    assert classify_title("Family Office Associate") == (RoleCategory.OTHER, "tier15")
