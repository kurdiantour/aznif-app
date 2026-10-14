import { createClient } from "jsr:@supabase/supabase-js@2";
import { executeDamaLifecycle } from "../_shared/dama-lifecycle.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const secret = Deno.env.get("AZNIF_LIFECYCLE_SECRET") ?? "";
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!secret || request.headers.get("x-aznif-lifecycle-key") !== secret) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const body = await request.json();
    if (typeof body.match_id !== "string" || !Number.isSafeInteger(body.expected_version)) return json({ ok: false, error: "invalid_lifecycle_job" }, 400);
    const result = await executeDamaLifecycle({ service, matchId: body.match_id, expectedVersion: body.expected_version });
    return json({ ok: true, mode: "dama-lifecycle", result });
  } catch (error) {
    console.error("dama_lifecycle failed", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "dama_lifecycle_failed" }, 500);
  }
});
