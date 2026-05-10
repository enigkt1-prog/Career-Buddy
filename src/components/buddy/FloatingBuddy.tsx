import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X, ArrowUpRight, Send, Loader2 } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

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

/**
 * Phase 2 + 6 — floating Buddy widget with inline chat.
 *
 * Bottom-right bubble on every route except /buddy itself. Click →
 * right-side slide-out panel containing the chat composer + last
 * messages, sharing localStorage history with the full /buddy page
 * via `lib/buddy-chat`.
 *
 * Phase 2 shipped the launcher version (4 starter pills routing to
 * /buddy?prefill=…). Phase 6 swaps in real send/receive using the
 * shared chat-helpers so a quick question doesn't force a route
 * change. The starter pills still appear when the message history
 * is empty.
 *
 * prefers-reduced-motion: slide transition disabled.
 */

const STARTERS = [
  "What should I focus on this week to land my next operator-track role?",
  "Which 3 of my live roles should I apply to first, and why?",
  "Summarise my profile gaps and what to fix in 4 weeks.",
  "Draft a cold outreach to the hiring manager for my top-fit live role.",
];

export function FloatingBuddy() {
  const [open, setOpen] = useState(false);
  const router = useRouterState();
  const pathname = router.location.pathname;
  const onBuddyRoute = pathname === "/buddy";

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaHitAt, setQuotaHitAt] = useState<number | null>(null);
  const [shimOnline, setShimOnline] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Hydrate + probe once when the panel first becomes interactive
  // (we delay until open=true so the bubble itself stays cheap on
  // every page load).
  useEffect(() => {
    if (!open) return;
    setMessages(loadHistory());
    setQuotaHitAt(readQuota());
    void probeShim().then(setShimOnline);
    const id = window.setInterval(() => {
      void probeShim().then(setShimOnline);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    saveHistory(messages);
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quotaActive = useMemo(
    () => !!(quotaHitAt && Date.now() - quotaHitAt < QUOTA_COOLDOWN_MS),
    [quotaHitAt],
  );

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || quotaActive) return;
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
      if (result.quotaHit) {
        const now = Date.now();
        setQuotaHitAt(now);
        writeQuota(now);
      }
      setError(result.error);
    }
  }

  if (onBuddyRoute) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close Buddy panel" : "Open Buddy panel"}
        aria-expanded={open}
        className="floating-buddy-bubble fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-cinema-moss text-cinema-cream inline-flex items-center justify-center border border-cinema-pine hover:bg-cinema-pine transition-colors"
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {open && (
        <button
          type="button"
          aria-label="Close Buddy panel overlay"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/30"
        />
      )}

      <aside
        aria-hidden={!open}
        aria-label="Buddy panel"
        className={`floating-buddy-panel fixed top-0 right-0 z-40 h-full w-full sm:w-[440px] bg-cinema-cream border-l border-cinema-mint shadow-xl transform transition-transform flex flex-col ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-cinema-mint flex-shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-cinema-moss" />
            <span className="text-cinema-eyebrow text-cinema-ink-mute">Buddy</span>
            {shimOnline && (
              <span className="text-cinema-caption text-cinema-pine font-medium ml-1">
                local Claude
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/buddy"
              onClick={() => setOpen(false)}
              aria-label="Open full Buddy page"
              title="Open the full Buddy chat"
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-cinema-ink-soft hover:bg-cinema-mint/40"
            >
              <ArrowUpRight className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Buddy panel"
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-cinema-ink-soft hover:bg-cinema-mint/40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.length === 0 ? (
            <>
              <div>
                <h2 className="text-cinema-h2 text-cinema-ink mb-2">
                  Ask anything about your search.
                </h2>
                <p className="text-base text-cinema-ink-soft">
                  Buddy reads your profile, your applications, and the live job
                  feed before answering.
                </p>
              </div>
              <div>
                <div className="text-cinema-caption text-cinema-ink-mute uppercase tracking-wider mb-3">
                  A few places to start
                </div>
                <ul className="space-y-2">
                  {STARTERS.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => void send(s)}
                        disabled={loading || quotaActive}
                        className="block w-full text-left text-base text-cinema-ink rounded-glass border border-cinema-mint bg-white px-4 py-3 hover:bg-cinema-mint/40 transition-colors disabled:opacity-50"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={`text-base ${
                  m.role === "user"
                    ? "ml-8 bg-cinema-moss text-cinema-cream rounded-glass px-4 py-3"
                    : "mr-8 bg-white text-cinema-ink rounded-glass border border-cinema-mint px-4 py-3 whitespace-pre-wrap"
                }`}
              >
                {m.content}
              </div>
            ))
          )}
          {loading && (
            <div className="mr-8 inline-flex items-center gap-2 text-base text-cinema-ink-mute bg-white rounded-glass border border-cinema-mint px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Buddy is thinking…
            </div>
          )}
          {error && (
            <div role="alert" className="text-base text-red-700 bg-red-50 border border-red-200 rounded-glass px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="border-t border-cinema-mint px-4 py-4 flex gap-2 flex-shrink-0"
        >
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={
              quotaActive
                ? "Quota cooldown — try again later"
                : "Ask Buddy anything…"
            }
            disabled={quotaActive || loading}
            className="flex-1 border border-cinema-mint rounded-glass px-3 py-2 text-base bg-white resize-none focus:outline-none focus:ring-2 focus:ring-cinema-sage disabled:bg-cinema-mist/60 text-cinema-ink"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading || quotaActive}
            aria-label="Send"
            className="w-11 h-11 rounded-full bg-cinema-moss text-cinema-cream inline-flex items-center justify-center hover:bg-cinema-pine disabled:opacity-40 self-end"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </aside>
    </>
  );
}
