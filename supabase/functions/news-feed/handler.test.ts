// Deno tests for the news-feed edge handler (F3).
//
// Run: deno test supabase/functions/news-feed/handler.test.ts
//
// Covers the auth gate (never anonymous), CORS preflight, and the
// company-name shaping helper. The happy-path DB join is integration-
// level (live Supabase) and is not exercised here.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { distinctCompanies, handleRequest } from "./handler.ts";

Deno.test("OPTIONS preflight returns CORS headers, no body", async () => {
  const res = await handleRequest(
    new Request("http://localhost/news-feed", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("missing Authorization header → 401", async () => {
  const res = await handleRequest(
    new Request("http://localhost/news-feed", { method: "POST" }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assert(typeof body.error === "string" && body.error.length > 0);
});

Deno.test("empty Bearer token → 401 (never anonymous)", async () => {
  const res = await handleRequest(
    new Request("http://localhost/news-feed", {
      method: "POST",
      headers: { Authorization: "Bearer " },
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test("distinctCompanies dedupes, trims, drops empties, keeps order", () => {
  const out = distinctCompanies([
    { company: "Stripe" },
    { company: " Stripe " },
    { company: "Notion" },
    { company: "" },
    { company: null },
    { company: "Stripe" },
  ]);
  assertEquals(out, ["Stripe", "Notion"]);
});

Deno.test("distinctCompanies returns [] for empty input", () => {
  assertEquals(distinctCompanies([]), []);
});
