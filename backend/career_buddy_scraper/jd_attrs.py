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


# ============================================================
# Level (intern / junior / mid / senior / lead / principal / executive)
# ============================================================

# Order matters — match the most specific first. Intern beats junior, exec beats lead.
_LEVEL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("executive", re.compile(r"\b(c[-\s]?level|cxo|chief\s+\w+\s+officer|vp\b|vice\s+president|svp|evp|head\s+of\s+\w+)\b", re.I)),
    ("principal", re.compile(r"\bprincipal\b", re.I)),
    ("lead", re.compile(r"\b(lead|staff|director)\b", re.I)),
    ("senior", re.compile(r"\b(senior|sr\.?)\b", re.I)),
    ("intern", re.compile(r"\b(intern|internship|werkstud|praktikant|stagiaire|stage|trainee\b)", re.I)),
    ("junior", re.compile(r"\b(junior|jr\.?|entry[-\s]?level|graduate|associate|analyst)\b", re.I)),
]


def extract_level(role_title: str, description: str = "") -> str | None:
    """Pick the most specific level from role_title; fall back to description."""
    if not role_title:
        return None
    for label, pat in _LEVEL_PATTERNS:
        if pat.search(role_title):
            return label
    if description:
        for label, pat in _LEVEL_PATTERNS:
            if pat.search(description[:500]):
                return label
    return None


# ============================================================
# Country / city — parsed from raw location string.
# ============================================================

# Common country names + ISO-like aliases. Lowercase keys.
_COUNTRY_ALIASES: dict[str, str] = {
    "germany": "Germany", "deutschland": "Germany", "de": "Germany",
    "united kingdom": "United Kingdom", "uk": "United Kingdom", "england": "United Kingdom", "scotland": "United Kingdom",
    "united states": "United States", "usa": "United States", "us": "United States", "u.s.": "United States",
    "france": "France",
    "spain": "Spain", "españa": "Spain",
    "italy": "Italy", "italia": "Italy",
    "netherlands": "Netherlands", "the netherlands": "Netherlands", "holland": "Netherlands",
    "switzerland": "Switzerland", "schweiz": "Switzerland",
    "austria": "Austria", "österreich": "Austria",
    "ireland": "Ireland",
    "belgium": "Belgium", "belgique": "Belgium",
    "portugal": "Portugal",
    "denmark": "Denmark", "dänemark": "Denmark",
    "sweden": "Sweden",
    "norway": "Norway",
    "finland": "Finland",
    "poland": "Poland",
    "canada": "Canada",
    "australia": "Australia",
    "singapore": "Singapore",
    "japan": "Japan",
    "india": "India",
    "brazil": "Brazil",
    "mexico": "Mexico",
}

