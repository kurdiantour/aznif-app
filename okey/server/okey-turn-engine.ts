import type { OkeyGameState } from "../types/okey.ts";
import {
  isActiveOkeyPlayer,
  isEliminatedOkeyPlayer,
  isGhostOkeySeat,
} from "../engine/okeyengine-eliminated.ts";
import {
  createAuthoritativeOkeyMatch,
  deriveOkeyDailyQuestGameplayEvents,
  getNextOkeyMatchTurnDeadline,
  getOkeyMatchTurnDeadlineAfterTransition,
  OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
  projectOkeyMatchPublicState,
  type OkeyAuthoritativeCommand,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
  type OkeyMatchSettlement,
  type OkeyServerPlayerIdentity,
} from "./okey-authoritative.ts";
import { commitAuthoritativeOkeyAction } from "./okey-authoritative-commit-gateway.ts";
import {
  createForcedDrawDiscardEvents,
  createOkeyCommandActionEvents,
  type OkeyActionEvent,
  type OkeyActionEventDraft,
} from "./okey-action-events.ts";
import { selectOkeyBotIntent } from "./okey-bot-executor.ts";

/**
 * Canonical authoritative turn durations.
 */
export const OKEY_DRAW_PHASE_SECONDS = 15;
export const OKEY_THROW_PHASE_SECONDS = 30;

/**
 * Single authoritative source of truth for calculating the next lifecycle wake time.
 * Bot and ghost turns wake immediately unless a round-start delay is active.
 * Human turns wake at the turn deadline.
 * Finished rounds wake at nextRoundEligibleAt.
 * Finished matches do not wake.
 */
export function getOkeyLifecycleRunAt(
  state: OkeyAuthoritativeMatchState,
  turnDeadlineAt: string | null,
  nowMs: number,
): string | null {
  if (state.matchFinished) return null;
  if (state.roundState.phase === "finished") {
    return state.nextRoundEligibleAt ?? null;
  }

  const currentPlayer = state.roundState.players[state.roundState.currentPlayerIndex];

  if (isEliminatedOkeyPlayer(currentPlayer)) {
    return new Date(nowMs).toISOString();
  }

  if (
    isActiveOkeyPlayer(currentPlayer) &&
    (currentPlayer.controlledByBot === true || currentPlayer.kind === "bot")
  ) {
    if (state.roundStartsAt) {
      const startsAtMs = Date.parse(state.roundStartsAt);
      if (Number.isFinite(startsAtMs) && nowMs < startsAtMs) {
        return state.roundStartsAt;
      }
    }
    return new Date(nowMs).toISOString();
  }

  return turnDeadlineAt;
}

export type OkeyLifecycleAlarmJob = {
  matchId: string;
  state: OkeyAuthoritativeMatchState;
  version: number;
  runAt: string;
};

export type OkeyLifecycleAlarmScheduler = (
  input: OkeyLifecycleAlarmJob,
) => Promise<void>;

/**
 * Single owner for deciding and registering the next authoritative Okey wake.
 * Transport callers provide only the scheduler adapter; they do not decide runAt.
 */
export async function scheduleNextOkeyLifecycleAlarm(input: {
  matchId: string;
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  scheduleLifecycleAlarm?: OkeyLifecycleAlarmScheduler;
  nowMs?: number;
}): Promise<string | null> {
  const runAt = getOkeyLifecycleRunAt(
    input.state,
    input.turnDeadlineAt,
    input.nowMs ?? Date.now(),
  );

  if (!runAt || !input.scheduleLifecycleAlarm) return runAt;

  await input.scheduleLifecycleAlarm({
    matchId: input.matchId,
    state: input.state,
    version: input.version,
    runAt,
  });

  return runAt;
}

/** The authoritative phase of the current seat. */
export type OkeyAuthoritativeTurnPhase = "draw" | "throw" | "finished";

/**
 * Controller is ownership of the current seat, not a separate turn engine.
 * An eliminated player remains the current seat but is driven as a ghost.
 */
export type OkeyAuthoritativeSeatController = "human" | "bot" | "ghost";

/**
 * Canonical read-only description of the turn currently owned by the server.
 */
export type OkeyAuthoritativeTurnContext = {
  currentPlayerIndex: number;
  currentPlayerId: string | null;
  phase: OkeyAuthoritativeTurnPhase;
  controller: OkeyAuthoritativeSeatController | null;
};

