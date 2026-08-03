import type { OkeyTile } from "@/okey/types/okey";

export type ScreenRect = { x: number; y: number; width: number; height: number };
export type TileFlight = { id: string; tile: OkeyTile | null; face: "front" | "back"; from: ScreenRect; to: ScreenRect };
export type QueuedOpponentDiscardFlight = { tile: OkeyTile; ownerPlayerId: string; discardCount: number };
export type EliminatedTurnFlight = {
  playerIndex: number;
  playerId: string;
  tile: OkeyTile;
  stage: "draw" | "discard" | "committing";
  playerRect: ScreenRect;
  discardRect: ScreenRect;
};
export type MeldDropRect = { playerId: string; meldId: string; x: number; y: number; width: number; height: number };
export type MeldOffset = { x: number; y: number };
