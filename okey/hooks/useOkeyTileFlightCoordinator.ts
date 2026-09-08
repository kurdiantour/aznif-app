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
  type MeldDropRect,
  type ScreenRect,
  type TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "@/okey/types/okey";
import { getOkeyRackDiscardAction } from "@/okey/engine/okey-engine";
import type { OkeyOpenAction, OkeyTableMeldAction } from "@/okey/engine/okey-engine";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { SupabaseOkeyMatchAdapter, OkeyCommittedTransition } from "@/okey/adapters/supabase-okey-match-adapter";
import type { OkeyActionEvent } from "@/okey/server/okey-action-events";
import { useOkeyPresentationBoundary } from "@/okey/presentation/useOkeyPresentationPolicy";
import { getOkeyRunEndForDrop } from "@/okey/presentation/okey-table-interactions";

type OnlineTimeoutDiscardFlight = {
  eventId: string;
  tile: OkeyTile;
  stage: "deck-to-rack" | "rack-to-discard";
  rackRect: ScreenRect;
  discardRect: ScreenRect;
  previousDiscard: OkeyTile | null;
};

type ActivePresentation = {
  onlineTimeout: OnlineTimeoutDiscardFlight | null;
  completedTimeoutEventId: string | null;
  resetOpponent: (() => void) | null;
  resetTimeout: (() => void) | null;
};

type QueuedPresentationEvent = {
  event: OkeyActionEvent;
};

type PresentedTurnSnapshot = {
  version: number;
  playerId: string | null;
  playerIndex: number | null;
};

type LaunchTileFlightOptions = {
  flight: TileFlight;
  hideDeckTopTile?: boolean;
  hideDiscardTopTile?: boolean;
  discardFallback?: OkeyTile | null;
};

type PresentationSurface = {
  tileFlight: TileFlight | null;
  hiddenRackTileIds: string[];
  hideDeckTopTile: boolean;
  hideDiscardTopTile: boolean;
 discardPresentation: {
    fallback: OkeyTile | null;
    untilTileId: string | null;
  };
};

const createPresentationSurface = (): PresentationSurface => ({
  tileFlight: null,
  hiddenRackTileIds: [],
  hideDeckTopTile: false,
  hideDiscardTopTile: false,
 discardPresentation: { fallback: null, untilTileId: null },
});

