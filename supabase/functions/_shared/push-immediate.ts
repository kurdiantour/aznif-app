export type Device = { id: string; user_id: string; expo_push_token: string };
export type Input = { title: string; body: string; environment: string; userIds: string[] | null; cursor?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseInput(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  const v = value as Record<string, unknown>;
  const keys = ["title", "body", "environment", "audience", "userIds", "userId", "cursor"];
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error("Unsupported field; only immediate sending is supported");
  if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 120 || typeof v.body !== "string" || !v.body.trim() || v.body.length > 1000) throw new Error("Invalid title or body");
  const environment = v.environment ?? "production";
  if (!["production", "development"].includes(String(environment))) throw new Error("Invalid environment");
  if (v.userId !== undefined && v.userIds !== undefined) throw new Error("Use userId or userIds");
  const ids = v.userIds ?? (v.userId !== undefined ? [v.userId] : null);
  if (ids === null ? v.audience !== "all" : v.audience !== undefined && v.audience !== "users") throw new Error("Specify audience: all or explicit userIds");
  if (ids !== null && (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string" || !uuid.test(id)))) throw new Error("Invalid userIds (1-100 UUIDs)");
  for (const key of ["cursor"]) if (v[key] !== undefined && (typeof v[key] !== "string" || !uuid.test(v[key] as string))) throw new Error("Invalid " + key);
  return { title: v.title, body: v.body, environment: String(environment), userIds: ids === null ? null : [...new Set(ids as string[])], cursor: v.cursor as string | undefined };
}
export function expoMessage(input: Input, device: Device) {
  return { to: device.expo_push_token, title: input.title, body: input.body, sound: "default", priority: "high", channelId: "general", ttl: 0 };
}
export type Dependencies = {
  authorize: (authorization: string) => Promise<401 | 403 | null>;
  list: (input: Input, cursor?: string) => Promise<Device[]>;
  deactivate: (device: Device) => Promise<void>;
  fetch: typeof fetch;
  accessToken?: string;
};
type Result = { deviceId: string; userId: string; status: "accepted" | "error" | "unknown"; ticketId?: string; error?: string; cleanupError?: string };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "POST,OPTIONS" };
export async function handleImmediatePush(req: Request, deps: Dependencies): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let input: Input;
  try {
    const denied = await deps.authorize(req.headers.get("Authorization") ?? "");
    if (denied) return reply({ error: denied === 401 ? "Unauthorized" : "Admin access required" }, denied);
  } catch { return reply({ error: "Authorization unavailable" }, 503); }
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > 65536) return reply({ error: "Request too large" }, 413);
    input = parseInput(JSON.parse(text));
    // APNs/FCM payloads must fit within 4 KiB, including multibyte text.
    if (new TextEncoder().encode(JSON.stringify(expoMessage(input, { id: "", user_id: "0".repeat(36), expo_push_token: "0".repeat(200) }))).length > 3800) throw new Error("Notification payload too large");
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Invalid request" }, 400); }
  const results: Result[] = [];
  let cursor = input.cursor;
  const started = Date.now();
  // Bounded synchronous fan-out. Caller explicitly continues; no stored work or retries.
  for (let batch = 0; batch < 5; batch++) {
    let devices: Device[];
    try { devices = await deps.list(input, cursor); }
    catch { return reply({ complete: false, nextCursor: cursor ?? null, results, error: "Device lookup failed" }, 503); }
    if (!devices.length) return reply({ complete: true, results });
    const messages = devices.map(d => expoMessage(input, d));
    let tickets: { status?: string; id?: string; message?: string; details?: { error?: string } }[];
    try {
      const response = await deps.fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json", ...(deps.accessToken ? { Authorization: "Bearer " + deps.accessToken } : {}) }, body: JSON.stringify(messages), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("ExpoHTTP:" + response.status);
      const body = await response.json();
      if (!Array.isArray(body.data) || body.data.length !== devices.length) throw new Error("Invalid Expo response");
      tickets = body.data;
    } catch (error) {
      for (const d of devices) results.push({ deviceId: d.id, userId: d.user_id, status: "unknown", error: error instanceof Error ? error.message : "Expo request failed" });
      return reply({ complete: false, nextCursor: devices.at(-1)!.id, results, error: "Stopped; current batch outcome may be unknown. No automatic retry." }, 502);
    }
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i], ticket = tickets[i];
      const accepted = ticket?.status === "ok" && typeof ticket.id === "string";
      const result: Result = { deviceId: d.id, userId: d.user_id, status: accepted ? "accepted" : ticket?.status === "error" ? "error" : "unknown", ...(accepted ? { ticketId: ticket.id } : { error: ticket?.details?.error ?? ticket?.message ?? "Invalid Expo ticket" }) };
      if (ticket?.details?.error === "DeviceNotRegistered") {
        try { await deps.deactivate(d); } catch { result.cleanupError = "Device deactivation failed"; }
      }
      results.push(result);
    }
    cursor = devices.at(-1)!.id;
    if (devices.length < 100) return reply({ complete: true, results });
    if (Date.now() - started >= 20000) break;
  }
  return reply({ complete: false, nextCursor: cursor, results });
}
