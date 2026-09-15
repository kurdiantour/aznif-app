import type { OkeyGameState } from "../types/okey.ts";

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

