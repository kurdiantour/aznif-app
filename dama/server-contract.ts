import {
  createDamaRoom,
  disconnectDamaPlayer,
  getDamaTurnSnapshot,
  reconnectDamaPlayer,
  resolveDamaRoomMove,
  resolveDamaTurnTimeout,
  type DamaMoveCommand,
  type DamaRoomState,
  type DamaRoomPlayer,
  type DamaMatchState,
} from "./authoritative.ts";
import type { Side } from "./engine.ts";

export type DamaServerAction =
  | "create"
  | "join"
  | "reconnect"
  | "leave"
  | "move"
  | "timeout"
  | "snapshot";

export type DamaCreateRoomRequest = {
  roomId: string;
  players?: Partial<Record<Side, string | null>>;
  createdAtMs?: number;
};

export type DamaJoinRequest = {
  roomId: string;
  playerId: string;
  color: Side;
};

export type DamaReconnectRequest = {
  roomId: string;
  playerId: string;
  color: Side;
};

export type DamaLeaveRequest = {
  roomId: string;
  playerId: string;
  color: Side;
};

export type DamaTimeoutRequest = {
  roomId: string;
  actorPlayerId: string;
  playerColor: Side;
  expectedVersion: number;
  expectedTurnId: string;
};

export type DamaRoomSnapshot = {
  roomId: string;
  matchId: string;
  version: number;
  turnId: string;
  turn: Side;
  remainingMs: number;
  expired: boolean;
  players: Record<Side, DamaRoomPlayer | null>;
  result: ReturnType<typeof getDamaTurnSnapshot> extends { expired: boolean }
    ? DamaMatchState["game"]["result"]
    : never;
};

