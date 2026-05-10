/**
 * Lazy-chunks bundle-shape assertion.
 *
 * Round-10 task — gates the monolith-extraction work that's still
 * pending. Catches two regression classes:
 *
 *   1. Eager imports of route-specific chunks on the landing page.
 *      Loading `/` should NOT pull in `/profile`'s or `/buddy`'s
 *      route chunks. Each route's JS arrives lazily on navigation.
 *
 *   2. Bundle-shape collapse — every route now loads at least one
 *      unique JS chunk that the previous route didn't. If the
 *      router stops code-splitting, all routes load the same chunk
 *      set and this assertion fires.
 *
 * Pre-condition: a deployed (or local-preview) build serving the
 * route chunks `profile-*.js`, `buddy-*.js`, `jobs-*.js`, etc. The
 * spec defaults to the live Cloudflare Worker
 * (`https://career-buddy.enigkt1.workers.dev`) so it runs without a
 * local preview pipeline; set `PLAYWRIGHT_BASE_URL` to override.
 *
 * Byte-budget assertions are intentionally deferred until the
 * extraction round lands a fresh baseline — the current entry chunk
 * has grown legitimately (theme picker + email accounts +
 * CvUploadInline + profile-store) since `docs/iter-3-bundle-
 * baseline.txt` was captured.
 */

const TARGET_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://career-buddy.enigkt1.workers.dev";

import { expect, test, type Page } from "@playwright/test";

// Route chunks emitted by vite — match by prefix so the content
// hash doesn't bake into the test.
const CHUNK_PREFIXES = {
  profile: /\/assets\/profile-[\w-]+\.js/,
  buddy: /\/assets\/buddy-[\w-]+\.js/,
  jobs: /\/assets\/jobs-[\w-]+\.js/,
} as const;

type ChunkBucket = Record<keyof typeof CHUNK_PREFIXES, string[]>;

async function captureJsRequests(
  page: Page,
  navigate: () => Promise<void>,
): Promise<{ all: string[]; matched: ChunkBucket }> {
  const all: string[] = [];
  const matched: ChunkBucket = { profile: [], buddy: [], jobs: [] };

  const onResponse = (resp: { url: () => string; request: () => { resourceType: () => string } }) => {
    const url = resp.url();
    if (resp.request().resourceType() !== "script") return;
    if (!url.endsWith(".js")) return;
    all.push(url);
    for (const [key, re] of Object.entries(CHUNK_PREFIXES)) {
      if (re.test(url)) matched[key as keyof typeof CHUNK_PREFIXES].push(url);
    }
  };

  page.on("response", onResponse);
  await navigate();
  await page.waitForLoadState("networkidle");
  page.off("response", onResponse);

  return { all, matched };
}

test.describe("lazy chunks", () => {
  test("/ does NOT pull route-specific chunks (profile / buddy / jobs)", async ({ page }) => {
    const { matched, all } = await captureJsRequests(page, async () => {
      await page.goto(`${TARGET_URL}/`);
    });
    expect(
      all.length,
      "expected at least the index entry chunk to load",
    ).toBeGreaterThan(0);
    expect(matched.profile, "profile chunk leaked into / load").toEqual([]);
    expect(matched.buddy, "buddy chunk leaked into / load").toEqual([]);
    expect(matched.jobs, "jobs chunk leaked into / load").toEqual([]);
  });

  test("/profile loads at least one unique profile chunk", async ({ page }) => {
    const { matched } = await captureJsRequests(page, async () => {
      await page.goto(`${TARGET_URL}/profile`);
    });
    expect(
      matched.profile.length,
      "expected at least one profile-*.js chunk on /profile",
    ).toBeGreaterThan(0);
  });

  test("/buddy loads at least one unique buddy chunk", async ({ page }) => {
    const { matched } = await captureJsRequests(page, async () => {
      await page.goto(`${TARGET_URL}/buddy`);
    });
    expect(
      matched.buddy.length,
      "expected at least one buddy-*.js chunk on /buddy",
    ).toBeGreaterThan(0);
  });

  test("/jobs loads at least one unique jobs chunk", async ({ page }) => {
    const { matched } = await captureJsRequests(page, async () => {
      await page.goto(`${TARGET_URL}/jobs`);
    });
    expect(
      matched.jobs.length,
      "expected at least one jobs-*.js chunk on /jobs",
    ).toBeGreaterThan(0);
  });
});
