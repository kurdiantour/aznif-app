export const GAME_ROOM_PROTOCOL_VERSION = 1 as const;
export type GameRoomType = "okey" | "domino_1v1" | "domino_2v2";
export type GameRoomClientMessage =
  | { type: "authenticate"; requestId: string; ticket: string; protocolVersion: 1 }
  | { type: "join_room"; requestId: string; gameType: GameRoomType; roomId: string; connectionId: string }
  | { type: "leave_room"; requestId: string; gameType: GameRoomType; roomId: string; connectionId: string; generation: number }
  | { type: "ping"; requestId: string; sentAt: number };
export type GameRoomServerMessage =
  | { type: "authenticated"; requestId: string; userId: string }
  | { type: "room_joined"; requestId: string; gameType: GameRoomType; roomId: string; connectionId: string; generation: number; leaseVersion: number; phase: "waiting" | "playing" | "finished" }
  | { type: "room_left"; requestId: string; gameType: GameRoomType; roomId: string; released: boolean; phase: string }
  | { type: "membership_released"; gameType: GameRoomType; roomId: string; reason: "manual_leave" | "disconnect_timeout" }
  | { type: "connection_state"; gameType: GameRoomType; roomId: string; state: "healthy" | "reconnecting" | "disconnected" }
  | { type: "pong"; requestId: string; sentAt: number; serverAt: number }
  | { type: "error"; requestId?: string; code: string; message: string };
export type JoinedRoomLease = { gameType: GameRoomType; roomId: string; connectionId: string; generation: number; leaseVersion: number; phase: "waiting" | "playing" | "finished" };
