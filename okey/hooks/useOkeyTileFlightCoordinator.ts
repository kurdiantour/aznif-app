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
  projectionState: OkeyGameState | null;
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
  opponentTurnTransitionActive: boolean;
};

const createPresentationSurface = (): PresentationSurface => ({
  tileFlight: null,
  hiddenRackTileIds: [],
  hideDeckTopTile: false,
  hideDiscardTopTile: false,
 discardPresentation: { fallback: null, untilTileId: null },
  opponentTurnTransitionActive: false,
});

export function useOkeyTileFlightCoordinator(initialPlayers: OkeyGameState["players"]) {
  const [surface, setSurface] = useState<PresentationSurface>(createPresentationSurface);
  const [presentedTablePlayers, setPresentedTablePlayers] =
    useState(initialPlayers);

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
  const setOpponentTurnTransitionActive = useCallback((action: SetStateAction<boolean>) =>
    setSurfaceField("opponentTurnTransitionActive", action), [setSurfaceField]);

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

  const resetPresentationRuntime = useCallback((players: OkeyGameState["players"]) => {
    activePresentationRef.current.resetOpponent?.();
    activePresentationRef.current.resetTimeout?.();
    awaitingDiscardRemovalTileIdRef.current = null;
    setPresentedTablePlayers(players);
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
    opponentTurnTransitionActive: surface.opponentTurnTransitionActive,
    setOpponentTurnTransitionActive,
    presentedTablePlayers,
    setPresentedPlayers,
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
  rackRectRef,
  activePresentationRef,
  setPresentedPlayers,
  setDiscardPresentationFallback,
  setOpponentTurnTransitionActive,
  setHideDeckTopTile,
  setHideDiscardTopTile,
  setTileFlight,
  buildOpponentDiscardFlight,
  toLocalRect,
}: UseOkeyOpponentTileFlightCoordinatorInput) {
  const presentationQueueRef = useRef<QueuedPresentationEvent[]>([]);
  const [actionEventTick, setActionEventTick] = useState(0);

  const [presentedOpponentPlayerId, setPresentedOpponentPlayerId] =
    useState<string | null>(null);

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

    while (presentationQueueRef.current.length > 0) {
      const queued = presentationQueueRef.current[0];
      if (!queued || queued.event.version > (projectionVersion ?? -1)) break;
      const event = queued.event;
      const eventState = queued.projectionState ?? state;
      const isEliminatedEvent = event.payload.reason === "eliminated";
      const actorIndex = eventState.players.findIndex(
        (player) => player.id === event.actorPlayerId,
      );
      if (actorIndex < 0 || !event.actorPlayerId || (actorIndex === 0 && !isEliminatedEvent)) {
        presentationQueueRef.current.shift();
        continue;
      }
      const consumeEvent = () => {
        presentationQueueRef.current.shift();
        setPresentedPlayers(eventState.players);
      };

      if (event.type === "open" || event.type === "meld" || event.type === "konkan") {
        consumeEvent();
        setPresentedOpponentPlayerId(event.actorPlayerId);
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
        setPresentedOpponentPlayerId(event.actorPlayerId);

        if (source === "deck") setHideDeckTopTile(true);
        else setHideDiscardTopTile(true);

        setTileFlight({
          id: `opponent-draw-${event.version}-${event.sequence}`,
          tile: source === "discard"
            ? ((event.payload.tile as OkeyTile | null) ?? null)
            : null,
          face: source === "discard" ? "front" : "back",
          from: toLocalRect(sourceRect),
          to: toLocalRect(landingRect),
        });
        return true;
      }

      if (event.type !== "discard") {
        consumeEvent();
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
        setDiscardPresentationFallback(
          eventState.discardPile[discardIndex - 1] ?? null,
        );
        setHideDiscardTopTile(true);
        setTileFlight({
          id: `eliminated-discard-${event.version}-${event.sequence}`,
          tile,
          face: "front",
          from: toLocalRect(sourceRect),
          to: toLocalRect(discardRect),
        });
        return true;
      }
      if (!startDiscardFlight({
        tile,
        ownerPlayerId: event.actorPlayerId,
        discardCount: discardIndex >= 0 ? discardIndex + 1 : eventState.discardPile.length,
        animateWallDraw: false,
      })) return false;

      consumeEvent();
      return true;
    }

    setPresentedOpponentPlayerId(null);
    return false;
  }, [
    deckTopRectRef,
    discardTopRectRef,
    opponentSeatRectsRef,
    rackRectRef,
    projectionVersion,
    setHideDeckTopTile,
    setHideDiscardTopTile,
    setPresentedPlayers,
    setTileFlight,
    startDiscardFlight,
    state.discardPile,
    state.players,
    tileFlight,
    toLocalRect,
  ]);

  const retryQueuedOpponentFlight = useCallback(() => {
    if (tileFlight) return;

    if (presentationQueueRef.current.length === 0) {
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
      presentationQueueRef.current.push({ event, projectionState: null });
      presentationQueueRef.current.sort(
        (left, right) =>
          left.event.version - right.event.version ||
          left.event.sequence - right.event.sequence,
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
    const ready = presentationQueueRef.current.filter(
      (queued) => queued.event.version <= projectionVersion,
    );
    if (ready.length === 0) return;
    ready.forEach((queued) => {
      if (!queued.projectionState) queued.projectionState = state;
    });

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
    presentationQueueRef.current = [];
    setPresentedOpponentPlayerId(null);
  }, []);

  activePresentationRef.current.resetOpponent = resetOpponentPresentation;

  return {
    presentedOpponentPlayerId,
    startNextQueuedPresentation,
    retryQueuedOpponentFlight,
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
  setOpponentTurnTransitionActive: Dispatch<SetStateAction<boolean>>;
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
  setOpponentTurnTransitionActive,
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
    activePresentationRef.current.onlineTimeout = {
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
  activePresentationRef: MutableRefObject<ActivePresentation>;
  setTileFlight: Dispatch<SetStateAction<TileFlight | null>>;
  setHiddenRackTileIds: Dispatch<SetStateAction<string[]>>;
 setHideDeckTopTile: Dispatch<SetStateAction<boolean>>;
  setHideDiscardTopTile: Dispatch<SetStateAction<boolean>>;
  setDiscardPresentationFallback: Dispatch<SetStateAction<OkeyTile | null>>;
  holdDiscardUntilAuthoritative: (tile: OkeyTile) => void;
  setOpponentTurnTransitionActive: Dispatch<SetStateAction<boolean>>;
  toLocalRect: (rect: ScreenRect) => ScreenRect;
  resetTimeoutPresentation: () => void;
  startNextQueuedPresentation: () => boolean;
}) {
  return () => {
    const landedDiscardTile = input.tileFlight?.id.includes("discard-")
      ? input.tileFlight.tile
      : null;
    input.setTileFlight(null);
    input.setHiddenRackTileIds([]);
   input.setHideDeckTopTile(false);

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
        if (!input.startNextQueuedPresentation()) {
          input.setOpponentTurnTransitionActive(false);
        }
      });
      return;
    }

    requestAnimationFrame(() => {
      if (!input.startNextQueuedPresentation()) {
        input.setOpponentTurnTransitionActive(false);
      }
    });
  };
}

