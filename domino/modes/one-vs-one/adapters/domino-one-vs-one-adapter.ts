import type { DominoTileData, KozelBranch } from "@/domino/types/domino-game";

export type DominoOneVsOneTurnTimeoutClaim = {
  expectedVersion: number;
  expectedTurnStartedAt: string;
  expectedTurnPlayerId: string;
};

export type DominoOneVsOneDrawTimeoutClaim = {
  expectedVersion: number;
  expectedDrawStartedAt: string;
  expectedTurnPlayerId: string;
};

export type DominoOneVsOneCommand =
  | { type: "play"; tile: DominoTileData; branch?: KozelBranch }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "timeout-pass"; claim: DominoOneVsOneTurnTimeoutClaim }
  | { type: "timeout-draw"; claim: DominoOneVsOneDrawTimeoutClaim };

export type DominoOneVsOneRoster = {
  rows: any[];
  profiles: any[] | null;
};

export type DominoOneVsOneSubscription = {
  onRoomInvalidated: (snapshot: unknown) => void;
  onRosterInvalidated: () => void;
  onTakeoverInvalidated: () => void;
  onStatus?: (channel: "rooms" | "players" | "moves", status: string, error?: unknown) => void;
};

export interface DominoOneVsOneAdapter<TSnapshot = any> {
  getCurrentUserId(): Promise<string | null>;
  getSnapshot(): Promise<TSnapshot>;
  getRoster(includeProfiles?: boolean): Promise<DominoOneVsOneRoster>;
  prepareLaunch(): Promise<TSnapshot>;
  startGame(): Promise<TSnapshot>;
  processBotTurn(): Promise<any>;
  dispatch(command: DominoOneVsOneCommand): Promise<TSnapshot>;
  subscribe(observer: DominoOneVsOneSubscription): () => void;
  reconnect(): Promise<TSnapshot>;
  leave(): Promise<void>;
}