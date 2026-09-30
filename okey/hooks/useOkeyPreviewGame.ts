import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialOkeyGame,
  discardTile,
  drawTile,
  lockKonkanSet,
  openPlayerMelds,
  spendTileOnMeld,
} from "@/okey/engine/okey-engine";
import { chooseBotDiscardTile, isOkeyBotControlled } from "@/okey/engine/okey-bot-engine";
import type { OkeyActionEvent, OkeyActionEventDraft } from "@/okey/server/okey-action-events";
import type { OkeyCommittedTransition, OkeyPresentationSource } from "@/okey/adapters/okey-match-adapter";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyDrawSource, OkeyGameState, OkeyMeld, OkeyTeamId } from "@/okey/types/okey";

function createPreviewState(dealerIndex = 0): OkeyGameState {
  const initial = createInitialOkeyGame(dealerIndex);
  const players = initial.players.map((player, index) => ({
    ...player,
    id: index === 0 ? "seat-0" : `seat-${index}`,
    name: index === 0 ? "You" : `Bot ${index}`,
    avatarId: index === 0 ? undefined : "bot-avatar",
    kind: index === 0 ? ("human" as const) : ("bot" as const),
    controlledByBot: index !== 0,
    botDifficulty: "normal" as const,
    botNumber: index,
  }));
  return {
    ...initial,
    players,
  };
}

function createPreviewProjection(
  state: OkeyGameState,
  version: number,
  deadline: number,
  currentRound = 1,
): OkeyMatchServerProjection {
  return {
    ...state,
    version,
    deckCount: state.deck.length,
    turnDeadlineAt: new Date(deadline).toISOString(),
    turnDurationSeconds: 30,
    currentRound,
    maxRounds: 7,
    roundResults: [],
    matchScores: { teamA: 0, teamB: 0 },
    matchFinished: false,
    matchWinnerTeamId: null,
    nextRoundEligibleAt: null,
    forcedKonkanTeamId: null,
    roundStartsAt: null,
    lastTimeoutDiscardEvent: null,
    players: state.players.map((player) => ({
      ...player,
      handCount: player.hand.length,
      hand: player.hand,
    })),
  };
}

const TURN_MS = 30_000;
const BOT_STEP_MS = 1_500;

function createPresentationStream() {
  const transitions = new Set<(value: OkeyCommittedTransition) => void>();
  const events = new Set<(value: OkeyActionEvent) => void>();
  const resets = new Set<() => void>();
  const source: OkeyPresentationSource = {
    subscribeCommittedTransitions(listener) {
      transitions.add(listener);
      return () => { transitions.delete(listener); };
    },
    subscribeActionEvents(listener) {
      events.add(listener);
      return () => { events.delete(listener); };
    },
    subscribeReset(listener) {
      resets.add(listener);
      return () => { resets.delete(listener); };
    },
  };
  return {
    source,
    emit(transition: OkeyCommittedTransition) {
      transitions.forEach((listener) => listener(transition));
      transition.actionEvents.forEach((event) => events.forEach((listener) => listener(event)));
    },
    reset() { resets.forEach((listener) => listener()); },
  };
}

