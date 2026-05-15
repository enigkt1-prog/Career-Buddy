/**
 * Thin wrapper around inserts into `analytics_events` (migration 0017).
 *
 * Best-effort: any network or RLS error is logged + swallowed so UI
 * never blocks on telemetry. The RLS policy on `analytics_events`
 * accepts both `user_id = auth.uid()` (signed-in) AND `user_id IS NULL`
 * (pre-PHASE_AUTH_REQUIRED anonymous-fallback), so calling `track()`
 * without a session still writes a row.
 *
 * Acceptance criteria (per WORKPLAN F0):
 *  - `track(name)` while anon  → row in `analytics_events` with `user_id IS NULL`
 *  - `track(name)` while signed-in → row with `user_id = auth.uid()`
 *  - Mid-session sign-in: a previously-anon row stays NULL (no backfill);
 *    new rows post-sign-in carry the user_id. Documented v1 behaviour.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type TelemetryPayload = Record<string, Json>;

function isDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem?.("debug:telemetry") === "1";
  } catch {
    return false;
  }
}

/**
 * Resolve the current user id from the Supabase local session
 * (no HTTP). Returns null when anonymous or session not yet hydrated.
 */
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget event log. Promise resolves once the insert returns
 * but callers should NOT await it on user-interaction paths — pass
 * the promise to a no-op `.catch(() => {})` so the lint rule allows it.
 */
export async function track(
  eventName: string,
  payload?: TelemetryPayload,
): Promise<void> {
  try {
    const userId = await currentUserId();
    const row = {
      user_id: userId,
      event_name: eventName,
      payload: payload ?? null,
    };
    const { error } = await supabase.from("analytics_events").insert(row);
    if (error) {
      if (isDebug()) console.warn("[telemetry] insert failed", eventName, error);
      return;
    }
    if (isDebug()) console.info("[telemetry]", eventName, payload);
  } catch (e) {
    if (isDebug()) console.warn("[telemetry] threw", eventName, e);
  }
}
