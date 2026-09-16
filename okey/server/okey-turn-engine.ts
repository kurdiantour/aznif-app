import type { OkeyGameState } from "../types/okey.ts";
import { isGhostOkeySeat } from "../engine/okeyengine-eliminated.ts";
import {
  getNextOkeyMatchTurnDeadline,
  OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
  projectOkeyMatchPublicState,
  settleAuthoritativeOkeyRound,
  type OkeyAuthoritativeCommand,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
} from "./okey-authoritative.ts";
import { commitAuthoritativeOkeyAction } from "./okey-authoritative-commit-gateway.ts";
import {
  createForcedDrawDiscardEvents,
  type OkeyActionEvent,
  type OkeyActionEventDraft,
} from "./okey-action-events.ts";
import { selectOkeyBotIntent } from "./okey-bot-executor.ts";

/**
 * Canonical authoritative turn durations.
 *
 * These values now live with the authoritative engine contract so server
 * controllers can consume one TypeScript owner instead of defining their own
 * timer constants.
 */
export const OKEY_DRAW_PHASE_SECONDS = 15;
export const OKEY_THROW_PHASE_SECONDS = 30;

/** The authoritative phase of the current seat. */
export type OkeyAuthoritativeTurnPhase = "draw" | "throw" | "finished";

/**
 * Controller is ownership of the current seat, not a separate turn engine.
 * An eliminated player remains the current seat but is driven as a ghost.
 */
export type OkeyAuthoritativeSeatController = "human" | "bot" | "ghost";

/**
 * Canonical read-only description of the turn currently owned by the server.
 *
 * Canonical action reduction and lifecycle evaluation consume this context.
 */
export type OkeyAuthoritativeTurnContext = {
  currentPlayerIndex: number;
  currentPlayerId: string | null;
  phase: OkeyAuthoritativeTurnPhase;
  controller: OkeyAuthoritativeSeatController | null;
};

/**
 * Single canonical derivation of seat + phase + controller from Okey state.
 *
 * No DB/network/presentation effects belong here.
 */
export function getAuthoritativeOkeyTurnContext(
  state: OkeyGameState,
): OkeyAuthoritativeTurnContext {
  const currentPlayerIndex = state.currentPlayerIndex;
  const currentPlayer = state.players[currentPlayerIndex] ?? null;

  if (state.phase === "finished") {
    return {
      currentPlayerIndex,
      currentPlayerId: currentPlayer?.id ?? null,
      phase: "finished",
      controller: null,
    };
  }

  const phase: OkeyAuthoritativeTurnPhase = state.hasDrawnThisTurn
    ? "throw"
    : "draw";

  let controller: OkeyAuthoritativeSeatController | null = null;

  if (currentPlayer) {
    if (isGhostOkeySeat(currentPlayer)) {
      controller = "ghost";
    } else if (
      currentPlayer.controlledByBot ||
      currentPlayer.kind === "bot"
    ) {
      controller = "bot";
    } else {
      controller = "human";
    }
  }

  return {
    currentPlayerIndex,
    currentPlayerId: currentPlayer?.id ?? null,
    phase,
    controller,
  };
}


export type OkeyAuthoritativeLifecycleState = {
  currentRound: number;
  matchFinished: boolean;
  matchWinnerTeamId: "teamA" | "teamB" | null;
  pendingForfeitTeamId: "teamA" | "teamB" | null;
  leaveTerminationReason:
    | "last-human-winner"
    | "no-humans"
    | "team-forfeit"
    | null;
  roundStartsAt?: string | null;
  nextRoundEligibleAt: string | null;
  roundState: OkeyGameState;
};

export type OkeyAuthoritativeSnapshotBundle = {
  version: number | string;
  turn_deadline_at: string | null;
  state: OkeyAuthoritativeLifecycleState;
  status?: "playing" | "finished" | "waiting";
};

