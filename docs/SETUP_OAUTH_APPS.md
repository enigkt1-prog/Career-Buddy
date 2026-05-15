# OAuth Apps Setup — Gmail + Outlook (Phase 1.6)

Click-by-click runbook. ~30 min total. Du brauchst:
- Google account (für Gmail OAuth)
- Microsoft account (für Outlook OAuth) — kann persönlich oder
  M365-business sein
- Zugriff auf Supabase Dashboard

Output am ende: 6 env vars die du in Supabase Dashboard pastest +
2 edge functions deployed.

---

## Step 1 — Google Cloud OAuth (Gmail)

### 1.1 Project anlegen
1. https://console.cloud.google.com
2. Top-bar → project dropdown → "New Project"
3. Name: `Career-Buddy` → Create
4. Warten bis erstellt, dann project switchen

### 1.2 Gmail API aktivieren
1. Sidebar → APIs & Services → Library
2. Such "Gmail API" → click result → **Enable**
3. Warten

### 1.3 OAuth consent screen konfigurieren
1. Sidebar → APIs & Services → OAuth consent screen
2. User Type: **External** → Create
3. App information:
   - App name: `Career-Buddy`
   - User support email: `enigkt1@gmail.com`
   - Developer contact: `enigkt1@gmail.com`
4. → Save and Continue
5. Scopes screen → **Add or Remove Scopes** → search + add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `openid`, `email`, `profile`
6. → Update → Save and Continue
7. Test users → **Add Users** → `enigkt1@gmail.com` → Save and Continue
8. Summary → Back to Dashboard

### 1.4 OAuth credentials erstellen
1. Sidebar → APIs & Services → **Credentials**
2. Top: **Create Credentials** → OAuth client ID
3. Application type: **Web application**
4. Name: `Career-Buddy Web`
5. Authorized redirect URIs → **Add URI** (drei stück):
   - `https://career-buddy.enigkt1.workers.dev/email-oauth-callback`
   - `http://localhost:8788/email-oauth-callback`
   - `https://gxnpfbzfqgbhnyqunuwf.supabase.co/auth/v1/callback`
     *(Supabase Auth Google-sign-in provider callback. Without this
     `/login` → "Continue with Google" returns Error 400
     redirect_uri_mismatch. Project ref hardcoded — change if you
     re-link to a different Supabase project.)*
5b. Authorized JavaScript origins → **Add URI** (drei stück):
   - `https://career-buddy.enigkt1.workers.dev`
   - `http://localhost:5173` *(vite dev)*
   - `http://localhost:8788` *(wrangler dev)*
6. → Create
7. Modal mit credentials erscheint → kopier dir:
   - **Client ID** (endet auf `.apps.googleusercontent.com`)
   - **Client secret** (kürzerer string)
8. → OK

Speicher beide kurz im password manager als
`GMAIL_OAUTH_CLIENT_ID` + `GMAIL_OAUTH_CLIENT_SECRET`.

---

## Step 2 — Azure Entra OAuth (Outlook)

### 2.1 App registration
1. https://entra.microsoft.com → log in mit Microsoft account
2. Sidebar → Identity → Applications → **App registrations**
3. → **+ New registration**
4. Name: `Career-Buddy`
5. Supported account types: **Accounts in any organizational
   directory + personal Microsoft accounts** (3rd option)
6. Redirect URI → Platform: **Web** → URI:
   `https://career-buddy.enigkt1.workers.dev/email-oauth-callback`
7. → Register

### 2.2 API permissions
1. Auf der neuen app-page → sidebar → **API permissions**
2. → + Add a permission → Microsoft Graph → **Delegated permissions**
3. Such + check:
   - `Mail.Read`
   - `Mail.Send`
   - `User.Read`
   - `offline_access`
   - `openid`, `email`, `profile`
4. → Add permissions
5. (Optional) → "Grant admin consent for ..." button — falls da,
   click. Sonst skipt's für personal-microsoft-accounts.

### 2.3 Zweite redirect URI (localhost)
1. Sidebar → Authentication
2. Section "Redirect URIs" → + Add URI:
   `http://localhost:8788/email-oauth-callback`
3. → Save (unten)

### 2.4 Client secret
1. Sidebar → **Certificates & secrets**
2. Tab "Client secrets" → + **New client secret**
3. Description: `Career-Buddy Phase 1.6`
4. Expires: **24 months** (Recommended)
5. → Add
6. **WICHTIG:** der `Value` wird nur EINMAL angezeigt — sofort kopieren.
   (Falls verloren: neuer secret erstellen, alten löschen.)

### 2.5 Client ID
1. Sidebar → **Overview**
2. Kopier **Application (client) ID** (UUID-shape)

Speicher beide:
- `OUTLOOK_OAUTH_CLIENT_ID` (Application client ID)
- `OUTLOOK_OAUTH_CLIENT_SECRET` (Value aus 2.4)

---

