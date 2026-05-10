import { supabase } from "@/integrations/supabase/client";

/**
 * Shared Buddy-chat helpers. Phase 6 — used by both `/buddy` (full
 * page) and the FloatingBuddy panel (inline mini-chat) so both
 * surfaces share one message history, one quota, and one local-shim
 * → Gemini fallback path.
 *
 * Storage shape:
 *  - `career-buddy-chat-v1` → ChatMsg[]   (last 50 messages)
 *  - `career-buddy-chat-quota-v1` → { quotaHitAt }  (4h cooldown)
 *  - `career-buddy-state`     → CareerBuddy localStorage, read for
 *    profile + applications context on every send.
 */

export const STORAGE_KEY = "career-buddy-state";
export const CHAT_KEY = "career-buddy-chat-v1";
export const QUOTA_KEY = "career-buddy-chat-quota-v1";
export const QUOTA_COOLDOWN_MS = 4 * 3600 * 1000;
export const SHIM_URL = "http://127.0.0.1:5051";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  ts: number;
};

export function loadHistory(): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMsg[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(msgs: ChatMsg[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-50)));
  } catch {
    /* ignore quota */
  }
}

export function readQuota(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(QUOTA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { quotaHitAt?: number };
    if (!parsed?.quotaHitAt) return null;
    if (Date.now() - parsed.quotaHitAt > QUOTA_COOLDOWN_MS) return null;
    return parsed.quotaHitAt;
  } catch {
    return null;
  }
}

export function writeQuota(quotaHitAt: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUOTA_KEY, JSON.stringify({ quotaHitAt }));
  } catch {
    /* ignore */
  }
}

export function loadProfileAndApps(): { profile: unknown; applications: unknown[] } {
  if (typeof window === "undefined") return { profile: undefined, applications: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profile: undefined, applications: [] };
    const parsed = JSON.parse(raw) as { profile?: unknown; applications?: unknown[] };
    return {
      profile: parsed?.profile,
      applications: Array.isArray(parsed?.applications) ? parsed.applications : [],
    };
  } catch {
    return { profile: undefined, applications: [] };
  }
}

export async function probeShim(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${SHIM_URL}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export type SendResult =
  | { ok: true; reply: string }
  | { ok: false; error: string; quotaHit: boolean };

/**
 * Send a chat turn. Tries the local Claude shim first (preferred —
 * uses the Max-sub OAuth, no API key), then falls back to the
 * `chat` Supabase edge function (Gemini 2.5-flash) on failure.
 *
 * Returns a discriminated result. The caller is responsible for
 * persisting the appended assistant message into the local history
 * and tripping the quota cooldown if `quotaHit` is true.
 */
export async function sendBuddyMessage(opts: {
  messages: ChatMsg[];
  shimOnline: boolean;
}): Promise<SendResult> {
  const { messages, shimOnline } = opts;
  const { profile, applications } = loadProfileAndApps();
  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  if (shimOnline) {
    try {
      const r = await fetch(`${SHIM_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, profile, applications }),
      });
      if (r.ok) {
        const payload = (await r.json()) as { reply?: string };
        if (payload?.reply) return { ok: true, reply: payload.reply };
      }
      // non-2xx → fall through to Gemini
    } catch {
      // shim offline mid-call → fall through
    }
  }

  try {
    const { data, error: fnErr } = await supabase.functions.invoke("chat", {
      body: { messages: apiMessages, profile, applications },
    });
    if (fnErr) {
      const status = (fnErr as { context?: { status?: number } })?.context?.status;
      const message = fnErr instanceof Error ? fnErr.message : "Chat failed";
      return { ok: false, error: message, quotaHit: status === 429 || /quota/i.test(message) };
    }
    const payload = data as { reply?: string; error?: string };
    if (!payload?.reply) {
      const errMsg = payload?.error || "No reply";
      return { ok: false, error: errMsg, quotaHit: /quota/i.test(errMsg) };
    }
    return { ok: true, reply: payload.reply };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat failed";
    return {
      ok: false,
      error: message,
      quotaHit: /(?:^|\s)429(?:\s|$)|quota/i.test(message),
    };
  }
}