export type OkeyLifecycleDecision =
  | {
      type: "terminal";
      matchFinished: true;
      winnerTeamId: "teamA" | "teamB" | null;
      reason: OkeyAuthoritativeLifecycleState["leaveTerminationReason"];
    }
  | {
      type: "eliminated-turn";
      expectedVersion: number;
      expectedActorId: string;
      playerIndex: number;
    }
  | {
      type: "bot-turn";
      expectedVersion: number;
      expectedActorId: string;
      playerIndex: number;
      step: "draw" | "discard";
      notBefore: string | null;
      ready: boolean;
    }
  | {
      type: "expired-human-turn";
      expectedVersion: number;
      expectedTurnPlayerId: string;
      expectedTurnDeadlineAt: string;
    }
  | {
      type: "due-next-round";
      expectedVersion: number;
      expectedRound: number;
      eligibleAt: string;
    }
  | {
      type: "idle";
      reason:
        | "waiting_for_human_action"
        | "round_start_pending"
        | "next_round_countdown"
        | "match_finished_settled"
        | "match_not_playing";
      turnDeadlineAt?: string | null;
      eligibleAt?: string | null;
    };

function isAuthoritativeOkeyRoundStartPending(
  state: OkeyAuthoritativeLifecycleState,
  now: number,
): boolean {
  const startsAtMs = Date.parse(state.roundStartsAt ?? "");
  return Number.isFinite(startsAtMs) && now < startsAtMs;
}

/**
 * Single authoritative owner of the next lifecycle decision.
 *
 * Priority is deterministic and mirrors the canonical server lifecycle:
 * terminal -> ghost -> bot -> expired human -> next round -> idle.
 * No DB, network or presentation side effects belong here.
 */
export function evaluateOkeyServerLifecycle(
  bundle: OkeyAuthoritativeSnapshotBundle,
  now = Date.now(),
): OkeyLifecycleDecision {
  const version = Number(bundle.version);
  const state = bundle.state;
  const turnDeadlineAt = bundle.turn_deadline_at;

  if (state.matchFinished) {
    return {
      type: "terminal",
      matchFinished: true,
      winnerTeamId: state.matchWinnerTeamId,
      reason: state.leaveTerminationReason,
    };
  }

  if (state.roundState.phase === "playing") {
    const context = getAuthoritativeOkeyTurnContext(state.roundState);
    const currentPlayer = state.roundState.players[context.currentPlayerIndex];

    if (!currentPlayer || !context.currentPlayerId) {
      return { type: "idle", reason: "waiting_for_human_action" };
    }

    if (context.controller === "ghost") {
      return {
        type: "eliminated-turn",
        expectedVersion: version,
        expectedActorId: context.currentPlayerId,
        playerIndex: context.currentPlayerIndex,
      };
    }

    if (context.controller === "bot") {
      const startPending = isAuthoritativeOkeyRoundStartPending(state, now);
      return {
        type: "bot-turn",
        expectedVersion: version,
        expectedActorId: context.currentPlayerId,
        playerIndex: context.currentPlayerIndex,
        step: context.phase === "throw" ? "discard" : "draw",
        notBefore: state.roundStartsAt ?? null,
        ready: !startPending,
      };
    }

    if (isAuthoritativeOkeyRoundStartPending(state, now)) {
      return {
        type: "idle",
        reason: "round_start_pending",
        turnDeadlineAt: state.roundStartsAt,
      };
    }

    if (context.controller === "human" && turnDeadlineAt) {
      const deadlineMs = Date.parse(turnDeadlineAt);
      if (Number.isFinite(deadlineMs) && now >= deadlineMs) {
        return {
          type: "expired-human-turn",
          expectedVersion: version,
          expectedTurnPlayerId: context.currentPlayerId,
          expectedTurnDeadlineAt: turnDeadlineAt,
        };
      }
    }

    return {
      type: "idle",
      reason: "waiting_for_human_action",
      turnDeadlineAt,
    };
  }

  if (state.roundState.phase === "finished") {
    if (state.pendingForfeitTeamId || state.leaveTerminationReason === "team-forfeit") {
      return {
        type: "due-next-round",
        expectedVersion: version,
        expectedRound: state.currentRound,
        eligibleAt: new Date(now).toISOString(),
      };
    }

    const eligibleAt = state.nextRoundEligibleAt;
    if (eligibleAt) {
      const eligibleAtMs = Date.parse(eligibleAt);
      if (Number.isFinite(eligibleAtMs) && now >= eligibleAtMs) {
        return {
          type: "due-next-round",
          expectedVersion: version,
          expectedRound: state.currentRound,
          eligibleAt,
        };
      }
      return { type: "idle", reason: "next_round_countdown", eligibleAt };
    }

    return {
      type: "due-next-round",
      expectedVersion: version,
      expectedRound: state.currentRound,
      eligibleAt: new Date(now).toISOString(),
    };
  }

  return { type: "idle", reason: "match_not_playing" };
}

