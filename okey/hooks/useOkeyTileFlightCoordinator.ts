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
  type QueuedOpponentDiscardFlight,
  type ScreenRect,
  type TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import type { OkeyGameState, OkeyTile } from "@/okey/types/okey";
import type { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import type { OkeyActionEvent } from "@/okey/server/okey-action-events";

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
  kind: "draw";
  ownerPlayerId: string;
  eventId: string;
  source: "deck" | "discard";
  tile: OkeyTile | null;
};

type OpponentDiscardFlight = {
  kind: "discard";
  entry: QueuedOpponentDiscardFlight;
};

type OpponentPlayersSync = {
  kind: "players-sync";
  ownerPlayerId: string;
  players: OkeyGameState["players"];
};

type OpponentPresentationAction =
  | OpponentDrawFlight
  | OpponentDiscardFlight
  | OpponentPlayersSync;

type UseOkeyOpponentTileFlightCoordinatorInput = {
  state: OkeyGameState;
  adapter: SupabaseOkeyMatchAdapter | null;
  projectionVersion: number | null;
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
 * Presentation-only FIFO for already-committed remote actions.
 *
 * The server/engine owns legality and turn progression. This hook never delays,
 * retries, or schedules game actions. It only renders committed action events in
 * `(version, sequence)` order.
 *
 * Important invariants:
 * - Events are always ingested, even while a tile flight is active.
 * - Only one visual flight is started at a time.
 * - An action is removed from the visual queue only after its flight can start.
 * - Missing layout rects never consume/drop an action; measurement callbacks
 *   call `retryQueuedOpponentFlight()` to drain again.
 * - No bot-specific timers, decision pauses, or presentation turn scheduler.
 */
export function useOkeyOpponentTileFlightCoordinator({
  state,
  adapter,
  projectionVersion,
  tileFlight,
  deckTopRectRef,
  discardTopRectRef,
  opponentSeatRectsRef,
  presentedTablePlayersRef: _presentedTablePlayersRef,
  setPresentedPlayers,
  setDiscardPresentationFallback,
  setOpponentTurnTransitionActive,
  setHideDeckTopTile,
  setHideDiscardTopTile,
  setTileFlight,
  buildOpponentDiscardFlight,
  toLocalRect,
}: UseOkeyOpponentTileFlightCoordinatorInput) {
  const pendingCommittedEventsRef = useRef<OkeyActionEvent[]>([]);
  const queuedPresentationActionsRef = useRef<OpponentPresentationAction[]>([]);
  const [actionEventTick, setActionEventTick] = useState(0);

  const [presentedOpponentPlayerId, setPresentedOpponentPlayerId] =
    useState<string | null>(null);

  // Shared with eliminated-turn presentation so its committed discard is not
  // animated a second time.
  const suppressNextOpponentDiscardFlightTileIdRef =
    useRef<string | null>(null);

  const startDiscardFlight = useCallback(
    (entry: QueuedOpponentDiscardFlight): boolean => {
      const discardFlight = buildOpponentDiscardFlight(entry);
      if (!discardFlight) return false;

      const previousDiscard =
        state.discardPile[entry.discardCount - 2] ?? null;

      setPresentedOpponentPlayerId(entry.ownerPlayerId);
      setDiscardPresentationFallback(previousDiscard);
      setHideDiscardTopTile(true);
      setTileFlight(discardFlight);
      return true;
    },
    [
      buildOpponentDiscardFlight,
      setDiscardPresentationFallback,
      setHideDiscardTopTile,
      setTileFlight,
      state.discardPile,
    ],
  );

  const startNextQueuedPresentation = useCallback((): boolean => {
    // `tileFlight` is the only visual busy condition. Game progression is never
    // blocked here; this only prevents two animations from starting together.
    if (tileFlight) return false;

    while (queuedPresentationActionsRef.current.length > 0) {
      const next = queuedPresentationActionsRef.current[0];
      if (!next) break;

      if (next.kind === "players-sync") {
        queuedPresentationActionsRef.current.shift();
        setPresentedOpponentPlayerId(next.ownerPlayerId);
        setPresentedPlayers(next.players);
        continue;
      }

      if (next.kind === "draw") {
        const sourceRect =
          next.source === "deck"
            ? deckTopRectRef.current
            : discardTopRectRef.current;
        const seatRect =
          opponentSeatRectsRef.current[next.ownerPlayerId] ?? null;

        // Do not consume the action. onMeasured will call retry and this same
        // action will be attempted once geometry exists.
        if (!sourceRect || !seatRect) return false;

        const landingRect: ScreenRect = {
          x: seatRect.x + seatRect.width / 2 - sourceRect.width / 2,
          y: seatRect.y + seatRect.height / 2 - sourceRect.height / 2,
          width: sourceRect.width,
          height: sourceRect.height,
        };

        queuedPresentationActionsRef.current.shift();
        setPresentedOpponentPlayerId(next.ownerPlayerId);

        if (next.source === "deck") setHideDeckTopTile(true);
        else setHideDiscardTopTile(true);

        setTileFlight({
          id: `opponent-draw-${next.eventId}`,
          tile: next.tile,
          face: next.source === "discard" ? "front" : "back",
          from: toLocalRect(sourceRect),
          to: toLocalRect(landingRect),
        });
        return true;
      }

      // Discard: never remove it until its flight can actually be created.
      if (!startDiscardFlight(next.entry)) return false;

      queuedPresentationActionsRef.current.shift();
      return true;
    }

    setPresentedOpponentPlayerId(null);
    return false;
  }, [
    deckTopRectRef,
    discardTopRectRef,
    opponentSeatRectsRef,
    setHideDeckTopTile,
    setHideDiscardTopTile,
    setPresentedPlayers,
    setTileFlight,
    startDiscardFlight,
    tileFlight,
    toLocalRect,
  ]);

  const retryQueuedOpponentFlight = useCallback(() => {
    if (tileFlight) return;

    if (queuedPresentationActionsRef.current.length === 0) {
      setOpponentTurnTransitionActive(false);
      setPresentedOpponentPlayerId(null);
      return;
    }

    setOpponentTurnTransitionActive(true);
    startNextQueuedPresentation();
  }, [
    setOpponentTurnTransitionActive,
    startNextQueuedPresentation,
    tileFlight,
  ]);

  useEffect(() => {
    if (!adapter) return;

    return adapter.subscribeActionEvents((event) => {
      pendingCommittedEventsRef.current.push(event);
      pendingCommittedEventsRef.current.sort(
        (left, right) =>
          left.version - right.version || left.sequence - right.sequence,
      );
      setActionEventTick((value) => value + 1);
    });
  }, [adapter]);

  /**
   * Ingest every committed event whose authoritative projection is already
   * available. This intentionally does NOT return when `tileFlight` is active:
   * incoming events must be queued while the previous animation is playing.
   */
  useLayoutEffect(() => {
    if (projectionVersion === null) return;

    const ready: OkeyActionEvent[] = [];
    while (
      pendingCommittedEventsRef.current[0] &&
      pendingCommittedEventsRef.current[0].version <= projectionVersion
    ) {
      ready.push(pendingCommittedEventsRef.current.shift()!);
    }

    if (ready.length === 0) return;

    let queuedVisual = false;

    for (const event of ready) {
      const actorIndex = state.players.findIndex(
        (player) => player.id === event.actorPlayerId,
      );
      if (actorIndex <= 0 || !event.actorPlayerId) continue;

      if (event.type === "draw") {
        const source =
          event.payload.source === "discard" ? "discard" : "deck";

        queuedPresentationActionsRef.current.push({
          kind: "draw",
          ownerPlayerId: event.actorPlayerId,
          eventId: `${event.version}-${event.sequence}`,
          source,
          tile:
            source === "discard"
              ? ((event.payload.tile as OkeyTile | null) ?? null)
              : null,
        });
        queuedVisual = true;
        continue;
      }

      if (event.type === "discard") {
        const tileId =
          typeof event.payload.tileId === "string"
            ? event.payload.tileId
            : null;

        if (
          tileId &&
          suppressNextOpponentDiscardFlightTileIdRef.current === tileId
        ) {
          suppressNextOpponentDiscardFlightTileIdRef.current = null;
          continue;
        }

        const tile =
          (event.payload.tile as OkeyTile | null) ??
          (tileId
            ? state.discardPile.find((entry) => entry.id === tileId) ?? null
            : null);

        if (!tile) continue;

        const discardIndex = state.discardPile.findIndex(
          (entry) => entry.id === tile.id,
        );

        queuedPresentationActionsRef.current.push({
          kind: "discard",
          entry: {
            tile,
            ownerPlayerId: event.actorPlayerId,
            discardCount:
              discardIndex >= 0
                ? discardIndex + 1
                : state.discardPile.length,
            animateWallDraw: false,
          },
        });
        queuedVisual = true;
        continue;
      }

      if (
        event.type === "open" ||
        event.type === "meld" ||
        event.type === "konkan"
      ) {
        queuedPresentationActionsRef.current.push({
          kind: "players-sync",
          ownerPlayerId: event.actorPlayerId,
          players: state.players,
        });
        queuedVisual = true;
      }
    }

    if (!queuedVisual) return;

    setOpponentTurnTransitionActive(true);

    // If another flight is active, do nothing else. The scene calls
    // startNextQueuedPresentation() when that flight completes.
    if (!tileFlight) {
      startNextQueuedPresentation();
    }
  }, [
    actionEventTick,
    projectionVersion,
    setOpponentTurnTransitionActive,
    startNextQueuedPresentation,
    state.discardPile,
    state.players,
    tileFlight,
  ]);

  const resetOpponentPresentation = useCallback(() => {
    pendingCommittedEventsRef.current = [];
    queuedPresentationActionsRef.current = [];
    setPresentedOpponentPlayerId(null);
    suppressNextOpponentDiscardFlightTileIdRef.current = null;
  }, []);

  useEffect(
    () => () => {
      resetOpponentPresentation();
    },
    [resetOpponentPresentation],
  );

  return {
    presentedOpponentPlayerId,
    suppressNextOpponentDiscardFlightTileIdRef,
    startNextQueuedPresentation,
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