export function useOkeyTileFlightCoordinator(
  initialPlayers: OkeyGameState["players"],
  initialTopDiscard: OkeyTile | null,
) {
  const [surface, setSurface] = useState<PresentationSurface>(createPresentationSurface);
  const [presentedTablePlayers, setPresentedTablePlayers] =
    useState(initialPlayers);
  const [presentedTopDiscard, setPresentedTopDiscard] =
    useState<OkeyTile | null>(initialTopDiscard);

  const setSurfaceField = useCallback(<Key extends keyof PresentationSurface>(
    key: Key,
    action: SetStateAction<PresentationSurface[Key]>,
  ) => {
    setSurface((current) => {
      const value = typeof action === "function"
        ? (action as (previous: PresentationSurface[Key]) => PresentationSurface[Key])(current[key])
        : action;
      return Object.is(value, current[key]) ? current : { ...current, [key]: value };
    });
  }, []);

  const setTileFlight = useCallback((action: SetStateAction<TileFlight | null>) =>
    setSurfaceField("tileFlight", action), [setSurfaceField]);
  const setHiddenRackTileIds = useCallback((action: SetStateAction<string[]>) =>
    setSurfaceField("hiddenRackTileIds", action), [setSurfaceField]);
  const setHideDeckTopTile = useCallback((action: SetStateAction<boolean>) =>
    setSurfaceField("hideDeckTopTile", action), [setSurfaceField]);
  const setHideDiscardTopTile = useCallback((action: SetStateAction<boolean>) =>
    setSurfaceField("hideDiscardTopTile", action), [setSurfaceField]);
 const setDiscardPresentationFallback = useCallback((action: SetStateAction<OkeyTile | null>) => {
    setSurface((current) => {
      const fallback = typeof action === "function"
        ? (action as (previous: OkeyTile | null) => OkeyTile | null)(current.discardPresentation.fallback)
        : action;
      const discardPresentation = { fallback, untilTileId: null };
      return fallback === current.discardPresentation.fallback &&
        current.discardPresentation.untilTileId === null
        ? current
        : { ...current, discardPresentation };
    });
  }, []);
  const holdDiscardUntilAuthoritative = useCallback((tile: OkeyTile) => {
    setSurface((current) => ({
      ...current,
      discardPresentation: { fallback: tile, untilTileId: tile.id },
    }));
  }, []);
  const releaseAuthoritativeDiscardHold = useCallback((topDiscardTileId: string | null) => {
    setSurface((current) => current.discardPresentation.untilTileId !== null &&
      current.discardPresentation.untilTileId === topDiscardTileId
      ? {
          ...current,
          hideDiscardTopTile: false,
          discardPresentation: { fallback: null, untilTileId: null },
        }
      : current);
  }, []);
  const launchTileFlight = useCallback((options: LaunchTileFlightOptions) => {
    setSurface((current) => {
      const hasDiscardFallback =
        Object.prototype.hasOwnProperty.call(options, "discardFallback");

      return {
        ...current,
        tileFlight: options.flight,
        hideDeckTopTile: options.hideDeckTopTile
          ? true
          : current.hideDeckTopTile,
        hideDiscardTopTile:
          options.hideDiscardTopTile || hasDiscardFallback
            ? true
            : current.hideDiscardTopTile,
        discardPresentation: hasDiscardFallback
          ? {
              fallback: options.discardFallback ?? null,
              untilTileId: null,
            }
          : current.discardPresentation,
      };
    });
  }, []);

  const awaitingDiscardRemovalTileIdRef = useRef<string | null>(null);
  const activePresentationRef = useRef<ActivePresentation>({
    onlineTimeout: null,
    completedTimeoutEventId: null,
    resetOpponent: null,
    resetTimeout: null,
  });

  const setPresentedPlayers = useCallback((players: OkeyGameState["players"]) => {
    setPresentedTablePlayers(players);
  }, []);

  const resetPresentationRuntime = useCallback((
    players: OkeyGameState["players"],
    topDiscard: OkeyTile | null,
  ) => {
    activePresentationRef.current.resetOpponent?.();
    activePresentationRef.current.resetTimeout?.();
    awaitingDiscardRemovalTileIdRef.current = null;
    setPresentedTablePlayers(players);
    setPresentedTopDiscard(topDiscard);
    setSurface(createPresentationSurface());
  }, []);

  return {
    tileFlight: surface.tileFlight,
    setTileFlight,
    hiddenRackTileIds: surface.hiddenRackTileIds,
    setHiddenRackTileIds,
    hideDeckTopTile: surface.hideDeckTopTile,
    setHideDeckTopTile,
    hideDiscardTopTile: surface.hideDiscardTopTile,
    setHideDiscardTopTile,
    discardPresentationFallback: surface.discardPresentation.fallback,
    setDiscardPresentationFallback,
    holdDiscardUntilAuthoritative,
    releaseAuthoritativeDiscardHold,
    launchTileFlight,
    presentedTablePlayers,
    setPresentedPlayers,
    presentedTopDiscard,
    setPresentedTopDiscard,
    resetPresentationRuntime,
    awaitingDiscardRemovalTileIdRef,
    activePresentationRef,
  };
}

