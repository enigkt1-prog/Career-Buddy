import { useEffect, useState } from "react";

/**
 * Cinema theme registry — single source of truth for which themes
 * exist + which photography goes with each. Keep in sync with
 * `[data-theme="..."]` blocks in `src/styles/cinema.css` and the
 * `KNOWN_THEMES` set in `src/routes/__root.tsx`.
 *
 * Each theme is a persona — Sage = startup early-stage, Onyx =
 * IB/PE/Late VC, Slate = consulting, Coral = creative/brand. Photo
 * direction matches: Sage = open coworking with plants, Onyx =
 * glass skyscrapers + financial district, Slate = minimal corporate
 * lobby, Coral = warm designer studio.
 *
 * Surface = the page region the photo appears in. `overview`
 * (homepage hero), `profile`, `jobs`, `footer` (cluster behind
 * SiteFooter). Each (theme, surface) combo points at a verified
 * Unsplash ID rendering through Chromium ORB on 2026-05-10.
 */

export type ThemeName = "sage" | "onyx" | "slate" | "coral";
export type PhotoSurface = "overview" | "profile" | "jobs" | "footer";

const THEMES: ThemeName[] = ["sage", "onyx", "slate", "coral"];

function isTheme(value: string | null | undefined): value is ThemeName {
  return !!value && (THEMES as string[]).includes(value);
}

/**
 * Per-theme photography. All Unsplash CDN URLs verified to render
 * (Chromium ORB safe) on 2026-05-10 via browser_network_requests.
 * If an ID stops working, swap it — silent ORB blocks are the
 * usual culprit, not 404s.
 */
const PHOTOS: Record<ThemeName, Record<PhotoSurface, string>> = {
  sage: {
    overview: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=2400&q=80",
    profile:  "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=2400&q=80",
    jobs:     "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=2400&q=80",
    footer:   "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=2400&q=80",
  },
  onyx: {
    // Glass skyscrapers / financial-district / boardroom-at-dusk.
    overview: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=2400&q=80",
    profile:  "https://images.unsplash.com/photo-1444084316824-dc26d6657664?auto=format&fit=crop&w=2400&q=80",
    jobs:     "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?auto=format&fit=crop&w=2400&q=80",
    footer:   "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=2400&q=80",
  },
  slate: {
    // Minimal corporate / monochrome lobbies / clean boardrooms.
    overview: "https://images.unsplash.com/photo-1497215842964-222b430dc094?auto=format&fit=crop&w=2400&q=80",
    profile:  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=2400&q=80",
    jobs:     "https://images.unsplash.com/photo-1531497865144-0464ef8fb9a9?auto=format&fit=crop&w=2400&q=80",
    footer:   "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=2400&q=80",
  },
  coral: {
    // Warm designer studios / brand agency / golden-hour interiors.
    overview: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=2400&q=80",
    profile:  "https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=2400&q=80",
    jobs:     "https://images.unsplash.com/photo-1486718448742-163732cd1544?auto=format&fit=crop&w=2400&q=80",
    footer:   "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=2400&q=80",
  },
};

/**
 * Read current theme from `<html data-theme>`. Re-renders on theme
 * change via a MutationObserver on the root element. Always starts
 * at `"sage"` on first render (server + client) so hydration never
 * mismatches; the post-mount effect picks up the actual theme that
 * `__root.tsx` wrote and swaps the rendered output without flicker
 * inside a single tick.
 */
export function useTheme(): ThemeName {
  const [theme, setTheme] = useState<ThemeName>("sage");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const initial = root.getAttribute("data-theme");
    if (isTheme(initial) && initial !== theme) setTheme(initial);

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          const next = root.getAttribute("data-theme");
          if (isTheme(next)) setTheme(next);
        }
      }
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return theme;
}

/**
 * Pick the Unsplash URL for a (theme, surface) pair. Theme defaults
 * to whatever `useTheme()` reports if omitted; surface defaults to
 * `overview`. Use this in route components to keep CinematicHero +
 * SiteFooter image props in sync with the active theme.
 */
export function usePhoto(surface: PhotoSurface = "overview", theme?: ThemeName): string {
  const active = useTheme();
  const t = theme ?? active;
  return PHOTOS[t]?.[surface] ?? PHOTOS.sage[surface];
}

/** Read the URL string for a theme + surface without subscribing. */
export function photoFor(theme: ThemeName, surface: PhotoSurface): string {
  return PHOTOS[theme]?.[surface] ?? PHOTOS.sage[surface];
}
