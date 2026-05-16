// Career-Buddy news-feed edge function (F3 — News v2).
//
// Thin transport wrapper: binds `handleRequest` (in `handler.ts`) to the
// Deno HTTP server. All logic lives in the handler so it stays testable.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { handleRequest } from "./handler.ts";

serve(handleRequest);
