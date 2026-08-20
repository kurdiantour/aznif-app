import { getSnapshotVersion as getCoreSnapshotVersion } from "@/lib/multiplayer/core/versioning";

import type {
  DominoTileData,
  KozelBoardState,
  KozelBranch,
} from "@/types/game";

export type PendingMultiplayerMove = {
  requestId: string;
  roomId: string;
  tile: DominoTileData;
  branch: KozelBranch;
  baseVersion: number;
  visualBoard: KozelBoardState;
};

export function getSnapshotVersion(snapshot: any): number {
  return getCoreSnapshotVersion(snapshot);
}

export function boardContainsMove(
  board: KozelBoardState | null | undefined,
  tileId: string,
  branch: KozelBranch,
): boolean {
  if (!board) return false;
  if (board.centerTile?.id === tileId) return true;
  return board.branches[branch].tiles.some((tile) => tile.id === tileId);
}
