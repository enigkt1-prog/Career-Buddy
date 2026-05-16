/**
 * Company-news data layer (F3 — News v2).
 *
 * Two surfaces on the /news page:
 *  - the feed itself — `news-feed` edge function returns the latest
 *    headlines for the companies the user has applied to + watches;
 *  - the watch-list — direct PostgREST CRUD on `user_target_companies`
 *    (RLS scopes every row to the signed-in user).
 *
 * The catalog (`company_news`) is cron-populated nightly; the feed is
 * read-only from the client.
 */

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type CompanyNewsItem = {
  id: string;
  company_name: string;
  headline: string;
  url: string;
  summary: string | null;
  source: string | null;
  published_at: string;
};

export type NewsFeedResponse = {
  applied_news: CompanyNewsItem[];
  target_news: CompanyNewsItem[];
};

export const COMPANY_NEWS_QUERY_KEY = ["company-news"] as const;
export const TARGET_COMPANIES_QUERY_KEY = ["target-companies"] as const;

/** Human "2h ago" stamp — hour/minute granularity, unlike `relativeDays`. */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

/** Fetch the signed-in user's company-news feed via the edge function. */
export async function fetchCompanyNews(): Promise<NewsFeedResponse> {
  const { data, error } = await supabase.functions.invoke("news-feed");
  if (error) throw error;
  const payload = (data ?? {}) as Partial<NewsFeedResponse> & { error?: string };
  if (payload.error) throw new Error(payload.error);
  return {
    applied_news: payload.applied_news ?? [],
    target_news: payload.target_news ?? [],
  };
}

export function useCompanyNews() {
  return useQuery({
    queryKey: COMPANY_NEWS_QUERY_KEY,
    queryFn: fetchCompanyNews,
    staleTime: 5 * 60 * 1000,
  });
}

/** The user's watch-list company names, newest-added first. */
export async function fetchTargetCompanies(): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_target_companies")
    .select("company_name, added_at")
    .order("added_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.company_name);
}

export function useTargetCompanies() {
  return useQuery({
    queryKey: TARGET_COMPANIES_QUERY_KEY,
    queryFn: fetchTargetCompanies,
    staleTime: 5 * 60 * 1000,
  });
}

/** Add a company to the watch-list. Idempotent (upsert on the PK). */
export async function addTargetCompany(name: string): Promise<void> {
  const company = name.trim();
  if (!company) return;
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to add target companies.");
  const { error } = await supabase
    .from("user_target_companies")
    .upsert(
      { user_id: userId, company_name: company },
      { onConflict: "user_id,company_name" },
    );
  if (error) throw error;
}

/** Remove a company from the watch-list. */
export async function removeTargetCompany(name: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in required.");
  const { error } = await supabase
    .from("user_target_companies")
    .delete()
    .eq("user_id", userId)
    .eq("company_name", name);
  if (error) throw error;
}
