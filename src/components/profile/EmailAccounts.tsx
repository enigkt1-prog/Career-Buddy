import { useState } from "react";
import { Mail, Plus, Star, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/**
 * Email accounts UI — Phase 1.6 wired.
 *
 * Buttons invoke the `email-oauth-start` edge function, which returns
 * a provider authorisation URL. We redirect the browser there;
 * provider redirects back to /email-oauth-callback, which finishes
 * the handshake by invoking `email-oauth-callback`.
 *
 * Until the user is signed in to Supabase Auth the edge function
 * returns 401 ("sign in required for OAuth connect") — surfaced as a
 * "please sign in" prompt with a /login link.
 */

type Provider = "gmail" | "outlook" | "imap";
type ConnectableProvider = "gmail" | "outlook";

/**
 * Outlook OAuth is hidden until the env var flips it on. The edge
 * function already returns 500 when `OUTLOOK_OAUTH_CLIENT_ID` is
 * absent; this gate keeps the UI from surfacing a button that can
 * only fail. Flip `VITE_OUTLOOK_OAUTH_ENABLED=1` in `.env` (build
 * time) once the Azure Entra app + secrets are live.
 *
 * Evaluated per-render (not module-top-level) so vi.stubEnv() in
 * the test suite can flip the flag between cases.
 */
function isOutlookOauthEnabled(): boolean {
  const v = import.meta.env.VITE_OUTLOOK_OAUTH_ENABLED;
  return v === "1" || v === "true";
}

type EmailAccount = {
  id: string;
  email: string;
  provider: Provider;
  isPrimary: boolean;
};

const PROVIDER_LABEL: Record<Provider, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  imap: "IMAP",
};

const PROVIDER_COLOR: Record<Provider, string> = {
  gmail: "bg-cinema-mint/60 text-cinema-ink",
  outlook: "bg-cinema-sage/40 text-cinema-ink",
  imap: "bg-cinema-mist text-cinema-ink-mute",
};

type ConnectState =
  | { kind: "idle" }
  | { kind: "starting"; provider: ConnectableProvider }
  | { kind: "auth-required" }
  | { kind: "error"; provider: ConnectableProvider; message: string };

export function EmailAccounts() {
  const [accounts] = useState<EmailAccount[]>([]); // hydrated post-OAuth
  const [connect, setConnect] = useState<ConnectState>({ kind: "idle" });
  const [imapNotice, setImapNotice] = useState(false);

  async function startConnect(provider: ConnectableProvider) {
    setConnect({ kind: "starting", provider });
    try {
      const { data, error } = await supabase.functions.invoke(
        "email-oauth-start",
        { body: { provider } },
      );
      if (error) {
        const message = error.message ?? "OAuth start failed.";
        const status = (error as { context?: { status?: number } }).context
          ?.status;
        if (status === 401 || /sign in required/i.test(message)) {
          setConnect({ kind: "auth-required" });
        } else {
          setConnect({ kind: "error", provider, message });
        }
        return;
      }
      const url = (data as { authoriseUrl?: string })?.authoriseUrl;
      if (!url) {
        setConnect({
          kind: "error",
          provider,
          message: "Edge function returned no authorise URL.",
        });
        return;
      }
      window.location.href = url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "OAuth start failed.";
      setConnect({ kind: "error", provider, message });
    }
  }

  const starting = connect.kind === "starting";
  const outlookEnabled = isOutlookOauthEnabled();

  return (
    <div className="space-y-5">
      {accounts.length === 0 ? (
        <div className="rounded-glass border border-cinema-mint bg-white/70 p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-full bg-cinema-mint/60">
              <Mail className="w-4 h-4 text-cinema-pine" />
            </div>
            <div>
              <div className="text-cinema-h2 mb-1">No accounts connected.</div>
              <p className="text-cinema-body">
                Connect Gmail or Outlook so Buddy can read application
                replies, draft outreach from your address, and surface
                interview invites in your Overview tracker. Multiple
                accounts supported — set one as primary.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-glass border border-cinema-mint bg-white/70 px-4 py-3"
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center px-2.5 py-1 rounded-full text-base font-medium",
                  PROVIDER_COLOR[a.provider],
                )}
              >
                {PROVIDER_LABEL[a.provider]}
              </span>
              <span className="flex-1 text-base text-cinema-ink truncate">
                {a.email}
              </span>
              {a.isPrimary && (
                <span className="inline-flex items-center gap-1 text-base text-cinema-pine">
                  <Star className="w-3.5 h-3.5" /> primary
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => startConnect("gmail")}
          disabled={starting}
          className="pill-cta disabled:opacity-40"
        >
          {connect.kind === "starting" && connect.provider === "gmail" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Connect Gmail
        </button>
        {outlookEnabled && (
          <button
            type="button"
            onClick={() => startConnect("outlook")}
            disabled={starting}
            className="pill-cta-soft disabled:opacity-40"
          >
            {connect.kind === "starting" && connect.provider === "outlook" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Connect Outlook
          </button>
        )}
        <button
          type="button"
          onClick={() => setImapNotice(true)}
          className="pill-cta-soft"
        >
          <Plus className="w-4 h-4" /> Connect IMAP
        </button>
      </div>

      {connect.kind === "auth-required" && (
        <div className="rounded-glass border border-cinema-mint bg-white/70 px-4 py-3 text-base text-cinema-ink-soft">
          You need to be signed in before connecting an inbox.{" "}
          <a
            href="/login"
            className="text-cinema-pine underline hover:text-cinema-ink"
          >
            Sign in
          </a>{" "}
          and try again.
        </div>
      )}

      {connect.kind === "error" && (
        <div className="rounded-glass border border-red-200 bg-red-50 px-4 py-3 text-base text-destructive">
          {PROVIDER_LABEL[connect.provider]} couldn't start: {connect.message}
        </div>
      )}

      <p className="text-cinema-caption">
        OAuth handshake live (Phase 1.6). Refresh tokens are encrypted via
        pgcrypto + Supabase Vault before storage. Gmail is the default
        day-one provider; Outlook unlocks once
        <code className="px-1 mx-1 bg-cinema-mist rounded">VITE_OUTLOOK_OAUTH_ENABLED=1</code>
        ships alongside the Azure Entra secrets.
      </p>

      {imapNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-cinema-moss/60 backdrop-blur-sm p-4"
          onClick={() => setImapNotice(false)}
        >
          <div
            className="glass-panel-heavy max-w-md w-full p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-3">
              Not yet
            </div>
            <h3 className="text-cinema-h2 mb-3">IMAP support</h3>
            <p className="text-cinema-body mb-5">
              IMAP / generic mailbox connections aren't supported yet —
              app-password handling + per-provider quirks need their own
              encrypted-secret path. Phase-2 backlog. Use Gmail or
              Outlook for now.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setImapNotice(false)}
                className="pill-cta"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
