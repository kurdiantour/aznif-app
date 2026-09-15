import type { OkeyTile } from "@/okey/types/okey";

export type ScreenRect = { x: number; y: number; width: number; height: number };
export type TileFlight = {
  id: string;
  tile: OkeyTile | null;
  face: "front" | "back";
  from: ScreenRect;
  to: ScreenRect;
};
export type MeldDropRect = { playerId: string; meldId: string; x: number; y: number; width: number; height: number };
export type MeldOffset = { x: number; y: number };
