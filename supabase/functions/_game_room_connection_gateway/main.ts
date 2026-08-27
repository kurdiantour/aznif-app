import { createClient } from "@supabase/supabase-js";

type GameType = "okey" | "domino_1v1" | "domino_2v2";
type Lease = { gameType: GameType; roomId: string; connectionId: string; generation: number };
type Client = { socket: WebSocket; userId: string | null; lastPingAt: number; leases: Map<string, Lease> };
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const clients = new Set<Client>();
const GRACE_SECONDS = Number(Deno.env.get("GAME_ROOM_GRACE_SECONDS") ?? 15);
const HEALTH_TIMEOUT_MS = 35_000;
const send = (socket: WebSocket, value: unknown) => socket.send(JSON.stringify(value));
const rpc = (name: string, args: Record<string, unknown>) => db.rpc(`game_room_connection_${name}`, args);

async function disconnect(client: Client) {
  clients.delete(client);
  if (!client.userId) return;
  for (const lease of client.leases.values()) await rpc("begin_disconnect", {
    p_user: client.userId, p_game: lease.gameType, p_room: lease.roomId,
    p_connection: lease.connectionId, p_generation: lease.generation, p_grace: GRACE_SECONDS,
  });
}
async function takeOverLocalSession(current: Client, lease: Lease) {
  for (const other of clients) {
    if (other === current || other.userId !== current.userId) continue;
    const old = other.leases.get(`${lease.gameType}:${lease.roomId}`);
    if (!old || old.connectionId === lease.connectionId) continue;
    await rpc("detach_connection", { p_user: other.userId, p_game: old.gameType, p_room: old.roomId, p_connection: old.connectionId, p_generation: old.generation });
    other.leases.delete(`${lease.gameType}:${lease.roomId}`);
    try { other.socket.close(4001, "session_taken_over"); } catch {}
  }
}

Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8787) }, (request) => {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Game Room Connection Gateway", { status: 200 });
  const { socket, response } = Deno.upgradeWebSocket(request);
  const client: Client = { socket, userId: null, lastPingAt: Date.now(), leases: new Map() };
  clients.add(client);
  socket.onmessage = (event) => { void (async () => {
    let message: any;
    try { message = JSON.parse(String(event.data)); } catch { return send(socket, { type: "error", code: "invalid_json", message: "Invalid JSON" }); }
    try {
      if (message.type === "authenticate") {
        if (client.userId) throw new Error("already_authenticated");
        const { data, error } = await rpc("consume_ticket", { p_ticket: message.ticket });
        if (error || !data) throw new Error("invalid_ticket");
        client.userId = String(data); client.lastPingAt = Date.now();
        return send(socket, { type: "authenticated", requestId: message.requestId, userId: client.userId });
      }
      if (!client.userId) throw new Error("authentication_required");
      if (message.type === "ping") { client.lastPingAt = Date.now(); return send(socket, { type: "pong", requestId: message.requestId, sentAt: message.sentAt, serverAt: Date.now() }); }
      if (message.type === "join_room") {
        const { data, error } = await rpc("join_room", { p_user: client.userId, p_game: message.gameType, p_room: message.roomId, p_connection: message.connectionId });
        if (error) throw error;
        const lease = { gameType: message.gameType, roomId: message.roomId, connectionId: message.connectionId, generation: Number(data.generation) };
        client.leases.set(`${lease.gameType}:${lease.roomId}`, lease);
        await takeOverLocalSession(client, lease);
        return send(socket, { type: "room_joined", requestId: message.requestId, ...lease, leaseVersion: Number(data.leaseVersion), phase: data.phase });
      }
      if (message.type === "leave_room") {
        const { data, error } = await rpc("detach_connection", { p_user: client.userId, p_game: message.gameType, p_room: message.roomId, p_connection: message.connectionId, p_generation: message.generation });
        if (error) throw error;
        client.leases.delete(`${message.gameType}:${message.roomId}`);
        return send(socket, { type: "room_left", requestId: message.requestId, gameType: message.gameType, roomId: message.roomId, released: Boolean(data?.released), phase: data?.phase ?? "detached" });
      }
      throw new Error("invalid_message");
    } catch (error) { send(socket, { type: "error", requestId: message.requestId, code: "request_failed", message: error instanceof Error ? error.message : "request_failed" }); }
  })(); };
  socket.onclose = () => { void disconnect(client); };
  socket.onerror = () => socket.close();
  return response;
});

setInterval(() => {
  const cutoff = Date.now() - HEALTH_TIMEOUT_MS;
  for (const client of clients) if (client.lastPingAt < cutoff) client.socket.close(4000, "heartbeat_timeout");
}, 5_000);
