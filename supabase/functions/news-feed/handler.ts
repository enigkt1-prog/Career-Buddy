// Career-Buddy news-feed request handler (F3 — News v2).
//
// Returns the company-news feed for the signed-in user, split into:
//   - applied_news : news for companies the user has applications to
//   - target_news  : news for companies on the user's watch-list
//                    (`user_target_companies`)
//
// Auth: `requireAuth` (never anonymous — F0 strict helper). DB reads run
// under the caller's JWT so RLS scopes `applications` /
// `user_target_companies` to the user.
//
// `company_news` is, by design, a shared authenticated-read catalog —
// the same posture as the `jobs` table. It carries no user_id and no
// per-user attribution; its rows are public Google-News headlines for
// companies that are mostly public job-board companies. This handler is
// the only read path the app uses, and it scopes the *feed* to the
// caller's own companies. The residual that a determined authenticated
// user could enumerate the catalog's company set directly was weighed
// and accepted: no attribution, public content, catalog-shaped data.
//
// `index.ts` wires this handler into `serve()`; kept separate so tests
// can import `handleRequest` without binding a port.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireAuth, unauthorisedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NEWS_COLS = "id, company_name, headline, url, summary, source, published_at";
// Per-section cap. The feed is a glanceable digest, not an archive.
const PER_SECTION_LIMIT = 50;
// Each company is queried individually for its newest PER_COMPANY_LIMIT
// stories, so one very newsy company can never crowd the others out of
// a section (a single pooled query, ordered globally, could).
const PER_COMPANY_LIMIT = 8;
// Upper bound on companies queried per section — bounds the fan-out of
// parallel point lookups for a user with an unusually long list.
const MAX_FEED_COMPANIES = 80;

export type NewsItem = {
  id: string;
  company_name: string;
  headline: string;
  url: string;
  summary: string | null;
  source: string | null;
  published_at: string;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Distinct company keys — trimmed and lowercased. The RSS scraper folds
 * `company_news.company_name` to the same `lower(trim(...))` key, so a
 * user's casing ("stripe" vs "Stripe") never hides their news.
 */
export function distinctCompanies(
  rows: Array<{ company: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const name = (r.company ?? "").trim().toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Merge per-company news lists into one section: newest-first across
 * all companies, capped at `PER_SECTION_LIMIT`. Each input list is
 * already capped per company, so fairness is structural.
 * `published_at` is an ISO-8601 string — lexical order is chronological.
 */
export function mergeSection(perCompany: NewsItem[][]): NewsItem[] {
  return perCompany
    .flat()
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
    .slice(0, PER_SECTION_LIMIT);
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authResult = await requireAuth(req);
  if (!authResult.ok) {
    return unauthorisedResponse(authResult, corsHeaders);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("news-feed: SUPABASE_URL / SUPABASE_ANON_KEY missing in edge env");
    return jsonResponse({ error: "Failed to load the news feed." }, 500);
  }

  try {
    // User-scoped client: RLS enforces ownership on applications +
    // user_target_companies; company_news is authenticated-read.
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [appliedRes, targetRes] = await Promise.all([
      client.from("applications").select("company"),
      client.from("user_target_companies").select("company_name"),
    ]);
    if (appliedRes.error) throw appliedRes.error;
    if (targetRes.error) throw targetRes.error;

    const appliedCompanies = distinctCompanies(appliedRes.data ?? []);
    const targetCompanies = distinctCompanies(
      (targetRes.data ?? []).map((r) => ({ company: r.company_name })),
    );

    // Query each company individually (newest PER_COMPANY_LIMIT each) so
    // a prolific company can never starve the others. Each query is an
    // index scan on (company_name, published_at DESC); the company count
    // is bounded by MAX_FEED_COMPANIES.
    async function newsFor(companies: string[]): Promise<NewsItem[]> {
      if (companies.length === 0) return [];
      const perCompany = await Promise.all(
        companies.slice(0, MAX_FEED_COMPANIES).map(async (name) => {
          const { data, error } = await client
            .from("company_news")
            .select(NEWS_COLS)
            .eq("company_name", name)
            .is("archived_at", null)
            .order("published_at", { ascending: false })
            .limit(PER_COMPANY_LIMIT);
          if (error) throw error;
          return (data ?? []) as NewsItem[];
        }),
      );
      return mergeSection(perCompany);
    }

    const [applied_news, target_news] = await Promise.all([
      newsFor(appliedCompanies),
      newsFor(targetCompanies),
    ]);

    return jsonResponse({ applied_news, target_news });
  } catch (e) {
    // Log the detail server-side; never leak DB / auth internals to the client.
    console.error("news-feed error:", e);
    return jsonResponse({ error: "Failed to load the news feed." }, 500);
  }
}