type UseOkeyOpponentTileFlightCoordinatorInput = {
  state: OkeyGameState;
  adapter: SupabaseOkeyMatchAdapter | null;
  projectionVersion: number | null;
  tileFlight: TileFlight | null;
  deckTopRectRef: MutableRefObject<ScreenRect | null>;
  discardTopRectRef: MutableRefObject<ScreenRect | null>;
  opponentSeatRectsRef: MutableRefObject<Record<string, ScreenRect>>;
  rackRectRef: MutableRefObject<ScreenRect | null>;
  activePresentationRef: MutableRefObject<ActivePresentation>;
  setPresentedPlayers: (players: OkeyGameState["players"]) => void;
  launchTileFlight: (options: LaunchTileFlightOptions) => void;
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
  rackRectRef,
  activePresentationRef,
  setPresentedPlayers,
  launchTileFlight,
  toLocalRect,
}: UseOkeyOpponentTileFlightCoordinatorInput) {
  const presentationQueueRef = useRef<QueuedPresentationEvent[]>([]);
  const pendingTurnTransitionsRef = useRef<PresentedTurnSnapshot[]>([]);
  const activePresentationVersionRef = useRef<number | null>(null);
  const latestAuthoritativeTurnRef = useRef<PresentedTurnSnapshot>({
    version: projectionVersion ?? 0,
    playerId: state.players[state.currentPlayerIndex]?.id ?? null,
    playerIndex: state.currentPlayerIndex ?? null,
  });
  const presentedTurnVersionRef = useRef(projectionVersion ?? 0);
  const [presentedTurn, setPresentedTurn] = useState<PresentedTurnSnapshot>(
    latestAuthoritativeTurnRef.current,
  );
  const [actionEventTick, setActionEventTick] = useState(0);

  const flushPresentedTurnTransitions = useCallback(() => {
    let latestReady: PresentedTurnSnapshot | null = null;

    while (pendingTurnTransitionsRef.current.length > 0) {
      const candidate = pendingTurnTransitionsRef.current[0];
      if (!candidate) break;

      const hasQueuedEventThroughCandidate = presentationQueueRef.current.some(
        (queued) => queued.event.version <= candidate.version,
      );
      const hasActiveFlightThroughCandidate =
        activePresentationVersionRef.current !== null &&
        activePresentationVersionRef.current <= candidate.version;

      if (hasQueuedEventThroughCandidate || hasActiveFlightThroughCandidate) {
        break;
      }

      pendingTurnTransitionsRef.current.shift();
      if (candidate.version >= presentedTurnVersionRef.current) {
        latestReady = candidate;
        presentedTurnVersionRef.current = candidate.version;
      }
    }

    if (latestReady) {
      setPresentedTurn(latestReady);
    }
  }, []);

  const queueCommittedTurnTransition = useCallback((
    transition: OkeyCommittedTransition,
  ) => {
    const playerIndex = transition.projection.currentPlayerIndex;
    const snapshot: PresentedTurnSnapshot = {
      version: transition.version,
      playerId: transition.projection.players[playerIndex]?.id ?? null,
      playerIndex,
    };

    latestAuthoritativeTurnRef.current = snapshot;
    if (snapshot.version < presentedTurnVersionRef.current) return;

    pendingTurnTransitionsRef.current = pendingTurnTransitionsRef.current
      .filter((entry) => entry.version !== snapshot.version);
    pendingTurnTransitionsRef.current.push(snapshot);
    pendingTurnTransitionsRef.current.sort((left, right) => left.version - right.version);
    flushPresentedTurnTransitions();
  }, [flushPresentedTurnTransitions]);

  useEffect(() => {
    if (projectionVersion === null) return;

    const snapshot: PresentedTurnSnapshot = {
      version: projectionVersion,
      playerId: state.players[state.currentPlayerIndex]?.id ?? null,
      playerIndex: state.currentPlayerIndex ?? null,
    };
    latestAuthoritativeTurnRef.current = snapshot;

    const alreadyQueued = pendingTurnTransitionsRef.current.some(
      (entry) => entry.version === snapshot.version,
    );
    if (!alreadyQueued && snapshot.version >= presentedTurnVersionRef.current) {
      pendingTurnTransitionsRef.current.push(snapshot);
      pendingTurnTransitionsRef.current.sort((left, right) => left.version - right.version);
    }
    flushPresentedTurnTransitions();
  }, [
    flushPresentedTurnTransitions,
    projectionVersion,
    state.currentPlayerIndex,
    state.players,
  ]);

  const startNextQueuedPresentation = useCallback((): boolean => {
    // `tileFlight` is the only visual busy condition. Game progression is never
    // blocked here; this only prevents two animations from starting together.
    if (tileFlight) return false;

    while (presentationQueueRef.current.length > 0) {
      const queued = presentationQueueRef.current[0];
      if (!queued || queued.event.version > (projectionVersion ?? -1)) break;
      const event = queued.event;
      const eventState = state;
      const isEliminatedEvent = event.payload.reason === "eliminated";
      const actorIndex = eventState.players.findIndex(
        (player) => player.id === event.actorPlayerId,
      );
      if (actorIndex < 0 || !event.actorPlayerId) {
        presentationQueueRef.current.shift();
        flushPresentedTurnTransitions();
        continue;
      }
      if (actorIndex === 0 && !isEliminatedEvent) {
        const targetPlayerId = typeof event.payload.targetPlayerId === "string"
          ? event.payload.targetPlayerId
          : null;
        if (
          event.type === "meld" &&
          event.payload.kind === "spend" &&
          targetPlayerId !== null &&
          targetPlayerId !== eventState.players[0]?.id
        ) {
          setPresentedPlayers(eventState.players);
        }
        presentationQueueRef.current.shift();
        flushPresentedTurnTransitions();
        continue;
      }
      const consumeEvent = () => {
        presentationQueueRef.current.shift();
        setPresentedPlayers(eventState.players);
      };

      if (event.type === "open" || event.type === "meld" || event.type === "konkan") {
        consumeEvent();
        flushPresentedTurnTransitions();
        continue;
      }

      if (event.type === "draw") {
        const source = event.payload.source === "discard" ? "discard" : "deck";
        const sourceRect =
          source === "deck"
            ? deckTopRectRef.current
            : discardTopRectRef.current;
        const seatRect = actorIndex === 0
          ? rackRectRef.current
          : opponentSeatRectsRef.current[event.actorPlayerId] ?? null;

        // Do not consume the action. onMeasured will call retry and this same
        // action will be attempted once geometry exists.
        if (!sourceRect || !seatRect) return false;

        const landingRect: ScreenRect = {
          x: seatRect.x + seatRect.width / 2 - sourceRect.width / 2,
          y: seatRect.y + seatRect.height / 2 - sourceRect.height / 2,
          width: sourceRect.width,
          height: sourceRect.height,
        };

        consumeEvent();
        activePresentationVersionRef.current = event.version;

        launchTileFlight({
          flight: {
            id: `opponent-draw-${event.version}-${event.sequence}`,
            tile: source === "discard"
              ? ((event.payload.tile as OkeyTile | null) ?? null)
              : null,
            face: source === "discard" ? "front" : "back",
            from: toLocalRect(sourceRect),
            to: toLocalRect(landingRect),
          },
          hideDeckTopTile: source === "deck",
          hideDiscardTopTile: source === "discard",
        });
        return true;
      }

      if (event.type !== "discard") {
        consumeEvent();
        flushPresentedTurnTransitions();
        continue;
      }

      const tileId = typeof event.payload.tileId === "string"
        ? event.payload.tileId
        : null;
      const tile =
        (event.payload.tile as OkeyTile | null) ??
        (tileId ? eventState.discardPile.find((entry) => entry.id === tileId) ?? null : null);
      if (!tile) {
        consumeEvent();
        flushPresentedTurnTransitions();
        continue;
      }
      const discardIndex = eventState.discardPile.findIndex((entry) => entry.id === tile.id);
      if (actorIndex === 0 && isEliminatedEvent) {
        const playerRect = rackRectRef.current;
        const discardRect = discardTopRectRef.current;
        if (!playerRect || !discardRect) return false;
        const sourceRect: ScreenRect = {
          x: playerRect.x + playerRect.width / 2 - discardRect.width / 2,
          y: playerRect.y + playerRect.height / 2 - discardRect.height / 2,
          width: discardRect.width,
          height: discardRect.height,
        };
        consumeEvent();
        activePresentationVersionRef.current = event.version;
        launchTileFlight({
          flight: {
            id: `eliminated-discard-${event.version}-${event.sequence}`,
            tile,
            face: "front",
            from: toLocalRect(sourceRect),
            to: toLocalRect(discardRect),
          },
          discardFallback:
            eventState.discardPile[discardIndex - 1] ?? null,
        });
        return true;
      }
      const sourceSeatRect =
        opponentSeatRectsRef.current[event.actorPlayerId] ?? null;
      const discardRect = discardTopRectRef.current;
      if (!sourceSeatRect || !discardRect) return false;

      const sourceRect: ScreenRect = {
        x: sourceSeatRect.x + sourceSeatRect.width / 2 - discardRect.width / 2,
        y: sourceSeatRect.y + sourceSeatRect.height / 2 - discardRect.height / 2,
        width: discardRect.width,
        height: discardRect.height,
      };

      const previousDiscard =
        discardIndex > 0
          ? eventState.discardPile[discardIndex - 1] ?? null
          : null;

      consumeEvent();
      activePresentationVersionRef.current = event.version;
      launchTileFlight({
        flight: {
          id: `opponent-discard-${event.version}-${event.sequence}`,
          tile,
          face: "front",
          from: toLocalRect(sourceRect),
          to: toLocalRect(discardRect),
        },
        discardFallback: previousDiscard,
      });
      return true;
    }

    return false;
  }, [
    deckTopRectRef,
    discardTopRectRef,
    flushPresentedTurnTransitions,
    opponentSeatRectsRef,
    rackRectRef,
    projectionVersion,
    launchTileFlight,
    setPresentedPlayers,
    state.discardPile,
    state.players,
    tileFlight,
    toLocalRect,
  ]);

  const retryQueuedOpponentFlight = useCallback(() => {
    if (tileFlight) return;

    if (presentationQueueRef.current.length === 0) {
        return;
    }

    startNextQueuedPresentation();
  }, [
    startNextQueuedPresentation,
    tileFlight,
  ]);

  useEffect(() => {
    if (!adapter) return;

    const unsubscribeEvents = adapter.subscribeActionEvents((event) => {
      presentationQueueRef.current.push({ event });
      presentationQueueRef.current.sort(
        (left, right) =>
          left.event.version - right.event.version ||
          left.event.sequence - right.event.sequence,
      );
      setActionEventTick((value) => value + 1);
    });

    const unsubscribeTransitions = adapter.subscribeCommittedTransitions(
      queueCommittedTurnTransition,
    );

    return () => {
      unsubscribeEvents();
      unsubscribeTransitions();
    };
  }, [adapter, queueCommittedTurnTransition]);

  /**
   * Ingest every committed event whose authoritative projection is already
   * available. This intentionally does NOT return when `tileFlight` is active:
   * incoming events must be queued while the previous animation is playing.
   */
  useLayoutEffect(() => {
    if (projectionVersion === null) return;

    const hasReadyEvent = presentationQueueRef.current.some(
      (queued) => queued.event.version <= projectionVersion,
    );
    if (!hasReadyEvent) return;


    // If another flight is active, do nothing else. The scene calls
    // startNextQueuedPresentation() when that flight completes.
    if (!tileFlight) {
      startNextQueuedPresentation();
    }
  }, [
    actionEventTick,
    projectionVersion,
    startNextQueuedPresentation,
    tileFlight,
  ]);

  const completeOpponentPresentationFlight = useCallback((
    completedFlight: TileFlight | null,
  ) => {
    if (!completedFlight) return;
    if (
      completedFlight.id.startsWith("opponent-") ||
      completedFlight.id.startsWith("eliminated-")
    ) {
      activePresentationVersionRef.current = null;
      flushPresentedTurnTransitions();
    }
  }, [flushPresentedTurnTransitions]);

  const resetOpponentPresentation = useCallback(() => {
    presentationQueueRef.current = [];
    pendingTurnTransitionsRef.current = [];
    activePresentationVersionRef.current = null;
    const latest = latestAuthoritativeTurnRef.current;
    presentedTurnVersionRef.current = latest.version;
    setPresentedTurn(latest);
  }, []);

  activePresentationRef.current.resetOpponent = resetOpponentPresentation;

  const hasQueuedPresentation = presentationQueueRef.current.some(
    (queued) => queued.event.version <= (projectionVersion ?? -1),
  );

  return {
    startNextQueuedPresentation,
    retryQueuedOpponentFlight,
    completeOpponentPresentationFlight,
    hasQueuedPresentation,
    presentedTurnPlayerId: presentedTurn.playerId,
    presentedTurnPlayerIndex: presentedTurn.playerIndex,
    presentedTurnVersion: presentedTurn.version,
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
  tileFlight: TileFlight | null;
  rackRectRef: MutableRefObject<ScreenRect | null>;
  rackTileRectsRef: MutableRefObject<Record<string, ScreenRect>>;
  deckTopRectRef: MutableRefObject<ScreenRect | null>;
  discardTopRectRef: MutableRefObject<ScreenRect | null>;
  setHideDeckTopTile: Dispatch<SetStateAction<boolean>>;
  setHideDiscardTopTile: Dispatch<SetStateAction<boolean>>;
  setDiscardPresentationFallback: Dispatch<SetStateAction<OkeyTile | null>>;
  setTileFlight: Dispatch<SetStateAction<TileFlight | null>>;
  toLocalRect: (rect: ScreenRect) => ScreenRect;
  activePresentationRef: MutableRefObject<ActivePresentation>;
};

export function useOkeyTimeoutTileFlightCoordinator({
  isOnline,
  onlineMatchId,
  onlineProjection,
  state,
  humanPlayer,
  tileFlight,
  rackRectRef,
  rackTileRectsRef,
  deckTopRectRef,
  discardTopRectRef,
  setHideDeckTopTile,
  setHideDiscardTopTile,
  setDiscardPresentationFallback,
  setTileFlight,
  toLocalRect,
  activePresentationRef,
}: UseOkeyTimeoutTileFlightCoordinatorInput) {
  const handledOnlineTimeoutDiscardEventIdRef = useRef<string | null>(null);
  const onlineTimeoutProjectionInitializedRef = useRef(false);
  const onlineTimeoutMatchIdRef = useRef<string | undefined>(undefined);
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
    if (tileFlight || activePresentationRef.current.onlineTimeout) return;

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
      activePresentationRef.current.onlineTimeout = {
        eventId: event.id,
        tile,
        stage: "rack-to-discard",
        rackRect,
        discardRect,
        previousDiscard,
      };
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
    activePresentationRef.current.onlineTimeout = {
      eventId: event.id,
      tile,
      stage: "deck-to-rack",
      rackRect: deckLandingRect,
      discardRect,
      previousDiscard,
    };
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
    state.discardPile,
    tileFlight,
    toLocalRect,
  ]);

  const resetTimeoutPresentation = useCallback(() => {
    activePresentationRef.current.onlineTimeout = null;
    handledOnlineTimeoutDiscardEventIdRef.current = null;
    onlineTimeoutProjectionInitializedRef.current = false;
  }, []);

  activePresentationRef.current.resetTimeout = resetTimeoutPresentation;

  return {
    resetTimeoutPresentation,
  };
}

