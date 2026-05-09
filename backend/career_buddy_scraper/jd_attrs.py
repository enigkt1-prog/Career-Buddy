"""Regex-only structured-attribute extractors for job descriptions.

Pulls four attributes out of plain-text JD bodies:
- years_min / years_max (e.g. "3+ years", "5-7 years experience")
- salary_min / salary_max + currency (e.g. "€60-80k", "$120,000 - $150,000")
- languages_required (English, German, French, Spanish, Dutch, Italian)

All best-effort. Empty results are normal; the LLM match-job endpoint
fills the gaps when the user explicitly asks for an analysis.
"""

from __future__ import annotations

import re

# ============================================================
# Years of experience
# ============================================================

# Match patterns:
#   "3+ years"
#   "3-5 years"
#   "minimum 3 years"
#   "at least 4 years"
#   "5+ Jahre"
_YEARS_RANGE_RE = re.compile(
    r"(?:\b|^)(\d{1,2})\s*[\-–to]+\s*(\d{1,2})\+?\s*(?:years|yrs|jahre|ans)\b",
    re.IGNORECASE,
)
_YEARS_PLUS_RE = re.compile(
    r"(?:\b|^)(\d{1,2})\+\s*(?:years|yrs|jahre|ans)\b",
    re.IGNORECASE,
)
_YEARS_MIN_RE = re.compile(
    r"(?:minimum|at least|min\.?|mindestens|au moins)\s+(\d{1,2})\s*(?:years|yrs|jahre|ans)\b",
    re.IGNORECASE,
)
_YEARS_PLAIN_RE = re.compile(
    r"(?:\b)(\d{1,2})\s*(?:years|yrs|jahre|ans)\s+(?:of\s+)?(?:experience|exp\.?|erfahrung|d['e ]expérience)",
    re.IGNORECASE,
)


def extract_years(text: str) -> tuple[int | None, int | None]:
    """Return ``(years_min, years_max)``. Either side may be None.

    Strategy: prefer explicit ranges, then "X+ years", then "minimum X",
    then plain "X years experience".
    """
    if not text:
        return None, None
    # Range "3-5 years"
    range_m = _YEARS_RANGE_RE.search(text)
    if range_m:
        a = _safe_int(range_m.group(1))
        b = _safe_int(range_m.group(2))
        if a is not None and b is not None and 0 < a <= b <= 30:
            return a, b
    # "5+ years"
    plus_m = _YEARS_PLUS_RE.search(text)
    if plus_m:
        a = _safe_int(plus_m.group(1))
        if a is not None and 0 < a <= 30:
            return a, None
    # "minimum 3 years"
    min_m = _YEARS_MIN_RE.search(text)
    if min_m:
        a = _safe_int(min_m.group(1))
        if a is not None and 0 < a <= 30:
            return a, None
    # "5 years experience"
    plain_m = _YEARS_PLAIN_RE.search(text)
    if plain_m:
        a = _safe_int(plain_m.group(1))
        if a is not None and 0 < a <= 30:
            return a, None
    return None, None


# ============================================================
# Salary
# ============================================================

_SALARY_RANGE_RE = re.compile(
    r"""
    (?P<currency>[\$€£]|EUR|USD|GBP|CHF)
    \s*
    (?P<min>\d{2,3}[,.]?\d{0,3})\s*[Kk]?
    \s*[\-–to]+\s*
    (?P<currency2>[\$€£]|EUR|USD|GBP|CHF)?
    \s*
    (?P<max>\d{2,3}[,.]?\d{0,3})\s*[Kk]?
    """,
    re.IGNORECASE | re.VERBOSE,
)
_SALARY_SINGLE_RE = re.compile(
    r"""
    (?:salary|compensation|gehalt|gehaltsband|base\s+salary|annual\s+salary)
    [\s:\-—–]+
    (?:up\s+to|bis\s+zu)?
    \s*
    (?P<currency>[\$€£]|EUR|USD|GBP|CHF)?
    \s*
    (?P<value>\d{2,3}[,.]?\d{0,3})\s*[Kk]?
    """,
    re.IGNORECASE | re.VERBOSE,
)

_CURRENCY_NORMAL = {"$": "USD", "€": "EUR", "£": "GBP"}


