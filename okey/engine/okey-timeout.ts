import { discardTile, drawTile } from "./okey-engine.ts";
import type { OkeyGameState } from "../types/okey.ts";

export type PreparedTimeoutTurn = {
  state: OkeyGameState;
  drawnTileId: string | null;
};

export function prepareTimeoutTurn(state: OkeyGameState, playerIndex: number): PreparedTimeoutTurn {
  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) {
    return { state, drawnTileId: null };
  }

  if (state.hasDrawnThisTurn) {
    return { state, drawnTileId: null };
  }

  const drawnTileId = state.deck[0]?.id ?? null;
  if (!drawnTileId) return { state, drawnTileId: null };

  return {
    state: drawTile(state, "deck"),
    drawnTileId,
  };
}

export function resolveTimeoutTurn(state: OkeyGameState, playerIndex: number): OkeyGameState {
  const prepared = prepareTimeoutTurn(state, playerIndex);
  if (prepared.drawnTileId) {
    return discardTile(prepared.state, prepared.drawnTileId);
  }

  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) return state;
  if (!state.hasDrawnThisTurn) return prepared.state;

  const player = state.players[playerIndex];
  const discardTileId = player?.hand[player.hand.length - 1]?.id;
  if (!discardTileId || !player?.hand.some((tile) => tile.id === discardTileId)) return state;

  return discardTile(state, discardTileId);
}
