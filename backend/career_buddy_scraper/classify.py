"""Role categorization (Phase D + Tier-1.5 expansion).

Tier 1   — high-precision regex over the role title for FA-track-relevant
           categories. Returns one of the 6 specific RoleCategory values.
Tier 1.5 — broad regex matching obvious noise titles (engineering, sales,
           marketing, HR, support, design, PM, generic data, finance,
           legal, admin, generic ops, crypto-dev, intern). Returns
           RoleCategory.OTHER. Free, deterministic, no LLM.
Tier 2   — LLM classifier over the residual; lives in cli/classify_tier2*.
           Only fills rows where Tier-1 + Tier-1.5 returned None.

`classify_title` is the public wrapper: returns (category, source) so
callers can audit and report tier-1 vs tier-1.5 hits separately.
"""

from __future__ import annotations

import re
from typing import Literal

from .models import RoleCategory

ClassifySource = Literal["tier1", "tier15", "none"]


# ---------------------------------------------------------------------------
# Tier 1 — FA-track-relevant patterns. High precision, MUST stay narrow.
# Order matters: first match wins, so put more specific patterns first.
# ---------------------------------------------------------------------------
TIER1_PATTERNS: list[tuple[re.Pattern[str], RoleCategory]] = [
    # Founders Associate — explicit FA forms only. NEVER bare "office".
    (
        re.compile(
            r"\b(founders?\s*associate|founder['’]?s\s*associate|special\s+projects)\b",
            re.I,
        ),
        RoleCategory.FOUNDERS_ASSOCIATE,
    ),
    (
        re.compile(r"\boffice\s+of\s+the\s+(founder|ceo)\b", re.I),
        RoleCategory.FOUNDERS_ASSOCIATE,
    ),
    # Chief of Staff — including CoS acronym in word boundary.
    (
        re.compile(r"\b(chief\s+of\s+staff|cos)\b", re.I),
        RoleCategory.CHIEF_OF_STAFF,
    ),
    # BizOps — must have a qualifier (rev/sales/gtm/marketing/business/biz).
    # NEVER match bare "operations" — that catches Office Manager, etc.
    (
        re.compile(
            r"\b(operating\s+associate|biz\s*ops|business\s+operations|portfolio\s+operator)\b",
            re.I,
        ),
        RoleCategory.BIZOPS,
    ),
    (
        re.compile(
            r"\b(rev(?:enue)?|sales|gtm|marketing)[\s\-]*ops\b",
            re.I,
        ),
        RoleCategory.BIZOPS,
    ),
    (
        re.compile(
            r"\b(rev(?:enue)?|sales|gtm|marketing)\s+operations\b",
            re.I,
        ),
        RoleCategory.BIZOPS,
    ),
    # Strategy — qualified forms only. Never bare "strategic".
    (
        re.compile(
            r"\b(strategy\s+associate|strategy\s*&\s*operations|strategic\s+initiatives)\b",
            re.I,
        ),
        RoleCategory.STRATEGY,
    ),
    (
        re.compile(
            r"\b(corporate\s+strategy|strategic\s+(planning|projects))\b",
            re.I,
        ),
        RoleCategory.STRATEGY,
    ),
    # Investment Analyst / Associate / Manager — listed BEFORE BD so
    # "Investment Manager" goes to IA, not generic noise.
    (
        re.compile(
            r"\b(investment\s+(analyst|associate|manager|principal)|venture\s+associate|vc\s+associate)\b",
            re.I,
        ),
        RoleCategory.INVESTMENT_ANALYST,
    ),
    # BD / Partnerships — qualified forms. NEVER bare "partner".
    (
        re.compile(
            r"\b(business\s+development|partnerships\s+associate)\b",
            re.I,
        ),
        RoleCategory.BD,
    ),
    (
        re.compile(
            r"\b(strategic\s+partnerships?|channel\s+partnerships?|alliance\s+(manager|director))\b",
            re.I,
        ),
        RoleCategory.BD,
    ),
]


