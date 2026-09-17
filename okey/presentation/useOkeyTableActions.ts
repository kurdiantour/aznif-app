import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  getLockedKonkanSetsForPlayer,
  getOkeyOpenAction,
  getOkeyRackDiscardAction,
  hasLockedKonkanSet,
  resolveTableMeldAction,
  type OkeyOpenAction,
  type OkeyTableMeldAction,
} from "@/okey/engine/okey-engine";
import {
  findKonkanRackLayoutCandidates,
  type KonkanRackLayoutCandidate,
} from "@/okey/engine/okey-rack-layout";
import { isEliminatedOkeyPlayer } from "@/okey/engine/okeyengine-eliminated";
import {
  type MeldDropRect,
  type ScreenRect,
  type TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import { getOkeyRunEndForDrop } from "@/okey/presentation/okey-table-interactions";
import type { OkeyGameState, OkeyMeld, OkeyPlayer, OkeyTile } from "@/okey/types/okey";

type RackMeldSelection = {
  melds: OkeyMeld[];
  score: number;
  contiguousGroups: OkeyTile[][];
};

export type LaunchTileFlightOptions = {
  flight: TileFlight;
  hideDeckTopTile?: boolean;
  hideDiscardTopTile?: boolean;
  discardFallback?: OkeyTile | null;
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
  declareKonkan: (
    orderedRunTileIds: string[],
    completionMeldTileIds: string[],
    discardTileId: string,
  ) => unknown;
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
  const topDiscardBlocked = !!topDiscardOwner && isEliminatedOkeyPlayer(state.players[topDiscardOwner.playerIndex]);
  const canDraw = isHumanTurn && !isEliminatedOkeyPlayer(humanPlayer) && !state.hasDrawnThisTurn;
  const canPlayAfterDraw = isHumanTurn && !isEliminatedOkeyPlayer(humanPlayer) && state.hasDrawnThisTurn;
  const selectedTile = humanPlayer.hand.find((tile) => tile.id === selectedTileId);
  const humanPlayerIndex = useMemo(
    () => state.players.findIndex((player) => player.id === humanPlayer.id),
    [state.players, humanPlayer.id],
  );
  const hasLockedSet = useMemo(
    () => hasLockedKonkanSet(getLockedKonkanSetsForPlayer(state, humanPlayer.id), state.okeyTile),
    [state, humanPlayer.id],
  );
  const konkanCandidates = useMemo(
    () => humanPlayer.konkan
      ? findKonkanRackLayoutCandidates(rackMeldSelection.contiguousGroups, state.okeyTile, hasLockedSet)
      : [],
    [humanPlayer.konkan, rackMeldSelection.contiguousGroups, state.okeyTile, hasLockedSet],
  );
  const openAction = useMemo(
    () => getOkeyOpenAction(
      state,
      humanPlayerIndex,
      rackMeldSelection.melds,
      konkanCandidates,
    ),
    [humanPlayerIndex, konkanCandidates, rackMeldSelection.melds, state],
  );

  const executeOpenAction = useCallback(() => {
    if (openAction.mode === "declare-konkan") {
      declareKonkan(
        openAction.orderedRunTileIds,
        openAction.completionMeldTileIds,
        openAction.discardTileId,
      );
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
    selectOpenAction: (
      melds: OkeyMeld[],
      orderedKonkanRuns: KonkanRackLayoutCandidate[] = [],
    ) =>
      getOkeyOpenAction(
        state,
        humanPlayerIndex,
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
  dropTile: (tileId: string, point: { x: number; y: number }) => boolean | Promise<boolean>;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  emitFeedback: (event: "rack-move" | "invalid", key: string) => void;
}) {
  const { dropTile, setSelectedTileId, emitFeedback } = input;
  const handleDropTile = useCallback((tileId: string, point: { x: number; y: number }): boolean => {
    const accepted = dropTile(tileId, point);
    const isAccepted = typeof accepted === "boolean" ? accepted : true;
    emitFeedback(isAccepted ? "rack-move" : "invalid", `tile-drop:${tileId}:${Date.now()}`);
    return isAccepted;
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

export function useOkeyTableMeldCommandPresentation(input: {
  awaitingTileIdRef: MutableRefObject<string | null>;
  setHiddenTileIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  lockKonkan: (tileId: string, playerId: string, meldId: string, runEnd?: "start" | "end") => Promise<boolean>;
  spendTile: (tileId: string, playerId: string, meldId: string, runEnd?: "start" | "end") => Promise<boolean>;
}) {
  const { awaitingTileIdRef, setHiddenTileIds, setSelectedTileId, lockKonkan, spendTile } = input;
  return useCallback((action: OkeyTableMeldAction, runEnd?: "start" | "end"): boolean | Promise<boolean> => {
    const tileId = action.tileId;
    awaitingTileIdRef.current = tileId;
    setHiddenTileIds([tileId]);
    setSelectedTileId(null);
    const command = action.type === "lock-konkan" ? lockKonkan : spendTile;
    return command(tileId, action.targetPlayerId, action.targetMeldId, runEnd).then((accepted) => {
      if (!accepted) {
        awaitingTileIdRef.current = null;
        setHiddenTileIds((current) => current.filter((entry) => entry !== tileId));
      }
      return accepted;
    });
  }, [awaitingTileIdRef, lockKonkan, setHiddenTileIds, setSelectedTileId, spendTile]);
}

export function useOkeyMeldDropOrchestration(input: {
  canPlayAfterDraw: boolean;
  remainingMeldSlots: number;
  humanOpened: boolean;
  humanHandCount: number;
  droppedMelds: OkeyMeld[];
  hoveredTargetRef: MutableRefObject<MeldDropRect | null>;
  findMeldTarget: (point: { x: number; y: number }, isValid: (rect: MeldDropRect) => boolean) => MeldDropRect | null;
  isInsideHumanMeldZone: (point: { x: number; y: number }) => boolean;
  selectTableMeldAction: (tileId: string, playerId: string, meldId: string) => OkeyTableMeldAction | null;
  awaitingTileIdRef: MutableRefObject<string | null>;
  setHiddenTileIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  setHoveredTarget: Dispatch<SetStateAction<{ playerId: string; meldId: string } | null>>;
  setDroppedMelds: Dispatch<SetStateAction<OkeyMeld[]>>;
  setCommittedSignatures: Dispatch<SetStateAction<string[]>>;
  lockKonkan: (tileId: string, playerId: string, meldId: string, runEnd?: "start" | "end") => Promise<boolean>;
  spendTile: (tileId: string, playerId: string, meldId: string, runEnd?: "start" | "end") => Promise<boolean>;
  commitOpenIntent: (melds: OkeyMeld[], score: number, tileId?: string) => Promise<boolean>;
  selectOpenAction: (melds: OkeyMeld[]) => OkeyOpenAction;
  emitFeedback: (event: "invalid" | "rack-move", key: string) => void;
}) {
  const {
    canPlayAfterDraw, remainingMeldSlots, humanOpened, humanHandCount, droppedMelds, hoveredTargetRef,
    findMeldTarget, isInsideHumanMeldZone, selectTableMeldAction, awaitingTileIdRef,
    setHiddenTileIds, setSelectedTileId, setHoveredTarget, setDroppedMelds,
    setCommittedSignatures, lockKonkan, spendTile, commitOpenIntent, selectOpenAction, emitFeedback,
  } = input;
  const pendingAutomaticOpenRef = useRef<string | null>(null);
  const submitTableMeldAction = useOkeyTableMeldCommandPresentation({
    awaitingTileIdRef, setHiddenTileIds, setSelectedTileId, lockKonkan, spendTile,
  });
  const getClosestValidMeldDropTarget = useCallback((tileId: string, point: { x: number; y: number }) =>
    findMeldTarget(point, (rect) => selectTableMeldAction(tileId, rect.playerId, rect.meldId) !== null),
  [findMeldTarget, selectTableMeldAction]);
  const updateTileDragMeldTarget = useCallback((tileId: string | null, point: { x: number; y: number } | null) => {
    const target = tileId && point ? getClosestValidMeldDropTarget(tileId, point) : null;
    hoveredTargetRef.current = target;
    setHoveredTarget((current) => current?.playerId === target?.playerId && current?.meldId === target?.meldId
      ? current : target ? { playerId: target.playerId, meldId: target.meldId } : null);
  }, [getClosestValidMeldDropTarget, hoveredTargetRef, setHoveredTarget]);
  const dropTileOnTableMeld = useCallback((tileId: string, point: { x: number; y: number }): boolean | Promise<boolean> => {
    const target = hoveredTargetRef.current;
    if (!target) return false;
    const action = selectTableMeldAction(tileId, target.playerId, target.meldId);
    if (!action) return false;
    return submitTableMeldAction(action, getOkeyRunEndForDrop(action.runEndOptions, point, target));
  }, [hoveredTargetRef, selectTableMeldAction, submitTableMeldAction]);
  const handleDropMeldGroup = useCallback((meld: OkeyMeld, point: { x: number; y: number }) => {
    if (!canPlayAfterDraw || !isInsideHumanMeldZone(point) || remainingMeldSlots <= 0) {
      emitFeedback("invalid", `meld-drop:${meld.id}:${Date.now()}`); return false;
    }
    if (!humanOpened && pendingAutomaticOpenRef.current) return false;
    if (humanOpened) {
      const signature = meld.tiles.map((tile) => tile.id).sort().join("|");
      setCommittedSignatures((current) => current.includes(signature) ? current : [...current, signature]);
      void commitOpenIntent([meld], meld.score).then((accepted) => {
        if (!accepted) setCommittedSignatures((current) => current.filter((entry) => entry !== signature));
      });
      setSelectedTileId(null);
      emitFeedback("rack-move", `meld-drop:${meld.id}:${Date.now()}`);
      return true;
    }
    if (droppedMelds.length >= remainingMeldSlots) {
      emitFeedback("invalid", `meld-drop:${meld.id}:${Date.now()}`); return false;
    }
    const existingIds = new Set(droppedMelds.flatMap((entry) => entry.tiles.map((tile) => tile.id)));
    if (meld.tiles.some((tile) => existingIds.has(tile.id))) return false;
    const nextDroppedMelds = [...droppedMelds, { ...meld, id: `human-drop-${Date.now()}-${droppedMelds.length}` }];
    const stagedTileCount = new Set(nextDroppedMelds.flatMap((entry) => entry.tiles.map((tile) => tile.id))).size;
    if (humanHandCount - stagedTileCount < 1) {
      emitFeedback("invalid", `meld-drop-no-discard:${meld.id}:${Date.now()}`);
      return false;
    }
    setDroppedMelds(nextDroppedMelds);
    setSelectedTileId(null);
    emitFeedback("rack-move", `meld-drop:${meld.id}:${Date.now()}`);

    const automaticOpen = selectOpenAction(nextDroppedMelds);
    if (automaticOpen.allowed && automaticOpen.mode === "open-melds") {
      const signatures = automaticOpen.melds.map((entry) =>
        entry.tiles.map((tile) => tile.id).sort().join("|"));
      const openingSignature = signatures.slice().sort().join("::");
      pendingAutomaticOpenRef.current = openingSignature;
      setCommittedSignatures((current) => [...new Set([...current, ...signatures])]);
      void commitOpenIntent(automaticOpen.melds, automaticOpen.score).then((accepted) => {
        if (pendingAutomaticOpenRef.current === openingSignature) {
          pendingAutomaticOpenRef.current = null;
        }
        if (!accepted) {
          setCommittedSignatures((current) => current.filter((entry) => !signatures.includes(entry)));
        }
      });
    }
    return true;
  }, [canPlayAfterDraw, commitOpenIntent, droppedMelds, emitFeedback, humanHandCount, humanOpened, isInsideHumanMeldZone, remainingMeldSlots, selectOpenAction, setCommittedSignatures, setDroppedMelds, setSelectedTileId]);
  return { getClosestValidMeldDropTarget, updateTileDragMeldTarget, dropTileOnTableMeld, handleDropMeldGroup };
}

export type RackDropPlacement = { tileId: string; point: { x: number; y: number }; nonce: number } | null;
export type PendingDraw = { tileId: string; source: "deck" | "discard" } | null;

export function useOkeyPlayerTileFlightCommands(input: {
  state: OkeyGameState;
  humanPlayer: OkeyGameState["players"][number];
  topDiscard: OkeyTile | null;
  canDraw: boolean;
  canDiscardTile: boolean;
  droppedMelds: OkeyMeld[];
  tileFlight: TileFlight | null;
  deckTopRectRef: MutableRefObject<ScreenRect | null>;
  discardTopRectRef: MutableRefObject<ScreenRect | null>;
  drawLandingRectRef: MutableRefObject<ScreenRect | null>;
  rackTileRectsRef: MutableRefObject<Record<string, ScreenRect>>;
  pendingDrawRef: MutableRefObject<PendingDraw>;
  awaitingDiscardRemovalTileIdRef: MutableRefObject<string | null>;
  isPointInsideRack: (point: { x: number; y: number }) => boolean;
  isPointInsideDiscardPile: (point: { x: number; y: number }) => boolean;
  toLocalRect: (rect: ScreenRect) => ScreenRect;
  draw: (source: "deck" | "discard") => Promise<boolean>;
  discard: (tileId: string) => Promise<boolean>;
  commitOpenIntent: (melds: OkeyMeld[], score: number, tileId?: string) => Promise<boolean>;
  selectOpenAction: (melds: OkeyMeld[]) => OkeyOpenAction;
  dropTileOnTableMeld: (tileId: string, point: { x: number; y: number }) => boolean | Promise<boolean>;
  emitInvalid: (key: string) => void;
  launchTileFlight: (options: LaunchTileFlightOptions) => void;
  setTileFlight: Dispatch<SetStateAction<TileFlight | null>>;
  setHiddenRackTileIds: Dispatch<SetStateAction<string[]>>;
  setHideDeckTopTile: Dispatch<SetStateAction<boolean>>;
  setHideDiscardTopTile: Dispatch<SetStateAction<boolean>>;
  setDiscardPresentationFallback: Dispatch<SetStateAction<OkeyTile | null>>;
  setPresentedTopDiscard: Dispatch<SetStateAction<OkeyTile | null>>;
  holdDiscardUntilAuthoritative: (tile: OkeyTile) => void;
  releaseAuthoritativeDiscardHold: (tileId: string | null) => void;
  setOptimisticRackTile: Dispatch<SetStateAction<OkeyTile | null>>;
  setDiscardDropPlacement: Dispatch<SetStateAction<RackDropPlacement>>;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  setLocalDragCommittedMeldSignatures: Dispatch<SetStateAction<string[]>>;
}) {
  const {
    state, humanPlayer, topDiscard, canDraw, canDiscardTile, droppedMelds, tileFlight,
    deckTopRectRef, discardTopRectRef, drawLandingRectRef, rackTileRectsRef,
    pendingDrawRef, awaitingDiscardRemovalTileIdRef, isPointInsideRack,
    isPointInsideDiscardPile, toLocalRect, draw, discard, commitOpenIntent,
    selectOpenAction, dropTileOnTableMeld, emitInvalid, launchTileFlight,
    setTileFlight, setHiddenRackTileIds, setHideDeckTopTile, setHideDiscardTopTile,
    setDiscardPresentationFallback, setPresentedTopDiscard, holdDiscardUntilAuthoritative,
    releaseAuthoritativeDiscardHold, setOptimisticRackTile, setDiscardDropPlacement,
    setSelectedTileId, setLocalDragCommittedMeldSignatures,
  } = input;

  useEffect(() => {
    releaseAuthoritativeDiscardHold(topDiscard?.id ?? null);
  }, [releaseAuthoritativeDiscardHold, topDiscard?.id]);

  const beginDrawIntent = useCallback((
    source: "deck" | "discard",
    placementPoint?: { x: number; y: number },
    animate = false,
  ) => {
    if (!canDraw || pendingDrawRef.current) return false;
    const tile = source === "deck" ? state.deck[0] ?? null : topDiscard;
    if (!tile && source === "discard") return false;
    if (!tile) {
      void draw("deck");
      return true;
    }

    const pending = { tileId: tile.id, source } as const;
    pendingDrawRef.current = pending;
    setOptimisticRackTile(tile);

    if (source === "deck") {
      setHideDeckTopTile(true);
    } else {
      if (state.discardPile.length >= 2) {
        setPresentedTopDiscard(state.discardPile[state.discardPile.length - 2] ?? null);
      }
      setDiscardPresentationFallback(null);
      setHideDiscardTopTile(false);
    }

    if (placementPoint) {
      setDiscardDropPlacement({ tileId: tile.id, point: placementPoint, nonce: Date.now() });
    }

    const sourceRect = source === "deck" ? deckTopRectRef.current : discardTopRectRef.current;
    const targetRect = drawLandingRectRef.current;
    if (animate && !tileFlight && sourceRect && targetRect) {
      launchTileFlight({
        flight: { id: "draw-" + tile.id + "-" + Date.now(), tile, face: source === "deck" ? "back" : "front", from: toLocalRect(sourceRect), to: toLocalRect(targetRect) },
      });
    }

    void draw(source).then((accepted) => {
      if (accepted || pendingDrawRef.current !== pending) return;
      pendingDrawRef.current = null;
      setOptimisticRackTile((current) => current?.id === tile.id ? null : current);
      setDiscardDropPlacement((current) => current?.tileId === tile.id ? null : current);
      setSelectedTileId((current) => current === tile.id ? null : current);
      setTileFlight((current) => current?.tile?.id === tile.id ? null : current);
      if (source === "deck") {
        setHideDeckTopTile(false);
      } else {
        setPresentedTopDiscard(tile);
        setDiscardPresentationFallback(null);
        setHideDiscardTopTile(false);
      }
    });
    return true;
  }, [canDraw, deckTopRectRef, discardTopRectRef, draw, drawLandingRectRef, launchTileFlight, pendingDrawRef, setDiscardDropPlacement, setDiscardPresentationFallback, setHideDeckTopTile, setHideDiscardTopTile, setOptimisticRackTile, setPresentedTopDiscard, setSelectedTileId, setTileFlight, state.deck, state.discardPile, tileFlight, toLocalRect, topDiscard]);

  const startDrawFlight = useCallback((source: "deck" | "discard") => {
    beginDrawIntent(source, undefined, true);
  }, [beginDrawIntent]);

  const rollbackDiscardPresentation = useCallback((tileId: string) => {
    if (awaitingDiscardRemovalTileIdRef.current === tileId) awaitingDiscardRemovalTileIdRef.current = null;
    setHiddenRackTileIds((current) => current.filter((entry) => entry !== tileId));
    setTileFlight((current) => current?.tile?.id === tileId ? null : current);
    setPresentedTopDiscard(topDiscard);
    setDiscardPresentationFallback(null);
    setHideDiscardTopTile(false);
  }, [awaitingDiscardRemovalTileIdRef, setDiscardPresentationFallback, setHiddenRackTileIds, setHideDiscardTopTile, setPresentedTopDiscard, setTileFlight, topDiscard]);

  const commitDiscardFromRack = useCallback((tileId: string) => {
    if (!canDiscardTile) return false;
    if (!humanPlayer.opened && droppedMelds.length > 0) {
      const playerIndex = state.players.findIndex((player) => player.id === humanPlayer.id);
      const action = getOkeyRackDiscardAction(state, playerIndex, droppedMelds, tileId);
      if (action.type !== "open-and-discard") { emitInvalid(`staged-open-discard:${tileId}:${Date.now()}`); return false; }
      awaitingDiscardRemovalTileIdRef.current = tileId;
      setSelectedTileId(null);
      setHiddenRackTileIds([tileId]);
      setHideDiscardTopTile(false);
      const signatures = action.melds.map((meld) => meld.tiles.map((tile) => tile.id).sort().join("|"));
      setLocalDragCommittedMeldSignatures((current) => [...new Set([...current, ...signatures])]);
      void commitOpenIntent(action.melds, action.score, tileId).then((accepted) => {
        if (accepted) return;
        rollbackDiscardPresentation(tileId);
        setLocalDragCommittedMeldSignatures((current) => current.filter((entry) => !signatures.includes(entry)));
      });
      return true;
    }
    awaitingDiscardRemovalTileIdRef.current = tileId;
    setSelectedTileId(null);
    setHiddenRackTileIds([tileId]);
    setHideDiscardTopTile(false);
    void discard(tileId).then((accepted) => { if (!accepted) rollbackDiscardPresentation(tileId); });
    return true;
  }, [awaitingDiscardRemovalTileIdRef, canDiscardTile, commitOpenIntent, discard, droppedMelds, emitInvalid, humanPlayer.id, humanPlayer.opened, rollbackDiscardPresentation, selectOpenAction, setHiddenRackTileIds, setHideDiscardTopTile, setLocalDragCommittedMeldSignatures, setSelectedTileId, state]);

  const handleDrawSourceDroppedOnRack = useCallback((
    source: "deck" | "discard",
    point: { x: number; y: number },
  ) => {
    if (!isPointInsideRack(point)) return false;
    return beginDrawIntent(source, point);
  }, [beginDrawIntent, isPointInsideRack]);

  const handleDiscardDroppedOnRack = useCallback(
    (point: { x: number; y: number }) => handleDrawSourceDroppedOnRack("discard", point),
    [handleDrawSourceDroppedOnRack],
  );

  const dropTileFromRack = useCallback((tileId: string, point: { x: number; y: number }): boolean | Promise<boolean> => {
    if (!isPointInsideDiscardPile(point)) return dropTileOnTableMeld(tileId, point);
    const tile = humanPlayer.hand.find((entry) => entry.id === tileId);
    if (!tile || !commitDiscardFromRack(tileId)) return false;
    setPresentedTopDiscard(tile);
    holdDiscardUntilAuthoritative(tile);
    setHideDiscardTopTile(true);
    return true;
  }, [commitDiscardFromRack, dropTileOnTableMeld, holdDiscardUntilAuthoritative, humanPlayer.hand, isPointInsideDiscardPile, setHideDiscardTopTile, setPresentedTopDiscard]);

  const startDiscardFlight = useCallback((tileId: string) => {
    if (!canDiscardTile) return;
    const tile = humanPlayer.hand.find((entry) => entry.id === tileId);
    const sourceRect = rackTileRectsRef.current[tileId];
    const targetRect = discardTopRectRef.current;
    if (!commitDiscardFromRack(tileId)) return;
    if (tileFlight || !tile || !sourceRect || !targetRect) return;
    setDiscardPresentationFallback(topDiscard);
    setHideDiscardTopTile(true);
    setTileFlight({ id: `discard-${tileId}-${Date.now()}`, tile, face: "front", from: toLocalRect(sourceRect), to: toLocalRect(targetRect) });
  }, [canDiscardTile, commitDiscardFromRack, discardTopRectRef, humanPlayer.hand, rackTileRectsRef, setDiscardPresentationFallback, setHideDiscardTopTile, setTileFlight, tileFlight, toLocalRect, topDiscard]);

  const handleDeckDroppedOnRack = useCallback((point: { x: number; y: number }) => {
    return handleDrawSourceDroppedOnRack("deck", point);
  }, [handleDrawSourceDroppedOnRack]);

  useLayoutEffect(() => {
    const pending = pendingDrawRef.current;
    if (!pending) return;

    const authoritativeDrawCommitted =
      !canDraw ||
      humanPlayer.hand.some((tile) => tile.id === pending.tileId);
    if (!authoritativeDrawCommitted) return;

    pendingDrawRef.current = null;
    setOptimisticRackTile((current) => current?.id === pending.tileId ? null : current);
    setHideDeckTopTile(false);
    setHideDiscardTopTile(false);
    setPresentedTopDiscard(state.discardPile[state.discardPile.length - 1] ?? null);
    if (pending.source === "deck" && tileFlight?.id.startsWith("draw-")) {
      setTileFlight(null);
    }
  }, [canDraw, humanPlayer.hand, pendingDrawRef, setHideDeckTopTile, setHideDiscardTopTile, setOptimisticRackTile, setPresentedTopDiscard, setTileFlight, state.discardPile, tileFlight]);

  return { startDrawFlight, startDiscardFlight, handleDiscardDroppedOnRack, dropTileFromRack, handleDeckDroppedOnRack };
}