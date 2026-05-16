import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";

import {
  addTargetCompany,
  removeTargetCompany,
  TARGET_COMPANIES_QUERY_KEY,
  useTargetCompanies,
} from "@/lib/company-news";
import { track } from "@/lib/telemetry";

/**
 * F3 — watch-list editor for company news. Lives on the /news page
 * (not /profile, to keep the F2 profile work collision-free). Writes
 * to `user_target_companies`; the nightly RSS cron picks new names up
 * on its next run, so freshly-added companies show news the next day.
 */
export function TargetCompaniesInput() {
  const queryClient = useQueryClient();
  const { data: companies, isLoading } = useTargetCompanies();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addTargetCompany(name);
      void track("target_company_added", { company: name });
      setValue("");
      await queryClient.invalidateQueries({ queryKey: TARGET_COMPANIES_QUERY_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that company.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(name: string) {
    try {
      await removeTargetCompany(name);
      await queryClient.invalidateQueries({ queryKey: TARGET_COMPANIES_QUERY_KEY });
    } catch {
      // Swallow — the next list fetch resyncs the chip set.
    }
  }

  return (
    <div className="rounded-glass border border-cinema-mint bg-white/70 p-5">
      <div className="text-cinema-body font-medium text-cinema-ink mb-1">
        Companies you're watching
      </div>
      <p className="text-cinema-caption text-cinema-ink-mute mb-4">
        Add companies you care about. We'll surface their news here —
        fresh names appear in tomorrow's feed.
      </p>

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Stripe"
          aria-label="Company name"
          className="flex-1 px-3 py-2 rounded-full border border-cinema-mint bg-white text-cinema-body text-cinema-ink placeholder:text-cinema-ink-mute focus:outline-none focus:ring-2 focus:ring-cinema-sage/50"
        />
        <button
          type="submit"
          disabled={busy || value.trim().length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-cinema-moss text-cinema-cream text-cinema-body disabled:opacity-50 transition-opacity"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Add
        </button>
      </form>

      {error && (
        <p className="mt-2 text-cinema-caption text-destructive">{error}</p>
      )}

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-cinema-caption text-cinema-ink-mute">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading your watch-list…
        </div>
      ) : companies && companies.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {companies.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-cinema-mint/60 text-cinema-caption text-cinema-ink"
            >
              {name}
              <button
                type="button"
                onClick={() => handleRemove(name)}
                aria-label={`Remove ${name}`}
                className="rounded-full p-0.5 hover:bg-cinema-sage/40 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-cinema-caption text-cinema-ink-mute">
          No companies yet. Add one above to start tracking its news.
        </p>
      )}
    </div>
  );
}
