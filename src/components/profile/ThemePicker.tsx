import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { persistTheme, useTheme, type ThemeName } from "@/lib/cinema-theme";
import { cn } from "@/lib/utils";

/**
 * Theme picker — 4-chip selector that swaps the active cinema
 * theme without requiring a `?theme=` URL param. Writes to
 * `localStorage["career-buddy-theme-v1"]` and sets
 * `document.documentElement.dataset.theme`. The cinema palette + the
 * per-theme photography library (`src/lib/cinema-theme.ts`) react
 * automatically via the MutationObserver in `useTheme()`.
 *
 * Each chip carries a tiny swatch row (moss · pine · meadow) so the
 * user sees the palette before committing.
 */

type Persona = {
  id: ThemeName;
  label: string;
  hint: string;
  /** [moss, pine, meadow] — three swatches drawn straight from the theme. */
  swatch: [string, string, string];
};

const PERSONAS: Persona[] = [
  {
    id: "sage",
    label: "Sage · Startup operator",
    hint: "Open coworking + soft greens. Founders Associate, BizOps, founding ops.",
    swatch: ["#1c2620", "#4a6b58", "#93cf83"],
  },
  {
    id: "onyx",
    label: "Onyx · IB / PE / Late VC",
    hint: "Glass skyscrapers + deep navy + warm gold. Quiet luxury.",
    swatch: ["#0a1018", "#293c5b", "#d39d4d"],
  },
  {
    id: "slate",
    label: "Slate · Consulting",
    hint: "Cool monochrome boardrooms + corporate-blue accent. McKinsey-quiet.",
    swatch: ["#15171b", "#525a64", "#3d6dc7"],
  },
  {
    id: "coral",
    label: "Coral · Brand / Creative / D2C",
    hint: "Warm peach + terracotta + bright coral. Friendly, designer-y.",
    swatch: ["#3a1e1e", "#824132", "#e2796b"],
  },
];

const STORAGE_KEY = "career-buddy-theme-v1";

export function ThemePicker() {
  const active = useTheme();
  const [busy, setBusy] = useState<ThemeName | null>(null);

  useEffect(() => {
    if (!busy) return;
    const id = window.setTimeout(() => setBusy(null), 350);
    return () => window.clearTimeout(id);
  }, [busy]);

  function pick(id: ThemeName) {
    if (typeof document === "undefined") return;
    setBusy(id);
    document.documentElement.setAttribute("data-theme", id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    // Cross-device persistence via Supabase user_tracks (migration 0011).
    // Fire-and-forget — localStorage is the canonical store while
    // offline and the upsert swallows network failures internally.
    void persistTheme(id);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PERSONAS.map((p) => {
          const isActive = active === p.id;
          const isBusy = busy === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              className={cn(
                "rounded-glass border p-5 text-left transition-colors",
                isActive
                  ? "bg-cinema-moss text-cinema-cream border-cinema-moss"
                  : "bg-white border-cinema-mint text-cinema-ink hover:bg-cinema-mint/60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-base">{p.label}</div>
                  <div
                    className={cn(
                      "text-base mt-1",
                      isActive ? "text-cinema-cream/85" : "text-cinema-ink-mute",
                    )}
                  >
                    {p.hint}
                  </div>
                </div>
                {isActive && (
                  <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-cinema-cream/20">
                    <Check className="w-4 h-4 text-cinema-cream" />
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                {p.swatch.map((color, idx) => (
                  <span
                    key={idx}
                    className={cn(
                      "inline-block w-7 h-7 rounded-full border",
                      isActive ? "border-cinema-cream/30" : "border-black/10",
                    )}
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                ))}
                {isBusy && (
                  <span
                    className={cn(
                      "ml-2 text-base",
                      isActive ? "text-cinema-cream/80" : "text-cinema-ink-mute",
                    )}
                  >
                    swapping…
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-cinema-caption">
        Theme swaps colour palette + hero photography across every page.
        Saved locally; once Phase 1.6 wires up Supabase auth, the choice
        follows your account across devices.
      </p>
    </div>
  );
}
