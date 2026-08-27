import { createClient } from "npm:@supabase/supabase-js@2.106.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ticket, error: ticketError } = await service.rpc("game_room_connection_issue_ticket", { p_user_id: data.user.id });
  if (ticketError) return Response.json({ error: "ticket_failed" }, { status: 500, headers: cors });
  return Response.json({ ticket, expiresInSeconds: 30 }, { headers: { ...cors, "Cache-Control": "no-store" } });
});
