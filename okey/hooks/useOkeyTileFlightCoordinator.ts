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
  const [actionEventTick, setActionEventTick] = useState(0);


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

    return adapter.subscribeActionEvents((event) => {
      presentationQueueRef.current.push({ event });
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

  const resetOpponentPresentation = useCallback(() => {
    presentationQueueRef.current = [];
  }, []);

  activePresentationRef.current.resetOpponent = resetOpponentPresentation;

  return {
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
}) {
  return () => {
    const completedFlight = input.tileFlight;
    const landedDiscardTile = completedFlight?.id.includes("discard-")
      ? completedFlight.tile
      : null;

    if (landedDiscardTile) {
      input.setPresentedTopDiscard(landedDiscardTile);
    } else if (
      completedFlight?.id.includes("draw-") &&
      completedFlight.face === "front"
    ) {
      // A tile drawn from the discard pile is now in flight; reveal the
      // authoritative tile underneath only after the flight lands.
      input.setPresentedTopDiscard(input.topDiscard);
    }

    input.setTileFlight(null);
    // Keep a locally discarded rack tile hidden until the authoritative hand
    // no longer contains it. OkeyGameTableScene owns that release.
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
        input.startNextQueuedPresentation();
      });
      return;
    }

    requestAnimationFrame(() => {
      input.startNextQueuedPresentation();
    });
  };
}
