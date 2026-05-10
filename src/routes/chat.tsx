import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "Career-Buddy — Chat" },
      { name: "description", content: "Ask Career-Buddy what to do next." },
    ],
  }),
});

const STORAGE_KEY = "career-buddy-state";
const CHAT_KEY = "career-buddy-chat-v1";
const QUOTA_KEY = "career-buddy-chat-quota-v1";
const QUOTA_COOLDOWN_MS = 4 * 3600 * 1000;
const SHIM_URL = "http://127.0.0.1:5051";

type ChatMsg = { role: "user" | "assistant"; content: string; ts: number };

const SUGGESTED = [
  "What should I focus on this week to land a Founders Associate role in Berlin?",
  "Which 3 of my live roles should I apply to first, and why?",
  "Summarise my profile gaps and what to fix in 4 weeks.",
  "Draft a cold outreach to a Berlin VC for a Founders Associate role.",
];

function loadHistory(): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMsg[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(msgs: ChatMsg[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-50)));
  } catch {}
}

function readQuota(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { quotaHitAt?: number };
    if (!parsed?.quotaHitAt) return null;
    if (Date.now() - parsed.quotaHitAt > QUOTA_COOLDOWN_MS) return null;
    return parsed.quotaHitAt;
  } catch {
    return null;
  }
}

function writeQuota(quotaHitAt: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ quotaHitAt }));
  } catch {}
}

function loadProfileAndApps(): { profile: unknown; applications: unknown[] } {
  if (typeof window === "undefined") return { profile: undefined, applications: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

async function probeShim(): Promise<boolean> {
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

function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaHitAt, setQuotaHitAt] = useState<number | null>(null);
  const [shimOnline, setShimOnline] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(loadHistory());
    setQuotaHitAt(readQuota());
    void probeShim().then(setShimOnline);
    // Re-probe every 30s so toggling the shim on/off is reflected.
    const id = window.setInterval(() => {
      void probeShim().then(setShimOnline);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    saveHistory(messages);
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  const quotaActive = useMemo(
    () => !!(quotaHitAt && Date.now() - quotaHitAt < QUOTA_COOLDOWN_MS),
    [quotaHitAt],
  );

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: ChatMsg[] = [...messages, { role: "user", content: trimmed, ts: Date.now() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { profile, applications } = loadProfileAndApps();
      const apiMessages = next.map((m) => ({ role: m.role, content: m.content }));
      // Path 1: prefer the local Claude CLI shim (Max-sub OAuth, no API key).
      if (shimOnline) {
        try {
          const r = await fetch(`${SHIM_URL}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: apiMessages, profile, applications }),
          });
          if (r.ok) {
            const payload = (await r.json()) as { reply?: string };
            if (payload?.reply) {
              setMessages((m) => [
                ...m,
                { role: "assistant", content: payload.reply!, ts: Date.now() },
              ]);
              return;
            }
          }
          // shim returned non-2xx → fall through to Gemini
        } catch {
          // shim offline mid-call → fall through
        }
      }
      // Path 2: Gemini via Supabase edge function.
      const { data, error: fnErr } = await supabase.functions.invoke("chat", {
        body: { messages: apiMessages, profile, applications },
      });
      if (fnErr) {
        const status = (fnErr as { context?: { status?: number } })?.context?.status;
        if (status === 429) tripQuota();
        throw fnErr;
      }
      const payload = data as { reply?: string; error?: string };
      if (!payload?.reply) {
        const errMsg = payload?.error || "No reply";
        if (/quota/i.test(errMsg)) tripQuota();
        throw new Error(errMsg);
      }
      setMessages((m) => [...m, { role: "assistant", content: payload.reply!, ts: Date.now() }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      if (/(?:^|\s)429(?:\s|$)|quota/i.test(msg)) tripQuota();
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function tripQuota() {
    const now = Date.now();
    setQuotaHitAt(now);
    writeQuota(now);
  }

  function clearChat() {
    if (window.confirm("Clear this chat?")) {
      setMessages([]);
      setError(null);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-6 flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>
      <header className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Career-Buddy chat</h1>
          <p className="text-sm text-gray-500">
            Asks your profile, applications, and live job feed.{" "}
            {shimOnline ? (
              <span className="text-purple-700">Powered by local Claude (Max sub).</span>
            ) : (
              <span>Powered by Gemini 2.5-flash. Run <code className="text-[11px] bg-gray-100 px-1 rounded">python3 scripts/claude_cli_shim.py</code> for Claude.</span>
            )}
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} className="text-xs text-gray-400 underline hover:text-gray-700">
            Clear
          </button>
        )}
      </header>

      {quotaActive && (
        <div className="mb-3 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
          Gemini free-tier quota hit — resumes around midnight Pacific. Try again later.
        </div>
      )}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto bg-white border rounded-xl p-4 space-y-3"
      >
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Ask anything about your search. Some starters:</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={quotaActive}
                  className="text-left text-xs p-3 rounded-lg border bg-gray-50 hover:bg-purple-50 hover:border-purple-200 disabled:opacity-50"
                >
                  <Sparkles className="inline w-3.5 h-3.5 mr-1 text-purple-500" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl px-4 py-2.5 bg-gray-100 text-gray-600 text-sm flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={quotaActive ? "Quota cooldown — try again later" : "Ask Career-Buddy…"}
          disabled={quotaActive || loading}
          className="flex-1 border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading || quotaActive}
          className="px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          style={{ backgroundColor: "#7c3aed" }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send
        </button>
      </form>
      <p className="mt-2 text-[10px] text-gray-400">
        Conversation lives in localStorage. Profile + applications are sent with each request so the
        model can ground its answers.
      </p>
    </main>
  );
}
