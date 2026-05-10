import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Nav } from "@/components/Nav";
import { PromoBar, SiteFooter } from "@/components/cinema";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#1c2620" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Career-Buddy" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { title: "Career-Buddy" },
      { name: "description", content: "Career-Buddy — application tracker for business-background grads chasing Founders Associate, BizOps, Strategy and BD roles." },
      { property: "og:title", content: "Career-Buddy" },
      { property: "og:description", content: "Land your first startup role." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/favicon.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Cinema theme registry — keep in sync with the [data-theme="..."]
// blocks in src/styles/cinema.css. Sage is the default; the rest
// are opt-in via ?theme=<name>:
//   sage  — Startup early-stage / Operator-track (default).
//   onyx  — IB / PE / Late-stage VC; navy + gold; office-at-dusk.
//   slate — Consulting (MBB / Tier-2); cool monochrome + corporate-blue.
//   coral — Creative / Brand / Product-at-D2C; warm peach + coral.
const KNOWN_THEMES = new Set(["sage", "onyx", "slate", "coral"]);

function readThemeFromUrl(): string {
  if (typeof window === "undefined") return "sage";
  try {
    const param = new URL(window.location.href).searchParams.get("theme");
    if (param && KNOWN_THEMES.has(param)) return param;
    const stored = window.localStorage.getItem("career-buddy-theme-v1");
    if (stored && KNOWN_THEMES.has(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "sage";
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    // Default attribute is `sage` so SSR + first-paint render the
    // existing theme. The client effect in <RootComponent/> swaps to
    // the requested theme without a hydration mismatch (it just
    // re-writes the attribute on a DOM node).
    <html lang="en" data-theme="sage">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const theme = readThemeFromUrl();
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("career-buddy-theme-v1", theme);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.location.hostname === "localhost") return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] register failed", err);
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex flex-col bg-cinema-mist">
        <PromoBar
          message="9,980 live operator-track roles · refreshed every night"
          href="/jobs"
          cta="See all"
        />
        <Nav />
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </QueryClientProvider>
  );
}