export type OkeyAuthoritativeDeadlineInput = {
  phase: OkeyAuthoritativeTurnPhase;
  controller: OkeyAuthoritativeSeatController | null;
  now?: number;
};

/**
 * The TypeScript source of truth for authoritative Okey turn deadlines.
 *
 * Only a Human DRAW/THROW phase owns a countdown. Bot, ghost and finished
 * phases do not receive a Human turn deadline.
 */
export function deriveAuthoritativeOkeyTurnDeadline({
  phase,
  controller,
  now = Date.now(),
}: OkeyAuthoritativeDeadlineInput): string | null {
  if (controller !== "human" || phase === "finished") {
    return null;
  }

  const durationSeconds =
    phase === "throw"
      ? OKEY_THROW_PHASE_SECONDS
      : OKEY_DRAW_PHASE_SECONDS;

  return new Date(now + durationSeconds * 1000).toISOString();
}

/**
 * Canonical state-changing requests accepted by the authoritative Okey engine.
 *
 * Controllers may decide what intent/action to submit (human command, bot
 * action choice, timeout lifecycle alarm), but they no longer build the authoritative
 * match state themselves. The engine selects exactly one reducer for the
 * transition and returns the resulting state.
 */
export type OkeyAuthoritativeTransition<TCommand, TRoundState> =
  | {
      type: "human-command";
      actorPlayerIndex: number;
      command: TCommand;
    }
  | {
      type: "manual-leave";
      actorPlayerIndex: number;
    }
  | {
      type: "timeout";
      deadlineAt: string | null;
    }
  | {
      type: "eliminated-turn";
      expectedActorId: string;
    }
  | {
      type: "next-round";
    }
  | {
      type: "bot-action";
      roundState: TRoundState;
    };

export type OkeyAuthoritativeTransitionReducers<
  TState,
  TCommand,
  TRoundState,
> = {
  applyHumanCommand: (
    state: TState,
    actorPlayerIndex: number,
    command: TCommand,
    now: number,
  ) => TState;
  applyManualLeave: (
    state: TState,
    actorPlayerIndex: number,
    now: number,
  ) => TState;
  applyTimeout: (
    state: TState,
    deadlineAt: string | null,
    now: number,
  ) => TState;
  applyEliminatedTurn: (
    state: TState,
    expectedActorId: string,
    now: number,
  ) => TState;
  startNextRound: (
    state: TState,
    now: number,
  ) => TState;
  applyBotRoundState: (
    state: TState,
    roundState: TRoundState,
    now: number,
  ) => TState;
};

/**
 * Single pure transition gateway for authoritative Okey state mutation.
 *
 * This function owns transition selection. Rule reducers remain pure helpers;
 * runtime controllers must submit a transition instead of directly composing
 * the next authoritative match state.
 */
export function reduceAuthoritativeOkeyTransition<
  TState,
  TCommand,
  TRoundState,
>(input: {
  state: TState;
  transition: OkeyAuthoritativeTransition<TCommand, TRoundState>;
  reducers: OkeyAuthoritativeTransitionReducers<TState, TCommand, TRoundState>;
  now?: number;
}): TState {
  const now = input.now ?? Date.now();
  const { state, transition, reducers } = input;

  switch (transition.type) {
    case "human-command":
      return reducers.applyHumanCommand(
        state,
        transition.actorPlayerIndex,
        transition.command,
        now,
      );
    case "manual-leave":
      return reducers.applyManualLeave(
        state,
        transition.actorPlayerIndex,
        now,
      );
    case "timeout":
      return reducers.applyTimeout(state, transition.deadlineAt, now);
    case "eliminated-turn":
      return reducers.applyEliminatedTurn(
        state,
        transition.expectedActorId,
        now,
      );
    case "next-round":
      return reducers.startNextRound(state, now);
    case "bot-action":
      return reducers.applyBotRoundState(state, transition.roundState, now);
  }
}