export function useOkeyTileFlightCompletion(input: {
  tileFlight: TileFlight | null;
  topDiscard: OkeyTile | null;
  pendingDrawRef: MutableRefObject<{ tileId: string; source: "deck" | "discard" } | null>;
  setPresentedTopDiscard: Dispatch<SetStateAction<OkeyTile | null>>;
  activePresentationRef: MutableRefObject<ActivePresentation>;
  setTileFlight: Dispatch<SetStateAction<TileFlight | null>>;
  setHiddenRackTileIds: Dispatch<SetStateAction<string[]>>;
 setHideDeckTopTile: Dispatch<SetStateAction<boolean>>;
  setHideDiscardTopTile: Dispatch<SetStateAction<boolean>>;
  setDiscardPresentationFallback: Dispatch<SetStateAction<OkeyTile | null>>;
  holdDiscardUntilAuthoritative: (tile: OkeyTile) => void;
  toLocalRect: (rect: ScreenRect) => ScreenRect;
  resetTimeoutPresentation: () => void;
  startNextQueuedPresentation: () => boolean;
  completeOpponentPresentationFlight: (flight: TileFlight | null) => void;
}) {
  return () => {
    const completedFlight = input.tileFlight;
    input.completeOpponentPresentationFlight(completedFlight);
    const landedDiscardTile = completedFlight?.id.includes("discard-")
      ? completedFlight.tile
      : null;

    if (landedDiscardTile) {
      input.setPresentedTopDiscard(landedDiscardTile);
    } else if (
      completedFlight?.id.includes("draw-") &&
      completedFlight.face === "front" &&
      input.pendingDrawRef.current?.source !== "discard"
    ) {
      // A tile drawn from the discard pile is now in flight; reveal the
      // authoritative tile underneath only after the flight lands.
      input.setPresentedTopDiscard(input.topDiscard);
    }

    input.setTileFlight(null);
    // Keep a locally discarded rack tile hidden until the authoritative hand
    // no longer contains it. OkeyGameTableScene owns that release.
    if (input.pendingDrawRef.current?.source !== "deck") input.setHideDeckTopTile(false);

    if (landedDiscardTile) {
      if (input.topDiscard?.id === landedDiscardTile.id) {
        input.setHideDiscardTopTile(false);
        input.setDiscardPresentationFallback(null);
      } else {
        input.holdDiscardUntilAuthoritative(landedDiscardTile);
        input.setHideDiscardTopTile(true);
      }
    } else {
      input.setHideDiscardTopTile(false);
      input.setDiscardPresentationFallback(null);
    }

    const onlineTimeoutFlight = input.activePresentationRef.current.onlineTimeout;
    if (onlineTimeoutFlight?.stage === "deck-to-rack") {
      onlineTimeoutFlight.stage = "rack-to-discard";
      input.setDiscardPresentationFallback(onlineTimeoutFlight.previousDiscard);
      input.setHideDiscardTopTile(true);
      input.setTileFlight({
        id: `online-timeout-discard-${onlineTimeoutFlight.eventId}`,
        tile: onlineTimeoutFlight.tile,
        face: "front",
        from: input.toLocalRect(onlineTimeoutFlight.rackRect),
        to: input.toLocalRect(onlineTimeoutFlight.discardRect),
      });
      return;
    }
    if (onlineTimeoutFlight?.stage === "rack-to-discard") {
      input.activePresentationRef.current.completedTimeoutEventId =
        onlineTimeoutFlight.eventId;
      input.resetTimeoutPresentation();
      requestAnimationFrame(() => {
        input.startNextQueuedPresentation();
      });
      return;
    }

    requestAnimationFrame(() => {
      input.startNextQueuedPresentation();
    });
  };
}
type RackDropPlacement = { tileId: string; point: { x: number; y: number }; nonce: number } | null;
type PendingDraw = { tileId: string; source: "deck" | "discard" } | null;

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
  dropTileOnTableMeld: (tileId: string, point: { x: number; y: number }) => boolean;
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
    if (!tile) return false;

    const pending = { tileId: tile.id, source } as const;
    pendingDrawRef.current = pending;
    setOptimisticRackTile(tile);

    if (source === "deck") {
      setHideDeckTopTile(true);
    } else {
      setPresentedTopDiscard(state.discardPile[state.discardPile.length - 2] ?? null);
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
        flight: { id: "draw-" + tile.id + "-" + Date.now(), tile, face: "front", from: toLocalRect(sourceRect), to: toLocalRect(targetRect) },
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
  const dropTileFromRack = useCallback((tileId: string, point: { x: number; y: number }) => {
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
  }, [canDraw, humanPlayer.hand, pendingDrawRef, setHideDeckTopTile, setHideDiscardTopTile, setOptimisticRackTile]);
  return { startDrawFlight, startDiscardFlight, handleDiscardDroppedOnRack, dropTileFromRack, handleDeckDroppedOnRack };
}

