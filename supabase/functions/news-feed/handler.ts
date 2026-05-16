// Career-Buddy news-feed request handler (F3 — News v2).
//
// Returns the company-news feed for the signed-in user, split into:
//   - applied_news : news for companies the user has applications to
//   - target_news  : news for companies on the user's watch-list
//                    (`user_target_companies`)
//
// Auth: `requireAuth` (never anonymous — F0 strict helper). DB reads run
// under the caller's JWT so RLS scopes `applications` /
// `user_target_companies` to the user; `company_news` is a public
// catalog (authenticated-read) filtered here to the user's companies.
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

type NewsItem = {
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

/** Distinct, non-empty, trimmed company names — order preserved. */
export function distinctCompanies(
  rows: Array<{ company: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const name = (r.company ?? "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
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
    return jsonResponse({ error: "edge env not configured" }, 500);
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

    async function newsFor(companies: string[]): Promise<NewsItem[]> {
      if (companies.length === 0) return [];
      const { data, error } = await client
        .from("company_news")
        .select(NEWS_COLS)
        .in("company_name", companies)
        .is("archived_at", null)
        .order("published_at", { ascending: false })
        .limit(PER_SECTION_LIMIT);
      if (error) throw error;
      return (data ?? []) as NewsItem[];
    }

    const [applied_news, target_news] = await Promise.all([
      newsFor(appliedCompanies),
      newsFor(targetCompanies),
    ]);

    return jsonResponse({ applied_news, target_news });
  } catch (e) {
    console.error("news-feed error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
}
