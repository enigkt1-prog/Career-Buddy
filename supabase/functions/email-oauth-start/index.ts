// Career-Buddy email-oauth-start edge function.
// Phase 1.6 — kicks off the OAuth handshake for connecting a user's
// email inbox (Gmail or Outlook). Generates a signed state token
// (CSRF) and returns the provider authorise URL the frontend
// redirects the user to.
//
// Flow:
//   1. Frontend invokes this function with { provider: "gmail" | "outlook" }.
//   2. We validate the caller's JWT, generate a state token bound
//      to their user_id (HMAC over user_id + nonce + timestamp).
//   3. Return the provider authorise URL with state + scope.
//   4. User redirects to the URL, signs in, lands on
//      `/email-oauth-callback?code=...&state=...` which invokes the
//      callback edge function.
//
// State token format:
//   <base64url(user_id):base64url(nonce):base64url(ts):base64url(hmac)>
// HMAC key from env OAUTH_STATE_SECRET (random 32+ byte hex).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { authenticate, unauthorisedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Provider = "gmail" | "outlook";

const GMAIL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OUTLOOK_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
].join(" ");

const OUTLOOK_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "profile",
  "Mail.Read",
  "Mail.Send",
  "User.Read",
].join(" ");

function base64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = btoa(String.fromCharCode(...buf));
  s = s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return s;
}

async function hmacState(userId: string, nonce: string, ts: string): Promise<string> {
  const secret = Deno.env.get("OAUTH_STATE_SECRET");
  if (!secret) throw new Error("OAUTH_STATE_SECRET not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${userId}.${nonce}.${ts}`),
  );
  return base64url(new Uint8Array(sig));
}

async function buildState(userId: string): Promise<string> {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const ts = String(Date.now());
  const mac = await hmacState(userId, nonce, ts);
  return `${base64url(userId)}.${nonce}.${base64url(ts)}.${mac}`;
}

function providerConfig(provider: Provider) {
  if (provider === "gmail") {
    return {
      authUrl: GMAIL_AUTH_URL,
      clientId: Deno.env.get("GMAIL_OAUTH_CLIENT_ID"),
      scope: GMAIL_SCOPES,
      extras: { access_type: "offline", prompt: "consent" },
    };
  }
  if (provider === "outlook") {
    return {
      authUrl: OUTLOOK_AUTH_URL,
      clientId: Deno.env.get("OUTLOOK_OAUTH_CLIENT_ID"),
      scope: OUTLOOK_SCOPES,
      extras: { response_mode: "query", prompt: "consent" },
    };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const authResult = await authenticate(req);
  if (!authResult.ok) return unauthorisedResponse(authResult, corsHeaders);
  if (authResult.userId === "anonymous") {
    return jsonResponse({ error: "sign in required for OAuth connect" }, 401);
  }

  try {
    const body = await req.json();
    const provider = body?.provider as Provider | undefined;
    if (provider !== "gmail" && provider !== "outlook") {
      return jsonResponse({ error: "provider must be gmail | outlook" }, 400);
    }
    const conf = providerConfig(provider);
    if (!conf || !conf.clientId) {
      return jsonResponse(
        { error: `${provider} OAuth client_id not configured on server` },
        500,
      );
    }

    const redirectUri = Deno.env.get(
      provider === "gmail" ? "GMAIL_OAUTH_REDIRECT_URI" : "OUTLOOK_OAUTH_REDIRECT_URI",
    );
    if (!redirectUri) {
      return jsonResponse({ error: `${provider} OAuth redirect URI missing` }, 500);
    }

    const state = await buildState(authResult.userId);
    const params = new URLSearchParams({
      client_id: conf.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: conf.scope,
      state,
      ...conf.extras,
    });
    const authoriseUrl = `${conf.authUrl}?${params.toString()}`;
    return jsonResponse({ authoriseUrl });
  } catch (e) {
    console.error("email-oauth-start error:", e);
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