export function useOkeyTakeoverPresentationExit(input: {
  matchId?: string;
  projection: OkeyMatchServerProjection | null;
  activePresentationRef: MutableRefObject<ActivePresentation>;
  presentationToken: TileFlight | null;
  onExit: () => void;
}) {
  const { matchId, projection, activePresentationRef, presentationToken, onExit } = input;
  const exitStartedRef = useRef(false);
  const previousControlRef = useRef<{ matchId: string; playerId: string; controlled: boolean } | null>(null);
  const pendingTimeoutEventIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || !projection || exitStartedRef.current || projection.matchFinished) return;
    const viewer = projection.players.find((player) => Array.isArray(player.hand));
    if (!viewer) return;
    const controlled = viewer.controlledByBot === true || viewer.kind === "bot";
    const previous = previousControlRef.current;
    previousControlRef.current = { matchId, playerId: viewer.id, controlled };
    if (!controlled) { pendingTimeoutEventIdRef.current = null; return; }
    const event = projection.lastTimeoutDiscardEvent;
    const fresh = previous?.matchId === matchId && previous.playerId === viewer.id && previous.controlled === false;
    if (pendingTimeoutEventIdRef.current === null && fresh && event?.playerId === viewer.id) {
      if (activePresentationRef.current.completedTimeoutEventId === event.id) { exitStartedRef.current = true; onExit(); return; }
      if (activePresentationRef.current.onlineTimeout?.eventId === event.id) { pendingTimeoutEventIdRef.current = event.id; return; }
      exitStartedRef.current = true; onExit(); return;
    }
    const pendingId = pendingTimeoutEventIdRef.current;
    if (pendingId) {
      if (activePresentationRef.current.completedTimeoutEventId === pendingId || activePresentationRef.current.onlineTimeout?.eventId !== pendingId) {
        pendingTimeoutEventIdRef.current = null; exitStartedRef.current = true; onExit();
      }
      return;
    }
    exitStartedRef.current = true;
    onExit();
  }, [activePresentationRef, matchId, onExit, presentationToken, projection]);
}

