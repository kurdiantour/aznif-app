import { supabase } from "@/lib/supabase";
import { GAME_ROOM_PROTOCOL_VERSION, type GameRoomClientMessage, type GameRoomServerMessage, type GameRoomType, type JoinedRoomLease } from "./game-room-protocol";
import { SocketHealthMonitor, type SocketHealth } from "./socket-health";

type PendingRequest = { socket: WebSocket; resolve: (message: GameRoomServerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Listener = (message: GameRoomServerMessage) => void;
const REQUEST_TIMEOUT_MS = 12_000;
const PING_INTERVAL_MS = 20_000;
function randomId() { return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export class GameRoomConnection {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<Listener>();
  private readonly leases = new Map<string, JoinedRoomLease>();
  private readonly healthMonitor = new SocketHealthMonitor();
  private _health: SocketHealth = "idle";
  constructor(private readonly url = process.env.EXPO_PUBLIC_GAME_ROOM_WS_URL ?? "") {}
  get health() { return this._health; }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async joinRoom(gameType: GameRoomType, roomId: string): Promise<JoinedRoomLease> {
    await this.ensureConnected();
    const existing = this.leases.get(`${gameType}:${roomId}`);
    const response = await this.request({ type: "join_room", requestId: randomId(), gameType, roomId, connectionId: existing?.connectionId ?? randomId() });
    if (response.type !== "room_joined") throw new Error("game_room_join_failed");
    this.leases.set(`${gameType}:${roomId}`, response); return response;
  }
  async leaveRoom(gameType: GameRoomType, roomId: string) {
    const key = `${gameType}:${roomId}`; const lease = this.leases.get(key); if (!lease) return null;
    const response = await this.request({ type: "leave_room", requestId: randomId(), gameType, roomId, connectionId: lease.connectionId, generation: lease.generation });
    this.leases.delete(key); return response;
  }
  private async ensureConnected() {
    if (!this.url) throw new Error("EXPO_PUBLIC_GAME_ROOM_WS_URL is required");
    if (this.socket?.readyState === WebSocket.OPEN && this.healthMonitor.isHealthy()) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = null; }); return this.connecting;
  }
  private async open() {
    this._health = this.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    const { data, error } = await supabase.functions.invoke("game_room_ticket"); if (error) throw error;
    if (typeof data?.ticket !== "string") throw new Error("game_room_ticket_failed");
    const socket = new WebSocket(this.url); this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.socket === socket) socket.close(); reject(new Error("game_room_socket_timeout")); }, REQUEST_TIMEOUT_MS);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error("game_room_socket_error")); };
    });
    socket.onmessage = (event) => { if (this.socket === socket) this.onMessage(socket, String(event.data)); };
    socket.onclose = () => this.onClose(socket);
    const auth = await this.request({ type: "authenticate", requestId: randomId(), ticket: data.ticket, protocolVersion: GAME_ROOM_PROTOCOL_VERSION } as GameRoomClientMessage, socket);
    if (this.socket !== socket || auth.type !== "authenticated") throw new Error("game_room_auth_failed");
    this.healthMonitor.observePong(); this._health = "healthy"; this.reconnectAttempt = 0; this.startPing(socket);
    for (const lease of [...this.leases.values()]) await this.joinRoom(lease.gameType, lease.roomId);
  }
  private request(message: GameRoomClientMessage, socket = this.socket) {
    return new Promise<GameRoomServerMessage>((resolve, reject) => {
      if (!socket || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return reject(new Error("game_room_socket_not_open"));
      const timer = setTimeout(() => { const pending = this.pending.get(message.requestId); if (pending?.socket === socket) this.pending.delete(message.requestId); reject(new Error("game_room_request_timeout")); }, REQUEST_TIMEOUT_MS);
      this.pending.set(message.requestId, { socket, resolve, reject, timer }); socket.send(JSON.stringify(message));
    });
  }
  private onMessage(socket: WebSocket, raw: string) {
    if (this.socket !== socket) return;
    let message: GameRoomServerMessage; try { message = JSON.parse(raw) as GameRoomServerMessage; } catch { return; }
    if (message.type === "pong") this.healthMonitor.observePong();
    const requestId = "requestId" in message ? message.requestId : undefined;
    if (requestId) { const pending = this.pending.get(requestId); if (pending?.socket === socket) { clearTimeout(pending.timer); this.pending.delete(requestId); message.type === "error" ? pending.reject(new Error(`${message.code}: ${message.message}`)) : pending.resolve(message); } }
    for (const listener of this.listeners) listener(message);
  }
  private startPing(socket: WebSocket) {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => { if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return; void this.request({ type: "ping", requestId: randomId(), sentAt: Date.now() }, socket).catch(() => { if (this.socket === socket) socket.close(); }); }, PING_INTERVAL_MS);
  }
  private onClose(socket: WebSocket) {
    for (const [id, request] of this.pending) if (request.socket === socket) { clearTimeout(request.timer); request.reject(new Error("game_room_socket_closed")); this.pending.delete(id); }
    if (this.socket !== socket) return;
    this.socket = null; if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; this.healthMonitor.reset();
    if (this.leases.size === 0) { this._health = "closed"; return; }
    this._health = "reconnecting"; const delay = Math.min(1_000 * 2 ** this.reconnectAttempt++, 15_000);
    if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.ensureConnected().catch(() => { if (this.socket) this.onClose(this.socket); }); }, delay);
  }
}
export const gameRoomConnection = new GameRoomConnection();
