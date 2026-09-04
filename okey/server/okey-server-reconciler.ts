import { isOkeyBotControlled } from "../engine/okey-bot-policy.ts";
import {
  applyAuthoritativeOkeyEliminatedTurn,
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  isOkeyRoundStartPending,
  projectOkeyMatchPublicState,
  resolveAuthoritativeMatchDeadline,
  settleAuthoritativeOkeyRound,
  startAuthoritativeOkeyNextRound,
  OKEY_ROUND_END_PRESENTATION_BUDGET,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
  type OkeyServerPlayerIdentity,
  type OkeyTeamId,
} from "./okey-authoritative.ts";
import {
  createForcedDrawDiscardEvents,
  type OkeyActionEvent,
} from "./okey-action-events.ts";
import { executeOkeyBotTurn } from "./okey-bot-executor.ts";
import { executeAuthoritativeOkeyTurn, type OkeyTurnCommit } from "../../lib/multiplayer/okey/okey-turn-engine.ts";

export type OkeyAuthoritativeSnapshotBundle = {
  version: number | string;
  turn_deadline_at: string | null;
  state: OkeyAuthoritativeMatchState;
  status?: "playing" | "finished" | "waiting";
};

export type OkeyLifecycleDecision =
  | {
      type: "terminal";
      matchFinished: true;
      winnerTeamId: OkeyTeamId | null;
      reason: string | null;
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

/**
 * Evaluates the next authoritative server lifecycle action in deterministic priority order:
 * 1. Terminal / Match Finished
 * 2. Eliminated Current Actor
 * 3. Bot Current Actor
 * 4. Expired Human Turn Deadline
 * 5. Due Next Round
 * 6. Idle / Waiting for player action or countdown
 */
export function evaluateOkeyServerLifecycle(
  bundle: OkeyAuthoritativeSnapshotBundle,
  now = Date.now(),
): OkeyLifecycleDecision {
  const version = Number(bundle.version);
  const state = bundle.state;
  const turnDeadlineAt = bundle.turn_deadline_at;

  // Priority 1: Terminal / Match Finished
  if (state.matchFinished) {
    return {
      type: "terminal",
      matchFinished: true,
      winnerTeamId: state.matchWinnerTeamId,
      reason: state.leaveTerminationReason,
    };
  }

  // Active round playing phase
  if (state.roundState.phase === "playing") {
    const currentPlayerIndex = state.roundState.currentPlayerIndex;
    const currentPlayer = state.roundState.players[currentPlayerIndex];

    if (!currentPlayer) {
      return {
        type: "idle",
        reason: "waiting_for_human_action",
      };
    }

    // Priority 2: Eliminated Current Actor
    if (currentPlayer.eliminated) {
      return {
        type: "eliminated-turn",
        expectedVersion: version,
        expectedActorId: currentPlayer.id,
        playerIndex: currentPlayerIndex,
      };
    }

    // Priority 3: Bot Current Actor
    if (isOkeyBotControlled(currentPlayer)) {
      const startPending = isOkeyRoundStartPending(state, now);
      return {
        type: "bot-turn",
        expectedVersion: version,
        expectedActorId: currentPlayer.id,
        playerIndex: currentPlayerIndex,
        step: state.roundState.hasDrawnThisTurn ? "discard" : "draw",
        notBefore: state.roundStartsAt ?? null,
        ready: !startPending,
      };
    }

    // Round start delay for human player
    if (isOkeyRoundStartPending(state, now)) {
      return {
        type: "idle",
        reason: "round_start_pending",
        turnDeadlineAt: state.roundStartsAt,
      };
    }

    // Priority 4: Expired Human Turn Deadline
    if (turnDeadlineAt) {
      const deadlineMs = Date.parse(turnDeadlineAt);
      if (Number.isFinite(deadlineMs) && now >= deadlineMs) {
        return {
          type: "expired-human-turn",
          expectedVersion: version,
          expectedTurnPlayerId: currentPlayer.id,
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

  // Round finished phase
  if (state.roundState.phase === "finished") {
    if (state.pendingForfeitTeamId || state.leaveTerminationReason === "team-forfeit") {
      return {
        type: "terminal",
        matchFinished: true,
        winnerTeamId: state.pendingForfeitTeamId === "teamA" ? "teamB" : "teamA",
        reason: "team-forfeit",
      };
    }

    // Priority 5: Due Next Round
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
      return {
        type: "idle",
        reason: "next_round_countdown",
        eligibleAt,
      };
    }

    // Fallback: If round is finished and not match finished without eligibleAt, it is due next round
    return {
      type: "due-next-round",
      expectedVersion: version,
      expectedRound: state.currentRound,
      eligibleAt: new Date(now).toISOString(),
    };
  }

  return {
    type: "idle",
    reason: "match_not_playing",
  };
}

export type OkeyEliminatedReconcileResult = {
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  executedCount: number;
  actionEvents: OkeyActionEvent[];
};

/**
 * Authoritative Server Reconciler for Eliminated Player Turns.
 * Automatically advances turn for eliminated players without requiring client triggers.
 */
export async function reconcileAuthoritativeEliminatedTurns(options: {
  client: any;
  matchId: string;
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
  maxIterations?: number;
}): Promise<OkeyEliminatedReconcileResult> {
  const getNow = options.now ?? Date.now;
  const maxIterations = Math.max(1, options.maxIterations ?? 4);

  let currentState = options.state;
  let currentVersion = options.version;
  let currentDeadline = options.turnDeadlineAt;
  let executedCount = 0;
  const allActionEvents: OkeyActionEvent[] = [];

  while (executedCount < maxIterations) {
    const decision = evaluateOkeyServerLifecycle(
      {
        state: currentState,
        version: currentVersion,
        turn_deadline_at: currentDeadline,
      },
      getNow(),
    );

    if (decision.type !== "eliminated-turn") {
      break;
    }

    const actor = currentState.roundState.players[decision.playerIndex];
    if (!actor || actor.id !== decision.expectedActorId) {
      break;
    }

    const nextState = applyAuthoritativeOkeyEliminatedTurn(currentState, decision.expectedActorId);
    if (nextState === currentState) {
      break;
    }

    const drawnAndDiscardedTile = nextState.roundState.discardPile[nextState.roundState.discardPile.length - 1] ?? null;
    const actionEventDrafts = createForcedDrawDiscardEvents({
      actorPlayerId: actor.id,
      source: "deck",
      tile: drawnAndDiscardedTile,
      reason: "eliminated",
    });

    const nextVersion = currentVersion + 1;
    const deadline = getNextOkeyMatchTurnDeadline(nextState, getNow());
    const commandId = await (options.deterministicCommandId
      ? options.deterministicCommandId(`okey:${options.matchId}:system-eliminated-turn:${currentVersion}:${actor.id}`)
      : generateOkeyReconcilerCommandId(options.matchId, "system-eliminated-turn", currentVersion, actor.id));

    const publicProjection = projectOkeyMatchPublicState(
      nextState,
      nextVersion,
      deadline,
    );

    let committed;
    try {
      const turnResult = await executeAuthoritativeOkeyTurn({
        controller: "elimination",
        matchId: options.matchId,
        actorPlayerId: actor.id,
        commandId,
        commandType: "system-eliminated-turn",
        expectedVersion: currentVersion,
        intent: decision,
        validate: () => ({
          state: nextState,
          projection: publicProjection,
          deadline,
          status: nextState.matchFinished ? "finished" as const : "playing" as const,
          actionEvents: actionEventDrafts,
        }),
        commit: async (prepared) => {
          const { data, error } = await options.client.rpc("okey_commit_authoritative_action", {
            p_match_id: options.matchId,
            p_user_id: actor.id,
            p_command_id: commandId,
            p_expected_version: currentVersion,
            p_command_type: "system-eliminated-turn",
            p_state: prepared.state,
            p_projection: prepared.projection,
            p_status: prepared.status,
            p_turn_deadline_at: prepared.deadline,
            p_action_events: prepared.actionEvents,
          }).single();
          if (error || !data) throw new Error(error?.message ?? "okey_elimination_commit_failed");
          return data as OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
        },
        advance: async (value) => ({
          ...value,
          state: value.state ?? nextState,
          turn_deadline_at: value.turn_deadline_at ?? deadline,
          action_events: value.action_events ?? [],
        }),
        broadcast: options.broadcastStateUpdate ? async (value) => {
          try {
            await options.broadcastStateUpdate!({
              matchId: options.matchId,
              commandId,
              version: value.version,
              publicProjection: projectOkeyMatchPublicState(
                value.state,
                value.version,
                value.turnDeadlineAt,
              ),
              actionEvents: value.actionEvents,
            });
          } catch (broadcastError) {
            console.error("Okey eliminated turn broadcast failed", broadcastError);
          }
        } : undefined,
      });
      committed = turnResult.committed;
      if (committed.applied === false) break;
    } catch {
      break;
    }

    const committedVersion = Number(committed.version);
    const committedDeadline = committed.turn_deadline_at ?? deadline;
    const committedState = committed.state ?? nextState;
    const committedActionEvents = committed.action_events ?? [];

    executedCount += 1;
    currentState = committedState;
    currentVersion = committedVersion;
    currentDeadline = committedDeadline;
    allActionEvents.push(...committedActionEvents);
  }

  return {
    state: currentState,
    version: currentVersion,
    turnDeadlineAt: currentDeadline,
    executedCount,
    actionEvents: allActionEvents,
  };
}

export type OkeyTimeoutReconcileResult = {
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  executed: boolean;
  actionEvents: OkeyActionEvent[];
};

/**
 * Authoritative Server Reconciler for Expired Human Turns (Timeout).
 * Reuses the existing resolveAuthoritativeMatchDeadline reducer without changing timeout logic.
 */
export async function reconcileAuthoritativeTimeoutTurn(options: {
  client: any;
  matchId: string;
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
}): Promise<OkeyTimeoutReconcileResult> {
  const getNow = options.now ?? Date.now;

  const decision = evaluateOkeyServerLifecycle(
    {
      state: options.state,
      version: options.version,
      turn_deadline_at: options.turnDeadlineAt,
    },
    getNow(),
  );

  if (decision.type !== "expired-human-turn") {
    return {
      state: options.state,
      version: options.version,
      turnDeadlineAt: options.turnDeadlineAt,
      executed: false,
      actionEvents: [],
    };
  }

  const nextState = resolveAuthoritativeMatchDeadline(
    options.state,
    decision.expectedTurnDeadlineAt,
    getNow(),
  );

  const event = nextState.lastTimeoutDiscardEvent;
  const tile = nextState.roundState.discardPile[nextState.roundState.discardPile.length - 1] ?? null;
  const actorPlayerId = event?.playerId ?? decision.expectedTurnPlayerId;
  const actionEventDrafts = event?.source === "rack"
    ? [{ type: "discard" as const, actorPlayerId, payload: { tileId: tile?.id ?? null, tile, reason: "timeout" } }]
    : createForcedDrawDiscardEvents({
        actorPlayerId,
        source: "deck",
        tile,
        reason: "timeout",
      });

  const nextVersion = options.version + 1;
  const deadline = getNextOkeyMatchTurnDeadline(nextState, getNow());
  const commandId = await (options.deterministicCommandId
    ? options.deterministicCommandId(`okey:${options.matchId}:system-timeout:${options.version}:${actorPlayerId}`)
    : generateOkeyReconcilerCommandId(options.matchId, "system-timeout", options.version, actorPlayerId));

  const publicProjection = projectOkeyMatchPublicState(
    nextState,
    nextVersion,
    deadline,
  );

  try {
    const turnResult = await executeAuthoritativeOkeyTurn({
      controller: "timeout",
      matchId: options.matchId,
      actorPlayerId,
      commandId,
      commandType: "system-timeout",
      expectedVersion: options.version,
      intent: decision,
      validate: () => ({
        state: nextState,
        projection: publicProjection,
        deadline,
        status: nextState.matchFinished ? "finished" as const : "playing" as const,
        actionEvents: actionEventDrafts,
      }),
      commit: async (prepared) => {
        const { data, error } = await options.client.rpc("okey_commit_authoritative_action", {
          p_match_id: options.matchId,
          p_user_id: actorPlayerId,
          p_command_id: commandId,
          p_expected_version: options.version,
          p_command_type: "system-timeout",
          p_state: prepared.state,
          p_projection: prepared.projection,
          p_status: prepared.status,
          p_turn_deadline_at: prepared.deadline,
          p_action_events: prepared.actionEvents,
        }).single();
        if (error || !data) throw new Error(error?.message ?? "okey_timeout_commit_failed");
        return data as OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
      },
      advance: async (committed) => ({ ...committed, state: committed.state ?? nextState, turn_deadline_at: committed.turn_deadline_at ?? deadline, action_events: committed.action_events ?? [] }),
      broadcast: options.broadcastStateUpdate ? async (committed) => {
        try {
          await options.broadcastStateUpdate!({
            matchId: options.matchId,
            commandId,
            version: committed.version,
            publicProjection: projectOkeyMatchPublicState(
              committed.state,
              committed.version,
              committed.turnDeadlineAt,
            ),
            actionEvents: committed.actionEvents,
          });
        } catch (broadcastError) {
          console.error("Okey timeout broadcast failed", broadcastError);
        }
      } : undefined,
    });
    const committed = turnResult.committed;
    if (committed.applied === false) throw new Error("okey_timeout_not_committed");
    return {
      state: committed.state,
      version: Number(committed.version),
      turnDeadlineAt: committed.turn_deadline_at ?? deadline,
      executed: true,
      actionEvents: committed.action_events ?? [],
    };
  } catch {
    return {
      state: options.state,
      version: options.version,
      turnDeadlineAt: options.turnDeadlineAt,
      executed: false,
      actionEvents: [],
    };
  }
}

export type OkeyNextRoundReconcileResult = {
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  executed: boolean;
  actionEvents: OkeyActionEvent[];
};

/**
 * Authoritative Server Reconciler for Starting Next Round / Due Next Round.
 * Reuses startAuthoritativeOkeyNextRound and settleAuthoritativeOkeyRound pure reducers directly.
 */
export async function reconcileAuthoritativeNextRound(options: {
  client: any;
  matchId: string;
  requesterUserId?: string;
  state: OkeyAuthoritativeMatchState;
  version: number;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  deterministicCommandId?: (source: string) => Promise<string>;
  now?: () => number;
}): Promise<OkeyNextRoundReconcileResult> {
  const getNow = options.now ?? Date.now;

  const decision = evaluateOkeyServerLifecycle(
    {
      state: options.state,
      version: options.version,
      turn_deadline_at: null,
    },
    getNow(),
  );

  if (decision.type !== "due-next-round") {
    return {
      state: options.state,
      version: options.version,
      turnDeadlineAt: null,
      executed: false,
      actionEvents: [],
    };
  }

  const finishingTeamForfeit =
    Boolean(options.state.pendingForfeitTeamId) ||
    options.state.leaveTerminationReason === "team-forfeit";

  const nextState = finishingTeamForfeit
    ? settleAuthoritativeOkeyRound(options.state)
    : startAuthoritativeOkeyNextRound(options.state, getNow());

  const nextVersion = options.version + 1;
  const deadline = getNextOkeyMatchTurnDeadline(nextState, getNow());
  const commandType = finishingTeamForfeit ? "round-end-team-forfeit" : "start-next-round";
  const actorPlayerId = options.requesterUserId || nextState.roundState.players[nextState.roundState.currentPlayerIndex]?.id || "system";

  const commandId = await (options.deterministicCommandId
    ? options.deterministicCommandId(`okey:${options.matchId}:${commandType}:${options.version}:${nextState.currentRound}`)
    : generateOkeyReconcilerCommandId(options.matchId, commandType, options.version, String(nextState.currentRound)));

  const actionEventDrafts = finishingTeamForfeit    ? []
    : [{ type: "round" as const, actorPlayerId: null, payload: { round: nextState.currentRound } }];

  const publicProjection = projectOkeyMatchPublicState(
    nextState,
    nextVersion,
    deadline,
  );

  const { data: commit, error: commitError } = await options.client
    .rpc("okey_commit_authoritative_action", {
      p_match_id: options.matchId,
      p_user_id: actorPlayerId,
      p_command_id: commandId,
      p_expected_version: options.version,
      p_command_type: commandType,
      p_state: nextState,
      p_projection: publicProjection,
      p_status: nextState.matchFinished ? "finished" : "playing",
      p_turn_deadline_at: deadline,
      p_action_events: actionEventDrafts,
    })
    .single();

  if (commitError || !commit || (commit as { applied?: boolean }).applied === false) {
    return {
      state: options.state,
      version: options.version,
      turnDeadlineAt: null,
      executed: false,
      actionEvents: [],
    };
  }

  const committedVersion = Number((commit as { version: number }).version);
  const committedDeadline = (commit as { turn_deadline_at?: string | null }).turn_deadline_at ?? deadline;
  const committedState = (commit as { state?: OkeyAuthoritativeMatchState }).state ?? nextState;
  const committedActionEvents = (commit as { action_events?: OkeyActionEvent[] }).action_events ?? [];
  const committedPublicProjection = projectOkeyMatchPublicState(
    committedState,
    committedVersion,
    committedDeadline,
  );

  if (options.broadcastStateUpdate) {
    try {
      await options.broadcastStateUpdate({
        matchId: options.matchId,
        commandId,
        version: committedVersion,
        publicProjection: committedPublicProjection,
        actionEvents: committedActionEvents,
      });
    } catch (broadcastError) {
      console.error("Okey next-round broadcast failed", broadcastError);
    }
  }

  return {
    state: committedState,
    version: committedVersion,
    turnDeadlineAt: committedDeadline,
    executed: true,
    actionEvents: committedActionEvents,
  };
}

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
 * Authoritative Server Reconciler for Waiting -> Playing transition.
 * Directly reuses createAuthoritativeOkeyMatch without duplicating player count, seat, or tile dealing rules.
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

  return {
    state,
    version: 0,
    turnDeadlineAt: deadline,
    executed: true,
    publicProjection: projection,
    room: startedData,
  };
}

export type OkeyServerReconcileResult = {
  state: OkeyAuthoritativeMatchState;
  version: number;
  turnDeadlineAt: string | null;
  executedEliminatedCount: number;
  botProcessed: boolean;
  executedTimeoutCount: number;
  executedNextRoundCount: number;
  actionEvents: OkeyActionEvent[];
};

/**
 * Authoritative Server Reconciler for active match and turn transitions (Eliminated, Bot, Timeout, Next Round).
 * Evaluates server lifecycle and executes authoritative transitions without relying on client triggers.
 * Reuses existing pure reducers directly.
 */
export async function reconcileAuthoritativeServerTurns(options: {
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
  maxTransitions?: number;
}): Promise<OkeyServerReconcileResult> {
  const getNow = options.now ?? Date.now;
  const maxTransitions = Math.max(1, options.maxTransitions ?? 16);

  let currentState = options.state;
  let currentVersion = options.version;
  let currentDeadline = options.turnDeadlineAt;
  const allActionEvents: OkeyActionEvent[] = [];
  let executedEliminatedCount = 0;
  let botProcessed = false;
  let executedTimeoutCount = 0;
  let executedNextRoundCount = 0;
  let transitions = 0;

  while (transitions < maxTransitions) {
    const decision = evaluateOkeyServerLifecycle(
      {
        state: currentState,
        version: currentVersion,
        turn_deadline_at: currentDeadline,
      },
      getNow(),
    );

    if (decision.type === "eliminated-turn") {
      const eliminatedResult = await reconcileAuthoritativeEliminatedTurns({
        client: options.client,
        matchId: options.matchId,
        state: currentState,
        version: currentVersion,
        turnDeadlineAt: currentDeadline,
        broadcastStateUpdate: options.broadcastStateUpdate,
        deterministicCommandId: options.deterministicCommandId,
        now: getNow,
        maxIterations: 1,
      });

      if (eliminatedResult.executedCount === 0) break;
      executedEliminatedCount += eliminatedResult.executedCount;
      transitions += eliminatedResult.executedCount;
      currentState = eliminatedResult.state;
      currentVersion = eliminatedResult.version;
      currentDeadline = eliminatedResult.turnDeadlineAt;
      allActionEvents.push(...eliminatedResult.actionEvents);
      break;
    }

    if (decision.type === "bot-turn") {
      if (!decision.ready) break;
      const requesterId = options.requesterUserId || decision.expectedActorId;
      const botResult = await executeOkeyBotTurn(
        {
          matchId: options.matchId,
          requesterUserId: requesterId,
          expectedVersion: decision.expectedVersion,
          expectedActorId: decision.expectedActorId,
        },
        {
          client: options.client,
          deterministicCommandId:
            options.deterministicCommandId ??
            (async (src: string) => generateOkeyReconcilerCommandId(options.matchId, "bot", currentVersion, src)),
          now: getNow,
          broadcastStateUpdate: options.broadcastStateUpdate,
        },
      );

      if (!botResult.ok || !botResult.processed || !botResult.finalVersion) break;
      botProcessed = true;
      transitions += (botResult.steps?.length ?? 1);

      const { data: bundleRaw } = await options.client
        .rpc("okey_get_authoritative_bundle", {
          p_match_id: options.matchId,
          p_user_id: requesterId,
          p_command_id: null,
        })
        .single();

      if (bundleRaw) {
        currentState = bundleRaw.state as OkeyAuthoritativeMatchState;
        currentVersion = Number(bundleRaw.version);
        currentDeadline = bundleRaw.turn_deadline_at as string | null;
      }
      break;
    }

    if (decision.type === "expired-human-turn") {
      const timeoutResult = await reconcileAuthoritativeTimeoutTurn({
        client: options.client,
        matchId: options.matchId,
        state: currentState,
        version: currentVersion,
        turnDeadlineAt: currentDeadline,
        broadcastStateUpdate: options.broadcastStateUpdate,
        deterministicCommandId: options.deterministicCommandId,
        now: getNow,
      });

      if (!timeoutResult.executed) break;
      executedTimeoutCount += 1;
      transitions += 1;
      currentState = timeoutResult.state;
      currentVersion = timeoutResult.version;
      currentDeadline = timeoutResult.turnDeadlineAt;
      allActionEvents.push(...timeoutResult.actionEvents);
      break;
    }

    if (decision.type === "due-next-round") {
      const nextRoundResult = await reconcileAuthoritativeNextRound({
        client: options.client,
        matchId: options.matchId,
        requesterUserId: options.requesterUserId,
        state: currentState,
        version: currentVersion,
        broadcastStateUpdate: options.broadcastStateUpdate,
        deterministicCommandId: options.deterministicCommandId,
        now: getNow,
      });

      if (!nextRoundResult.executed) break;
      executedNextRoundCount += 1;
      transitions += 1;
      currentState = nextRoundResult.state;
      currentVersion = nextRoundResult.version;
      currentDeadline = nextRoundResult.turnDeadlineAt;
      allActionEvents.push(...nextRoundResult.actionEvents);
      break;
    }

    // "terminal", "idle", etc.
    break;
  }

  return {
    state: currentState,
    version: currentVersion,
    turnDeadlineAt: currentDeadline,
    executedEliminatedCount,
    botProcessed,
    executedTimeoutCount,
    executedNextRoundCount,
    actionEvents: allActionEvents,
  };
}

export type OkeyLifecycleTransitionExecutor = (
  decision: Exclude<OkeyLifecycleDecision, { type: "idle" }>,
  currentBundle: OkeyAuthoritativeSnapshotBundle,
) => Promise<OkeyAuthoritativeSnapshotBundle | null>;

export type OkeyReconcilerOptions = {
  transitionExecutor?: OkeyLifecycleTransitionExecutor;
  now?: () => number;
  maxIterations?: number;
};

export type OkeyReconcilerRunResult = {
  ok: boolean;
  iterations: number;
  decisions: OkeyLifecycleDecision[];
  finalBundle: OkeyAuthoritativeSnapshotBundle;
  finalDecision: OkeyLifecycleDecision;
  reason: "settled_idle" | "settled_terminal" | "max_iterations" | "no_executor" | "executor_stopped";
};

/**
 * Core Server Lifecycle Reconciler runner.
 * Evaluates decisions and, if an executor is provided, applies transitions and re-inspects.
 */
export async function runOkeyLifecycleReconciler(
  initialBundle: OkeyAuthoritativeSnapshotBundle,
  options: OkeyReconcilerOptions = {},
): Promise<OkeyReconcilerRunResult> {
  const getNow = options.now ?? Date.now;
  const maxIterations = Math.max(1, options.maxIterations ?? 16);
  const decisions: OkeyLifecycleDecision[] = [];

  let currentBundle = initialBundle;
  let iterations = 0;

  while (iterations < maxIterations) {
    const decision = evaluateOkeyServerLifecycle(currentBundle, getNow());
    decisions.push(decision);

    if (decision.type === "idle") {
      return {
        ok: true,
        iterations,
        decisions,
        finalBundle: currentBundle,
        finalDecision: decision,
        reason: "settled_idle",
      };
    }

    if (decision.type === "terminal" && !options.transitionExecutor) {
      return {
        ok: true,
        iterations,
        decisions,
        finalBundle: currentBundle,
        finalDecision: decision,
        reason: "settled_terminal",
      };
    }

    if (!options.transitionExecutor) {
      return {
        ok: true,
        iterations,
        decisions,
        finalBundle: currentBundle,
        finalDecision: decision,
        reason: "no_executor",
      };
    }

    const nextBundle = await options.transitionExecutor(decision, currentBundle);
    iterations += 1;

    if (!nextBundle) {
      return {
        ok: true,
        iterations,
        decisions,
        finalBundle: currentBundle,
        finalDecision: decision,
        reason: "executor_stopped",
      };
    }

    currentBundle = nextBundle;
  }

  const finalDecision = evaluateOkeyServerLifecycle(currentBundle, getNow());
  return {
    ok: true,
    iterations,
    decisions,
    finalBundle: currentBundle,
    finalDecision,
    reason: "max_iterations",
  };
}

export type OkeyServerLifecycleWakeupOptions = {
  client: any;
  matchId: string;
  requesterUserId?: string;
  initialState?: OkeyAuthoritativeMatchState;
  initialVersion?: number;
  eligibleAt?: string | null;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  deterministicCommandId?: (source: string) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxRetryDurationMs?: number;
  retryIntervalMs?: number;
};

export type OkeyServerLifecycleWakeupResult = {
  ok: boolean;
  executed: boolean;
  state: OkeyAuthoritativeMatchState | null;
  version: number | null;
  attempts: number;
  reason:
    | "next_round_started"
    | "match_finished"
    | "already_transitioned"
    | "max_duration_exceeded"
    | "fetch_failed"
    | "not_eligible";
};

/**
 * Server Lifecycle Wake-up for Okey matches.
 *
 * 1. Waits until nextRoundEligibleAt (minimum 3 seconds from round end).
 * 2. Wakes up on the Server and executes the authoritative Reconciler.
 * 3. In case of transient conflicts or errors, automatically retries up to 8 seconds total.
 * 4. Ensures the round never remains in phase=finished after 8 seconds.
 * 5. Uses the existing authoritative reconciler and reducer path without any client triggers.
 */
export async function reconcileAuthoritativeServerLifecycleWakeup(
  options: OkeyServerLifecycleWakeupOptions,
): Promise<OkeyServerLifecycleWakeupResult> {
  const getNow = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startTime = getNow();
  const maxDurationMs = Math.max(
    1,
    options.maxRetryDurationMs ?? (OKEY_ROUND_END_PRESENTATION_BUDGET.TOTAL_LIFECYCLE_DELAY_MS + 5_000),
  );
  const retryIntervalMs = Math.max(10, options.retryIntervalMs ?? 500);
  const matchId = options.matchId;
  const requesterUserId = options.requesterUserId ?? "server-lifecycle-wake-up";

  // Step 1: Wait for eligibleAt (minimum 3 seconds delay)
  const eligibleAt = options.eligibleAt ?? options.initialState?.nextRoundEligibleAt ?? null;
  if (eligibleAt) {
    const eligibleAtMs = Date.parse(eligibleAt);
    if (Number.isFinite(eligibleAtMs)) {
      const initialDelay = Math.max(0, eligibleAtMs - getNow());
      if (initialDelay > 0) {
        await sleep(initialDelay);
      }
    }
  }

  let attempts = 0;

  // Step 2 & 3: Run Reconciler and retry up to maxDurationMs (8 seconds)
  while (getNow() - startTime <= maxDurationMs) {
    attempts += 1;

    let currentState: OkeyAuthoritativeMatchState | null = options.initialState ?? null;
    let currentVersion: number | null = options.initialVersion !== undefined ? Number(options.initialVersion) : null;
    let currentDeadline: string | null = null;

    if (attempts > 1 || !currentState || currentVersion === null) {
      const { data: bundleRaw, error: bundleError } = await options.client
        .rpc("okey_get_authoritative_bundle", {
          p_match_id: matchId,
          p_user_id: requesterUserId,
          p_command_id: null,
        })
        .single();

      if (bundleError || !bundleRaw) {
        if (getNow() - startTime + retryIntervalMs <= maxDurationMs) {
          await sleep(retryIntervalMs);
          continue;
        }
        break;
      }

      currentState = bundleRaw.state as OkeyAuthoritativeMatchState;
      currentVersion = Number(bundleRaw.version);
      currentDeadline = bundleRaw.turn_deadline_at as string | null;
    }

    if (!currentState || currentVersion === null) {
      break;
    }

    if (currentState.matchFinished) {
      return {
        ok: true,
        executed: false,
        state: currentState,
        version: currentVersion,
        attempts,
        reason: "match_finished",
      };
    }

    if (currentState.roundState.phase !== "finished") {
      return {
        ok: true,
        executed: false,
        state: currentState,
        version: currentVersion,
        attempts,
        reason: "already_transitioned",
      };
    }

    const reconcileResult = await reconcileAuthoritativeServerTurns({
      client: options.client,
      matchId,
      requesterUserId,
      state: currentState,
      version: currentVersion,
      turnDeadlineAt: currentDeadline,
      broadcastStateUpdate: options.broadcastStateUpdate,
      deterministicCommandId: options.deterministicCommandId,
      now: getNow,
    });

    if (
      reconcileResult.executedNextRoundCount > 0 ||
      reconcileResult.state.roundState.phase !== "finished" ||
      reconcileResult.state.matchFinished
    ) {
      return {
        ok: true,
        executed: true,
        state: reconcileResult.state,
        version: reconcileResult.version,
        attempts,
        reason: "next_round_started",
      };
    }

    const elapsed = getNow() - startTime;
    if (elapsed + retryIntervalMs > maxDurationMs) {
      break;
    }

    await sleep(retryIntervalMs);
  }

  // Step 4: Fallback attempt before finishing: Round must not remain in phase=finished after 8s
  try {
    const { data: finalBundle } = await options.client
      .rpc("okey_get_authoritative_bundle", {
        p_match_id: matchId,
        p_user_id: requesterUserId,
        p_command_id: null,
      })
      .single();

    if (finalBundle) {
      const state = finalBundle.state as OkeyAuthoritativeMatchState;
      const ver = Number(finalBundle.version);
      if (!state.matchFinished && state.roundState.phase === "finished") {
        const finalReconcile = await reconcileAuthoritativeServerTurns({
          client: options.client,
          matchId,
          requesterUserId,
          state,
          version: ver,
          turnDeadlineAt: null,
          broadcastStateUpdate: options.broadcastStateUpdate,
          deterministicCommandId: options.deterministicCommandId,
          now: getNow,
        });

        if (finalReconcile.executedNextRoundCount > 0 || finalReconcile.state.roundState.phase !== "finished") {
          return {
            ok: true,
            executed: true,
            state: finalReconcile.state,
            version: finalReconcile.version,
            attempts: attempts + 1,
            reason: "next_round_started",
          };
        }
      }
    }
  } catch (err) {
    console.error("Final server lifecycle wake-up attempt failed", err);
  }

  return {
    ok: false,
    executed: false,
    state: null,
    version: null,
    attempts,
    reason: "max_duration_exceeded",
  };
}