export function useOkeyOptimisticRackPresentation(
  authoritativeHand: OkeyTile[],
  optimisticTile: OkeyTile | null,
  setOptimisticTile: Dispatch<SetStateAction<OkeyTile | null>>,
) {
  const presentedHand = optimisticTile && !authoritativeHand.some((tile) => tile.id === optimisticTile.id)
    ? [...authoritativeHand, optimisticTile]
    : authoritativeHand;
  useLayoutEffect(() => {
    if (optimisticTile && authoritativeHand.some((tile) => tile.id === optimisticTile.id)) {
      setOptimisticTile(null);
    }
  }, [authoritativeHand, optimisticTile, setOptimisticTile]);
  return presentedHand;
}
export function useOkeyPresentationResetLifecycle(input: {
  resumeToken: number;
  round: number;
  players: OkeyGameState["players"];
  topDiscard: OkeyTile | null;
  resetRuntime: (players: OkeyGameState["players"], topDiscard: OkeyTile | null) => void;
  resetTablePresentation: () => void;
  pendingDrawRef: MutableRefObject<PendingDraw>;
  hoveredMeldTargetRef: MutableRefObject<{ playerId: string; meldId: string } | null>;
  meldDropRectsRef: MutableRefObject<unknown[]>;
  setDiscardDropPlacement: Dispatch<SetStateAction<RackDropPlacement>>;
  setIsDiscardDragActive: Dispatch<SetStateAction<boolean>>;
  setHoveredMeldTarget: Dispatch<SetStateAction<{ playerId: string; meldId: string } | null>>;
}) {
  const {
    resumeToken, round, players, topDiscard, resetRuntime, resetTablePresentation,
    pendingDrawRef, hoveredMeldTargetRef, meldDropRectsRef, setDiscardDropPlacement,
    setIsDiscardDragActive, setHoveredMeldTarget,
  } = input;
  useOkeyPresentationBoundary(resumeToken, () => {
    resetRuntime(players, topDiscard);
    pendingDrawRef.current = null;
    setDiscardDropPlacement(null);
    setIsDiscardDragActive(false);
    setHoveredMeldTarget(null);
  });
  useOkeyPresentationBoundary(round, () => {
    hoveredMeldTargetRef.current = null;
    meldDropRectsRef.current = [];
    resetRuntime(players, topDiscard);
    pendingDrawRef.current = null;
    resetTablePresentation();
  });
}