/**
 * Single canonical derivation of seat + phase + controller from Okey state.
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
 * Deterministic priority: terminal -> ghost -> bot -> expired human -> next round -> idle.
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
 * The single source of truth for deriving human turn deadlines.
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

/**
 * Unified authoritative settlement helper for Okey matches.
 * Single owner for invoking `okey_settle_match` RPC and loading fun-match rewards.
 */
export async function settleAuthoritativeOkeyMatch(input: {
  client: any;
  matchId: string;
  actorUserId?: string | null;
  state: OkeyAuthoritativeMatchState;
  now?: () => number;
}): Promise<{ settlement: unknown; error: Error | null }> {
  if (!input.state.matchFinished) return { settlement: null, error: null };

  const winnerTeamId = input.state.matchWinnerTeamId;
  if (!winnerTeamId && input.state.leaveTerminationReason !== "no-humans") {
    return { settlement: null, error: new Error("winner_team_not_found") };
  }

  const { data: settlement, error } = await input.client.rpc("okey_settle_match", {
    p_match_id: input.matchId,
    p_winner_team_id: winnerTeamId,
  });

  if (error) return { settlement: null, error: new Error(error.message) };

  let playerReward: { pointDelta: number; gemDelta: number } | null = null;

  if (
    input.actorUserId &&
    settlement &&
    typeof settlement === "object" &&
    (settlement as { currency?: unknown }).currency === "fun"
  ) {
    const { data: rewardRow, error: rewardError } = await input.client
      .schema("okey")
      .from("fun_match_rewards")
      .select("point_delta, gem_delta")
      .eq("match_id", input.matchId)
      .eq("user_id", input.actorUserId)
      .maybeSingle();

    if (rewardError) {
      return { settlement: null, error: new Error(rewardError.message) };
    }

    if (rewardRow) {
      playerReward = {
        pointDelta: Number(rewardRow.point_delta ?? 0),
        gemDelta: Number(rewardRow.gem_delta ?? 0),
      };
    }
  }

  return {
    settlement:
      settlement && typeof settlement === "object"
        ? { ...settlement, playerReward }
        : settlement,
    error: null,
  };
}

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
          const { error: settlementError } = await settleAuthoritativeOkeyMatch({
            client: options.client,
            matchId: options.matchId,
            state: committed.state,
            now: getNow,
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
      let actorPlayerId = "system";
      let commandState = currentState;
      const commandType = "start-next-round";

      const execution = await executeOkeyAuthoritativePipeline({
        client: options.client,
        state: currentState,
        transition: { type: "next-round" },
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
        createActionEvents: (nextState) => [{
              type: "round",
              actorPlayerId: null,
              payload: { round: nextState.currentRound },
            }],
        acceptRejectedDataWithError: true,
        commitFailureCode: "okey_next_round_commit_failed",
        settle: async (committed) => {
          if (!committed.state.matchFinished) return;
          try {
            await settleAuthoritativeOkeyMatch({
              client: options.client,
              matchId: options.matchId,
              state: committed.state,
              now: getNow,
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

// ---------------------------------------------------------------------------
// Human Command / Manual Leave Reconciliation
// ---------------------------------------------------------------------------

export type OkeyHumanAuthoritativeBundle = {
  state: OkeyAuthoritativeMatchState;
  player_index: number;
  version: number;
  turn_deadline_at: string | null;
  command_applied: boolean;
};

export type OkeyHumanCommandInput = {
  action: "command" | "manual-leave";
  matchId: string;
  actorUserId: string;
  commandId: string;
  command: OkeyAuthoritativeCommand | null;
  clientExpectedVersion: number | null;
  commandReceivedAtMs: number;
  bundle: OkeyHumanAuthoritativeBundle;
};

export type OkeyHumanCommandResult =
  | {
      ok: true;
      commit: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
      settlement: unknown;
      duplicate: boolean;
      state: OkeyAuthoritativeMatchState;
      version: number;
      turnDeadlineAt: string | null;
      actionEvents: OkeyActionEvent[];
    }
  | {
      ok: false;
      error: string;
      status: number;
      details?: string;
      commit?: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
    };

export type OkeyHumanCommandDependencies = {
  client: any;
  deterministicCommandId: (source: string) => Promise<string>;
  reloadBundle?: () => Promise<OkeyHumanAuthoritativeBundle | null>;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  now?: () => number;
  scheduleLifecycleAlarm?: (input: OkeyLifecycleAlarmJob) => Promise<void>;
};

/**
 * Owns the authoritative Human Command and Manual Leave transition pipeline.
 */
export async function reconcileAuthoritativeHumanCommand(
  input: OkeyHumanCommandInput,
  dependencies: OkeyHumanCommandDependencies,
): Promise<OkeyHumanCommandResult> {
  const now = dependencies.now ?? Date.now;
  const initialState = input.bundle.state;

  if (
    (initialState.manualLeftPlayerIds ?? []).includes(input.actorUserId) &&
    !(input.action === "manual-leave" && input.bundle.command_applied)
  ) {
    return { ok: false, error: "manual_leave_is_final", status: 403 };
  }

  if (input.bundle.command_applied) {
    // Restore the wake if the original request committed but failed to schedule.
    await scheduleNextOkeyLifecycleAlarm({
      matchId: input.matchId,
      state: initialState,
      version: Number(input.bundle.version),
      turnDeadlineAt: input.bundle.turn_deadline_at,
      scheduleLifecycleAlarm: dependencies.scheduleLifecycleAlarm,
      nowMs: now(),
    });
    const settled = await settleAuthoritativeOkeyMatch({
      client: dependencies.client,
      matchId: input.matchId,
      actorUserId: input.actorUserId,
      state: initialState,
      now,
    });

    if (settled.error) {
      console.error(
        "Okey settlement recovery failed during duplicate",
        settled.error,
      );
    }

    return {
      ok: true,
      commit: {
        applied: true,
        version: Number(input.bundle.version),
        state: initialState,
        turn_deadline_at: input.bundle.turn_deadline_at,
        action_events: [],
      },
      settlement: settled.error ? null : settled.settlement,
      duplicate: true,
      state: initialState,
      version: Number(input.bundle.version),
      turnDeadlineAt: input.bundle.turn_deadline_at,
      actionEvents: [],
    };
  }

  if (
    input.action === "command" &&
    input.clientExpectedVersion !== null &&
    input.clientExpectedVersion !== Number(input.bundle.version)
  ) {
    return {
      ok: false,
      error: "version_conflict",
      status: 409,
      details: `Client expected version ${input.clientExpectedVersion} does not match database version ${input.bundle.version}`,
    };
  }

  if (input.action === "command" && !input.command) {
    return { ok: false, error: "invalid_command", status: 400 };
  }

  let workingBundle = input.bundle;
  const maxCommitAttempts = input.action === "manual-leave" ? 3 : 1;

  for (let attempt = 1; attempt <= maxCommitAttempts; attempt += 1) {
    if (attempt > 1) {
      const freshBundle = await dependencies.reloadBundle?.();

      if (!freshBundle) {
        return {
          ok: false,
          error: "manual_leave_retry_fetch_failed",
          status: 409,
        };
      }

      workingBundle = freshBundle;

      if (
        workingBundle.command_applied ||
        (workingBundle.state.manualLeftPlayerIds ?? []).includes(
          input.actorUserId,
        )
      ) {
        // Confirming a committed leave must also restore its lifecycle wake.
        await scheduleNextOkeyLifecycleAlarm({
          matchId: input.matchId,
          state: workingBundle.state,
          version: Number(workingBundle.version),
          turnDeadlineAt: workingBundle.turn_deadline_at,
          scheduleLifecycleAlarm: dependencies.scheduleLifecycleAlarm,
          nowMs: now(),
        });
        return {
          ok: true,
          commit: {
            applied: true,
            version: Number(workingBundle.version),
            state: workingBundle.state,
            turn_deadline_at: workingBundle.turn_deadline_at,
            action_events: [],
          },
          settlement: null,
          duplicate: false,
          state: workingBundle.state,
          version: Number(workingBundle.version),
          turnDeadlineAt: workingBundle.turn_deadline_at,
          actionEvents: [],
        };
      }
    }

    if (
      input.action === "command" &&
      workingBundle.turn_deadline_at &&
      Date.parse(workingBundle.turn_deadline_at) <= input.commandReceivedAtMs
    ) {
      return {
        ok: false,
        error: "turn_deadline_expired",
        status: 409,
      };
    }

    const workingState = workingBundle.state;
    const playerIndex = Number(workingBundle.player_index);

    const acceptedCommand =
      input.action === "manual-leave"
        ? { type: "manual-leave" as const }
        : input.command!;

    const commandType = acceptedCommand.type;

    const transition: OkeyAuthoritativeTransition<
      OkeyAuthoritativeCommand,
      OkeyAuthoritativeMatchState["roundState"]
    > =
      input.action === "manual-leave"
        ? { type: "manual-leave", actorPlayerIndex: playerIndex }
        : {
            type: "human-command",
            actorPlayerIndex: playerIndex,
            command: input.command!,
          };

    const expectedVersion =
      input.action === "manual-leave"
        ? Number(workingBundle.version)
        : input.clientExpectedVersion ?? Number(workingBundle.version);

    const actingPlayer =
      workingState.roundState.players[
        workingState.roundState.currentPlayerIndex
      ] ?? null;

    let gameplayEvents: ReturnType<
      typeof deriveOkeyDailyQuestGameplayEvents
    > = [];

    let committedSettlement: unknown = null;
    let committedBeforeSettlement:
      | OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>
      | null = null;

    try {
      const execution = await executeOkeyAuthoritativePipeline({
        client: dependencies.client,
        state: workingState,
        transition,
        transitionNow: input.commandReceivedAtMs,
        matchId: input.matchId,
        actorPlayerId: input.actorUserId,
        commandId: input.commandId,
        commandType,
        expectedVersion,

        resolveDeadline: (nextState) =>
          getOkeyMatchTurnDeadlineAfterTransition(
            workingState,
            nextState,
            workingBundle.turn_deadline_at,
            input.commandReceivedAtMs,
          ),

        createActionEvents: (nextState) => {
          let actionEvents: OkeyActionEventDraft[] =
            acceptedCommand.type === "manual-leave"
              ? [
                  {
                    type: "leave",
                    actorPlayerId:
                      workingState.roundState.players[playerIndex]?.id ?? null,
                    payload: {},
                  },
                ]
              : createOkeyCommandActionEvents(
                  acceptedCommand,
                  actingPlayer?.id ?? "",
                  workingState.roundState,
                );

          const previousDiscard =
            workingState.roundState.discardPile.at(-1) ?? null;

          actionEvents = actionEvents.map((event) =>
            event.type === "draw" &&
            event.payload.source === "discard" &&
            previousDiscard
              ? {
                  ...event,
                  payload: {
                    ...event.payload,
                    tile: previousDiscard,
                  },
                }
              : event,
          );

          const committedDiscard =
            nextState.roundState.discardPile.at(-1) ?? null;

          actionEvents = actionEvents.map((event) =>
            event.type === "discard" && committedDiscard
              ? {
                  ...event,
                  payload: {
                    ...event.payload,
                    tileId: committedDiscard.id,
                    tile: committedDiscard,
                  },
                }
              : event,
          );

          gameplayEvents = deriveOkeyDailyQuestGameplayEvents(
            workingState,
            nextState,
            playerIndex,
            acceptedCommand,
            input.commandId,
          );

          return actionEvents;
        },

        gameplayEvents: () => gameplayEvents,
        commitFailureCode: "commit_failed",

        settle: async (committed) => {
          committedBeforeSettlement = committed;

          const settled = await settleAuthoritativeOkeyMatch({
            client: dependencies.client,
            matchId: input.matchId,
            actorUserId: input.actorUserId,
            state: committed.state,
            now,
          });

          if (settled.error) throw settled.error;

          committedSettlement = settled.settlement;
        },

        broadcast: dependencies.broadcastStateUpdate,
        broadcastFailureMessage: "Okey match broadcast failed",
      });

      const committed = execution.committed;

      await scheduleNextOkeyLifecycleAlarm({
        matchId: input.matchId,
        state: committed.state,
        version: committed.version,
        turnDeadlineAt: committed.turn_deadline_at,
        scheduleLifecycleAlarm: dependencies.scheduleLifecycleAlarm,
        nowMs: now(),
      });

      return {
        ok: true,
        commit: committed,
        settlement: committedSettlement,
        duplicate: false,
        state: committed.state,
        version: committed.version,
        turnDeadlineAt: committed.turn_deadline_at,
        actionEvents: committed.action_events ?? [],
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const conflict = details.includes("version_conflict");

      if (
        input.action === "manual-leave" &&
        conflict &&
        attempt < maxCommitAttempts
      ) {
        continue;
      }

      if (committedBeforeSettlement) {
        return {
          ok: false,
          error: "settlement_failed",
          status: 500,
          details,
          commit: committedBeforeSettlement,
        };
      }

      return {
        ok: false,
        error: conflict ? "version_conflict" : "commit_failed",
        status: conflict ? 409 : 500,
        details,
      };
    }
  }

  return {
    ok: false,
    error: "manual_leave_retry_exhausted",
    status: 409,
  };
}

// ---------------------------------------------------------------------------
// Match Start Reconciliation
// ---------------------------------------------------------------------------

export type OkeyMatchStartReconcileResult<TRoom = any> = {
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  executed: boolean;
  publicProjection: OkeyMatchServerProjection;
  room: TRoom | null;
  error?: string | null;
};

/**
 * Authoritative Server Reconciler for Waiting -> Playing start transition.
 * Directly reuses createAuthoritativeOkeyMatch and registers the canonical first alarm.
 */
export async function reconcileAuthoritativeMatchStart<TRoom = any>(options: {
  client: any;
  matchId: string;
  members: readonly [
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
    OkeyServerPlayerIdentity,
  ];
  startingPlayerIndex?: number;
  now?: () => number;
  startRoomAction?: (input: {
    state: OkeyAuthoritativeMatchState;
    projection: OkeyMatchServerProjection;
    turnDeadlineAt: string | null;
  }) => Promise<{ data: TRoom | null; error: any }>;
  scheduleLifecycleAlarm?: (input: OkeyLifecycleAlarmJob) => Promise<void>;
}): Promise<OkeyMatchStartReconcileResult<TRoom>> {
  const getNow = options.now ?? Date.now;

  const state = createAuthoritativeOkeyMatch(
    options.members,
    options.startingPlayerIndex ?? 0,
  );

  const deadline = getNextOkeyMatchTurnDeadline(state, getNow());
  const projection = projectOkeyMatchPublicState(state, 0, deadline);

  let startedData: TRoom | null = null;
  let startedError: any = null;

  if (options.startRoomAction) {
    const actionResult = await options.startRoomAction({
      state,
      projection,
      turnDeadlineAt: deadline,
    });

    startedData = actionResult.data;
    startedError = actionResult.error;
  } else {
    const rpcResult = await options.client.rpc("okey_start_match", {
      p_match_id: options.matchId,
      p_state: state,
      p_projection: projection,
      p_turn_deadline_at: deadline,
    });

    startedData = (rpcResult.data ? true : null) as unknown as TRoom;
    startedError = rpcResult.error;
  }

  if (startedError || !startedData) {
    return {
      state,
      version: 0,
      turnDeadlineAt: deadline,
      executed: false,
      publicProjection: projection,
      room: null,
      error: startedError?.message ?? "match_start_failed",
    };
  }

  await scheduleNextOkeyLifecycleAlarm({
    matchId: options.matchId,
    state,
    version: 0,
    turnDeadlineAt: deadline,
    scheduleLifecycleAlarm: options.scheduleLifecycleAlarm,
    nowMs: getNow(),
  });

  return {
    state,
    version: 0,
    turnDeadlineAt: deadline,
    executed: true,
    publicProjection: projection,
    room: startedData,
  };
}

// ---------------------------------------------------------------------------
// Server Lifecycle Alarm Reconciliation
// ---------------------------------------------------------------------------

export type OkeyServerLifecycleAlarmOptions = {
  client: any;
  matchId: string;
  requesterUserId?: string;
  initialVersion?: number;
  runAt?: string | null;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  deterministicCommandId?: (source: string) => Promise<string>;
  now?: () => number;
  scheduleLifecycleAlarm?: (input: OkeyLifecycleAlarmJob) => Promise<void>;
};

export type OkeyServerLifecycleAlarmResult = {
  ok: boolean;
  executed: boolean;
  state: OkeyAuthoritativeMatchState | null;
  version: number | null;
  attempts: number;
  nextRunAt?: string | null;
  turnDeadlineAt?: string | null;
  reason:
    | "next_round_started"
    | "timeout_executed"
    | "bot_executed"
    | "eliminated_executed"
    | "match_finished"
    | "already_transitioned"
    | "fetch_failed"
    | "not_eligible";
};

/**
 * One-shot executor: fetch latest bundle, validate due state, reconcile once via executeOkeyServerLifecycle,
 * and schedule the next wake timestamp.
 */
export async function reconcileAuthoritativeServerLifecycleAlarm(
  options: OkeyServerLifecycleAlarmOptions,
): Promise<OkeyServerLifecycleAlarmResult> {
  const getNow = options.now ?? Date.now;
  const matchId = options.matchId;

  const { data: bundleRaw, error: bundleError } = await options.client
    .rpc("okey_get_system_authoritative_bundle", {
      p_match_id: matchId,
    })
    .single();

  if (bundleError || !bundleRaw) {
    return {
      ok: false,
      executed: false,
      state: null,
      version: null,
      attempts: 1,
      reason: "fetch_failed",
    };
  }

  const state = bundleRaw.state as OkeyAuthoritativeMatchState;
  const version = Number(bundleRaw.version);
  const turnDeadlineAt = bundleRaw.turn_deadline_at as string | null;

  const baseResult = {
    state,
    version,
    attempts: 1,
    turnDeadlineAt,
  };

  if (
    options.initialVersion !== undefined &&
    version !== Number(options.initialVersion)
  ) {
    return {
      ok: true,
      executed: false,
      ...baseResult,
      nextRunAt: getOkeyLifecycleRunAt(state, turnDeadlineAt, getNow()),
      reason: "already_transitioned",
    };
  }

  if (state.matchFinished) {
    return {
      ok: true,
      executed: false,
      ...baseResult,
      reason: "match_finished",
    };
  }

  const requestedAt = options.runAt;
  const requestedAtMs = requestedAt ? Date.parse(requestedAt) : NaN;

  if (Number.isFinite(requestedAtMs) && getNow() < requestedAtMs) {
    return {
      ok: true,
      executed: false,
      ...baseResult,
      nextRunAt:
        getOkeyLifecycleRunAt(state, turnDeadlineAt, getNow()) ??
        requestedAt ??
        null,
      reason: "not_eligible",
    };
  }

  const reconciled = await executeOkeyServerLifecycle({
    client: options.client,
    matchId,
    state,
    version,
    turnDeadlineAt,
    broadcastStateUpdate: options.broadcastStateUpdate,
    deterministicCommandId: options.deterministicCommandId,
    now: getNow,
  });

  if (!reconciled.executed) {
    return {
      ok: true,
      executed: false,
      state: reconciled.state,
      version: reconciled.version,
      attempts: 1,
      turnDeadlineAt: reconciled.turnDeadlineAt,
      nextRunAt: getOkeyLifecycleRunAt(
        reconciled.state,
        reconciled.turnDeadlineAt,
        getNow(),
      ),
      reason: reconciled.state.matchFinished
        ? "match_finished"
        : "not_eligible",
    };
  }

  const reason: OkeyServerLifecycleAlarmResult["reason"] =
    reconciled.executedTimeoutCount > 0
      ? "timeout_executed"
      : reconciled.botProcessed
        ? "bot_executed"
        : reconciled.executedEliminatedCount > 0
          ? "eliminated_executed"
          : "next_round_started";

  const nextRunAt = getOkeyLifecycleRunAt(
    reconciled.state,
    reconciled.turnDeadlineAt,
    getNow(),
  );

  const result: OkeyServerLifecycleAlarmResult = {
    ok: true,
    executed: true,
    state: reconciled.state,
    version: reconciled.version,
    attempts: 1,
    turnDeadlineAt: reconciled.turnDeadlineAt,
    nextRunAt,
    reason,
  };

  if (options.scheduleLifecycleAlarm) {
    await scheduleNextOkeyLifecycleAlarm({
      matchId,
      state: reconciled.state,
      version: reconciled.version,
      turnDeadlineAt: reconciled.turnDeadlineAt,
      scheduleLifecycleAlarm: options.scheduleLifecycleAlarm,
      nowMs: getNow(),
    });
  }

  return result;
}
