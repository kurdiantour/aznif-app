import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import type { OkeyGameState, OkeyTile } from "../types/okey.ts";
import { isOkeyWildcard } from "./okeyengine-melds.ts";

const COUNTER_CLOCKWISE_TURN_ORDER =
  OKEY_RULESET_V1.table.counterClockwiseTurnOrder;

export function getTurnMessage(
  playerName: string,
  hasDrawnThisTurn: boolean,
): OkeyGameState["turnMessage"] {
  return {
    code: hasDrawnThisTurn ? "discard-tile" : "draw-tile",
    playerName,
  };
}

export function withJokerOrigin(
  tile: OkeyTile,
  okeyTile: OkeyTile,
  jokerOrigin: "natural" | "stolen",
): OkeyTile {
  return isOkeyWildcard(tile, okeyTile)
    ? { ...tile, jokerOrigin }
    : tile;
}

export function withoutTile(
  tiles: OkeyTile[],
  tileId: string,
): OkeyTile[] {
  return tiles.filter((tile) => tile.id !== tileId);
}

function getNextCounterClockwisePlayerIndex(currentPlayerIndex: number) {
  const currentTurnOrderIndex = COUNTER_CLOCKWISE_TURN_ORDER.findIndex(
    (playerIndex) => playerIndex === currentPlayerIndex,
  );
  if (currentTurnOrderIndex < 0) return COUNTER_CLOCKWISE_TURN_ORDER[0];
  return COUNTER_CLOCKWISE_TURN_ORDER[
    (currentTurnOrderIndex + 1) % COUNTER_CLOCKWISE_TURN_ORDER.length
  ];
}

export function advanceTurn(state: OkeyGameState): OkeyGameState {
  return {
    ...state,
    currentPlayerIndex: getNextCounterClockwisePlayerIndex(
      state.currentPlayerIndex,
    ),
    hasDrawnThisTurn: false,
  };
}
