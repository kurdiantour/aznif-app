import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  createOkeyMeldPresentationFrames,
  type QueuedOpponentDiscardFlight,
  type ScreenRect,
  type TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import type { OkeyGameState, OkeyTile } from "@/okey/types/okey";

const BOT_DECISION_PAUSE_MS = 2200;
const BOT_MELD_ACTION_GAP_MS = 650;
const BOT_DISCARD_AFTER_ACTION_MS = 450;

export function useOkeyTileFlightCoordinator() {
  const [tileFlight, setTileFlight] = useState<TileFlight | null>(null);
  const [hiddenRackTileIds, setHiddenRackTileIds] = useState<string[]>([]);
  const [hideDeckTopTile, setHideDeckTopTile] = useState(false);
  const [hideDiscardTopTile, setHideDiscardTopTile] = useState(false);
  const [drawFlightTileId, setDrawFlightTileId] = useState<string | null>(null);

  return {
    tileFlight,
    setTileFlight,
    hiddenRackTileIds,
    setHiddenRackTileIds,
    hideDeckTopTile,
    setHideDeckTopTile,
    hideDiscardTopTile,
    setHideDiscardTopTile,
    drawFlightTileId,
    setDrawFlightTileId,
  };
}

type OpponentDrawFlight = {
  ownerPlayerId: string;
  eventId: string;
  source: "deck" | "discard";
  tile: OkeyTile | null;
};

type UseOkeyOpponentTileFlightCoordinatorInput = {
  state: OkeyGameState;
  tileFlight: TileFlight | null;
  deckTopRectRef: MutableRefObject<ScreenRect | null>;
  discardTopRectRef: MutableRefObject<ScreenRect | null>;
  opponentSeatRectsRef: MutableRefObject<Record<string, ScreenRect>>;
  presentedTablePlayersRef: MutableRefObject<OkeyGameState["players"]>;
  setPresentedPlayers: (players: OkeyGameState["players"]) => void;
  setDiscardPresentationFallback: Dispatch<SetStateAction<OkeyTile | null>>;
  setOpponentTurnTransitionActive: Dispatch<SetStateAction<boolean>>;
  setHideDeckTopTile: Dispatch<SetStateAction<boolean>>;
  setHideDiscardTopTile: Dispatch<SetStateAction<boolean>>;
  setTileFlight: Dispatch<SetStateAction<TileFlight | null>>;
  buildOpponentDiscardFlight: (
    entry: QueuedOpponentDiscardFlight,
  ) => TileFlight | null;
  toLocalRect: (rect: ScreenRect) => ScreenRect;
};

/**
 * Owns presentation-only sequencing for remote players.
 *
 * Authoritative game state still comes from useOkeyGame/server. This hook only
 * turns already-committed draw/discard changes into ordered tile-flight visuals.
 */
