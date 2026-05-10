/**
 * Supabase Auth wrappers for the multi-user cutover (Phase: pre-migration).
 *
 * Anonymous-mode-friendly: every helper degrades gracefully when no
 * session exists so the app keeps working in single-user mode until
 * the 0014 / 0015 migrations apply.
 *
 * Public surface:
 *  - {@link getCurrentUserId}  — current auth.uid() or null
 *  - {@link signInWithEmail}   — magic-link OTP
 *  - {@link signInWithGoogle}  — OAuth redirect flow
 *  - {@link signOut}           — clear session
 *  - {@link onAuthChange}      — subscribe to auth state, returns unsubscribe
 *
 * Auth provider config lives in the Supabase dashboard (Project
 * settings → Authentication → Providers). v1 enables Email
 * magic-link + Google. No password-based sign-up is exposed.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the current authenticated user_id, or null if anonymous
 * / session expired / network error. Never throws.
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Send a magic-link sign-in OTP to the provided email. The user
 * clicks the link in their inbox to complete sign-in; the redirect
 * back to the app lands on the post-auth handler (Supabase JS
 * client picks up the session from the URL hash automatically).
 *
 * @throws when the SDK errors (invalid email, rate limit, etc.) so
 * the caller can surface the message.
 */
export async function signInWithEmail(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("Email required");
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo:
        typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
    },
  });
  if (error) throw error;
}

/**
 * Kick off the Google OAuth redirect flow. The user lands back on
 * the app with the session in the URL hash, which the Supabase
 * client picks up via `detectSessionInUrl`.
 *
 * @throws when the SDK errors (provider misconfigured, etc.).
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo:
        typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
    },
  });
  if (error) throw error;
}

/**
 * Sign out the current user. Best-effort: swallows errors so the
 * UI can proceed to its anonymous state even if the API call
 * fails.
 */
export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore — UI proceeds anonymous */
  }
}

/**
 * Subscribe to auth-state changes (sign-in / sign-out / token
 * refresh). Returns an unsubscribe function the caller invokes
 * during cleanup (typically a React useEffect return).
 *
 * The callback fires with the current user_id (or null) on every
 * relevant state change. Wraps Supabase's `onAuthStateChange` so
 * downstream code doesn't import the session-shape type directly.
 */
export function onAuthChange(cb: (userId: string | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user?.id ?? null);
  });
  return () => data.subscription.unsubscribe();
}
