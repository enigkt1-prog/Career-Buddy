import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { signOut } from "@/lib/auth";

type Session = { id: string; email: string | null } | null;

/**
 * Cinema-styled auth pill for the top nav.
 *
 * - Signed in: shows truncated email + sign-out icon.
 * - Anonymous: shows "Sign in" link to /login.
 *
 * Subscribes to `supabase.auth.onAuthStateChange` directly so the
 * INITIAL_SESSION event delivers the cached session on mount
 * without an HTTP round-trip, avoiding the race where
 * `detectSessionInUrl` parses a post-OAuth/magic-link hash after
 * a getUser() call has already returned null.
 */
export function AuthPill() {
  const [session, setSession] = useState<Session>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (sess?.user) {
        setSession({ id: sess.user.id, email: sess.user.email ?? null });
      } else {
        setSession(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSignOut() {
    await signOut();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }

  if (!session) {
    return (
      <a
        href="/login"
        className="flex items-center gap-1.5 px-3 py-2 rounded-full text-base text-cinema-pine hover:text-cinema-ink hover:bg-cinema-mint/60 no-underline transition-colors"
      >
        <LogIn className="w-4 h-4" />
        <span className="hidden sm:inline">Sign in</span>
      </a>
    );
  }

  const label = session.email ?? "Signed in";
  return (
    <button
      type="button"
      onClick={onSignOut}
      title={`Sign out (${label})`}
      className="flex items-center gap-1.5 px-3 py-2 rounded-full text-base text-cinema-ink-soft hover:text-cinema-ink hover:bg-cinema-mint/60 transition-colors max-w-[12rem]"
    >
      <LogOut className="w-4 h-4 shrink-0" />
      <span className="hidden sm:inline truncate">{label}</span>
    </button>
  );
}
