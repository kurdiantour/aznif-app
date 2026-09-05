import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import {
  getOkeyOpenAction,
  resolveTableMeldAction,
  type OkeyTableMeldAction,
} from "@/okey/engine/okey-engine";
import { getOrderedKonkanRunCandidates } from "@/okey/engine/okey-rack-layout";
import type { OkeyGameState, OkeyMeld, OkeyPlayer, OkeyTile } from "@/okey/types/okey";

type RackMeldSelection = {
  melds: OkeyMeld[];
  score: number;
  contiguousGroups: OkeyTile[][];
};

/**
 * Presentation-only command availability. These selectors never transition
 * authoritative state; every submitted command is validated again by the
 * server-owned reducer.
 */
export function useOkeyTableActions(input: {
  state: OkeyGameState;
  humanPlayer: OkeyPlayer;
  isHumanTurn: boolean;
  selectedTileId: string | null;
  rackMeldSelection: RackMeldSelection;
  declareKonkan: (orderedRunTileIds: string[]) => unknown;
  commitOpenIntent: (melds: OkeyMeld[], score: number) => unknown;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    state,
    humanPlayer,
    isHumanTurn,
    selectedTileId,
    rackMeldSelection,
    declareKonkan,
    commitOpenIntent,
    setSelectedTileId,
  } = input;

  const topDiscardOwner = state.discardOwners[state.discardOwners.length - 1] ?? null;
  const topDiscardBlocked = !!topDiscardOwner && !!state.players[topDiscardOwner.playerIndex]?.eliminated;
  const canDraw = isHumanTurn && !humanPlayer.eliminated && !state.hasDrawnThisTurn;
  const canPlayAfterDraw = isHumanTurn && !humanPlayer.eliminated && state.hasDrawnThisTurn;
  const selectedTile = humanPlayer.hand.find((tile) => tile.id === selectedTileId);
  const openAction = useMemo(
    () => getOkeyOpenAction(
      state,
      state.players.findIndex((player) => player.id === humanPlayer.id),
      rackMeldSelection.melds,
      getOrderedKonkanRunCandidates(rackMeldSelection.contiguousGroups),
    ),
    [humanPlayer.id, rackMeldSelection.contiguousGroups, rackMeldSelection.melds, state],
  );

  const executeOpenAction = useCallback(() => {
    if (openAction.mode === "declare-konkan") {
      declareKonkan(openAction.orderedRunTileIds);
    } else if (openAction.mode === "open-melds") {
      commitOpenIntent(openAction.melds, openAction.score);
    }
    setSelectedTileId(null);
  }, [commitOpenIntent, declareKonkan, openAction, setSelectedTileId]);
  return {
    canDraw,
    canDrawDiscard: canDraw && !topDiscardBlocked,
    canPlayAfterDraw,
    canDiscardTile: canPlayAfterDraw,
    canDiscardSelectedTile: canPlayAfterDraw && !!selectedTile,
    selectedTile,
    openAction,
    executeOpenAction,
    openActionButtonLabel: openAction.mode === "declare-konkan" ? "\u06A9\u06C6\u0646\u06A9\u0627\u0646" : "\u0695\u0627\u062E\u0633\u062A\u0646",
    remainingMeldSlots: openAction.remainingSlots,
    selectOpenAction: (melds: OkeyMeld[], orderedKonkanRuns: string[][] = []) =>
      getOkeyOpenAction(
        state,
        state.players.findIndex((player) => player.id === humanPlayer.id),
        melds,
        orderedKonkanRuns,
      ),
    selectTableMeldAction: (tileId: string, targetPlayerId: string, targetMeldId: string): OkeyTableMeldAction | null =>
      resolveTableMeldAction(
        state,
        state.players.findIndex((player) => player.id === humanPlayer.id),
        tileId,
        targetPlayerId,
        targetMeldId,
      ),
  };
}

export function useOkeyRackTileInteraction(input: {
  canDiscardTile: boolean;
  canDiscardSelectedTile: boolean;
  selectedTileId: string | null;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  discardTile: (tileId: string) => void;
  emitFeedback: (event: "rack-select", key: string) => void;
}) {
  const lastTapRef = useRef<{ tileId: string; tappedAt: number } | null>(null);
  const { canDiscardTile, canDiscardSelectedTile, selectedTileId, setSelectedTileId, discardTile, emitFeedback } = input;
  return useCallback((tileId: string) => {
    const tappedAt = Date.now();
    const previousTap = lastTapRef.current;
    lastTapRef.current = { tileId, tappedAt };
    if (canDiscardTile && previousTap?.tileId === tileId && tappedAt - previousTap.tappedAt <= 350) {
      lastTapRef.current = null;
      discardTile(tileId);
      return;
    }
    if (canDiscardSelectedTile && selectedTileId === tileId) {
      lastTapRef.current = null;
      discardTile(tileId);
      return;
    }
    setSelectedTileId((current) => current === tileId ? null : tileId);
    emitFeedback("rack-select", `rack-select:${tileId}:${tappedAt}`);
  }, [canDiscardSelectedTile, canDiscardTile, discardTile, emitFeedback, selectedTileId, setSelectedTileId]);
}
export function useOkeyRackMoveInteraction(input: {
  dropTile: (tileId: string, point: { x: number; y: number }) => boolean;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  emitFeedback: (event: "rack-move" | "invalid", key: string) => void;
}) {
  const { dropTile, setSelectedTileId, emitFeedback } = input;
  const handleDropTile = useCallback((tileId: string, point: { x: number; y: number }) => {
    const accepted = dropTile(tileId, point);
    emitFeedback(accepted ? "rack-move" : "invalid", `tile-drop:${tileId}:${Date.now()}`);
    return accepted;
  }, [dropTile, emitFeedback]);
  const handleMoveRackTile = useCallback((tileId: string, targetIndex: number) => {
    setSelectedTileId(tileId);
    emitFeedback("rack-move", `rack-move:${tileId}:${targetIndex}:${Date.now()}`);
  }, [emitFeedback, setSelectedTileId]);
  return { handleDropTile, handleMoveRackTile };
}
export function useOkeyHumanMeldDropAvailability(input: {
  isInsideHumanMeldZone: (point: { x: number; y: number }, blocked: boolean) => boolean;
  blocked: boolean;
}) {
  const { isInsideHumanMeldZone, blocked } = input;
  return useCallback(
    (point: { x: number; y: number }) => isInsideHumanMeldZone(point, blocked),
    [blocked, isInsideHumanMeldZone],
  );
}