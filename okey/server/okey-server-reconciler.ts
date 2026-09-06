import { isOkeyBotControlled } from "../engine/okey-bot-policy.ts";
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  isOkeyRoundStartPending,
  projectOkeyMatchPublicState,
  settleAuthoritativeOkeyRound,
  OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
  type OkeyServerPlayerIdentity,
  type OkeyTeamId,
} from "./okey-authoritative.ts";
import { OKEY_SERVER_ROUND_TRANSITION_DELAY_MS } from "./okey-lifecycle-timing.ts";
import {
  createForcedDrawDiscardEvents,
  type OkeyActionEvent,
} from "./okey-action-events.ts";
import { executeOkeyBotTurn } from "./okey-bot-executor.ts";
import {
  evaluateOkeyServerLifecycle,
  executeAuthoritativeOkeyLifecycleDecision,
  executeAuthoritativeOkeyTurn,
  reduceAuthoritativeOkeyTransition,
  runAuthoritativeOkeyLifecycle,
  type OkeyAuthoritativeSnapshotBundle,
  type OkeyLifecycleDecision,
  type OkeyTurnCommit,
} from "../../lib/multiplayer/okey/okey-turn-engine.ts";

export {
  evaluateOkeyServerLifecycle,
  type OkeyAuthoritativeSnapshotBundle,
  type OkeyLifecycleDecision,
} from "../../lib/multiplayer/okey/okey-turn-engine.ts";

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

    const nextState = reduceAuthoritativeOkeyTransition({
      state: currentState,
      transition: {
        type: "eliminated-turn",
        expectedActorId: decision.expectedActorId,
      },
      reducers: OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
      now: getNow(),
    });
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
          if (error && data?.applied !== false) {
  throw new Error(error.message ?? "okey_elimination_commit_failed");
}
if (!data) {
  throw new Error(error?.message ?? "okey_elimination_commit_failed");
}
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
    } catch (error) {
      throw error;
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
 * Routes timeout reduction through the central authoritative transition gateway without changing timeout rules.
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

  const nextState = reduceAuthoritativeOkeyTransition({
    state: options.state,
    transition: {
      type: "timeout",
      deadlineAt: decision.expectedTurnDeadlineAt,
    },
    reducers: OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
    now: getNow(),
  });

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
        if (error && data?.applied !== false) {
  throw new Error(error.message ?? "okey_timeout_commit_failed");
}
if (!data) {
  throw new Error(error?.message ?? "okey_timeout_commit_failed");
}
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
    if (committed.applied === false) {
      return {
        state: options.state,
        version: options.version,
        turnDeadlineAt: options.turnDeadlineAt,
        executed: false,
        actionEvents: [],
      };
    }
    return {
      state: committed.state,
      version: Number(committed.version),
      turnDeadlineAt: committed.turn_deadline_at ?? deadline,
      executed: true,
      actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
    };
  } catch (error) {
    throw error;
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
 * Routes next-round reduction through the central authoritative transition gateway; terminal forfeit settlement remains the dedicated settlement path.
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
    : reduceAuthoritativeOkeyTransition({
        state: options.state,
        transition: { type: "next-round" },
        reducers: OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
        now: getNow(),
      });

  const nextVersion = options.version + 1;
  const deadline = getNextOkeyMatchTurnDeadline(nextState, getNow());
  const commandType = finishingTeamForfeit ? "round-end-team-forfeit" : "start-next-round";
  const actorPlayerId = options.requesterUserId || nextState.roundState.players[nextState.roundState.currentPlayerIndex]?.id || "system";

  const commandId = await (options.deterministicCommandId
    ? options.deterministicCommandId(`okey:${options.matchId}:${commandType}:${options.version}:${nextState.currentRound}`)
    : generateOkeyReconcilerCommandId(options.matchId, commandType, options.version, String(nextState.currentRound)));

  const actionEventDrafts = finishingTeamForfeit
    ? []
    : [{ type: "round" as const, actorPlayerId: null, payload: { round: nextState.currentRound } }];

  const publicProjection = projectOkeyMatchPublicState(
    nextState,
    nextVersion,
    deadline,
  );

  try {
    const turnResult = await executeAuthoritativeOkeyTurn({
      controller: "next-round",
      matchId: options.matchId,
      actorPlayerId,
      commandId,
      commandType,
      expectedVersion: options.version,
      intent: decision,
      validate: () => ({
        state: nextState,
        projection: publicProjection,
        deadline,
        status: nextState.matchFinished ? ("finished" as const) : ("playing" as const),
        actionEvents: actionEventDrafts,
      }),
      commit: async (prepared) => {
        const { data, error } = await options.client
          .rpc("okey_commit_authoritative_action", {
            p_match_id: options.matchId,
            p_user_id: actorPlayerId,
            p_command_id: commandId,
            p_expected_version: options.version,
            p_command_type: commandType,
            p_state: prepared.state,
            p_projection: prepared.projection,
            p_status: prepared.status,
            p_turn_deadline_at: prepared.deadline,
            p_action_events: prepared.actionEvents,
          })
          .single();
        if (error && data?.applied !== false) {
  throw new Error(error.message ?? "okey_next_round_commit_failed");
}
if (!data) {
  throw new Error(error?.message ?? "okey_next_round_commit_failed");
}
        return data as OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
      },
      advance: async (committed) => {
        const advancedState = committed.state ?? nextState;
        if (advancedState.matchFinished && advancedState.matchWinnerTeamId && options.client?.rpc) {
          try {
            await options.client.rpc("okey_settle_match", {
              p_match_id: options.matchId,
              p_winner_team_id: advancedState.matchWinnerTeamId,
            });
          } catch {
            // Settle recovery will safely retry idempotently during snapshot if needed
          }
        }
        return {
          ...committed,
          state: advancedState,
          turn_deadline_at: committed.turn_deadline_at ?? deadline,
          action_events: committed.action_events ?? [],
        };
      },
      broadcast: options.broadcastStateUpdate
        ? async (committed) => {
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
              console.error("Okey next-round broadcast failed", broadcastError);
            }
          }
        : undefined,
    });

    const committed = turnResult.committed;
    if (committed.applied === false) {
      return {
        state: options.state,
        version: options.version,
        turnDeadlineAt: null,
        executed: false,
        actionEvents: [],
      };
    }

    return {
      state: committed.state,
      version: Number(committed.version),
      turnDeadlineAt: committed.turn_deadline_at ?? deadline,
      executed: true,
      actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
    };
  } catch (error) {
    throw error;
  }
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
  const allActionEvents: OkeyActionEvent[] = [];
  let executedEliminatedCount = 0;
  let botProcessed = false;
  let executedTimeoutCount = 0;
  let executedNextRoundCount = 0;

  const initialBundle: OkeyAuthoritativeSnapshotBundle = {
    state: options.state,
    version: options.version,
    turn_deadline_at: options.turnDeadlineAt,
  };

  const lifecycle = await runAuthoritativeOkeyLifecycle(initialBundle, {
    now: getNow,
    maxTransitions: options.maxTransitions ?? 2,
    executeTransition: async (decision, currentBundle) =>
      executeAuthoritativeOkeyLifecycleDecision(decision, currentBundle, {
        eliminatedTurn: async (_decision, bundle) => {
          const result = await reconcileAuthoritativeEliminatedTurns({
            client: options.client,
            matchId: options.matchId,
            state: bundle.state as OkeyAuthoritativeMatchState,
            version: Number(bundle.version),
            turnDeadlineAt: bundle.turn_deadline_at,
            broadcastStateUpdate: options.broadcastStateUpdate,
            deterministicCommandId: options.deterministicCommandId,
            now: getNow,
            maxIterations: 1,
          });
          if (result.executedCount === 0) return null;
          executedEliminatedCount += result.executedCount;
          allActionEvents.push(...result.actionEvents);
          return { state: result.state, version: result.version, turn_deadline_at: result.turnDeadlineAt };
        },
        botTurn: async (botDecision, bundle) => {
          if (!botDecision.ready) return null;
          const requesterId = options.requesterUserId || botDecision.expectedActorId;
          const result = await executeOkeyBotTurn(
            {
              matchId: options.matchId,
              requesterUserId: requesterId,
              expectedVersion: botDecision.expectedVersion,
              expectedActorId: botDecision.expectedActorId,
            },
            {
              client: options.client,
              deterministicCommandId: options.deterministicCommandId ??
                (async (src: string) => generateOkeyReconcilerCommandId(options.matchId, "bot", Number(bundle.version), src)),
              now: getNow,
              broadcastStateUpdate: options.broadcastStateUpdate,
            },
          );
          if (!result.ok || !result.processed || !result.finalVersion) return null;
          botProcessed = true;

          const { data: bundleRaw } = await options.client.rpc("okey_get_authoritative_bundle", {
            p_match_id: options.matchId,
            p_user_id: requesterId,
            p_command_id: null,
          }).single();
          if (!bundleRaw) return null;
          return {
            state: bundleRaw.state as OkeyAuthoritativeMatchState,
            version: Number(bundleRaw.version),
            turn_deadline_at: bundleRaw.turn_deadline_at as string | null,
          };
        },
        expiredHumanTurn: async (_decision, bundle) => {
          const result = await reconcileAuthoritativeTimeoutTurn({
            client: options.client,
            matchId: options.matchId,
            state: bundle.state as OkeyAuthoritativeMatchState,
            version: Number(bundle.version),
            turnDeadlineAt: bundle.turn_deadline_at,
            broadcastStateUpdate: options.broadcastStateUpdate,
            deterministicCommandId: options.deterministicCommandId,
            now: getNow,
          });
          if (!result.executed) return null;
          executedTimeoutCount += 1;
          allActionEvents.push(...result.actionEvents);
          return { state: result.state, version: result.version, turn_deadline_at: result.turnDeadlineAt };
        },
        dueNextRound: async (_decision, bundle) => {
          const result = await reconcileAuthoritativeNextRound({
            client: options.client,
            matchId: options.matchId,
            requesterUserId: options.requesterUserId,
            state: bundle.state as OkeyAuthoritativeMatchState,
            version: Number(bundle.version),
            broadcastStateUpdate: options.broadcastStateUpdate,
            deterministicCommandId: options.deterministicCommandId,
            now: getNow,
          });
          if (!result.executed) return null;
          executedNextRoundCount += 1;
          allActionEvents.push(...result.actionEvents);
          return { state: result.state, version: result.version, turn_deadline_at: result.turnDeadlineAt };
        },
      }),
  });

  return {
    state: lifecycle.finalBundle.state as OkeyAuthoritativeMatchState,
    version: Number(lifecycle.finalBundle.version),
    turnDeadlineAt: lifecycle.finalBundle.turn_deadline_at,
    executedEliminatedCount,
    botProcessed,
    executedTimeoutCount,
    executedNextRoundCount,
    actionEvents: allActionEvents,
  };
}

