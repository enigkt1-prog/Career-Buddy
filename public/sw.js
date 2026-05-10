// Career-Buddy service worker.
//
// VERSION POLICY: bump CACHE on every shipping commit that changes
// route output (HTML, JS, CSS bundles). Old caches are dropped on
// activate. Without the bump, browsers serve the previous build
// indefinitely — that was the root cause of the "CV upload doesn't
// work" report on 2026-05-10 (user had Phase-0-era cached HTML, my
// Phase 0.5 fix never reached them).
//
// STRATEGY:
// - Navigation requests (HTML): network-first → fall back to cache.
//   Ensures the user always gets the latest deploy if online.
// - Static assets (JS/CSS/img/icons): cache-first → fall back to
//   network. Hashed filenames make staleness a non-issue.
const CACHE = "career-buddy-v3";
const PRECACHE = ["/", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match("/"));
    }),
  );
});