## Step 2.6 — Supabase Auth URL Configuration (CRITICAL)

Magic-link + Google sign-in redirect to whichever URL Supabase has
in **Site URL** unless your app's origin is whitelisted in
**Redirect URLs**. Default Site URL is `http://localhost:3000`
(Next.js default) — if you leave it there, every magic-link
clicked from production email lands on `localhost:3000/#access_token=...`
which is a different app on your machine (or nothing if you don't
run anything on :3000).

1. https://supabase.com/dashboard/project/gxnpfbzfqgbhnyqunuwf
2. **Authentication → URL Configuration**
3. **Site URL** → set to:
   ```
   https://career-buddy.enigkt1.workers.dev
   ```
4. **Redirect URLs** → Add URL (3 entries):
   ```
   https://career-buddy.enigkt1.workers.dev/**
   http://localhost:5173/**
   http://localhost:8788/**
   ```
5. **Save**

After this, `signInWithOtp({ email, options: { emailRedirectTo:
`${origin}/` } })` and `signInWithOAuth({ provider: "google",
options: { redirectTo: `${origin}/` } })` actually honour the
runtime origin instead of falling back to Site URL.

---

## Step 3 — Edge Functions env vars setzen

Generate noch einen secret (separater key für CSRF state token):

```bash
openssl rand -hex 32
```

Speicher als `OAUTH_STATE_SECRET`.

Dann Supabase Dashboard:

1. Project → **Edge Functions** (sidebar)
2. **Settings** → **Secrets** (oder direkt: "Manage secrets")
3. Add diese 7 env vars (Add Secret button für jeden):

```
OAUTH_STATE_SECRET          = <openssl-output aus oben>
GMAIL_OAUTH_CLIENT_ID       = <aus Step 1.4>
GMAIL_OAUTH_CLIENT_SECRET   = <aus Step 1.4>
GMAIL_OAUTH_REDIRECT_URI    = https://career-buddy.enigkt1.workers.dev/email-oauth-callback
OUTLOOK_OAUTH_CLIENT_ID     = <aus Step 2.5>
OUTLOOK_OAUTH_CLIENT_SECRET = <aus Step 2.4>
OUTLOOK_OAUTH_REDIRECT_URI  = https://career-buddy.enigkt1.workers.dev/email-oauth-callback
```

Save jeden.

---

## Step 4 — Edge functions deployen

Im terminal:

```bash
cd /path/to/career-buddy
npx supabase functions deploy email-oauth-start
npx supabase functions deploy email-oauth-callback
```

Wenn `npx supabase` nach login fragt → folgt anweisung (kurzer
browser redirect).

---

## Step 5 — `PHASE_AUTH_REQUIRED` flag

Erst NACH /login UI live + getestet (Schritt 3 / Spur B).

Dashboard → Edge Functions → Settings → Secrets:
```
PHASE_AUTH_REQUIRED = 1
```

Macht dass alle edge functions anon-calls rejecten.

---

## Smoke test (am Ende, nach /login UI live)

1. Login auf Career-Buddy als dev user
2. /profile → section 05 Email → "Connect Gmail" click
3. → redirect zu Google → grant scopes
4. → redirect zurück auf `/email-oauth-callback?code=...&state=...`
5. → /profile section 05 zeigt "Connected: enigkt1@gmail.com"
6. Supabase SQL editor verify:
   ```sql
   SELECT user_id, email, provider, octet_length(oauth_refresh_token) AS cipher_bytes
     FROM user_email_accounts;
   ```
   `cipher_bytes` muss > 0 sein (encrypted), NIE NULL für connected accounts.
7. Round-trip:
   ```sql
   SELECT length(decrypt_oauth_token(oauth_refresh_token)) FROM user_email_accounts;
   ```
   muss > 0 sein.

---

## Failure-mode handbook

| Error | Cause | Fix |
|---|---|---|
| "redirect_uri_mismatch" Google (inbox-connect) | URI in 1.4 nicht exakt gleich wie env var | Check trailing slash, http vs https |
| "redirect_uri_mismatch" Google (login / sign-in) | Supabase Auth callback `https://<ref>.supabase.co/auth/v1/callback` fehlt in 1.4 Authorized redirect URIs | Add it, save, retry |
| Magic-link redirects to `localhost:3000/#access_token=...` | Supabase Site URL still default (localhost:3000) + app origin not in Redirect URLs allow-list | Step 2.6 — set Site URL + add app origins. Then request a NEW magic link (old one expired by config change) |
| "AADSTS50011 redirect URI" Azure | Same issue Azure-side | Check 2.1 / 2.3 redirect URIs |
| "did not return refresh_token" | User hat schon mal granted | Revoke at https://myaccount.google.com/permissions + retry |
| Edge function 401 | OAUTH_STATE_SECRET missing | Set env var + redeploy function |
| Function 500 "vault secret missing" | master_key vault setup nicht gemacht | Run SETUP_MASTER_KEY.md |
