import { applyMove } from "@/domino/core/engine/kozel-engine";
import {
  acceptsSnapshot,
  getSnapshotVersion,
  reconcileOptimisticCommand,
} from "@/lib/multiplayer/core/versioning";
import type { OptimisticCommand } from "@/lib/multiplayer/core/types";
import type { DominoTileData, KozelBoardState, KozelBranch } from "@/types/game";

export type DominoOneVsOneMovePayload = { tile: DominoTileData; branch: KozelBranch };
export type DominoOneVsOneOptimisticMove = OptimisticCommand<
  DominoOneVsOneMovePayload,
  KozelBoardState
>;

export type DominoOneVsOnePendingMove = {
  requestId: string;
  roomId: string;
  tile: DominoTileData;
  branch: KozelBranch;
  baseVersion: number;
  visualBoard: KozelBoardState;
};

export function normalizeDominoOneVsOneSnapshot(snapshot: any) {
  return {
    ...(snapshot ?? {}),
    ...(snapshot?.state ?? {}),
    mode: "1v1" as const,
    currentTurnPlayerId:
      snapshot?.state?.currentTurnPlayerId ?? snapshot?.current_turn_player_id ?? null,
  };
}

export function createDominoOneVsOneOptimisticMove(input: {
  roomId: string;
  baseVersion: number;
  board: KozelBoardState;
  tile: DominoTileData;
  branch: KozelBranch;
  spinnerValue: number | null;
  isOpeningRound: boolean;
  requestId?: string;
}): DominoOneVsOneOptimisticMove {
  return {
    id: input.requestId ?? `${input.roomId}:${input.tile.id}:${Date.now()}`,
    scopeId: input.roomId,
    baseVersion: input.baseVersion,
    payload: { tile: input.tile, branch: input.branch },
    projection: applyMove(
      input.board,
      input.tile,
      input.branch,
      input.spinnerValue,
      input.isOpeningRound,
    ).board,
  };
}

export function reconcileDominoOneVsOneMove(
  pending: DominoOneVsOneOptimisticMove | null,
  snapshot: any,
) {
  return reconcileOptimisticCommand(pending, snapshot, (command, current) => {
    const board = normalizeDominoOneVsOneSnapshot(current).board as KozelBoardState | undefined;
    if (!board) return false;
    if (board.centerTile?.id === command.payload.tile.id) return true;
    return board.branches[command.payload.branch].tiles.some(
      (tile) => tile.id === command.payload.tile.id,
    );
  });
}

export class DominoOneVsOneSnapshotController {
  private version = -1;
  private snapshot: any = null;
  private pendingMove: DominoOneVsOnePendingMove | null = null;

  apply(snapshot: any): boolean {
    if (!acceptsSnapshot(this.version, snapshot)) return false;
    this.version = Math.max(this.version, getSnapshotVersion(snapshot));
    this.snapshot = normalizeDominoOneVsOneSnapshot(snapshot);
    const pending = this.pendingMove;
    if (
      pending &&
      getSnapshotVersion(snapshot) > pending.baseVersion &&
      reconcileDominoOneVsOneMove({
        id: pending.requestId,
        scopeId: pending.roomId,
        baseVersion: pending.baseVersion,
        payload: { tile: pending.tile, branch: pending.branch },
        projection: pending.visualBoard,
      }, snapshot).confirmed
    ) {
      this.pendingMove = null;
    }
    return true;
  }

  beginOptimisticMove(input: Parameters<typeof createDominoOneVsOneOptimisticMove>[0]) {
    const command = createDominoOneVsOneOptimisticMove(input);
    this.pendingMove = {
      requestId: command.id,
      roomId: command.scopeId,
      tile: command.payload.tile,
      branch: command.payload.branch,
      baseVersion: command.baseVersion,
      visualBoard: command.projection,
    };
    return this.pendingMove;
  }

  clearPendingMove(requestId?: string) {
    if (!requestId || this.pendingMove?.requestId === requestId) this.pendingMove = null;
    return this.pendingMove;
  }

  getSnapshot() { return this.snapshot; }
  getVersion() { return this.version; }
  getPendingMove() { return this.pendingMove; }
}
