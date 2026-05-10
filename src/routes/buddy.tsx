import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";

import { GlassCard } from "@/components/cinema";
import { VoiceMic } from "@/components/voice/VoiceMic";
import {
  loadHistory,
  probeShim,
  QUOTA_COOLDOWN_MS,
  readQuota,
  saveHistory,
  sendBuddyMessage,
  writeQuota,
  type ChatMsg,
} from "@/components/buddy/chat-helpers";

export const Route = createFileRoute("/buddy")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "Career-Buddy — Buddy" },
      { name: "description", content: "Talk to Buddy — ask anything about your search, your CV, your next role." },
    ],
  }),
});

const SUGGESTED = [
  "What should I focus on this week to land my next operator-track role?",
  "Which 3 of my live roles should I apply to first, and why?",
  "Summarise my profile gaps and what to fix in 4 weeks.",
  "Draft a cold outreach to the hiring manager for my top-fit live role.",
];

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
    // Phase 2 floating-Buddy entry point: when the panel dispatches a
    // starter prompt via /buddy?prefill=…, seed the composer so the
    // user lands ready to send.
    if (typeof window !== "undefined") {
      const prefill = new URL(window.location.href).searchParams.get("prefill");
      if (prefill) setInput(prefill);
    }
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
    const result = await sendBuddyMessage({ messages: next, shimOnline });
    setLoading(false);
    if (result.ok) {
      setMessages((m) => [...m, { role: "assistant", content: result.reply, ts: Date.now() }]);
    } else {
      if (result.quotaHit) tripQuota();
      setError(result.error);
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
    <div className="bg-cinema-mist">
      <section className="max-w-4xl mx-auto px-6 md:px-12 pt-16 md:pt-24 pb-8">
        <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
          Talk to Buddy
        </div>
        <h1 className="text-cinema-h1 mb-4">
          <span className="cinema-headline-underline">Ask anything</span> about
          your search.
        </h1>
        <p className="text-cinema-body max-w-2xl">
          Buddy reads your profile, your applications, and the live job feed
          before answering — so the advice is grounded, not generic.{" "}
          {shimOnline ? (
            <span className="text-cinema-pine font-medium">
              Powered by local Claude (Max sub).
            </span>
          ) : (
            <>
              Powered by Gemini 2.5-flash. Run{" "}
              <code className="text-[0.85rem] bg-cinema-mint/60 text-cinema-ink px-1.5 py-0.5 rounded">
                python3 scripts/claude_cli_shim.py
              </code>{" "}
              for Claude.
            </>
          )}
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 md:px-12 pb-24">
        <GlassCard variant="cream" padding="lg" className="md:p-8">
          {quotaActive && (
            <div className="mb-4 text-base text-cinema-pine bg-cinema-mint/60 border border-cinema-sage/40 rounded-glass px-4 py-3">
              Gemini free-tier quota hit — resumes around midnight Pacific.
              Try again later.
            </div>
          )}

          <div
            ref={scrollerRef}
            className="bg-white/70 border border-cinema-mint rounded-glass p-5 space-y-3 min-h-[40vh] max-h-[60vh] overflow-y-auto"
          >
            {messages.length === 0 && !loading && (
              <div className="space-y-3">
                <p className="text-cinema-body">A few places to start:</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={quotaActive}
                      className="text-left text-base p-3.5 rounded-glass border border-cinema-mint bg-cinema-mist/60 hover:bg-cinema-mint/60 hover:border-cinema-sage text-cinema-ink-soft disabled:opacity-50 transition-colors"
                    >
                      <Sparkles className="inline w-4 h-4 mr-1 text-cinema-pine" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={`max-w-[85%] rounded-glass px-4 py-2.5 text-base whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-cinema-moss text-cinema-cream"
                      : "bg-cinema-mint/70 text-cinema-ink"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-glass px-4 py-2.5 bg-cinema-mint/70 text-cinema-ink-soft text-base flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                </div>
              </div>
            )}

            {error && (
              <div className="text-base text-destructive bg-red-50 border border-red-200 rounded-glass px-3 py-2">
                {error}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-4 flex gap-2"
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
              placeholder={
                quotaActive
                  ? "Quota cooldown — try again later"
                  : "Ask Buddy anything…"
              }
              disabled={quotaActive || loading}
              className="flex-1 border border-cinema-mint rounded-glass px-4 py-3 text-base bg-white/80 resize-none focus:outline-none focus:ring-2 focus:ring-cinema-sage disabled:bg-cinema-mist/60 text-cinema-ink"
            />
            <div className="flex flex-col gap-2 self-stretch justify-end">
              <VoiceMic
                onTranscript={(text) =>
                  setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
                }
                disabled={loading || quotaActive}
                label="Dictate to Buddy"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading || quotaActive}
                className="pill-cta disabled:opacity-40"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send
              </button>
            </div>
          </form>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-cinema-caption">
              Conversation lives in localStorage. Profile + applications are sent
              with each request so the model can ground its answers.
            </p>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-base text-cinema-ink-mute underline hover:text-cinema-ink"
              >
                Clear
              </button>
            )}
          </div>
        </GlassCard>
      </section>
    </div>
  );
}
