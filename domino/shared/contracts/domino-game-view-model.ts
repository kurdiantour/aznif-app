import type { GameState } from "@/domino/types/domino-game";

export type DominoGameViewModel = GameState & {
  passTurn: () => boolean;
  drawTile: () => boolean;
  canDrawTile: boolean;
  hasPlayableTile: boolean;
  lastPassedPlayerId: string | null;
};