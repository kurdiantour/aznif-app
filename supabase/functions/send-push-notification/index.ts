import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.1";
import { handleImmediatePush } from "../_shared/push-immediate.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const pushSendSecret = Deno.env.get("PUSH_SEND_SECRET");
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(req => handleImmediatePush(req, {
  async authorize(header) {
    if (!pushSendSecret) throw new Error("PUSH_SEND_SECRET is not configured");
    const token = /^Bearer (\S+)$/i.exec(header)?.[1];
    if (!token) return 401;
    return token === pushSendSecret ? null : 401;
  },
  async list(input, cursor) {
    let query = service.from("push_devices").select("id,user_id,expo_push_token").eq("active", true).eq("environment", input.environment).order("id").limit(100);
    if (input.userIds) query = query.in("user_id", input.userIds);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },
  async deactivate(device) {
    const { error } = await service.from("push_devices").update({ active: false, updated_at: new Date().toISOString() }).eq("id", device.id).eq("user_id", device.user_id).eq("expo_push_token", device.expo_push_token);
    if (error) throw error;
  },
  fetch,
  accessToken: Deno.env.get("EXPO_ACCESS_TOKEN"),
}));
