"""Local HTTP shim for Career-Buddy chat → Claude CLI subprocess.

Why: hard rule says no Anthropic API auto-pay. The user's Claude Code CLI
runs against a Max-20x OAuth subscription (not the API). This shim exposes
a tiny HTTP endpoint at http://localhost:5051/chat that the browser hits;
each request shells out to ``claude --print`` with the user's profile +
applications + chat history baked into a system prompt.

Run:
    uv run python scripts/claude_cli_shim.py
    # or
    python3 scripts/claude_cli_shim.py

Browser fallback chain: shim (Claude Opus) → Supabase ``chat`` (Gemini).
The shim CORS-allows the live URL + localhost so it works from prod and dev.

This file is intentionally dependency-free (stdlib only) so ``python3 ...``
just runs without uv.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PORT = int(os.environ.get("CAREER_BUDDY_SHIM_PORT", "5051"))
ALLOWED_ORIGINS = {
    "http://localhost:8080",
    "http://localhost:5173",
    "https://career-buddy.enigkt1.workers.dev",
}

SYSTEM_PROMPT = """You are Career-Buddy, a coach for one user (a business-background graduate hunting their first non-engineering startup role).

You have the user's profile, recent applications, and (optionally) a single job posting picked from their feed. Use ONLY the supplied context — do not invent facts.

Rules:
- Be direct, concrete, and short. Prefer ranked lists and one-line takeaways.
- When the user asks "what should I do today?", point to specific roles + applications by name.
- When asked about a job they're not yet applied to, weigh fit (role-cat, location, years, skills) and tell them whether to apply, what to mention, and what blockers to address.
- When asked to draft, keep ≤150 words.
- Match the language of the user's last message (German or English).
- If you cannot answer with the supplied context, say so.
"""


def _summarise_profile(p: dict[str, Any] | None) -> str:
    if not p:
        return "(no profile yet)"
    parts: list[str] = []
    for label, key in (
        ("name", "name"), ("headline", "headline"), ("target role", "target_role"),
        ("target geo", "target_geo"), ("background", "background"),
    ):
        v = p.get(key)
        if isinstance(v, str) and v.strip():
            parts.append(f"{label}: {v}")
    if isinstance(p.get("strengths"), list):
        parts.append("strengths: " + ", ".join(str(s) for s in p["strengths"][:6]))
    if isinstance(p.get("gaps"), list):
        parts.append("gaps: " + ", ".join(str(s) for s in p["gaps"][:4]))
    wh = p.get("work_history") or []
    if isinstance(wh, list) and wh:
        parts.append("recent positions:")
        for w in wh[:3]:
            if not isinstance(w, dict):
                continue
            parts.append(
                f"- {w.get('role','')} @ {w.get('company','')} "
                f"({w.get('start_date','')}–{w.get('end_date','')})"
            )
    return "\n".join(parts)


def _summarise_apps(apps: list[dict[str, Any]] | None) -> str:
    if not apps:
        return "(no applications yet)"
    return "\n".join(
        f"- {a.get('company','?')} · {a.get('role','?')} · {a.get('status','?')}"
        f" · last_event={a.get('last_event','?')}"
        for a in apps[:12]
    )


def _summarise_job(j: dict[str, Any] | None) -> str:
    if not j:
        return ""
    desc = (j.get("description") or "")[:4000]
    reqs = (j.get("requirements") or "")[:1500]
    return (
        f"Company: {j.get('company','')}\n"
        f"Role: {j.get('role','')}\n"
        f"Location: {j.get('location','')}\n"
        f"Description: {desc}\n"
        f"{('Requirements: ' + reqs) if reqs else ''}"
    )


def _build_full_prompt(payload: dict[str, Any]) -> str:
    profile = payload.get("profile")
    apps = payload.get("applications")
    job = payload.get("job")
    messages = payload.get("messages") or []

    context = "\n\n".join(filter(None, [
        "## CANDIDATE PROFILE\n" + _summarise_profile(profile),
        "## RECENT APPLICATIONS\n" + _summarise_apps(apps),
        ("## JOB IN FOCUS\n<jd>\n" + _summarise_job(job) + "\n</jd>") if job else "",
    ]))

    transcript_lines: list[str] = []
    for m in messages[:-1] if messages else []:
        role = "User" if m.get("role") == "user" else "Career-Buddy"
        transcript_lines.append(f"{role}: {m.get('content','')}")
    transcript = "\n\n".join(transcript_lines)

    last_user = messages[-1].get("content", "") if messages else ""

    parts: list[str] = [SYSTEM_PROMPT, "", context]
    if transcript:
        parts.append("## CONVERSATION SO FAR\n" + transcript)
    parts.append("## NEW USER MESSAGE\n" + last_user)
    parts.append(
        "Respond directly to the user. Do not include any meta commentary or framing."
    )
    return "\n\n".join(parts)


def _run_claude(prompt: str) -> tuple[int, str, str]:
    cmd = ["claude", "--print", "--permission-mode", "bypassPermissions"]
    proc = subprocess.run(
        cmd,
        input=prompt,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # quieter logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def _set_cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            body = json.dumps({"ok": True, "model": "claude-cli"}).encode()
            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self._set_cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/chat":
            self.send_response(404)
            self._set_cors()
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid json body"})
            return
        if not isinstance(payload.get("messages"), list) or not payload["messages"]:
            self._json(400, {"error": "messages[] required"})
            return
        prompt = _build_full_prompt(payload)
        try:
            code, stdout, stderr = _run_claude(prompt)
        except subprocess.TimeoutExpired:
            self._json(504, {"error": "claude CLI timeout"})
            return
        except FileNotFoundError:
            self._json(500, {"error": "claude CLI not on PATH"})
            return
        if code != 0:
            self._json(502, {"error": f"claude exited {code}", "stderr": stderr[-500:]})
            return
        if not stdout:
            self._json(502, {"error": "claude returned empty"})
            return
        self._json(200, {"reply": stdout, "model": "claude-cli"})

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self._set_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(
        f"[claude-shim] listening on http://127.0.0.1:{PORT}\n"
        f"[claude-shim] POST /chat → claude CLI subprocess\n"
        f"[claude-shim] GET /health → {{ok: true}}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