export function useOkeyAuthoritativeRackRemovalPresentation(
  authoritativeHand: OkeyTile[],
  awaitingTileIdRef: MutableRefObject<string | null>,
  setHiddenTileIds: Dispatch<SetStateAction<string[]>>,
) {
  useEffect(() => {
    const tileId = awaitingTileIdRef.current;
    if (!tileId || authoritativeHand.some((tile) => tile.id === tileId)) return;
    awaitingTileIdRef.current = null;
    setHiddenTileIds((current) => current.filter((entry) => entry !== tileId));
  }, [authoritativeHand, awaitingTileIdRef, setHiddenTileIds]);
}

export function useOkeyTableMeldCommandPresentation(input: {
  awaitingTileIdRef: MutableRefObject<string | null>;
  setHiddenTileIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTileId: Dispatch<SetStateAction<string | null>>;
  lockKonkan: (tileId: string, playerId: string, meldId: string, runEnd?: "start" | "end") => Promise<boolean>;
  spendTile: (tileId: string, playerId: string, meldId: string, runEnd?: "start" | "end") => Promise<boolean>;
}) {
  const { awaitingTileIdRef, setHiddenTileIds, setSelectedTileId, lockKonkan, spendTile } = input;
  return useCallback((action: OkeyTableMeldAction, runEnd?: "start" | "end") => {
    const tileId = action.tileId;
    awaitingTileIdRef.current = tileId;
    setHiddenTileIds([tileId]);
    setSelectedTileId(null);
    const command = action.type === "lock-konkan" ? lockKonkan : spendTile;
    void command(tileId, action.targetPlayerId, action.targetMeldId, runEnd).then((accepted) => {
      if (accepted) return;
      awaitingTileIdRef.current = null;
      setHiddenTileIds((current) => current.filter((entry) => entry !== tileId));
    });
    return true;
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
  const dropTileOnTableMeld = useCallback((tileId: string, point: { x: number; y: number }) => {
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
