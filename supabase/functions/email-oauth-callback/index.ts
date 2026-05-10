// Career-Buddy email-oauth-callback edge function.
// Phase 1.6 — completes the OAuth handshake started by
// email-oauth-start. Exchanges the authorization code for tokens,
// encrypts the refresh_token via 0016's pgcrypto helpers, and
// upserts a row into user_email_accounts.
//
// Flow:
//   1. Provider redirects user to <site>/email-oauth-callback?code=...&state=...
//   2. Frontend invokes this function with { provider, code, state }.
//   3. We validate state HMAC (binds user_id to the request), exchange
//      code for access + refresh tokens against the provider's
//      token endpoint, fetch the connected account's email address,
//      and upsert the encrypted refresh_token into user_email_accounts.
//
// Service-role key is used here because user_email_accounts has an
// RLS policy on INSERT (auth.uid() = user_id), AND we need to RPC
// the SECURITY DEFINER encrypt_oauth_token() function which only
// service_role can EXECUTE. We re-impose the per-user constraint
// in code via the state token's verified user_id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Provider = "gmail" | "outlook";

const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OUTLOOK_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GMAIL_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const OUTLOOK_USERINFO = "https://graph.microsoft.com/v1.0/me";

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function fromBase64url(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

async function hmacState(userId: string, nonce: string, tsB64: string): Promise<string> {
  const secret = Deno.env.get("OAUTH_STATE_SECRET");
  if (!secret) throw new Error("OAUTH_STATE_SECRET not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const ts = fromBase64url(tsB64);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${userId}.${nonce}.${ts}`),
  );
  const bytes = new Uint8Array(sig);
  let str = btoa(String.fromCharCode(...bytes));
  str = str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return str;
}

async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [uidB64, nonce, tsB64, macIn] = parts;
  const userId = fromBase64url(uidB64);
  const ts = parseInt(fromBase64url(tsB64), 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > STATE_MAX_AGE_MS) {
    return null;
  }
  const expected = await hmacState(userId, nonce, tsB64);
  if (expected !== macIn) return null;
  return userId;
}

function providerConfig(provider: Provider) {
  if (provider === "gmail") {
    return {
      tokenUrl: GMAIL_TOKEN_URL,
      userinfoUrl: GMAIL_USERINFO,
      clientId: Deno.env.get("GMAIL_OAUTH_CLIENT_ID"),
      clientSecret: Deno.env.get("GMAIL_OAUTH_CLIENT_SECRET"),
      redirectUri: Deno.env.get("GMAIL_OAUTH_REDIRECT_URI"),
      emailField: "email",
    };
  }
  if (provider === "outlook") {
    return {
      tokenUrl: OUTLOOK_TOKEN_URL,
      userinfoUrl: OUTLOOK_USERINFO,
      clientId: Deno.env.get("OUTLOOK_OAUTH_CLIENT_ID"),
      clientSecret: Deno.env.get("OUTLOOK_OAUTH_CLIENT_SECRET"),
      redirectUri: Deno.env.get("OUTLOOK_OAUTH_REDIRECT_URI"),
      emailField: "mail",
    };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const provider = body?.provider as Provider | undefined;
    const code = body?.code as string | undefined;
    const state = body?.state as string | undefined;
    if ((provider !== "gmail" && provider !== "outlook") || !code || !state) {
      return jsonResponse({ error: "provider + code + state required" }, 400);
    }

    const userId = await verifyState(state);
    if (!userId) {
      return jsonResponse({ error: "invalid or expired state token" }, 401);
    }

    const conf = providerConfig(provider);
    if (!conf?.clientId || !conf?.clientSecret || !conf?.redirectUri) {
      return jsonResponse({ error: `${provider} OAuth env vars missing` }, 500);
    }

    // Exchange code for tokens.
    const tokenResp = await fetch(conf.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: conf.clientId,
        client_secret: conf.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: conf.redirectUri,
      }).toString(),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      console.error(`${provider} token exchange failed`, tokenResp.status, text.slice(0, 200));
      return jsonResponse({ error: `${provider} token exchange failed` }, 502);
    }
    const tokens = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.refresh_token) {
      return jsonResponse(
        { error: `${provider} did not return a refresh_token; user may have already granted (revoke + retry)` },
        502,
      );
    }

    // Resolve the connected account's email.
    const userResp = await fetch(conf.userinfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userResp.ok) {
      return jsonResponse({ error: `${provider} userinfo fetch failed` }, 502);
    }
    const userData = (await userResp.json()) as Record<string, unknown>;
    const email =
      (userData[conf.emailField] as string | undefined) ??
      (userData["userPrincipalName"] as string | undefined);
    if (!email) {
      return jsonResponse({ error: `${provider} userinfo missing email` }, 502);
    }

    // Service-role client for the RPC + insert. We re-impose the
    // per-user constraint via the state-verified userId.
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      return jsonResponse({ error: "SUPABASE service env vars missing" }, 500);
    }
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: cipher, error: encErr } = await admin.rpc("encrypt_oauth_token", {
      plaintext: tokens.refresh_token,
    });
    if (encErr || !cipher) {
      console.error("encrypt_oauth_token RPC failed", encErr);
      return jsonResponse({ error: "token encryption failed" }, 500);
    }

    const { error: insertErr } = await admin
      .from("user_email_accounts")
      .upsert(
        {
          user_id: userId,
          email,
          provider,
          oauth_refresh_token: cipher,
        } as never,
        { onConflict: "user_id,email" },
      );
    if (insertErr) {
      console.error("upsert user_email_accounts failed", insertErr);
      return jsonResponse({ error: "could not persist email account" }, 500);
    }

    return jsonResponse({ ok: true, provider, email });
  } catch (e) {
    console.error("email-oauth-callback error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
