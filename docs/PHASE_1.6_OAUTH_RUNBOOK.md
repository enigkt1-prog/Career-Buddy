# Phase 1.6 — Email-Inbox OAuth runbook

Wires up Gmail + Outlook inbox connection. Backend code is shipped
(commits TBD); this runbook covers the manual config steps the
edge functions need before they actually work.

## Pre-reqs

- Multi-user auth (0014 + 0015) applied. Phase 1.6 is signed-in-only.
- pgcrypto migration 0016 applied. Edge function relies on
  `encrypt_oauth_token` / `decrypt_oauth_token` RPCs.

## Step 1 — Generate the OAuth master key

```bash
openssl rand -hex 32
# → copy the 64-char hex output
```

Set it in Postgres (via Supabase SQL editor):

```sql
ALTER DATABASE postgres SET app.oauth_master_key TO '<the 64-char hex>';
```

**Critical:** never commit this key. Anyone with the key can
decrypt every stored refresh-token. Rotate by re-encrypting all
rows: pull plaintext via `decrypt_oauth_token(<old key>)`,
re-encrypt with the new key, swap the GUC.

## Step 2 — Generate the state HMAC secret

Distinct from the master key — used to sign the CSRF state token
in the OAuth round-trip.

```bash
openssl rand -hex 32
```

Add to the Supabase Functions env (Dashboard → Edge Functions →
Settings → Secrets):

```
OAUTH_STATE_SECRET=<64-char hex>
```

## Step 3 — Google OAuth app (Gmail)

1. https://console.cloud.google.com/apis/credentials → Create
   OAuth 2.0 Client ID → Web application.
2. Add redirect URI:
   `https://career-buddy.enigkt1.workers.dev/email-oauth-callback`
   (and `http://localhost:8788/email-oauth-callback` for dev).
3. Enable the Gmail API on the same project.
4. Add OAuth consent screen scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `openid email profile`
5. Add yourself as a test user (until app is verified).
6. Copy client_id + client_secret into Supabase Functions env:

```
GMAIL_OAUTH_CLIENT_ID=...
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REDIRECT_URI=https://career-buddy.enigkt1.workers.dev/email-oauth-callback
```

## Step 4 — Microsoft Azure AD app (Outlook)

1. https://entra.microsoft.com → App registrations → New
   registration → "Career-Buddy email-connect" → "Accounts in any
   organizational directory and personal Microsoft accounts".
2. Redirect URI (Web):
   `https://career-buddy.enigkt1.workers.dev/email-oauth-callback`
3. API permissions → Microsoft Graph (delegated):
   - `Mail.Read`
   - `Mail.Send`
   - `User.Read`
   - `offline_access`
   - `openid email profile`
4. Grant admin consent (or self-consent at first sign-in).
5. Certificates & secrets → New client secret → copy value.
6. Application (client) ID + secret into Supabase Functions env:

```
OUTLOOK_OAUTH_CLIENT_ID=...
OUTLOOK_OAUTH_CLIENT_SECRET=...
OUTLOOK_OAUTH_REDIRECT_URI=https://career-buddy.enigkt1.workers.dev/email-oauth-callback
```

## Step 5 — Apply migrations

After Supabase Auth dev user signup completes:

```bash
# 0014 — needs the bootstrap_user_id
psql "$SUPABASE_DB_URL" \
  -v bootstrap_user_id="'<auth.users.id from dashboard>'" \
  -f data/migrations/0014_auth_user_id_fk.sql

# 0015 — RLS policies
psql "$SUPABASE_DB_URL" -f data/migrations/0015_rls_policies.sql

# 0016 — pgcrypto functions
cd backend && uv run python -m career_buddy_scraper.cli.migrate
```

## Step 6 — Deploy edge functions

```bash
npx supabase functions deploy email-oauth-start
npx supabase functions deploy email-oauth-callback
```

Optionally flip the strict-auth flag:

```
PHASE_AUTH_REQUIRED=1
```

(Sets every edge function to reject anonymous calls. Recommended
once /login is live.)

## Step 7 — Frontend wire (A territory)

UI hooks `EmailAccounts.tsx` "Connect Gmail" / "Connect Outlook"
buttons to:

```ts
const { data, error } = await supabase.functions.invoke("email-oauth-start", {
  body: { provider: "gmail" }, // or "outlook"
});
if (error || !data?.authoriseUrl) throw new Error("oauth start failed");
window.location.href = data.authoriseUrl;
```

The provider redirects back to `/email-oauth-callback?code=...&state=...`.
The frontend route reads `code` + `state` from the URL, invokes:

```ts
await supabase.functions.invoke("email-oauth-callback", {
  body: { provider, code, state },
});
```

…then navigates to `/profile#email` for confirmation.

## Step 8 — Smoke test

1. Sign in as dev user.
2. Click "Connect Gmail" → Google sign-in screen → grant scopes.
3. Land on callback → see "Connected: <your-email>" in /profile.
4. Inspect Supabase: `select user_id, email, provider,
   octet_length(oauth_refresh_token) from user_email_accounts;`
   — token must be non-NULL ciphertext (32+ bytes), NEVER plaintext.
5. Verify decrypt round-trip: `select length(decrypt_oauth_token
   (oauth_refresh_token)) from user_email_accounts;` — should
   return > 0.

## Failure modes + fixes

- **"app.oauth_master_key not set"**: re-run `ALTER DATABASE...
  SET app.oauth_master_key` and reconnect.
- **"OAUTH_STATE_SECRET not configured"**: missing edge env var.
- **"<provider> did not return a refresh_token"**: user already
  granted on a prior attempt. Revoke at
  https://myaccount.google.com/permissions (Google) /
  https://account.microsoft.com (Microsoft) and retry — the OAuth
  authorize URL passes `prompt=consent` so this should be rare.
- **"invalid or expired state token"**: state TTL is 10 minutes;
  user took too long between start + callback. Retry.

## Upgrade path: Supabase Vault / KMS

The two pgcrypto functions in 0016 (`encrypt_oauth_token`,
`decrypt_oauth_token`) can be swapped for Supabase Vault or AWS
KMS round-trips without changing the column shape or any caller
code. When you swap, rotate all existing rows by:

```sql
UPDATE user_email_accounts
   SET oauth_refresh_token = vault_encrypt(decrypt_oauth_token(oauth_refresh_token))
 WHERE oauth_refresh_token IS NOT NULL;
```

Then drop the pgcrypto versions.
