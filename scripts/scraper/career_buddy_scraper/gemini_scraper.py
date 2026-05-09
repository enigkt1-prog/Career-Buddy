"""Gemini-powered job extractor with strict no-paid-API budget.

Tier 1: Google AI Studio Free API (15 RPM, 1500 RPD).
Tier 2: ``gemini`` CLI subprocess (uses user's Gemini Pro/Ultra subscription).
Tier 3: raise ``QuotaExhausted`` — never auto-spend.

Use case: take raw HTML from a careers page, return structured ``CanonicalJob``
candidates without writing brittle per-site selectors.

Setup:
    1. Free API key: https://aistudio.google.com/app/apikey
    2. ``echo 'GEMINI_API_KEY=<your-key>' >> .env``
    3. Optional fallback: ``gemini`` CLI installed + logged in to Gemini Pro/Ultra.
    4. ``uv sync --group gemini``
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Free-tier model — generous limits, JSON mode, 1M context.
DEFAULT_MODEL = "gemini-2.5-flash"

# Pro fallback for harder pages (lower free-tier RPD but more reasoning).
PRO_MODEL = "gemini-2.5-pro"


class QuotaExhausted(RuntimeError):
    """All tiers exhausted. Caller must stop, never auto-pay."""


class GeminiScraper:
    """Three-tier Gemini extractor with hard cost-floor at 0€."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        prefer_cli: bool = False,
    ) -> None:
        self.model = model
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.cli_path = shutil.which("gemini")
        self.prefer_cli = prefer_cli

    def extract_jobs(self, html: str, source_url: str) -> list[dict[str, Any]]:
        """Return list of job-dicts extractable from HTML.

        Each dict aligns with ``CanonicalJob`` keys (company_name, role_title,
        url, description, location, ...). Caller maps to CanonicalJob + upserts.
        """
        prompt = self._build_prompt(html, source_url)
        raw = self.query(prompt)
        return self._parse_json(raw)

    def query(self, prompt: str) -> str:
        """Run an arbitrary prompt through the tier chain and return raw text.

        Use this for custom tasks (Tier-2 classification, summarisation, etc.)
        that do not fit the careers-page extraction prompt.
        """
        order = [self._via_cli, self._via_api] if self.prefer_cli else [self._via_api, self._via_cli]

        last_err: Exception | None = None
        for fn in order:
            try:
                return fn(prompt)
            except _QuotaSignal as e:
                log.warning("%s quota exhausted: %s — trying next tier", fn.__name__, e)
                last_err = e
                continue
            except _NotAvailable as e:
                log.info("%s unavailable: %s — trying next tier", fn.__name__, e)
                last_err = e
                continue

        raise QuotaExhausted(
            f"All Gemini tiers exhausted (free API + CLI). Last error: {last_err}. "
            "Stop. NEVER auto-fallback to paid API."
        )

    def query_json(self, prompt: str) -> list[dict[str, Any]]:
        """Run a prompt and parse the response as a JSON list."""
        return self._parse_json(self.query(prompt))

    def _via_api(self, prompt: str) -> str:
        if not self.api_key:
            raise _NotAvailable("GEMINI_API_KEY not set")
        try:
            from google import genai
            from google.genai import types
        except ImportError as e:
            raise _NotAvailable(f"google-genai not installed: {e}") from e

        client = genai.Client(api_key=self.api_key)
        try:
            resp = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
            )
        except Exception as e:
            msg = str(e).lower()
            if "quota" in msg or "rate" in msg or "429" in msg or "resource_exhausted" in msg:
                raise _QuotaSignal(str(e)) from e
            raise

        text = resp.text or ""
        if not text:
            raise _NotAvailable("empty response from API")
        return text

    def _via_cli(self, prompt: str) -> str:
        if not self.cli_path:
            raise _NotAvailable("gemini CLI not on PATH")

        env = {**os.environ, "GEMINI_CLI_TRUST_WORKSPACE": "true"}
        try:
            proc = subprocess.run(
                [self.cli_path, "-m", self.model, "-p", prompt],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
                env=env,
            )
        except subprocess.TimeoutExpired as e:
            raise _NotAvailable(f"gemini CLI timeout: {e}") from e

        if proc.returncode != 0:
            stderr = (proc.stderr or "").lower()
            if "quota" in stderr or "exhausted" in stderr or "429" in stderr:
                raise _QuotaSignal(proc.stderr.strip())
            raise _NotAvailable(f"gemini CLI exit {proc.returncode}: {proc.stderr.strip()}")

        out = proc.stdout.strip()
        if not out:
            raise _NotAvailable("empty stdout from gemini CLI")
        return out

    @staticmethod
    def _parse_json(text: str) -> list[dict[str, Any]]:
        text = text.strip()
        if text.startswith("```"):
            lines = [line for line in text.splitlines() if not line.strip().startswith("```")]
            text = "\n".join(lines).strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            log.error("Gemini returned non-JSON: %s", text[:300])
            raise ValueError(f"Gemini output not valid JSON: {e}") from e

        if isinstance(data, dict) and "jobs" in data:
            data = data["jobs"]
        if not isinstance(data, list):
            raise ValueError(f"Expected JSON list of jobs, got {type(data).__name__}")
        return data

    @staticmethod
    def _build_prompt(html: str, source_url: str) -> str:
        max_html_chars = 200_000
        snippet = html[:max_html_chars]

        return f"""You are a careers-page parser for a job aggregator.

Source URL: {source_url}

HTML below. Extract every distinct job posting visible. Output STRICT JSON:
a list of objects, no prose, no markdown fences.

Schema per object (omit field if not visible — do NOT invent):
- company_name: string
- role_title: string
- url: absolute URL to the job (resolve against source URL if relative)
- location: string or null
- is_remote: boolean
- employment_type: "full-time" | "part-time" | "contract" | "internship" | null
- description: short summary 1-3 sentences (max 500 chars), or null
- posted_date: ISO date YYYY-MM-DD or null

If the page has zero jobs, return [].
If you cannot parse, return [].

HTML:
---
{snippet}
---
Respond with ONLY the JSON list. No preamble.
"""


class _QuotaSignal(RuntimeError):
    pass


class _NotAvailable(RuntimeError):
    pass


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Gemini job-extractor (free-tier + CLI fallback)")
    parser.add_argument("--url", required=True, help="Careers-page URL")
    parser.add_argument("--html-file", help="Local HTML file (skip HTTP fetch)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--prefer-cli", action="store_true", help="Use CLI before API")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")

    if args.html_file:
        html = Path(args.html_file).read_text(encoding="utf-8")
    else:
        import httpx

        log.info("Fetching %s", args.url)
        resp = httpx.get(
            args.url,
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": "Career-Buddy-Gemini-Scraper/0.1"},
        )
        resp.raise_for_status()
        html = resp.text

    scraper = GeminiScraper(model=args.model, prefer_cli=args.prefer_cli)
    jobs = scraper.extract_jobs(html, args.url)

    if args.pretty:
        print(json.dumps(jobs, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(jobs, ensure_ascii=False))


if __name__ == "__main__":
    main()
