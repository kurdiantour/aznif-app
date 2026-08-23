import type { DominoTileData } from "@/domino/types/domino-game";

export type DominoFlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

export type DominoTileFlight = {
  id: string;
  tile: DominoTileData;
  from: DominoFlightRect;
  to: DominoFlightRect;
};
