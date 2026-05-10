import { defineConfig, devices } from "@playwright/test";

// Local Cloudflare Worker dev (wrangler dev) ships on 8788; the live
// deploy lives at https://career-buddy.enigkt1.workers.dev. The
// lazy-chunks spec hits absolute URLs so it can run without a local
// preview server. Override via PLAYWRIGHT_BASE_URL when the local
// preview pipeline is healthy (vite preview currently 500s due to a
// TanStack Start + cloudflare-vite-plugin path mismatch — TODO).
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // webServer config intentionally omitted — lazy-chunks targets the
  // live Cloudflare Worker via absolute URL; sanity is serverless.
});
