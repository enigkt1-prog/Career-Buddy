/**
 * `useCareerBuddyApplications` — extracted applications-slice helpers
 * for the monolith and any future caller (F4 chat tool handlers, etc.).
 *
 * Why this exists:
 *   The 993-line `src/components/CareerBuddy.tsx` monolith owns the
 *   applications state plus all 3 mutators (add / update / delete).
 *   F4's agentic chat needs to invoke those mutators from outside the
 *   component (chat-handler callbacks, undo toasts). Extracting the
 *   mutators into a hook gives non-monolith callers a clean API
 *   without rewriting the rest of the monolith.
 *
 * Scope (deliberately narrow):
 *   - Hook accepts the current `applications` array + a state setter
 *     callback so the monolith remains the single source of truth.
 *   - Hook returns `{ addApplication, updateApplication,
 *     deleteApplication, syncApplication }` — pure functions that
 *     wrap localStorage-style state mutations with the Supabase
 *     upsert/delete side-effects the monolith already runs.
 *   - Hook does NOT own state. F0 keeps the refactor zero-behaviour-
 *     change. A later phase may invert that.
 *
 * Acceptance: the existing 363 tests continue to pass with the
 * monolith re-routing its 3 mutators through this hook.
 */

import { useCallback } from "react";

import { type Application } from "./types";
import { todayISO } from "./format";
import { applicationToRow } from "./jobs-helpers";
import { getCurrentUserId } from "./auth";
import { supabase } from "@/integrations/supabase/client";

export type ApplicationsSetter = (
  updater: (prev: Application[]) => Application[],
) => void;

export type UseCareerBuddyApplications = {
  /**
   * Add a new application (no-op if a row with the same
   * (company, role) already exists in the current local state).
   */
  addApplication: (
    company: string,
    role: string,
    opts?: { url?: string; fit?: number },
  ) => void;
  /**
   * Patch an existing application by client id.
   */
  updateApplication: (id: string, patch: Partial<Application>) => void;
  /**
   * Remove an application by client id (local + Supabase).
   */
  deleteApplication: (id: string) => void;
  /**
   * Best-effort Supabase upsert for a single application row. Called
   * automatically by add/update; exposed for chat tool handlers.
   */
  syncApplication: (a: Application) => void;
};

/**
 * Build the applications-slice helpers wrapped around the caller's
 * state setter. The hook is parameterised so the monolith keeps its
 * single useState container; future consumers (e.g. F4 chat handler)
 * can pass in their own setter or a no-op when only sync is needed.
 */
export function useCareerBuddyApplications(
  applications: Application[],
  setApplications: ApplicationsSetter,
): UseCareerBuddyApplications {
  const syncApplication = useCallback((a: Application) => {
    // Post-multi-user-cutover: applications.user_id is NOT NULL +
    // RLS-scoped. Anonymous mode → skip Supabase upsert; localStorage
    // stays canonical.
    void (async () => {
      const userId = await getCurrentUserId();
      if (!userId) return;
      const { error } = await supabase
        .from("applications")
        .upsert(applicationToRow(a, userId), {
          onConflict: "user_id,client_id",
        });
      if (error) console.warn("[applications] upsert failed", error.message);
    })();
  }, []);

  const addApplication = useCallback(
    (
      company: string,
      role: string,
      opts?: { url?: string; fit?: number },
    ) => {
      if (applications.some((a) => a.company === company && a.role === role)) {
        return;
      }
      const newApp: Application = {
        id: `a${Date.now()}`,
        company,
        role,
        status: "applied",
        last_event: todayISO(),
        next_action: "Awaiting reply",
        fit: opts?.fit ?? 7.0,
        url: opts?.url,
      };
      setApplications((prev) => [...prev, newApp]);
      syncApplication(newApp);
    },
    [applications, setApplications, syncApplication],
  );

  const updateApplication = useCallback(
    (id: string, patch: Partial<Application>) => {
      setApplications((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
        const updated = next.find((a) => a.id === id);
        if (updated) syncApplication(updated);
        return next;
      });
    },
    [setApplications, syncApplication],
  );

  const deleteApplication = useCallback(
    (id: string) => {
      setApplications((prev) => prev.filter((a) => a.id !== id));
      void supabase
        .from("applications")
        .delete()
        .eq("client_id", id)
        .then(({ error }) => {
          if (error) console.warn("[applications] delete failed", error.message);
        });
    },
    [setApplications],
  );

  return {
    addApplication,
    updateApplication,
    deleteApplication,
    syncApplication,
  };
}