export function useOkeyOpponentTileFlightCoordinator({
  state,
  tileFlight,
  deckTopRectRef,
  discardTopRectRef,
  opponentSeatRectsRef,
  presentedTablePlayersRef,
  setPresentedPlayers,
  setDiscardPresentationFallback,
  setOpponentTurnTransitionActive,
  setHideDeckTopTile,
  setHideDiscardTopTile,
  setTileFlight,
  buildOpponentDiscardFlight,
  toLocalRect,
}: UseOkeyOpponentTileFlightCoordinatorInput) {
  const previousDiscardCountRef = useRef(state.discardPile.length);
  const previousDiscardTopTileRef = useRef<OkeyTile | null>(
    state.discardPile[state.discardPile.length - 1] ?? null,
  );
  const previousDeckCountRef = useRef(state.deck.length);

  // These queues preserve draw -> discard order across split/coalesced
  // authoritative snapshots.
  const queuedOpponentDrawFlightsRef = useRef<OpponentDrawFlight[]>([]);
  const pendingOpponentDiscardAfterDrawRef =
    useRef<QueuedOpponentDiscardFlight | null>(null);
  const queuedOpponentDiscardFlightsRef =
    useRef<QueuedOpponentDiscardFlight[]>([]);
  const pendingOpponentMeldTargetRef =
    useRef<OkeyGameState["players"] | null>(null);
  const botPresentationTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared with eliminated-turn presentation so its committed discard is not
  // animated a second time when it appears in authoritative state.
  const suppressNextOpponentDiscardFlightTileIdRef =
    useRef<string | null>(null);

  const startOpponentPostDrawSequence = useCallback(
    (pendingDiscard: QueuedOpponentDiscardFlight) => {
      if (botPresentationTimerRef.current) {
        clearTimeout(botPresentationTimerRef.current);
      }

      const targetPlayers =
        pendingOpponentMeldTargetRef.current ?? state.players;
      const actingPlayer = targetPlayers.find(
        (player) => player.id === pendingDiscard.ownerPlayerId,
      );
      const isBotOpponent =
        actingPlayer?.kind === "bot" ||
        actingPlayer?.controlledByBot === true;

      const startDiscard = () => {
        botPresentationTimerRef.current = null;
        pendingOpponentMeldTargetRef.current = null;
        setPresentedPlayers(targetPlayers);

        const discardFlight = buildOpponentDiscardFlight(pendingDiscard);
        if (!discardFlight) {
          setHideDiscardTopTile(false);
          setDiscardPresentationFallback(null);
          setOpponentTurnTransitionActive(false);
          return;
        }

        setDiscardPresentationFallback(
          state.discardPile[pendingDiscard.discardCount - 2] ?? null,
        );
        setHideDiscardTopTile(true);
        setTileFlight(discardFlight);
      };

      // Real online players are presented immediately. Bot pacing is visual only.
      if (!isBotOpponent) {
        startDiscard();
        return;
      }

      const frames = createOkeyMeldPresentationFrames(
        presentedTablePlayersRef.current,
        targetPlayers,
      );

      const revealFrame = (index: number) => {
        if (index >= frames.length) {
          botPresentationTimerRef.current = setTimeout(
            startDiscard,
            BOT_DISCARD_AFTER_ACTION_MS,
          );
          return;
        }

        setPresentedPlayers(frames[index]);
        botPresentationTimerRef.current = setTimeout(
          () => revealFrame(index + 1),
          BOT_MELD_ACTION_GAP_MS,
        );
      };

      botPresentationTimerRef.current = setTimeout(
        () => revealFrame(0),
        BOT_DECISION_PAUSE_MS,
      );
    },
    [
      buildOpponentDiscardFlight,
      presentedTablePlayersRef,
      setDiscardPresentationFallback,
      setHideDiscardTopTile,
      setOpponentTurnTransitionActive,
      setPresentedPlayers,
      setTileFlight,
      state.discardPile,
      state.players,
    ],
  );

  const startNextQueuedOpponentDiscardFlight = useCallback(() => {
    const nextDraw = queuedOpponentDrawFlightsRef.current[0];

    if (nextDraw) {
      const sourceRect =
        nextDraw.source === "deck"
          ? deckTopRectRef.current
          : discardTopRectRef.current;
      const seatRect =
        opponentSeatRectsRef.current[nextDraw.ownerPlayerId] ?? null;

      if (!sourceRect || !seatRect) return false;

      queuedOpponentDrawFlightsRef.current.shift();

      const landingRect: ScreenRect = {
        x: seatRect.x + seatRect.width / 2 - sourceRect.width / 2,
        y: seatRect.y + seatRect.height / 2 - sourceRect.height / 2,
        width: sourceRect.width,
        height: sourceRect.height,
      };

      if (nextDraw.source === "deck") setHideDeckTopTile(true);
      else setHideDiscardTopTile(true);

      setTileFlight({
        id: `opponent-draw-${nextDraw.eventId}`,
        tile: nextDraw.tile,
        face: nextDraw.source === "discard" ? "front" : "back",
        from: toLocalRect(sourceRect),
        to: toLocalRect(landingRect),
      });

      return true;
    }

    while (queuedOpponentDiscardFlightsRef.current.length > 0) {
      const next = queuedOpponentDiscardFlightsRef.current[0];
      if (!next) return false;

      const previousDiscard =
        state.discardPile[next.discardCount - 2] ?? null;

      if (next.animateWallDraw) {
        const deckRect = deckTopRectRef.current;
        const seatRect =
          opponentSeatRectsRef.current[next.ownerPlayerId] ?? null;

        if (!deckRect || !seatRect) return false;

        queuedOpponentDiscardFlightsRef.current.shift();

        const landingRect: ScreenRect = {
          x: seatRect.x + seatRect.width / 2 - deckRect.width / 2,
          y: seatRect.y + seatRect.height / 2 - deckRect.height / 2,
          width: deckRect.width,
          height: deckRect.height,
        };

        pendingOpponentDiscardAfterDrawRef.current = next;
        setDiscardPresentationFallback(previousDiscard);
        setHideDeckTopTile(true);
        setHideDiscardTopTile(true);
        setTileFlight({
          id: `opponent-draw-${next.ownerPlayerId}-${next.discardCount}`,
          tile: null,
          face: "back",
          from: toLocalRect(deckRect),
          to: toLocalRect(landingRect),
        });
        return true;
      }

      setDiscardPresentationFallback(previousDiscard);
      setHideDiscardTopTile(true);
      queuedOpponentDiscardFlightsRef.current.shift();
      startOpponentPostDrawSequence(next);
      return true;
    }

    return false;
  }, [
    deckTopRectRef,
    discardTopRectRef,
    opponentSeatRectsRef,
    setDiscardPresentationFallback,
    setHideDeckTopTile,
    setHideDiscardTopTile,
    setTileFlight,
    startOpponentPostDrawSequence,
    state.discardPile,
    toLocalRect,
  ]);

  const retryQueuedOpponentFlight = useCallback(() => {
    if (tileFlight) return;
    if (
      queuedOpponentDrawFlightsRef.current.length === 0 &&
      queuedOpponentDiscardFlightsRef.current.length === 0
    ) {
      return;
    }

    startNextQueuedOpponentDiscardFlight();
  }, [
    startNextQueuedOpponentDiscardFlight,
    tileFlight,
  ]);

  useLayoutEffect(() => {
    const previousCount = previousDiscardCountRef.current;
    const previousDiscardTopTile = previousDiscardTopTileRef.current;
    const nextCount = state.discardPile.length;

    previousDiscardCountRef.current = nextCount;
    previousDiscardTopTileRef.current =
      state.discardPile[nextCount - 1] ?? null;

    const wallDrawsThisUpdate = Math.max(
      0,
      previousDeckCountRef.current - state.deck.length,
    );
    const discardDrawsThisUpdate = Math.max(0, previousCount - nextCount);
    previousDeckCountRef.current = state.deck.length;

    if (nextCount <= previousCount) {
      const opponent =
        state.currentPlayerIndex === 0
          ? null
          : state.players[state.currentPlayerIndex] ?? null;

      if (
        (wallDrawsThisUpdate > 0 || discardDrawsThisUpdate > 0) &&
        opponent
      ) {
        const source =
          discardDrawsThisUpdate > 0 ? ("discard" as const) : ("deck" as const);

        queuedOpponentDrawFlightsRef.current.push({
          ownerPlayerId: opponent.id,
          eventId: `${opponent.id}-${source}-${state.deck.length}-${nextCount}`,
          source,
          tile: source === "discard" ? previousDiscardTopTile : null,
        });

        setOpponentTurnTransitionActive(true);

        if (!tileFlight) {
          const started = startNextQueuedOpponentDiscardFlight();
          if (!started) setOpponentTurnTransitionActive(false);
        }
      }

      return;
    }

    let remainingWallDraws = wallDrawsThisUpdate;
    const newOpponentDiscards: QueuedOpponentDiscardFlight[] = [];

    for (let index = previousCount; index < nextCount; index += 1) {
      const owner = state.discardOwners[index];
      const discardedTile = state.discardPile[index];
      const animateWallDraw =
        !!owner && owner.playerIndex !== 0 && remainingWallDraws-- > 0;

      if (
        discardedTile &&
        suppressNextOpponentDiscardFlightTileIdRef.current === discardedTile.id
      ) {
        suppressNextOpponentDiscardFlightTileIdRef.current = null;
        continue;
      }

      if (!owner || owner.playerIndex === 0 || !discardedTile) continue;

      newOpponentDiscards.push({
        tile: discardedTile,
        ownerPlayerId: owner.playerId,
        discardCount: index + 1,
        animateWallDraw,
      });
    }

    if (newOpponentDiscards.length === 0) return;

    setOpponentTurnTransitionActive(true);
    pendingOpponentMeldTargetRef.current = state.players;
    queuedOpponentDiscardFlightsRef.current.push(...newOpponentDiscards);

    if (!tileFlight) {
      const started = startNextQueuedOpponentDiscardFlight();
      if (!started) setOpponentTurnTransitionActive(false);
    }
  }, [
    setOpponentTurnTransitionActive,
    startNextQueuedOpponentDiscardFlight,
    state.currentPlayerIndex,
    state.deck.length,
    state.discardOwners,
    state.discardPile,
    state.players,
    tileFlight,
  ]);

  const resetOpponentPresentation = useCallback(() => {
    queuedOpponentDrawFlightsRef.current = [];
    queuedOpponentDiscardFlightsRef.current = [];
    pendingOpponentDiscardAfterDrawRef.current = null;
    pendingOpponentMeldTargetRef.current = null;
    suppressNextOpponentDiscardFlightTileIdRef.current = null;

    if (botPresentationTimerRef.current) {
      clearTimeout(botPresentationTimerRef.current);
      botPresentationTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      resetOpponentPresentation();
    },
    [resetOpponentPresentation],
  );

  return {
    previousDiscardCountRef,
    pendingOpponentDiscardAfterDrawRef,
    suppressNextOpponentDiscardFlightTileIdRef,
    botPresentationTimerRef,
    startOpponentPostDrawSequence,
    startNextQueuedOpponentDiscardFlight,
    retryQueuedOpponentFlight,
    resetOpponentPresentation,
  };
}

type OnlineTimeoutProjection = {
  lastTimeoutDiscardEvent?: {
    id: string;
    playerId: string;
    tileId: string;
    source: "rack" | "deck";
  } | null;
};

type UseOkeyTimeoutTileFlightCoordinatorInput = {
  isOnline: boolean;
  onlineMatchId?: string;
  onlineProjection: OnlineTimeoutProjection | null | undefined;
  state: OkeyGameState;
  humanPlayer: OkeyGameState["players"][number];
  pendingTimeoutDiscardTileId: string | null;
  tileFlight: TileFlight | null;
  pendingDrawFlightRef: MutableRefObject<{
    tileId: string;
    tile: OkeyTile | null;
    sourceRect: ScreenRect;
    face: "front" | "back";
  } | null>;
  timeoutDrawLandingRectRef: MutableRefObject<ScreenRect | null>;
  pendingDiscardTileIdRef: MutableRefObject<string | null>;
  rackRectRef: MutableRefObject<ScreenRect | null>;
  rackTileRectsRef: MutableRefObject<Record<string, ScreenRect>>;
  deckTopRectRef: MutableRefObject<ScreenRect | null>;
  discardTopRectRef: MutableRefObject<ScreenRect | null>;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  setHiddenRackTileIds: Dispatch<SetStateAction<string[]>>;
  setHideDeckTopTile: Dispatch<SetStateAction<boolean>>;
  setHideDiscardTopTile: Dispatch<SetStateAction<boolean>>;
  setDiscardPresentationFallback: Dispatch<SetStateAction<OkeyTile | null>>;
  setOpponentTurnTransitionActive: Dispatch<SetStateAction<boolean>>;
  setTileFlight: Dispatch<SetStateAction<TileFlight | null>>;
  toLocalRect: (rect: ScreenRect) => ScreenRect;
  commitPendingTimeoutDiscard: () => void;
  completePendingDrawFlight: (tileId: string, targetRect: ScreenRect) => void;
};

export function useOkeyTimeoutTileFlightCoordinator({
  isOnline,
  onlineMatchId,
  onlineProjection,
  state,
  humanPlayer,
  pendingTimeoutDiscardTileId,
  tileFlight,
  pendingDrawFlightRef,
  timeoutDrawLandingRectRef,
  pendingDiscardTileIdRef,
  rackRectRef,
  rackTileRectsRef,
  deckTopRectRef,
  discardTopRectRef,
  setSelectedTileId,
  setHiddenRackTileIds,
  setHideDeckTopTile,
  setHideDiscardTopTile,
  setDiscardPresentationFallback,
  setOpponentTurnTransitionActive,
  setTileFlight,
  toLocalRect,
  commitPendingTimeoutDiscard,
  completePendingDrawFlight,
}: UseOkeyTimeoutTileFlightCoordinatorInput) {
  const onlineTimeoutDiscardFlightRef = useRef<{
    eventId: string;
    tile: OkeyTile;
    stage: "deck-to-rack" | "rack-to-discard";
    rackRect: ScreenRect;
    discardRect: ScreenRect;
    previousDiscard: OkeyTile | null;
  } | null>(null);
  const handledOnlineTimeoutDiscardEventIdRef = useRef<string | null>(null);
  const onlineTimeoutProjectionInitializedRef = useRef(false);
  const onlineTimeoutMatchIdRef = useRef<string | undefined>(undefined);
  const timeoutDrawFallbackTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const startTimeoutDiscardFlight = useCallback(
    (tileId: string) => {
      const tile = humanPlayer.hand.find((entry) => entry.id === tileId);
      const sourceRect =
        rackTileRectsRef.current[tileId] ?? timeoutDrawLandingRectRef.current;
      const targetRect = discardTopRectRef.current;

      if (!tile || !sourceRect || !targetRect) {
        timeoutDrawLandingRectRef.current = null;
        pendingDiscardTileIdRef.current = null;
        commitPendingTimeoutDiscard();
        return;
      }

      pendingDiscardTileIdRef.current = tileId;
      setSelectedTileId(null);
      setHiddenRackTileIds([tileId]);
      setHideDiscardTopTile(false);
      timeoutDrawLandingRectRef.current = null;
      setTileFlight({
        id: `timeout-discard-${tileId}-${Date.now()}`,
        tile,
        face: "front",
        from: toLocalRect(sourceRect),
        to: toLocalRect(targetRect),
      });
    },
    [
      commitPendingTimeoutDiscard,
      discardTopRectRef,
      humanPlayer.hand,
      pendingDiscardTileIdRef,
      rackTileRectsRef,
      setHiddenRackTileIds,
      setHideDiscardTopTile,
      setSelectedTileId,
      setTileFlight,
      timeoutDrawLandingRectRef,
      toLocalRect,
    ],
  );

  useLayoutEffect(() => {
    if (!isOnline || !onlineProjection) return;

    if (onlineTimeoutMatchIdRef.current !== onlineMatchId) {
      onlineTimeoutMatchIdRef.current = onlineMatchId;
      onlineTimeoutProjectionInitializedRef.current = false;
      handledOnlineTimeoutDiscardEventIdRef.current = null;
    }

    const event = onlineProjection.lastTimeoutDiscardEvent;
    if (!onlineTimeoutProjectionInitializedRef.current) {
      onlineTimeoutProjectionInitializedRef.current = true;
      handledOnlineTimeoutDiscardEventIdRef.current = event?.id ?? null;
      return;
    }

    if (!event || handledOnlineTimeoutDiscardEventIdRef.current === event.id) return;
    if (event.playerId !== humanPlayer.id) {
      handledOnlineTimeoutDiscardEventIdRef.current = event.id;
      return;
    }
    if (tileFlight || onlineTimeoutDiscardFlightRef.current) return;

    const tile =
      humanPlayer.hand.find((entry) => entry.id === event.tileId) ??
      state.discardPile.find((entry) => entry.id === event.tileId);
    const timeoutDiscardIndex = state.discardPile.findIndex(
      (entry) => entry.id === event.tileId,
    );
    const previousDiscard =
      timeoutDiscardIndex > 0
        ? state.discardPile[timeoutDiscardIndex - 1] ?? null
        : null;
    const discardRect = discardTopRectRef.current;
    const rackRect = rackTileRectsRef.current[event.tileId];
    const deckRect = deckTopRectRef.current;
    const rackAreaRect = rackRectRef.current;

    if (!tile || !discardRect) return;

    if (event.source === "rack") {
      if (!rackRect) return;

      handledOnlineTimeoutDiscardEventIdRef.current = event.id;
      onlineTimeoutDiscardFlightRef.current = {
        eventId: event.id,
        tile,
        stage: "rack-to-discard",
        rackRect,
        discardRect,
        previousDiscard,
      };
      setOpponentTurnTransitionActive(true);
      setDiscardPresentationFallback(previousDiscard);
      setHideDiscardTopTile(true);
      setTileFlight({
        id: `online-timeout-discard-${event.id}`,
        tile,
        face: "front",
        from: toLocalRect(rackRect),
        to: toLocalRect(discardRect),
      });
      return;
    }

    if (!deckRect || !rackAreaRect) return;

    const deckLandingRect: ScreenRect = {
      x: rackAreaRect.x + rackAreaRect.width / 2 - discardRect.width / 2,
      y: rackAreaRect.y + rackAreaRect.height / 2 - discardRect.height / 2,
      width: discardRect.width,
      height: discardRect.height,
    };

    handledOnlineTimeoutDiscardEventIdRef.current = event.id;
    onlineTimeoutDiscardFlightRef.current = {
      eventId: event.id,
      tile,
      stage: "deck-to-rack",
      rackRect: deckLandingRect,
      discardRect,
      previousDiscard,
    };
    setOpponentTurnTransitionActive(true);
    setDiscardPresentationFallback(previousDiscard);
    setHideDeckTopTile(true);
    setHideDiscardTopTile(true);
    setTileFlight({
      id: `online-timeout-draw-${event.id}`,
      tile: null,
      face: "back",
      from: toLocalRect(deckRect),
      to: toLocalRect(deckLandingRect),
    });
  }, [
    deckTopRectRef,
    discardTopRectRef,
    humanPlayer.hand,
    humanPlayer.id,
    isOnline,
    onlineMatchId,
    onlineProjection,
    rackRectRef,
    rackTileRectsRef,
    setDiscardPresentationFallback,
    setHideDeckTopTile,
    setHideDiscardTopTile,
    setOpponentTurnTransitionActive,
    setTileFlight,
    state.discardPile,
    tileFlight,
    toLocalRect,
  ]);

  useEffect(() => {
    const pendingTimeoutTileId = pendingTimeoutDiscardTileId;
    if (
      !pendingTimeoutTileId ||
      tileFlight ||
      !pendingDrawFlightRef.current ||
      !state.hasDrawnThisTurn
    ) {
      return;
    }
    if (!humanPlayer.hand.some((tile) => tile.id === pendingTimeoutTileId)) return;
    if (timeoutDrawFallbackTimerRef.current) return;

    timeoutDrawFallbackTimerRef.current = setTimeout(() => {
      timeoutDrawFallbackTimerRef.current = null;

      if (
        !pendingTimeoutDiscardTileId ||
        tileFlight ||
        !pendingDrawFlightRef.current
      ) {
        return;
      }
      if (
        !humanPlayer.hand.some(
          (tile) => tile.id === pendingTimeoutDiscardTileId,
        )
      ) {
        return;
      }

      const rackRect = rackRectRef.current;
      const pendingDraw = pendingDrawFlightRef.current;
      if (!rackRect || !pendingDraw) return;

      const tileWidth =
        discardTopRectRef.current?.width ?? pendingDraw.sourceRect.width;
      const tileHeight =
        discardTopRectRef.current?.height ?? pendingDraw.sourceRect.height;
      const landingRect: ScreenRect = {
        x: rackRect.x + rackRect.width / 2 - tileWidth / 2,
        y: rackRect.y + rackRect.height / 2 - tileHeight / 2,
        width: tileWidth,
        height: tileHeight,
      };

      timeoutDrawLandingRectRef.current = landingRect;
      completePendingDrawFlight(pendingTimeoutDiscardTileId, landingRect);
    }, 450);

    return () => {
      if (timeoutDrawFallbackTimerRef.current) {
        clearTimeout(timeoutDrawFallbackTimerRef.current);
        timeoutDrawFallbackTimerRef.current = null;
      }
    };
  }, [
    completePendingDrawFlight,
    discardTopRectRef,
    humanPlayer.hand,
    pendingDrawFlightRef,
    pendingTimeoutDiscardTileId,
    rackRectRef,
    state.hasDrawnThisTurn,
    tileFlight,
    timeoutDrawLandingRectRef,
  ]);

  useEffect(() => {
    const pendingTimeoutTileId = pendingTimeoutDiscardTileId;
    if (
      !pendingTimeoutTileId ||
      tileFlight ||
      pendingDrawFlightRef.current ||
      !state.hasDrawnThisTurn
    ) {
      return;
    }
    if (!humanPlayer.hand.some((tile) => tile.id === pendingTimeoutTileId)) return;

    startTimeoutDiscardFlight(pendingTimeoutTileId);
  }, [
    humanPlayer.hand,
    pendingDrawFlightRef,
    pendingTimeoutDiscardTileId,
    startTimeoutDiscardFlight,
    state.hasDrawnThisTurn,
    tileFlight,
  ]);

  const resetTimeoutPresentation = useCallback(() => {
    if (timeoutDrawFallbackTimerRef.current) {
      clearTimeout(timeoutDrawFallbackTimerRef.current);
      timeoutDrawFallbackTimerRef.current = null;
    }
    onlineTimeoutDiscardFlightRef.current = null;
    handledOnlineTimeoutDiscardEventIdRef.current = null;
    onlineTimeoutProjectionInitializedRef.current = false;
  }, []);

  useEffect(
    () => () => {
      resetTimeoutPresentation();
    },
    [resetTimeoutPresentation],
  );

  return {
    onlineTimeoutDiscardFlightRef,
    resetTimeoutPresentation,
  };
}