export function useOkeyPreviewGame(enabled = true) {
  const [snapshot, setSnapshot] = useState(() => {
    const state = createPreviewState();
    return { state, projection: createPreviewProjection(state, 1, Date.now() + TURN_MS) };
  });
  const snapshotRef = useRef(snapshot);
  const [stream] = useState(createPresentationStream);
  const [now, setNow] = useState(Date.now);
  const [lifecycleResumeToken, setLifecycleResumeToken] = useState(0);
  const { state, projection: onlineProjection } = snapshot;

  // Commit outside React state updaters: strict-mode replays must never emit twice.
  const commit = useCallback((
    update: (current: OkeyGameState) => OkeyGameState,
    drafts: OkeyActionEventDraft[] = [],
    timeoutTileId?: string,
  ) => {
    if (!enabled) return false;
    const previous = snapshotRef.current;
    const next = update(previous.state);
    if (next === previous.state) return false;
    const deadline = next.currentPlayerIndex !== previous.state.currentPlayerIndex
      ? Date.now() + TURN_MS
      : Date.parse(previous.projection.turnDeadlineAt!);
    const projection = createPreviewProjection(
      next,
      previous.projection.version + 1,
      deadline,
      previous.projection.currentRound,
    );
    projection.lastTimeoutDiscardEvent = timeoutTileId
      ? { id: 'local-timeout-' + projection.version, playerId: 'seat-0', tileId: timeoutTileId, source: 'rack' }
      : previous.projection.lastTimeoutDiscardEvent;
    const value = { state: next, projection };
    snapshotRef.current = value;
    setSnapshot(value);
    setNow(Date.now());
    stream.emit({
      version: projection.version,
      previousProjection: previous.projection,
      projection,
      actionEvents: drafts.map((event, sequence) => ({
        ...event, sequence, version: projection.version, matchId: "local-preview",
      })),
    });
    return true;
  }, [enabled, stream]);

  // Existing rack actions remain local and may only act for the human seat.
  const setState = useCallback((update: (current: OkeyGameState) => OkeyGameState) => {
    const current = snapshotRef.current.state;
    if (current.phase !== "playing" || current.currentPlayerIndex !== 0) return false;
    return commit(update);
  }, [commit]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || state.phase !== "playing") return;
    const player = state.players[state.currentPlayerIndex];
    if (!isOkeyBotControlled(player)) return;
    const timer = setTimeout(() => {
      if (snapshotRef.current.state !== state) return;
      if (!state.hasDrawnThisTurn) {
        commit((current) => drawTile(current, "deck"), [
          { type: "draw", actorPlayerId: player.id, payload: { source: "deck" } },
        ]);
      } else {
        const tile = chooseBotDiscardTile(state);
        if (tile) commit((current) => discardTile(current, tile.id), [
          { type: "discard", actorPlayerId: player.id, payload: { tileId: tile.id, tile } },
        ]);
      }
    }, BOT_STEP_MS);
    return () => clearTimeout(timer);
  }, [commit, enabled, state]);

  // Expired human turns still progress locally. Draw and discard remain separate commits.
  useEffect(() => {
    if (!enabled || state.phase !== "playing" || state.currentPlayerIndex !== 0) return;
    const remaining = Date.parse(onlineProjection.turnDeadlineAt!) - Date.now();
    const timer = setTimeout(() => {
      if (snapshotRef.current.state !== state) return;
      if (!state.hasDrawnThisTurn) {
        commit((current) => drawTile(current, "deck"));
      } else {
        const tile = chooseBotDiscardTile(state);
        if (tile) commit((current) => discardTile(current, tile.id), [], tile.id);
      }
    }, Math.max(state.hasDrawnThisTurn ? 750 : 0, remaining));
    return () => clearTimeout(timer);
  }, [commit, enabled, onlineProjection.turnDeadlineAt, state]);

  // End-of-round presentation is out of scope; deal a fresh sandbox hand instead.
  useEffect(() => {
    if (!enabled || state.phase === "playing") return;
    const timer = setTimeout(() => {
      const previous = snapshotRef.current;
      const nextRound = previous.projection.currentRound + 1;
      const next = createPreviewState();
      const value = {
        state: next,
        projection: createPreviewProjection(
          next,
          previous.projection.version + 1,
          Date.now() + TURN_MS,
          nextRound,
        ),
      };
      snapshotRef.current = value;
      stream.reset();
      setSnapshot(value);
      setNow(Date.now());
      setLifecycleResumeToken((token) => token + 1);
    }, BOT_STEP_MS);
    return () => clearTimeout(timer);
  }, [enabled, state.phase, stream]);
  const draw = useCallback((source: OkeyDrawSource) => {
    return Promise.resolve(setState((current) => drawTile(current, source)));
  }, [setState]);

  const discard = useCallback((tileId: string) => {
    return Promise.resolve(setState((current) => discardTile(current, tileId)));
  }, [setState]);

  const commitOpenIntent = useCallback(
    (melds: OkeyMeld[], score: number, tileId?: string) => {
      return Promise.resolve(setState((current) => {
        const opened = openPlayerMelds(current, 0, melds, score, {
          finalDiscard: Boolean(tileId),
        });
        return tileId && opened !== current ? discardTile(opened, tileId) : opened;
      }));
    },
    [setState],
  );

  // Konkan completion is outside this preview's scope.
  const declareKonkan = useCallback(
    (_orderedRunTileIds: string[], _completionMeldTileIds: string[], _discardTileId: string) =>
      Promise.resolve(false),
    [],
  );

  const spendTileOnTableMeld = useCallback(
    (tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") =>
      Promise.resolve(setState((current) =>
        spendTileOnMeld(current, 0, tileId, targetPlayerId, targetMeldId, runEnd),
      )),
    [setState],
  );

  const lockKonkanSetOnTable = useCallback(
    (tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") =>
      Promise.resolve(setState((current) =>
        lockKonkanSet(current, 0, tileId, targetPlayerId, targetMeldId, runEnd),
      )),
    [setState],
  );
  const [exitConfirmationVisible, setExitConfirmationVisible] = useState(false);

  const requestExit = useCallback(() => {
    setExitConfirmationVisible(true);
  }, []);

  const cancelExit = useCallback(() => {
    setExitConfirmationVisible(false);
  }, []);

  const leaveOnlineMatch = useCallback(() => {
    setExitConfirmationVisible(false);
    return Promise.resolve(true);
  }, []);

  const noop = useCallback(() => {}, []);

  return {
    state,
    onlineProjection,
    authoritativeProjection: onlineProjection,
    onlineAdapter: stream.source,
    leaveOnlineMatch,
    requestExit,
    cancelExit,
    exitConfirmationVisible,
    leaving: false,
    isAppActive: true,
    lifecycleResumeToken,
    currentRound: onlineProjection.currentRound,
    maxRounds: 7,
    roundResults: [],
    matchScores: { teamA: 0, teamB: 0 } as Record<OkeyTeamId, number>,
    showRoundResultPopup: false,
    currentRoundResult: null,
    matchFinished: false,
    matchWinnerTeamId: null,
    showMatchResultPopup: false,
    finalPresentationComplete: true,
    endRoundPresentationStage: "idle" as const,
    beginFinalTilePresentation: noop,
    completeFinalPresentation: noop,
    draw,
    discard,
    commitOpenIntent,
    declareKonkan,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    turnTimeLeft: Math.max(0, Date.parse(onlineProjection.turnDeadlineAt!) - now) / 1000,
    turnTimeLeftMilliseconds: Math.max(0, Date.parse(onlineProjection.turnDeadlineAt!) - now),
    serverClockOffsetMs: 0,
  };
}
