import { useEffect, useState } from "react";
import { MessageCircle, X, ArrowUpRight } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Phase 2 — Floating Buddy widget. Bottom-right bubble persists on
 * every route (except /buddy itself) so the user can ping Buddy from
 * anywhere without losing their current page state.
 *
 * MVP scope:
 *  - Bubble: 56×56 circle, fixed bottom-right, lucide MessageCircle.
 *  - Panel: slide-in from right, ≈400 px wide, shows 4 starter
 *    prompts + a link to the full /buddy page. Click a starter →
 *    navigates to /buddy with the prompt pre-filled via the
 *    `prefill` URL param.
 *  - Hidden on /buddy (avoid recursion).
 *  - prefers-reduced-motion safe (panel snaps open instead of
 *    sliding).
 *
 * Phase 6 will wire actual chat into the panel (re-use lib/buddy
 * chat helpers + the shim/Gemini fallback). Today the panel is a
 * launcher with curated entry points.
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

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        className={`floating-buddy-panel fixed top-0 right-0 z-40 h-full w-full sm:w-[420px] bg-cinema-cream border-l border-cinema-mint shadow-xl transform transition-transform ${
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-cinema-mint">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-cinema-moss" />
            <span className="text-cinema-eyebrow text-cinema-ink-mute">Buddy</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Buddy panel"
            className="w-9 h-9 rounded-full inline-flex items-center justify-center text-cinema-ink-soft hover:bg-cinema-mint/40"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-5 overflow-y-auto h-[calc(100%-72px)] space-y-5">
          <div>
            <h2 className="text-cinema-h2 text-cinema-ink mb-2">Ask anything about your search.</h2>
            <p className="text-base text-cinema-ink-soft">
              Buddy reads your profile, your applications, and the live job feed before
              answering — so the advice is grounded, not generic.
            </p>
          </div>

          <div>
            <div className="text-cinema-caption text-cinema-ink-mute uppercase tracking-wider mb-3">
              A few places to start
            </div>
            <ul className="space-y-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <a
                    href={`/buddy?prefill=${encodeURIComponent(s)}`}
                    onClick={() => setOpen(false)}
                    className="block w-full text-left text-base text-cinema-ink rounded-glass border border-cinema-mint bg-white px-4 py-3 hover:bg-cinema-mint/40 transition-colors"
                  >
                    {s}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <a
            href="/buddy"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-2 text-base text-cinema-pine font-medium hover:underline"
          >
            Open full Buddy
            <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      </aside>
    </>
  );
}