# ---------------------------------------------------------------------------
# Tier 1.5 — broad noise patterns. All map to RoleCategory.OTHER.
# Designed to catch the long tail of clearly-not-FA-track titles so we
# don't burn LLM budget on them. Order matters less here (all → OTHER),
# but keep it readable.
# ---------------------------------------------------------------------------
TIER15_OTHER_PATTERNS: list[re.Pattern[str]] = [
    # Engineering — software, ML, infra, security.
    re.compile(
        r"\b(software|backend|front[\s\-]?end|full[\s\-]?stack|mobile|ios|android|"
        r"systems?|platform|devops|sre|reliability|infra(structure)?|cloud|security|"
        r"ml|ai|machine[\s\-]learning|data|firmware|embedded|hardware)\s+"
        r"(engineer|developer|architect|programmer)\b",
        re.I,
    ),
    re.compile(
        r"\b(engineering\s+(manager|lead|director)|staff\s+engineer|"
        r"principal\s+engineer|tech\s+lead|founding\s+engineer|"
        r"ai\s+scientist|research\s+engineer|research\s+scientist)\b",
        re.I,
    ),
    re.compile(r"\b(solidity|smart[\s\-]contract|blockchain\s+(engineer|developer))\b", re.I),
    # Sales — exec / manager / SDR / BDR / AE / inside / outbound.
    re.compile(
        r"\b(sales\s+(executive|manager|representative|rep|lead|director|associate)|"
        r"account\s+(executive|manager|director)|enterprise\s+sales|"
        r"sdr|bdr|inside\s+sales|outbound\s+sales|sales\s+development|"
        r"agent\s+commercial|commercial\s+(executive|manager|director))\b",
        re.I,
    ),
    # Marketing / Comms / PR / Brand / Content / SEO.
    re.compile(
        r"\b(marketing\s+(manager|associate|director|lead|specialist|coordinator)|"
        r"growth\s+marketing|content\s+(manager|writer|strategist|creator)|"
        r"seo\s+(manager|specialist)|brand\s+(manager|director|strategist)|"
        r"social\s+media|communications?\s+(manager|director|specialist|associate)|"
        r"comms\s+(manager|director|lead)|pr\s+(manager|director)|public\s+relations)\b",
        re.I,
    ),
    # HR / People / Talent / Recruiting.
    re.compile(
        r"\b(people\s+(operations|partner|manager|business\s+partner|ops|team)|"
        r"hr\s+(manager|business\s+partner|generalist|director|coordinator)|"
        r"talent\s+(acquisition|partner|manager)|recruit(er|ment|ing)|"
        r"payroll\s+(associate|manager|specialist))\b",
        re.I,
    ),
    # Customer Support / Success / Account Management.
    re.compile(
        r"\b(customer\s+(support|success|service|experience)|"
        r"support\s+(engineer|specialist|agent|representative|associate)|"
        r"technical\s+(support|account\s+manager|solution(s)?\s+engineer|"
        r"solution(s)?\s+architect)|csm|technical\s+account\s+manager|"
        r"solutions\s+(engineer|architect|consultant))\b",
        re.I,
    ),
    # Design — UI / UX / product / graphic / visual.
    re.compile(
        r"\b((ui|ux|product|graphic|visual|interaction|motion)\s+designer|"
        r"design\s+(lead|manager|director|engineer))\b",
        re.I,
    ),
    # Product Manager / Owner / Lead / Director.
    re.compile(
        r"\b(product\s+(manager|owner|lead|director|associate|marketing\s+manager))\b",
        re.I,
    ),
    # Generic Data — scientist / analyst / engineer (Investment Analyst
    # is handled by Tier-1 BEFORE this fires, so safe).
    re.compile(
        r"\b(data\s+(scientist|analyst|engineer)|business\s+analyst|"
        r"competitive\s+intelligence|research\s+(manager|analyst))\b",
        re.I,
    ),
    # Finance / Accounting (NOT investment).
    re.compile(
        r"\b(controller|accountant|financial\s+analyst|fp&a|treasur(y|er)|"
        r"clearing\s+manager|tax\s+(analyst|manager))\b",
        re.I,
    ),
    # Legal.
    re.compile(
        r"\b(legal\s+counsel|general\s+counsel|attorney|paralegal|legal\s+(manager|director))\b",
        re.I,
    ),
    # Admin / EA / Office Manager — explicitly OTHER, not BIZOPS.
    re.compile(
        r"\b(admin(istrative)?\s+(assistant|coordinator)|executive\s+assistant|"
        r"office\s+manager|family\s+office)\b",
        re.I,
    ),
    # Generic operations — warehouse / logistics / supply chain / IT support.
    re.compile(
        r"\b(warehouse|logistics|supply\s+chain|shipping|fulfillment|"
        r"operations\s+(specialist|coordinator|analyst|associate)|"
        r"it\s+support|it\s+(manager|engineer|specialist))\b",
        re.I,
    ),
    # Intern / student / writer / translator / teacher / coach.
    re.compile(
        r"\b(intern\b|internship|working\s+student|writer\b|editor\b|copywriter|"
        r"translator|teacher|trainer|coach\b|consultant)\b",
        re.I,
    ),
    # Generic team-lead / regional manager titles that aren't FA-track.
    re.compile(
        r"\b(team\s+lead\s+(early\s+growth|card\s+reader|sales|support)|"
        r"country\s+manager|regional\s+manager|general\s+manager)\b",
        re.I,
    ),
    # Director / Head / VP of <function>. Catches "Director of Product",
    # "Head of Customer Programs", "VP of Marketing", "Director, Engineering".
    re.compile(
        r"\b(director|head|vp|vice\s+president|chief|svp)[\s,]+(of\s+)?"
        r"(engineering|product|sales|marketing|design|people|hr|operations|"
        r"customer|finance|legal|data|security|growth|content|talent|brand|"
        r"compliance|risk|procurement|communications?|enablement|programs?|"
        r"internal\s+control|infrastructure|platform|technology)\b",
        re.I,
    ),
    # Manager,? <function> suffix forms. E.g. "Manager, Engineering",
    # "Senior Manager, People Technology", "Technical Program Manager".
    re.compile(
        r"\b(senior\s+manager|manager|technical\s+program\s+manager|tpm|"
        r"program\s+manager|engineering\s+manager|product\s+manager)[\s,]+"
        r"(engineering|product|sales|marketing|design|people|hr|operations|"
        r"customer|finance|legal|data|security|growth|content|technical|"
        r"technology|enablement|programs?|infrastructure|platform|"
        r"identity|fraud|compliance|risk|payroll|accounting)\b",
        re.I,
    ),
    # Bare standalone Technical Program Manager (no suffix needed).
    re.compile(r"\btechnical\s+program\s+manager\b", re.I),
    # Marketing Analytics / Operations Analytics — catches "Marketing X Manager".
    re.compile(
        r"\bmarketing\s+(analytics|automation|data|operations|technology)\s+"
        r"(manager|director|lead|specialist)\b",
        re.I,
    ),
    # Growth Manager / Growth Lead / Growth Director (without "marketing").
    re.compile(r"\bgrowth\s+(manager|director|lead|associate|specialist)\b", re.I),
    # Compliance / Risk / Fraud / Internal Control / Fincrime.
    re.compile(
        r"\b(compliance|risk|fincrime|fraud|aml|kyc|internal\s+control)\s+"
        r"(manager|lead|specialist|coordinator|officer|analyst|director|expert|"
        r"program\s+manager|business\s+partner)\b",
        re.I,
    ),
    # Procurement / Maintenance / Logistics ops.
    re.compile(
        r"\b(procurement|maintenance|sourcing|invoice|inventory)\s+"
        r"(manager|lead|specialist|coordinator|planner|officer|analyst)\b",
        re.I,
    ),
    # More engineering — automation, productivity, electronics, salesforce,
    # forward-deployed, devsecops, member of technical staff, researcher.
    re.compile(
        r"\b(automation|productivity|electronics|salesforce|forward[\s\-]deployed|"
        r"devsecops|detection|observability)\s+"
        r"(engineer|developer|specialist|lead|architect|manager)\b",
        re.I,
    ),
    re.compile(r"\bmember\s+of\s+technical\s+staff\b", re.I),
    re.compile(r"\bresearcher\b", re.I),
    re.compile(r"\bdevsecops\b", re.I),
    # More sales — pre-sales, ADR, field enablement, client solutions,
    # multilingual sales (DE Vertrieb, IT Commercio, ES Ventas, FR Commercial).
    re.compile(
        r"\b(pre[\s\-]sales|account\s+development\s+representative|adr|"
        r"field\s+enablement|client\s+solutions|sales\s+enablement|"
        r"sales\s+development|named\s+account|account\s+director)\b",
        re.I,
    ),
    re.compile(
        r"\b(vertrieb(smitarbeiter)?|aussendienst|außendienst|"
        r"vertriebsmitarbeiter|vertriebs|"
        r"agenti\s+di\s+commercio|consulenti\s+di\s+vendita|procacciatori|"
        r"subgerente\s+de\s+ventas|gerente\s+de\s+ventas|"
        r"commercial[\.\s]+(b2b|e\s)|commerciale\b)\b",
        re.I,
    ),
    # HR-adjacent — compensation, benefits, comp & ben business partner.
    re.compile(
        r"\b(compensation|benefits|comp\s*&\s*ben|comp\s*ben)\s+"
        r"(business\s+partner|manager|lead|specialist|analyst|director)\b",
        re.I,
    ),
    # Communications / CEO Comms.
    re.compile(
        r"\b(ceo\s+communications?|communications?\s+(manager|director|lead|specialist))\b",
        re.I,
    ),
    # Generic Analyst with non-investment qualifier (Investment Analyst is
    # caught by Tier-1 BEFORE this fires).
    re.compile(
        r"\b(market|business|operations|risk|policy|pricing|revenue|"
        r"compliance|finance|financial|reporting|systems|analytics|"
        r"insurance|technical|product|growth|portfolio\s+(?!operator))\s+analyst\b",
        re.I,
    ),
    re.compile(r"\banalyst\s+relations\b", re.I),
    # Strategic Finance / Senior Accounting / Tax / Treasury.
    re.compile(
        r"\b(strategic\s+finance|senior\s+accounting|accounting\s+manager|"
        r"tax\s+(manager|analyst|associate|specialist)|treasury\s+(analyst|manager))\b",
        re.I,
    ),
    # Stage / French intern wording.
    re.compile(r"\bstage\s*[\-—]\s*(assistant|stagiaire)\b", re.I),
]


def tier1_classify(title: str) -> RoleCategory | None:
    """Return the high-precision FA-track category, or None."""
    for pattern, category in TIER1_PATTERNS:
        if pattern.search(title):
            return category
    return None


def tier15_classify(title: str) -> RoleCategory | None:
    """Return RoleCategory.OTHER if title matches a noise pattern, else None."""
    for pattern in TIER15_OTHER_PATTERNS:
        if pattern.search(title):
            return RoleCategory.OTHER
    return None


def classify_title(title: str) -> tuple[RoleCategory | None, ClassifySource]:
    """Public wrapper: returns (category, source) so callers can audit.

    Tier-1 fires first (FA-track-relevant). Tier-1.5 only fires if Tier-1
    didn't match. Source is one of "tier1", "tier15", "none".
    """
    cat = tier1_classify(title)
    if cat is not None:
        return cat, "tier1"
    cat = tier15_classify(title)
    if cat is not None:
        return cat, "tier15"
    return None, "none"
