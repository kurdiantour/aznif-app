import type { OkeyGameState, OkeyMeld } from "@/okey/types/okey";
import type { OkeyAuthoritativeCommand, OkeyServerProjection } from "@/okey/server/okey-authoritative";

export type OkeyMatchCommand =
  | { type: "draw"; source: "deck" | "discard" }
  | { type: "discard"; tileId: string }
  | { type: "sort-hand"; playerIndex: number }
  | { type: "move-tile"; playerIndex: number; tileId: string; targetIndex: number }
  | { type: "move-tiles"; playerIndex: number; tileIds: string[]; targetIndex: number }
  | { type: "open-melds"; playerIndex: number; melds: OkeyMeld[]; score: number }
  | { type: "declare-konkan"; playerIndex: number }
  | { type: "spend-best"; playerIndex: number; tileId: string }
  | { type: "spend-meld"; playerIndex: number; tileId: string; targetPlayerId: string; targetMeldId: string }
  | { type: "lock-konkan"; playerIndex: number; tileId: string; targetPlayerId: string; targetMeldId: string }
  | { type: "play-eliminated" };

export interface LocalOkeyMatchAdapter {
  readonly kind: "local";
  apply(state: OkeyGameState, command: OkeyMatchCommand): OkeyGameState;
}

export type OkeyMatchProjection = Omit<OkeyGameState, "players"> & {
  players: Array<Omit<OkeyGameState["players"][number], "hand"> & { hand?: OkeyGameState["players"][number]["hand"] }>;
};

export interface OnlineOkeyMatchAdapter {
  readonly kind: "online";
  getSnapshot(): OkeyServerProjection | null;
  subscribe(listener: (snapshot: OkeyServerProjection) => void): () => void;
  dispatch(command: OkeyAuthoritativeCommand): Promise<void>;
  reconnect(): Promise<void>;
  leave(): Promise<void>;
}