def extract_salary(text: str) -> tuple[int | None, int | None, str | None]:
    """Return ``(salary_min, salary_max, currency)``. Annual figures only."""
    if not text:
        return None, None, None
    m = _SALARY_RANGE_RE.search(text)
    if m:
        cur = _normalise_currency(m.group("currency"))
        lo = _parse_salary_amount(m.group("min"), text, m.start("min"), m.end("min"))
        hi = _parse_salary_amount(m.group("max"), text, m.start("max"), m.end("max"))
        if lo is not None and hi is not None and lo <= hi and 10_000 <= lo <= 1_000_000:
            return lo, hi, cur
    m2 = _SALARY_SINGLE_RE.search(text)
    if m2:
        cur = _normalise_currency(m2.group("currency"))
        v = _parse_salary_amount(m2.group("value"), text, m2.start("value"), m2.end("value"))
        if v is not None and 10_000 <= v <= 1_000_000:
            # Hard rule: require a currency to be present in the explicit match
            # OR within 20 chars surrounding it. Otherwise the number is noise.
            window = text[max(0, m2.start() - 20) : m2.end() + 20]
            window_cur = _normalise_currency(_first_currency(window))
            final_cur = cur or window_cur
            if final_cur is None:
                return None, None, None
            return v, None, final_cur
    return None, None, None


def _first_currency(text: str) -> str | None:
    m = re.search(r"[\$€£]|EUR|USD|GBP|CHF", text)
    return m.group(0) if m else None


def _parse_salary_amount(raw: str, text: str, start: int, end: int) -> int | None:
    if not raw:
        return None
    n = _safe_int(raw.replace(",", "").replace(".", ""))
    if n is None:
        return None
    # Heuristic: trailing "k" or "K" multiplies by 1000.
    suffix = text[end:end + 2].lower()
    if suffix.startswith("k"):
        n *= 1000
    elif n < 1000:
        # bare 60 → assumed thousands
        n *= 1000
    return n


def _normalise_currency(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip().upper()
    return _CURRENCY_NORMAL.get(raw, raw if raw in {"USD", "EUR", "GBP", "CHF"} else None)


# ============================================================
# Languages required
# ============================================================

_LANG_PATTERNS = {
    "English": re.compile(r"\b(english|englisch|anglais)(?:\s+(?:fluent|native|c1|c2|required))?\b", re.I),
    "German": re.compile(r"\b(german|deutsch|allemand)(?:\s+(?:fluent|native|c1|c2|required))?\b", re.I),
    "French": re.compile(r"\b(french|französisch|français|francais)\b", re.I),
    "Spanish": re.compile(r"\b(spanish|spanisch|espagnol|español)\b", re.I),
    "Dutch": re.compile(r"\b(dutch|niederländisch|néerlandais|nederlands)\b", re.I),
    "Italian": re.compile(r"\b(italian|italienisch|italien|italiano)\b", re.I),
    "Portuguese": re.compile(r"\b(portuguese|portugiesisch|portugais|português)\b", re.I),
}

# Negative context: skip mentions of "in english" inside "available only in English" etc.
# (The signal is heading + "fluent/native/required"; we already capture that above.)


def extract_languages(text: str) -> list[str]:
    """Return list of language names mentioned with a fluency hint.

    Heuristic: only include a language if it appears within 60 chars of a
    fluency keyword (fluent, native, C1, C2, required, fließend, courant)
    OR explicitly inside a Requirements-like heading section.
    """
    if not text:
        return []
    fluency_re = re.compile(
        r"(fluent|native|c1|c2|required|fließend|courant|muttersprachlich|business|professional)",
        re.IGNORECASE,
    )
    found: list[str] = []
    for name, pat in _LANG_PATTERNS.items():
        for m in pat.finditer(text):
            window_start = max(0, m.start() - 80)
            window_end = min(len(text), m.end() + 80)
            window = text[window_start:window_end]
            if fluency_re.search(window):
                if name not in found:
                    found.append(name)
                break
    return found


# ============================================================
# Helpers
# ============================================================


def _safe_int(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(re.sub(r"[^\d]", "", s))
    except (TypeError, ValueError):
        return None


def extract_all(description: str, requirements: str = "") -> dict[str, object]:
    """Convenience: extract every supported attribute and return a dict."""
    text = f"{description}\n{requirements}".strip()
    years_min, years_max = extract_years(text)
    sal_min, sal_max, sal_cur = extract_salary(text)
    languages = extract_languages(text)
    return {
        "years_min": years_min,
        "years_max": years_max,
        "salary_min": sal_min,
        "salary_max": sal_max,
        "salary_currency": sal_cur,
        "languages_required": languages,
    }