# City → canonical country (used when location only mentions a city).
_CITY_TO_COUNTRY: dict[str, tuple[str, str]] = {
    "berlin": ("Berlin", "Germany"),
    "munich": ("Munich", "Germany"), "münchen": ("Munich", "Germany"),
    "hamburg": ("Hamburg", "Germany"),
    "frankfurt": ("Frankfurt", "Germany"),
    "köln": ("Cologne", "Germany"), "cologne": ("Cologne", "Germany"),
    "düsseldorf": ("Düsseldorf", "Germany"), "dusseldorf": ("Düsseldorf", "Germany"),
    "stuttgart": ("Stuttgart", "Germany"),
    "vienna": ("Vienna", "Austria"), "wien": ("Vienna", "Austria"),
    "zurich": ("Zurich", "Switzerland"), "zürich": ("Zurich", "Switzerland"),
    "geneva": ("Geneva", "Switzerland"), "genf": ("Geneva", "Switzerland"),
    "amsterdam": ("Amsterdam", "Netherlands"),
    "rotterdam": ("Rotterdam", "Netherlands"),
    "paris": ("Paris", "France"),
    "lyon": ("Lyon", "France"),
    "london": ("London", "United Kingdom"),
    "manchester": ("Manchester", "United Kingdom"),
    "edinburgh": ("Edinburgh", "United Kingdom"),
    "dublin": ("Dublin", "Ireland"),
    "madrid": ("Madrid", "Spain"),
    "barcelona": ("Barcelona", "Spain"),
    "milan": ("Milan", "Italy"), "milano": ("Milan", "Italy"),
    "rome": ("Rome", "Italy"), "roma": ("Rome", "Italy"),
    "stockholm": ("Stockholm", "Sweden"),
    "copenhagen": ("Copenhagen", "Denmark"),
    "oslo": ("Oslo", "Norway"),
    "helsinki": ("Helsinki", "Finland"),
    "warsaw": ("Warsaw", "Poland"), "warszawa": ("Warsaw", "Poland"),
    "lisbon": ("Lisbon", "Portugal"), "lissabon": ("Lisbon", "Portugal"),
    "brussels": ("Brussels", "Belgium"), "brussel": ("Brussels", "Belgium"),
    "new york": ("New York", "United States"), "nyc": ("New York", "United States"),
    "san francisco": ("San Francisco", "United States"), "sf": ("San Francisco", "United States"),
    "los angeles": ("Los Angeles", "United States"),
    "toronto": ("Toronto", "Canada"),
    "vancouver": ("Vancouver", "Canada"),
    "sydney": ("Sydney", "Australia"),
    "melbourne": ("Melbourne", "Australia"),
}


def extract_location(location: str | None) -> tuple[str | None, str | None, bool]:
    """Parse ``location`` into ``(city, country, is_international)``.

    is_international = True when more than one canonical city OR more than one country
    is mentioned in the field — typical signal for "Berlin · London · Remote".
    """
    if not location:
        return None, None, False
    lower = location.lower()
    cities_found: list[tuple[str, str]] = []
    for key, (city, country) in _CITY_TO_COUNTRY.items():
        if re.search(rf"\b{re.escape(key)}\b", lower):
            cities_found.append((city, country))

    countries_explicit: list[str] = []
    for key, canonical in _COUNTRY_ALIASES.items():
        if re.search(rf"\b{re.escape(key)}\b", lower):
            if canonical not in countries_explicit:
                countries_explicit.append(canonical)

    distinct_countries: set[str] = {c for _, c in cities_found} | set(countries_explicit)
    is_international = (
        len({(c, co) for c, co in cities_found}) >= 2
        or len(distinct_countries) >= 2
    )

    if cities_found:
        city, country = cities_found[0]
        return city, country, is_international
    if countries_explicit:
        return None, countries_explicit[0], is_international
    return None, None, is_international


# ============================================================
# Visa sponsorship (true / false / unknown)
# ============================================================

_VISA_NEG = re.compile(
    r"(no\s+visa\s+sponsorship|cannot\s+sponsor|will\s+not\s+sponsor|"
    r"unable\s+to\s+sponsor|no\s+sponsorship\s+(?:available|provided))",
    re.I,
)
_VISA_POS = re.compile(
    r"(visa\s+sponsorship|will\s+sponsor|happy\s+to\s+sponsor|sponsorship\s+available|"
    r"we\s+(?:can|will)\s+sponsor|relocation\s+(?:assistance|support)\s+(?:available|provided)|"
    r"visumsponsoring|visa\s+support)",
    re.I,
)


def extract_visa_sponsorship(text: str) -> bool | None:
    if not text:
        return None
    if _VISA_NEG.search(text):
        return False
    if _VISA_POS.search(text):
        return True
    return None


# ============================================================
# Combined v2: extract_more() returns the new attributes.
# ============================================================


def extract_more(role_title: str, location: str | None, description: str, requirements: str = "") -> dict[str, object]:
    """Return the level/country/city/visa/international block."""
    full = f"{description}\n{requirements}".strip()
    level = extract_level(role_title, description)
    city, country, is_intl = extract_location(location)
    visa = extract_visa_sponsorship(full)
    return {
        "level": level,
        "country": country,
        "city": city,
        "visa_sponsorship": visa,
        "is_international": is_intl,
    }