export type OkeyTurnCommit<TState, TEvent> = {
  applied?: boolean;
  version: number;
  state: TState;
  turn_deadline_at: string | null;
  action_events?: TEvent[];
  rejectionReason?: string;
};

export type OkeyAuthoritativeExecutionInput = {
  client: any;
  state: OkeyAuthoritativeMatchState;
  transition?: OkeyAuthoritativeTransition<
    OkeyAuthoritativeCommand,
    OkeyAuthoritativeMatchState["roundState"]
  >;
  preReducedState?: OkeyAuthoritativeMatchState;
  transitionNow?: number;
  matchId: string;
  actorPlayerId: string | ((nextState: OkeyAuthoritativeMatchState) => string);
  commandId: string | (() => Promise<string>);
  commandType: string;
  expectedVersion: number;
  resolveDeadline: (nextState: OkeyAuthoritativeMatchState) => string | null;
  createActionEvents: (
    nextState: OkeyAuthoritativeMatchState,
  ) => OkeyActionEventDraft[];
  gameplayEvents?: () => unknown;
  versionConflictResult?: OkeyTurnCommit<
    OkeyAuthoritativeMatchState,
    OkeyActionEvent
  >;
  acceptRejectedDataWithError?: boolean;
  commitFailureCode: string;
  settle?: (
    committed: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>,
  ) => Promise<void>;
  broadcast?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  broadcastFailureMessage: string;
};

/**
 * Canonical authoritative execution entry point.
 *
 * Every authoritative state transition (Human command, Manual leave, Bot action,
 * Timeout, Eliminated turn, Next round) flows through this single canonical path:
 *
 * Transition -> Reduce -> Prepare authoritative metadata -> Commit Gateway
 */
export async function executeOkeyAuthoritativePipeline(
  input: OkeyAuthoritativeExecutionInput,
): Promise<{
  committed: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
  nextState: OkeyAuthoritativeMatchState;
  deadline: string | null;
}> {
  const nextVersion = input.expectedVersion + 1;
  const now = input.transitionNow ?? Date.now();

  const nextState = input.preReducedState ?? reduceAuthoritativeOkeyTransition({
    state: input.state,
    transition: input.transition!,
    reducers: OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
    now,
  });

  const deadline = input.resolveDeadline(nextState);
  const actorPlayerId = typeof input.actorPlayerId === "function"
    ? input.actorPlayerId(nextState)
    : input.actorPlayerId;
  const commandIdFactory = typeof input.commandId === "function" ? input.commandId : null;
  const resolvedCommandId = commandIdFactory
    ? await commandIdFactory()
    : (typeof input.commandId === "string" ? input.commandId : "");

  const prepared = {
    state: nextState,
    projection: projectOkeyMatchPublicState(nextState, nextVersion, deadline),
    deadline,
    status: nextState.matchFinished ? ("finished" as const) : ("playing" as const),
    actionEvents: input.createActionEvents(nextState),
  };

  const committed = await commitAuthoritativeOkeyAction({
    client: input.client,
    matchId: input.matchId,
    actorPlayerId,
    commandId: resolvedCommandId,
    expectedVersion: input.expectedVersion,
    commandType: input.commandType,
    prepared,
    ...(input.gameplayEvents ? { gameplayEvents: input.gameplayEvents() } : {}),
    fallbackState: nextState,
    fallbackDeadline: deadline,
    versionConflictResult: input.versionConflictResult,
    acceptRejectedDataWithError: input.acceptRejectedDataWithError,
    commitFailureCode: input.commitFailureCode,
    afterCommit: input.settle,
    broadcast: input.broadcast,
    broadcastFailureMessage: input.broadcastFailureMessage,
  });

  return { committed, nextState, deadline };
}