export type OkeyServerLifecycleWakeupOptions = {
  client: any;
  matchId: string;
  requesterUserId?: string;
  initialState?: OkeyAuthoritativeMatchState;
  initialVersion?: number;
  eligibleAt?: string | null;
  turnDeadlineAt?: string | null;
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
    | "timeout_executed"
    | "bot_executed"
    | "eliminated_executed"
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
    options.maxRetryDurationMs ?? (OKEY_SERVER_ROUND_TRANSITION_DELAY_MS + 5_000),
  );
  const retryIntervalMs = Math.max(10, options.retryIntervalMs ?? 500);
  const matchId = options.matchId;
  const requesterUserId = options.requesterUserId ?? "server-lifecycle-wake-up";

  let currentState: OkeyAuthoritativeMatchState | null = options.initialState ?? null;
  let currentVersion: number | null = options.initialVersion !== undefined ? Number(options.initialVersion) : null;
  let currentDeadline: string | null = options.turnDeadlineAt ?? null;

  if (!currentState || currentVersion === null) {
    const { data: initialBundle } = await options.client
      .rpc("okey_get_authoritative_bundle", {
        p_match_id: matchId,
        p_user_id: requesterUserId,
        p_command_id: null,
      })
      .single();

    if (initialBundle) {
      currentState = initialBundle.state as OkeyAuthoritativeMatchState;
      currentVersion = Number(initialBundle.version);
      currentDeadline = initialBundle.turn_deadline_at as string | null;
    }
  }

  if (
    options.initialVersion !== undefined &&
    currentVersion !== null &&
    currentVersion !== Number(options.initialVersion)
  ) {
    return {
      ok: true,
      executed: false,
      state: currentState,
      version: currentVersion,
      attempts: 0,
      reason: "already_transitioned",
    };
  }

  // Step 1: Wait for eligibleAt (minimum 3 seconds delay)
  const currentPlayer = currentState?.roundState.players[currentState.roundState.currentPlayerIndex] ?? null;
  const currentPlayerIsBot = currentPlayer ? isOkeyBotControlled(currentPlayer) : false;
  const botNotBefore = currentPlayerIsBot ? currentState?.roundStartsAt ?? null : null;
  const isTurnTimeoutWakeup = Boolean(
    options.turnDeadlineAt ||
    (!options.eligibleAt && !currentPlayerIsBot && currentDeadline),
  );
  const isNextRoundWakeup = Boolean(options.eligibleAt || currentState?.roundState.phase === "finished");
  const targetDeadline =
    options.eligibleAt ??
    options.turnDeadlineAt ??
    (currentState?.roundState.phase === "finished"
      ? currentState?.nextRoundEligibleAt
      : currentPlayerIsBot
        ? botNotBefore
        : currentDeadline);
  const eligibleAt = targetDeadline;
  let refreshAfterInitialSleep = false;
  if (eligibleAt) {
    const eligibleAtMs = Date.parse(eligibleAt);
    if (Number.isFinite(eligibleAtMs)) {
      const initialDelay = Math.max(0, eligibleAtMs - getNow());
      if (initialDelay > 0) {
        await sleep(initialDelay);
        refreshAfterInitialSleep = true;
      }
    }
  }

  const retryStartTime = getNow();
  let attempts = 0;

  // Step 2 & 3: Run Reconciler and retry up to maxDurationMs (8 seconds)
  while (getNow() - retryStartTime <= maxDurationMs) {
    attempts += 1;





    if (refreshAfterInitialSleep || attempts > 1 || !currentState || currentVersion === null) {
      const { data: bundleRaw, error: bundleError } = await options.client
        .rpc("okey_get_authoritative_bundle", {
          p_match_id: matchId,
          p_user_id: requesterUserId,
          p_command_id: null,
        })
        .single();

      if (bundleError || !bundleRaw) {
        if (getNow() - retryStartTime + retryIntervalMs <= maxDurationMs) {
          await sleep(retryIntervalMs);
          continue;
        }
        break;
      }

      currentState = bundleRaw.state as OkeyAuthoritativeMatchState;
      currentVersion = Number(bundleRaw.version);
      currentDeadline = bundleRaw.turn_deadline_at as string | null;
      refreshAfterInitialSleep = false;
    }

    if (!currentState || currentVersion === null) {
      break;
    }

    if (
      options.initialVersion !== undefined &&
      currentVersion !== Number(options.initialVersion)
    ) {
      return {
        ok: true,
        executed: false,
        state: currentState,
        version: currentVersion,
        attempts,
        reason: "already_transitioned",
      };
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

    if (isNextRoundWakeup && currentState.roundState.phase !== "finished") {
      return {
        ok: true,
        executed: false,
        state: currentState,
        version: currentVersion,
        attempts,
        reason: "already_transitioned",
      };
    }

    if (isTurnTimeoutWakeup && options.initialVersion !== undefined && currentVersion > options.initialVersion) {
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

    if (reconcileResult.executedTimeoutCount > 0) {
      return {
        ok: true,
        executed: true,
        state: reconcileResult.state,
        version: reconcileResult.version,
        attempts,
        reason: "timeout_executed",
      };
    }

    if (reconcileResult.botProcessed) {
      return {
        ok: true,
        executed: true,
        state: reconcileResult.state,
        version: reconcileResult.version,
        attempts,
        reason: "bot_executed",
      };
    }

    if (reconcileResult.executedEliminatedCount > 0) {
      return {
        ok: true,
        executed: true,
        state: reconcileResult.state,
        version: reconcileResult.version,
        attempts,
        reason: "eliminated_executed",
      };
    }

    if (
      reconcileResult.executedNextRoundCount > 0 ||
      (isNextRoundWakeup && reconcileResult.state.roundState.phase !== "finished") ||
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

    const elapsed = getNow() - retryStartTime;
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
      if (!state.matchFinished) {
        if (state.roundState.phase === "finished") {
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
        } else if (isTurnTimeoutWakeup && (options.initialVersion === undefined || ver <= options.initialVersion)) {
          const finalReconcile = await reconcileAuthoritativeServerTurns({
            client: options.client,
            matchId,
            requesterUserId,
            state,
            version: ver,
            turnDeadlineAt: finalBundle.turn_deadline_at as string | null,
            broadcastStateUpdate: options.broadcastStateUpdate,
            deterministicCommandId: options.deterministicCommandId,
            now: getNow,
          });

          if (finalReconcile.executedTimeoutCount > 0) {
            return {
              ok: true,
              executed: true,
              state: finalReconcile.state,
              version: finalReconcile.version,
              attempts: attempts + 1,
              reason: "timeout_executed",
            };
          }
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

export const reconcileAuthoritativeServerScheduler = reconcileAuthoritativeServerLifecycleWakeup;

