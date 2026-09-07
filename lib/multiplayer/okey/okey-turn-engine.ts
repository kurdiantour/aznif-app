import type { OkeyGameState } from "../../../okey/types/okey.ts";

/**
 * Canonical authoritative turn durations.
 *
 * These values now live with the authoritative engine contract so server
 * controllers can consume one TypeScript owner instead of defining their own
 * timer constants.
 */
export const OKEY_DRAW_PHASE_SECONDS = 15;
export const OKEY_THROW_PHASE_SECONDS = 30;

/**
 * Every source that can wake the authoritative Okey lifecycle.
 *
 * This is intentionally broader than a player command. Human input, a
 * scheduled wake-up and connection/lifecycle changes must all enter the same
 * engine boundary instead of owning separate progression logic.
 */
export type OkeyAuthoritativeStimulus =
  | {
      type: "human-command";
      actorPlayerId: string;
      commandId: string;
      commandType: string;
      payload: unknown;
    }
  | {
      type: "scheduled-wakeup";
      jobId: string;
      expectedVersion: number;
    }
  | {
      type: "disconnect";
      playerId: string;
    }
  | {
      type: "reconnect";
      playerId: string;
    }
  | {
      type: "manual-leave";
      playerId: string;
    }
  | {
      type: "recovery";
      reason: string;
    };

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
 * Later migration steps will make action reduction consume this exact context.
 * Keeping this pure lets us wire it in without changing gameplay.
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
    if (currentPlayer.eliminated) {
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
      step: "draw" | "discard" | "advance";
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

    const pendingBotAdvanceAt = state.roundState.pendingBotTurnAdvanceAt ?? null;
    if (
      pendingBotAdvanceAt &&
      state.roundState.pendingBotTurnAdvancePlayerId === context.currentPlayerId
    ) {
      const eligibleAtMs = Date.parse(pendingBotAdvanceAt);
      return {
        type: "bot-turn",
        expectedVersion: version,
        expectedActorId: context.currentPlayerId,
        playerIndex: context.currentPlayerIndex,
        step: "advance",
        notBefore: pendingBotAdvanceAt,
        ready: Number.isFinite(eligibleAtMs) && now >= eligibleAtMs,
      };
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

export type OkeyLifecycleTransitionHandlers = {
  eliminatedTurn: (
    decision: Extract<OkeyLifecycleDecision, { type: "eliminated-turn" }>,
    currentBundle: OkeyAuthoritativeSnapshotBundle,
  ) => Promise<OkeyAuthoritativeSnapshotBundle | null>;
  botTurn: (
    decision: Extract<OkeyLifecycleDecision, { type: "bot-turn" }>,
    currentBundle: OkeyAuthoritativeSnapshotBundle,
  ) => Promise<OkeyAuthoritativeSnapshotBundle | null>;
  expiredHumanTurn: (
    decision: Extract<OkeyLifecycleDecision, { type: "expired-human-turn" }>,
    currentBundle: OkeyAuthoritativeSnapshotBundle,
  ) => Promise<OkeyAuthoritativeSnapshotBundle | null>;
  dueNextRound: (
    decision: Extract<OkeyLifecycleDecision, { type: "due-next-round" }>,
    currentBundle: OkeyAuthoritativeSnapshotBundle,
  ) => Promise<OkeyAuthoritativeSnapshotBundle | null>;
};

/**
 * Single controller-dispatch owner for server lifecycle transitions.
 * Runtime adapters provide the I/O implementation; they do not decide which
 * controller path owns the current authoritative transition.
 */
export async function executeAuthoritativeOkeyLifecycleDecision(
  decision: Exclude<OkeyLifecycleDecision, { type: "idle" | "terminal" }>,
  currentBundle: OkeyAuthoritativeSnapshotBundle,
  handlers: OkeyLifecycleTransitionHandlers,
): Promise<OkeyAuthoritativeSnapshotBundle | null> {
  switch (decision.type) {
    case "eliminated-turn":
      return handlers.eliminatedTurn(decision, currentBundle);
    case "bot-turn":
      return handlers.botTurn(decision, currentBundle);
    case "expired-human-turn":
      return handlers.expiredHumanTurn(decision, currentBundle);
    case "due-next-round":
      return handlers.dueNextRound(decision, currentBundle);
  }
}

export type OkeyLifecycleTransitionExecutor = (
  decision: Exclude<OkeyLifecycleDecision, { type: "idle" | "terminal" }>,
  currentBundle: OkeyAuthoritativeSnapshotBundle,
) => Promise<OkeyAuthoritativeSnapshotBundle | null>;

export type OkeyAuthoritativeLifecycleRunOptions = {
  executeTransition: OkeyLifecycleTransitionExecutor;
  now?: () => number;
  maxTransitions?: number;
};

export type OkeyAuthoritativeLifecycleRunResult = {
  finalBundle: OkeyAuthoritativeSnapshotBundle;
  finalDecision: OkeyLifecycleDecision;
  executedDecisions: Exclude<OkeyLifecycleDecision, { type: "idle" | "terminal" }>[];
  reason: "waiting_boundary" | "terminal" | "executor_stopped" | "max_transitions";
};

/**
 * Central owner of authoritative lifecycle execution order.
 *
 * The engine decides the current lifecycle action, invokes exactly the supplied
 * transition adapter, then re-evaluates authoritative state. Runtime callers
 * no longer own their own decision/while-loop.
 *
 * maxTransitions intentionally defaults to 1 while bot/next-round pacing is
 * still scheduled outside this pure engine. This preserves the current server
 * waiting boundary and prevents presentation backlog.
 */
export async function runAuthoritativeOkeyLifecycle(
  initialBundle: OkeyAuthoritativeSnapshotBundle,
  options: OkeyAuthoritativeLifecycleRunOptions,
): Promise<OkeyAuthoritativeLifecycleRunResult> {
  const getNow = options.now ?? Date.now;
  const maxTransitions = Math.max(1, options.maxTransitions ?? 2);
  const executedDecisions: Exclude<OkeyLifecycleDecision, { type: "idle" | "terminal" }>[] = [];
  let currentBundle = initialBundle;

  for (let index = 0; index < maxTransitions; index += 1) {
    const decision = evaluateOkeyServerLifecycle(currentBundle, getNow());

    if (decision.type === "idle") {
      return { finalBundle: currentBundle, finalDecision: decision, executedDecisions, reason: "waiting_boundary" };
    }

    if (decision.type === "terminal") {
      return { finalBundle: currentBundle, finalDecision: decision, executedDecisions, reason: "terminal" };
    }

    const nextBundle = await options.executeTransition(decision, currentBundle);
    if (!nextBundle) {
      return { finalBundle: currentBundle, finalDecision: decision, executedDecisions, reason: "executor_stopped" };
    }

    executedDecisions.push(decision);
    currentBundle = nextBundle;

    // Preserve the intentional server waiting boundaries: Bot, Timeout and
    // Ghost transitions are one authoritative commit per invocation. A due
    // next-round transition may immediately consume the starting dealer Bot's
    // first required action, exactly as the current runtime does.
    if (decision.type !== "due-next-round") {
      const finalDecision = evaluateOkeyServerLifecycle(currentBundle, getNow());
      return {
        finalBundle: currentBundle,
        finalDecision,
        executedDecisions,
        reason: finalDecision.type === "terminal" ? "terminal" : "waiting_boundary",
      };
    }
  }

  const finalDecision = evaluateOkeyServerLifecycle(currentBundle, getNow());
  return {
    finalBundle: currentBundle,
    finalDecision,
    executedDecisions,
    reason: finalDecision.type === "terminal" ? "terminal" : "max_transitions",
  };
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
 * Legacy controller labels kept during migration so existing server entry
 * points continue to compile and behave exactly as before.
 *
 * They will later be folded into OkeyAuthoritativeStimulus + seat controller
 * ownership.
 */
export type OkeyTurnController =
  | "human"
  | "bot"
  | "timeout"
  | "disconnect"
  | "reconnect"
  | "manual-leave"
  | "elimination"
  | "next-round";


/**
 * Canonical state-changing requests accepted by the authoritative Okey engine.
 *
 * Controllers may decide what intent/action to submit (human command, bot
 * action choice, timeout wake-up), but they no longer build the authoritative
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

export type PreparedOkeyTurn<TState, TProjection, TEventDraft> = {
  state: TState;
  projection: TProjection;
  deadline: string | null;
  status: "playing" | "finished";
  actionEvents: TEventDraft[];
};

export type OkeyTurnEngineInput<
  TIntent,
  TState,
  TProjection,
  TEventDraft,
  TEvent,
> = {
  controller: OkeyTurnController;
  matchId: string;
  actorPlayerId: string;
  commandId: string;
  commandType: string;
  expectedVersion: number;
  intent: TIntent;

  /** Validate the controller intent and produce the one proposed transition. */
  validate: (
    intent: TIntent,
  ) => PreparedOkeyTurn<TState, TProjection, TEventDraft>;

  /** The only database write in the legacy pipeline. */
  commit: (
    prepared: PreparedOkeyTurn<TState, TProjection, TEventDraft>,
  ) => Promise<OkeyTurnCommit<TState, TEvent>>;

  /** Advance server-owned lifecycle work from the committed state, if needed. */
  advance?: (
    committed: OkeyTurnCommit<TState, TEvent>,
  ) => Promise<OkeyTurnCommit<TState, TEvent>>;

  /** Publish only committed/advanced state. */
  broadcast?: (input: {
    matchId: string;
    controller: OkeyTurnController;
    commandId: string;
    version: number;
    state: TState;
    turnDeadlineAt: string | null;
    actionEvents: TEvent[];
  }) => Promise<void>;
};

export type OkeyTurnEngineResult<TState, TEvent> = {
  controller: OkeyTurnController;
  committed: OkeyTurnCommit<TState, TEvent>;
};

/**
 * Compatibility pipeline for the current runtime.
 *
 * IMPORTANT:
 * This remains behavior-identical while the unified engine is introduced
 * beside it. Runtime callers will be migrated one at a time only after the
 * pure engine contract is covered by tests.
 */
export async function executeAuthoritativeOkeyTurn<
  TIntent,
  TState,
  TProjection,
  TEventDraft,
  TEvent,
>(
  input: OkeyTurnEngineInput<
    TIntent,
    TState,
    TProjection,
    TEventDraft,
    TEvent
  >,
): Promise<OkeyTurnEngineResult<TState, TEvent>> {
  // Controller -> Validate
  const prepared = input.validate(input.intent);

  // Validate -> Commit
  const committed = await input.commit(prepared);

  if (!committed) {
    throw new Error("okey_turn_commit_missing");
  }

  if (committed.applied === false) {
    return {
      controller: input.controller,
      committed,
    };
  }

  // Commit -> Advance
  const advanced = input.advance
    ? await input.advance(committed)
    : committed;

  // Advance -> Broadcast
  if (input.broadcast) {
    await input.broadcast({
      matchId: input.matchId,
      controller: input.controller,
      commandId: input.commandId,
      version: advanced.version,
      state: advanced.state,
      turnDeadlineAt: advanced.turn_deadline_at,
      actionEvents: advanced.action_events ?? [],
    });
  }

  return {
    controller: input.controller,
    committed: advanced,
  };
}

export type OkeyAuthoritativeTransitionExecutionInput<
  TState,
  TCommand,
  TRoundState,
  TProjection,
  TEventDraft,
  TEvent,
> = {
  state: TState;
  transition: OkeyAuthoritativeTransition<TCommand, TRoundState>;
  reducers: OkeyAuthoritativeTransitionReducers<TState, TCommand, TRoundState>;
  transitionNow?: number;
  prepare: (nextState: TState) => PreparedOkeyTurn<TState, TProjection, TEventDraft>;
  controller: OkeyTurnController;
  matchId: string;
  actorPlayerId: string | ((nextState: TState) => string);
  commandId: string | ((nextState: TState) => Promise<string>);
  commandType: string;
  expectedVersion: number;
  commit: (
    prepared: PreparedOkeyTurn<TState, TProjection, TEventDraft>,
  ) => Promise<OkeyTurnCommit<TState, TEvent>>;
  advance?: (
    committed: OkeyTurnCommit<TState, TEvent>,
  ) => Promise<OkeyTurnCommit<TState, TEvent>>;
  broadcast?: OkeyTurnEngineInput<
    OkeyAuthoritativeTransition<TCommand, TRoundState>,
    TState,
    TProjection,
    TEventDraft,
    TEvent
  >["broadcast"];
};

/**
 * Unified authoritative transition entry point.
 *
 * Runtime controllers submit only intent/transition metadata. The engine owns
 * reducer selection and passes the resulting authoritative state into the
 * existing commit/broadcast pipeline. This removes the Human entry point's
 * former direct reduce -> execute composition.
 */
export async function executeAuthoritativeOkeyTransition<
  TState,
  TCommand,
  TRoundState,
  TProjection,
  TEventDraft,
  TEvent,
>(
  input: OkeyAuthoritativeTransitionExecutionInput<
    TState,
    TCommand,
    TRoundState,
    TProjection,
    TEventDraft,
    TEvent
  >,
): Promise<OkeyTurnEngineResult<TState, TEvent>> {
  const nextState = reduceAuthoritativeOkeyTransition({
    state: input.state,
    transition: input.transition,
    reducers: input.reducers,
    now: input.transitionNow,
  });

  const prepared = input.prepare(nextState);
  const actorPlayerId = typeof input.actorPlayerId === "function"
    ? input.actorPlayerId(nextState)
    : input.actorPlayerId;
  const commandId = typeof input.commandId === "function"
    ? await input.commandId(nextState)
    : input.commandId;

  return executeAuthoritativeOkeyTurn({
    controller: input.controller,
    matchId: input.matchId,
    actorPlayerId,
    commandId,
    commandType: input.commandType,
    expectedVersion: input.expectedVersion,
    intent: input.transition,
    validate: () => prepared,
    commit: input.commit,
    advance: input.advance,
    broadcast: input.broadcast,
  });
}


