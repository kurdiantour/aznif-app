import { applyMove } from '@/domino/core/engine/kozel-engine';
import { boardContainsMove, type PendingMultiplayerMove } from '@/lib/multiplayer/optimisticMove';
import type { DominoTileData, KozelBoardState, KozelBranch } from '@/types/game';

export function normalizeDominoTwoVsTwoSnapshot(snapshot: any) {
  const room = snapshot?.room ?? snapshot ?? {};
  const state = snapshot?.state ?? room?.state ?? {};
  return { ...room, ...state, mode: '2v2' as const,
    currentTurnPlayerId: state?.currentTurnPlayerId ?? room?.current_turn_player_id ?? null };
}

export function createDominoTwoVsTwoPendingMove(input: {
  roomId: string; tile: DominoTileData; branch: KozelBranch; baseVersion: number;
  board: KozelBoardState; spinnerValue: number | null; isOpeningRound: boolean; now?: number;
}): PendingMultiplayerMove {
  return {
    requestId: `${input.roomId}:${input.tile.id}:${input.now ?? Date.now()}`,
    roomId: input.roomId, tile: input.tile, branch: input.branch, baseVersion: input.baseVersion,
    visualBoard: applyMove(input.board, input.tile, input.branch, input.spinnerValue, input.isOpeningRound).board,
  };
}

export function isDominoTwoVsTwoMoveCommitted(state: any, version: number, pending: PendingMultiplayerMove | null) {
  return Boolean(pending && version > pending.baseVersion &&
    boardContainsMove(state?.board, pending.tile.id, pending.branch));
}