export type DamaServerPayload =
  | DamaCreateRoomRequest
  | DamaJoinRequest
  | DamaReconnectRequest
  | DamaLeaveRequest
  | DamaMoveCommand
  | DamaTimeoutRequest
  | { roomId: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class DamaServerContract {
  private readonly rooms = new Map<string, DamaRoomState>();

  constructor(initialRooms: Iterable<[string, DamaRoomState]> = []) {
    for (const [roomId, room] of initialRooms) {
      this.rooms.set(roomId, room);
    }
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId) ?? null;
  }

  upsertRoom(room: DamaRoomState) {
    this.rooms.set(room.roomId, room);
    return room;
  }

  createRoom(roomId: string, players: Partial<Record<Side, string | null>> = {}, nowMs = Date.now()) {
    const room = this.rooms.get(roomId) ?? createDamaRoom(roomId, players, nowMs);
    this.rooms.set(roomId, room);
    return room;
  }

  getSnapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      roomId: room.roomId,
      matchId: room.match.matchId,
      version: room.match.version,
      turnId: room.match.turnId,
      turn: room.match.game.turn,
      remainingMs: getDamaTurnSnapshot(room.match).remainingMs,
      expired: getDamaTurnSnapshot(room.match).expired,
      players: room.players,
      result: room.match.game.result,
    } satisfies DamaRoomSnapshot;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method Not Allowed" }, 405);
    }

    let payload: { action?: string } & Record<string, unknown>;
    try {
      payload = (await request.clone().json()) as { action?: string } & Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const action = payload.action;
    if (!action) {
      return json({ ok: false, error: "Missing action" }, 400);
    }

    switch (action as DamaServerAction) {
      case "create": {
        const body = payload as DamaCreateRoomRequest;
        if (!body.roomId) {
          return json({ ok: false, error: "Missing roomId" }, 400);
        }

        const nowMs = body.createdAtMs ?? Date.now();
        const room = this.createRoom(body.roomId, body.players ?? {}, nowMs);
        return json({ ok: true, room, snapshot: this.getSnapshot(body.roomId) }, 200);
      }
      case "join": {
        const body = payload as DamaJoinRequest;
        if (!body.roomId || !body.playerId || !body.color) {
          return json({ ok: false, error: "Invalid join payload" }, 400);
        }

        const nowMs = Date.now();
        const room = this.rooms.get(body.roomId) ?? createDamaRoom(body.roomId, {}, nowMs);
        const nextRoom = room.players[body.color]
          ? reconnectDamaPlayer(room, body.playerId, body.color, nowMs)
          : {
              ...room,
              players: {
                ...room.players,
                [body.color]: {
                  color: body.color,
                  playerId: body.playerId,
                  connected: true,
                  lastSeenAtMs: nowMs,
                },
              },
              match: {
                ...room.match,
                players: {
                  ...room.match.players,
                  [body.color]: {
                    playerId: body.playerId,
                    connected: true,
                    lastSeenAtMs: nowMs,
                  },
                },
              },
              updatedAtMs: nowMs,
            };

        this.upsertRoom(nextRoom);
        return json({ ok: true, room: nextRoom, snapshot: this.getSnapshot(body.roomId) }, 200);
      }
      case "reconnect": {
        const body = payload as DamaReconnectRequest;
        const room = this.rooms.get(body.roomId);
        if (!room) {
          return json({ ok: false, error: "Room not found" }, 404);
        }

        const nextRoom = reconnectDamaPlayer(room, body.playerId, body.color, Date.now());
        this.upsertRoom(nextRoom);
        return json({ ok: true, room: nextRoom, snapshot: this.getSnapshot(body.roomId) }, 200);
      }
      case "leave": {
        const body = payload as DamaLeaveRequest;
        const room = this.rooms.get(body.roomId);
        if (!room) {
          return json({ ok: false, error: "Room not found" }, 404);
        }

        const nextRoom = disconnectDamaPlayer(room, body.playerId, body.color, Date.now());
        this.upsertRoom(nextRoom);
        return json({ ok: true, room: nextRoom, snapshot: this.getSnapshot(body.roomId) }, 200);
      }
      case "move": {
        const body = payload as DamaMoveCommand;
        const room = this.rooms.get(body.matchId.replace(/:match$/, ""));
        if (!room) {
          return json({ ok: false, error: "Room not found" }, 404);
        }

        const outcome = resolveDamaRoomMove(room, body, Date.now());
        if (!outcome.accepted) {
          return json({ ok: false, reason: outcome.reason, room: outcome.room, matchId: room.match.matchId, stateVersion: room.match.version, turnId: room.match.turnId }, 409);
        }

        this.upsertRoom(outcome.room);
        return json({ ok: true, room: outcome.room, snapshot: this.getSnapshot(room.roomId) }, 200);
      }
      case "timeout": {
        const body = payload as DamaTimeoutRequest;
        const room = this.rooms.get(body.roomId);
        if (!room) {
          return json({ ok: false, error: "Room not found" }, 404);
        }

        if (body.expectedVersion !== room.match.version) {
          return json({ ok: false, reason: "stale_state_version", room, snapshot: this.getSnapshot(body.roomId) }, 409);
        }

        if (body.expectedTurnId !== room.match.turnId) {
          return json({ ok: false, reason: "stale_turn", room, snapshot: this.getSnapshot(body.roomId) }, 409);
        }

        const nextRoom = {
          ...room,
          match: resolveDamaTurnTimeout(room.match, Date.now()),
          updatedAtMs: Date.now(),
        };

        this.upsertRoom(nextRoom);
        return json({ ok: true, room: nextRoom, snapshot: this.getSnapshot(body.roomId) }, 200);
      }
      case "snapshot": {
        const roomId = String((payload as { roomId?: string }).roomId ?? "");
        const snapshot = roomId ? this.getSnapshot(roomId) : null;
        if (!snapshot) {
          return json({ ok: false, error: "Room not found" }, 404);
        }
        return json({ ok: true, snapshot }, 200);
      }
      default:
        return json({ ok: false, error: "Invalid action" }, 400);
    }
  }
}
