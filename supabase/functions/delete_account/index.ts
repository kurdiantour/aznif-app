import { createClient } from "jsr:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!url || !serviceRoleKey)
    return json({ error: "Server configuration is incomplete" }, 503);

  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data, error: userError } = await admin.auth.getUser(token);
  if (userError || !data.user)
    return json({ error: "Invalid auth token" }, 401);

  for (const mode of ["one_vs_one", "two_vs_two"]) {
    const { data: memberships, error: membershipError } = await admin
      .from(`${mode}_players`)
      .select("room_id")
      .eq("user_id", data.user.id);
    if (membershipError) return json({ error: membershipError.message }, 500);

    const roomIds = (memberships ?? []).map((row) => row.room_id);
    if (roomIds.length) {
      const { data: openRooms, error: roomsError } = await admin
        .from(`${mode}_rooms`)
        .select("id")
        .in("id", roomIds)
        .in("status", ["waiting", "active"])
        .limit(1);
      if (roomsError) return json({ error: roomsError.message }, 500);
      if (openRooms?.length) {
        return json(
          {
            error:
              "Leave or cancel active matches before deleting your account.",
          },
          409,
        );
      }
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(
    data.user.id,
  );
  if (deleteError) return json({ error: deleteError.message }, 500);

  return json({ deleted: true });
});