export async function generateOkeyReconcilerCommandId(
  matchId: string,
  actionType: string,
  version: number,
  qualifier?: string | number,
): Promise<string> {
  const parts = ["okey", matchId, actionType, String(version)];
  if (qualifier !== undefined && qualifier !== null && String(qualifier).length > 0) {
    parts.push(String(qualifier));
  }
  const identity = parts.join(":");

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identity),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export type OkeyServerLifecycleInput = {
  client: any;
  matchId: string;
  requesterUserId?: string;
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  deterministicCommandId?: (source: string) => Promise<string>;
  now?: () => number;
  initialDecision?: OkeyLifecycleDecision;
};

export type OkeyServerLifecycleResult = {
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  executed: boolean;
  executedEliminatedCount: number;
  botProcessed: boolean;
  executedTimeoutCount: number;
  executedNextRoundCount: number;
  actionEvents: OkeyActionEvent[];
  step?: "draw" | "discard";
  reason?: string;
};

/**
 * Single Server Lifecycle entry point for all server-driven transitions
 * (Eliminated/Ghost, Bot turn, Expired Human Timeout, and Next Round).
 */
export async function executeOkeyServerLifecycle(
  options: OkeyServerLifecycleInput,
): Promise<OkeyServerLifecycleResult> {
  const getNow = options.now ?? Date.now;
  const currentVersion = options.version;
  const currentState = options.state;
  const currentDeadline = options.turnDeadlineAt;

  const decision = options.initialDecision ?? evaluateOkeyServerLifecycle(
    {
      state: currentState,
      version: currentVersion,
      turn_deadline_at: currentDeadline,
    },
    getNow(),
  );

  const idleResult: OkeyServerLifecycleResult = {
    state: currentState,
    version: currentVersion,
    turnDeadlineAt: currentDeadline,
    executed: false,
    executedEliminatedCount: 0,
    botProcessed: false,
    executedTimeoutCount: 0,
    executedNextRoundCount: 0,
    actionEvents: [],
    reason: decision.type === "idle" ? decision.reason : decision.type === "terminal" ? "match_finished" : undefined,
  };

  if (decision.type === "idle" || decision.type === "terminal") {
    return idleResult;
  }

  switch (decision.type) {
    case "eliminated-turn": {
      const actor = currentState.roundState.players[decision.playerIndex];
      if (!actor || actor.id !== decision.expectedActorId) {
        return idleResult;
      }
      const execution = await executeOkeyAuthoritativePipeline({
        client: options.client,
        state: currentState,
        transition: {
          type: "eliminated-turn",
          expectedActorId: decision.expectedActorId,
        },
        transitionNow: getNow(),
        matchId: options.matchId,
        actorPlayerId: actor.id,
        commandId: () => options.deterministicCommandId
          ? options.deterministicCommandId(
              `okey:${options.matchId}:system-eliminated-turn:${currentVersion}:${actor.id}`,
            )
          : generateOkeyReconcilerCommandId(
              options.matchId,
              "system-eliminated-turn",
              currentVersion,
              actor.id,
            ),
        commandType: "system-eliminated-turn",
        expectedVersion: currentVersion,
        resolveDeadline: (nextState) => getNextOkeyMatchTurnDeadline(nextState, getNow()),
        createActionEvents: (nextState) => {
          const beforePlayer = currentState.roundState.players[decision.playerIndex];
          const afterPlayer = nextState.roundState.players[decision.playerIndex];
          const drawnTile = afterPlayer?.hand.find((tile) =>
            !beforePlayer.hand.some((previousTile) => previousTile.id === tile.id),
          ) ?? null;
          const discardedTile = nextState.roundState.discardPile.at(-1) ?? null;
          return createForcedDrawDiscardEvents({
            actorPlayerId: actor.id,
            source: "deck",
            tile: drawnTile,
            discardedTile,
            reason: "eliminated",
          });
        },
        acceptRejectedDataWithError: true,
        commitFailureCode: "okey_elimination_commit_failed",
        broadcast: options.broadcastStateUpdate,
        broadcastFailureMessage: "Okey eliminated turn broadcast failed",
      });
      const committed = execution.committed;
      if (committed.applied === false) return idleResult;
      const committedVersion = Number(committed.version);
      const committedDeadline = committed.turn_deadline_at ?? execution.deadline;
      const committedState = committed.state ?? execution.nextState;
      const committedActionEvents = (committed.action_events ?? []) as OkeyActionEvent[];

      return {
        state: committedState,
        version: committedVersion,
        turnDeadlineAt: committedDeadline,
        executed: true,
        executedEliminatedCount: 1,
        botProcessed: false,
        executedTimeoutCount: 0,
        executedNextRoundCount: 0,
        actionEvents: committedActionEvents,
      };
    }

    case "bot-turn": {
      if (!decision.ready) {
        return {
          ...idleResult,
          reason: decision.notBefore
            ? "bot_transition_not_eligible"
            : "bot_transition_invalid_eligibility",
        };
      }

      const intent = selectOkeyBotIntent({
        state: currentState.roundState,
        expectedActorId: decision.expectedActorId,
        step: decision.step,
        now: getNow(),
      });
      if (!intent) {
        return { ...idleResult, reason: `bot_${decision.step}_rejected` };
      }

      const commandType = `system-bot-${intent.step}`;
      const execution = await executeOkeyAuthoritativePipeline({
        client: options.client,
        state: currentState,
        transition: { type: "bot-action", roundState: intent.roundState },
        transitionNow: getNow(),
        matchId: options.matchId,
        actorPlayerId: intent.actorPlayerId,
        commandId: () => options.deterministicCommandId
          ? options.deterministicCommandId(`okey:${options.matchId}:${commandType}:${currentVersion}`)
          : generateOkeyReconcilerCommandId(options.matchId, commandType, currentVersion),
        commandType,
        expectedVersion: currentVersion,
        resolveDeadline: (nextState) => getNextOkeyMatchTurnDeadline(nextState, getNow()),
        createActionEvents: () => intent.actionEvents,
        versionConflictResult: {
          applied: false,
          version: currentVersion,
          state: currentState,
          turn_deadline_at: currentDeadline,
          action_events: [],
          rejectionReason: "stale_bot_controller",
        },
        commitFailureCode: "okey_bot_commit_failed",
        settle: async (committed) => {
          if (!committed.state.matchFinished) return;
          const winnerTeamId = committed.state.matchWinnerTeamId;
          if (!winnerTeamId && committed.state.leaveTerminationReason !== "no-humans") {
            throw new Error("finished_match_missing_winner_team");
          }
          const { error: settlementError } = await options.client.rpc("okey_settle_match", {
            p_match_id: options.matchId,
            p_winner_team_id: winnerTeamId,
          });
          if (settlementError) {
            throw new Error(`okey_bot_settlement_failed: ${settlementError.message}`);
          }
        },
        broadcast: options.broadcastStateUpdate,
        broadcastFailureMessage: `Okey bot broadcast failed for ${options.matchId}`,
      });

      const committed = execution.committed;
      if (committed.applied === false) {
        return { ...idleResult, reason: committed.rejectionReason ?? "already_processed" };
      }
      const committedState = committed.state;
      const committedDeadline = committed.turn_deadline_at ?? execution.deadline;
      const nextVersion = Number(committed.version);

      return {
        state: committedState,
        version: nextVersion,
        turnDeadlineAt: committedDeadline,
        executed: true,
        executedEliminatedCount: 0,
        botProcessed: true,
        executedTimeoutCount: 0,
        executedNextRoundCount: 0,
        actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
        step: intent.step,
        reason: committedState.matchFinished
          ? "match_finished"
          : committedState.roundState.phase === "finished"
            ? "round_finished"
            : "transition_committed",
      };
    }

    case "expired-human-turn": {
      let actorPlayerId = decision.expectedTurnPlayerId;
      const execution = await executeOkeyAuthoritativePipeline({
        client: options.client,
        state: currentState,
        transition: {
          type: "timeout",
          deadlineAt: decision.expectedTurnDeadlineAt,
        },
        transitionNow: getNow(),
        matchId: options.matchId,
        actorPlayerId: () => actorPlayerId,
        commandId: () => options.deterministicCommandId
          ? options.deterministicCommandId(
              `okey:${options.matchId}:system-timeout:${currentVersion}:${actorPlayerId}`,
            )
          : generateOkeyReconcilerCommandId(
              options.matchId,
              "system-timeout",
              currentVersion,
              actorPlayerId,
            ),
        commandType: "system-timeout",
        expectedVersion: currentVersion,
        resolveDeadline: (nextState) => getNextOkeyMatchTurnDeadline(nextState, getNow()),
        createActionEvents: (nextState) => {
          const event = nextState.lastTimeoutDiscardEvent;
          actorPlayerId = event?.playerId ?? decision.expectedTurnPlayerId;
          const tile = nextState.roundState.discardPile.at(-1) ?? null;
          return event?.source === "rack"
            ? [{
                type: "discard",
                actorPlayerId,
                payload: { tileId: tile?.id ?? null, tile, reason: "timeout" },
              }]
            : createForcedDrawDiscardEvents({
                actorPlayerId,
                source: "deck",
                tile,
                reason: "timeout",
              });
        },
        acceptRejectedDataWithError: true,
        commitFailureCode: "okey_timeout_commit_failed",
        broadcast: options.broadcastStateUpdate,
        broadcastFailureMessage: "Okey timeout broadcast failed",
      });
      const committed = execution.committed;
      if (committed.applied === false) return idleResult;

      return {
        state: committed.state,
        version: Number(committed.version),
        turnDeadlineAt: committed.turn_deadline_at ?? execution.deadline,
        executed: true,
        executedEliminatedCount: 0,
        botProcessed: false,
        executedTimeoutCount: 1,
        executedNextRoundCount: 0,
        actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
      };
    }

    case "due-next-round": {
      const finishingTeamForfeit =
        Boolean(currentState.pendingForfeitTeamId) ||
        currentState.leaveTerminationReason === "team-forfeit";

      let actorPlayerId = "system";
      let commandState = currentState;
      const commandType = finishingTeamForfeit ? "round-end-team-forfeit" : "start-next-round";

      const execution = await executeOkeyAuthoritativePipeline({
        client: options.client,
        state: currentState,
        transition: finishingTeamForfeit ? undefined : { type: "next-round" },
        preReducedState: finishingTeamForfeit
          ? settleAuthoritativeOkeyRound(currentState)
          : undefined,
        transitionNow: getNow(),
        matchId: options.matchId,
        actorPlayerId: () => actorPlayerId,
        commandId: () => options.deterministicCommandId
          ? options.deterministicCommandId(
              `okey:${options.matchId}:${commandType}:${currentVersion}:${commandState.currentRound}`,
            )
          : generateOkeyReconcilerCommandId(
              options.matchId,
              commandType,
              currentVersion,
              String(commandState.currentRound),
            ),
        commandType,
        expectedVersion: currentVersion,
        resolveDeadline: (nextState) => {
          commandState = nextState;
          actorPlayerId =
            nextState.roundState.players[nextState.roundState.currentPlayerIndex]?.id ||
            "system";
          return getNextOkeyMatchTurnDeadline(nextState, getNow());
        },
        createActionEvents: (nextState) => finishingTeamForfeit
          ? []
          : [{
              type: "round",
              actorPlayerId: null,
              payload: { round: nextState.currentRound },
            }],
        acceptRejectedDataWithError: true,
        commitFailureCode: "okey_next_round_commit_failed",
        settle: async (committed) => {
          if (!committed.state.matchFinished ||
              !committed.state.matchWinnerTeamId ||
              !options.client?.rpc) return;
          try {
            await options.client.rpc("okey_settle_match", {
              p_match_id: options.matchId,
              p_winner_team_id: committed.state.matchWinnerTeamId,
            });
          } catch {
            // Settle recovery will safely retry idempotently during snapshot if needed
          }
        },
        broadcast: options.broadcastStateUpdate,
        broadcastFailureMessage: "Okey next-round broadcast failed",
      });
      const committed = execution.committed;
      if (committed.applied === false) return idleResult;

      return {
        state: committed.state,
        version: Number(committed.version),
        turnDeadlineAt: committed.turn_deadline_at ?? execution.deadline,
        executed: true,
        executedEliminatedCount: 0,
        botProcessed: false,
        executedTimeoutCount: 0,
        executedNextRoundCount: 1,
        actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
      };
    }
  }
}


