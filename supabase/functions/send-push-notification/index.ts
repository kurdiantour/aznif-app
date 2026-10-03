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
  async createCampaign(input) {
    const row = { id: input.campaignId, title: input.title, body: input.body, environment: input.environment,
      audience: input.userIds ? "users" : "all", user_ids: input.userIds, deep_link: input.deepLink ?? null };
    const { error: insertError } = await service.from("push_campaigns").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { data, error } = await service.from("push_campaigns").select("title,body,environment,audience,user_ids,deep_link").eq("id", input.campaignId).single();
    if (error) throw error;
    if (data.title !== row.title || data.body !== row.body || data.environment !== row.environment || data.audience !== row.audience ||
      JSON.stringify(data.user_ids) !== JSON.stringify(row.user_ids) || data.deep_link !== row.deep_link) throw new Error("campaign_id belongs to a different request");
  },
  async list(input, cursor) {
    let query = service.from("push_devices").select("id,user_id,platform,expo_push_token").eq("active", true).eq("environment", input.environment).order("id").limit(100);
    if (input.userIds) query = query.in("user_id", input.userIds);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },
  async claim(campaignId, device) {
    const { data, error } = await service.rpc("push_claim_device", { p_campaign: campaignId, p_device: device.id, p_user: device.user_id, p_platform: device.platform });
    if (error) throw error;
    return data === true;
  },
  async target(campaignId, device) {
    const { error } = await service.rpc("push_target_device", { p_campaign: campaignId, p_device: device.id, p_user: device.user_id, p_platform: device.platform });
    if (error) throw error;
  },
  async finish(campaignId, result) {
    const { error } = await service.from("push_campaign_devices").update({ status: result.status, expo_ticket_id: result.ticketId ?? null,
      error_code: result.error ?? null, resolved_at: new Date().toISOString() }).eq("campaign_id", campaignId).eq("device_id", result.deviceId);
    if (error) throw error;
  },
  async complete(campaignId) {
    const { error } = await service.from("push_campaigns").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", campaignId);
    if (error) throw error;
  },
  async deactivate(device) {
    const { error } = await service.from("push_devices").update({ active: false, updated_at: new Date().toISOString() }).eq("id", device.id).eq("user_id", device.user_id).eq("expo_push_token", device.expo_push_token);
    if (error) throw error;
  },
  fetch,
  accessToken: Deno.env.get("EXPO_ACCESS_TOKEN"),
}));
