// Shared auth helper for Career-Buddy edge functions. Validates
// the caller's Supabase JWT and returns the auth.uid() so the
// function body can scope writes per-user.
//
// Strategy (per docs/MULTI_USER_RLS_PLAN.md):
//   - anon key + user JWT for user-scoped writes; RLS enforces
//   - service-role key NEVER ships to the browser; used only for
//     cross-user catalog reads inside edge functions (jobs, vcs)
//   - this helper is for the user-scoped path: it validates the
//     caller's JWT and returns the user_id
//
// Failure modes (all → 401):
//   - missing Authorization header
//   - malformed Bearer token
//   - expired / revoked JWT
//   - JWT for a deleted auth.users row (getUser internal check)
//
// Pre-migration: if PHASE_AUTH_REQUIRED is not set to "1" in the
// edge-function env, the helper returns a sentinel "anonymous"
// uid so functions stay callable in single-user mode. Once 0014 +
// 0015 apply, flip the env var and every function rejects anon.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

function getAuthClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY required in edge env");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Extract the bearer token + validate it against Supabase Auth.
 * Returns the auth.uid() on success, or a 401-shaped error on
 * any failure. Never throws.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  const phaseAuthRequired = Deno.env.get("PHASE_AUTH_REQUIRED") === "1";

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) {
    if (!phaseAuthRequired) {
      return { ok: true, userId: "anonymous" };
    }
    return { ok: false, status: 401, error: "missing Authorization header" };
  }

  try {
    const client = getAuthClient();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) {
      if (!phaseAuthRequired) {
        // Pre-migration: bad token → still let the call through as
        // anonymous so dev flow stays working with stale sessions.
        return { ok: true, userId: "anonymous" };
      }
      return { ok: false, status: 401, error: "invalid or expired token" };
    }
    return { ok: true, userId: data.user.id };
  } catch (e) {
    if (!phaseAuthRequired) return { ok: true, userId: "anonymous" };
    const message = e instanceof Error ? e.message : "auth check failed";
    return { ok: false, status: 401, error: message };
  }
}

/**
 * Convenience: response builder for the failure side of authenticate().
 */
export function unauthorisedResponse(
  result: Extract<AuthResult, { ok: false }>,
  corsHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: result.error }), {
    status: result.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
