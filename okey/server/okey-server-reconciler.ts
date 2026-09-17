import { isActiveOkeyPlayer, isEliminatedOkeyPlayer } from "../engine/okeyengine-eliminated.ts";
import {
    createOkeyCommandActionEvents,
    type OkeyActionEvent,
    type OkeyActionEventDraft,
} from "./okey-action-events.ts";
import { commitAuthoritativeOkeyAction } from "./okey-authoritative-commit-gateway.ts";
import {
    createAuthoritativeOkeyMatch,
    deriveOkeyDailyQuestGameplayEvents,
    getNextOkeyMatchTurnDeadline,
    getOkeyMatchTurnDeadlineAfterTransition,
    OKEY_AUTHORITATIVE_TRANSITION_REDUCERS,
    projectOkeyMatchPublicState,
    settleAuthoritativeOkeyRound,
    type OkeyAuthoritativeCommand,
    type OkeyAuthoritativeMatchState,
    type OkeyMatchServerProjection,
    type OkeyServerPlayerIdentity
} from "./okey-authoritative.ts";
import { selectOkeyBotIntent } from "./okey-bot-executor.ts";
import {
    evaluateOkeyServerLifecycle,
    executeOkeyAuthoritativePipeline,
    executeOkeyServerLifecycle,
    generateOkeyReconcilerCommandId,
    reduceAuthoritativeOkeyTransition,
    type OkeyAuthoritativeExecutionInput,
    type OkeyAuthoritativeSnapshotBundle,
    type OkeyAuthoritativeTransition,
    type OkeyLifecycleDecision,
    type OkeyServerLifecycleInput,
    type OkeyServerLifecycleResult,
    type OkeyTurnCommit,
} from "./okey-turn-engine.ts";

export {
    evaluateOkeyServerLifecycle,
    executeOkeyAuthoritativePipeline,
    executeOkeyServerLifecycle,
    generateOkeyReconcilerCommandId,
    reduceAuthoritativeOkeyTransition,
    type OkeyAuthoritativeExecutionInput,
    type OkeyAuthoritativeSnapshotBundle,
    type OkeyLifecycleDecision,
    type OkeyServerLifecycleInput,
    type OkeyServerLifecycleResult,
} from "./okey-turn-engine.ts";

/** Returns the next official lifecycle time. Bot ownership is immediate and never UI-paced. */
export function getOkeyLifecycleRunAt(
  state: OkeyAuthoritativeMatchState,
  turnDeadlineAt: string | null,
  nowMs: number,
): string | null {
  if (state.matchFinished) return null;
  if (state.roundState.phase === 'finished') return state.nextRoundEligibleAt ?? null;
  const currentPlayer = state.roundState.players[state.roundState.currentPlayerIndex];
  if (isEliminatedOkeyPlayer(currentPlayer)) return new Date(nowMs).toISOString();
  if (isActiveOkeyPlayer(currentPlayer) &&
      (currentPlayer.controlledByBot === true || currentPlayer.kind === 'bot')) {
    return new Date(nowMs).toISOString();
  }
  return turnDeadlineAt;
}

type OkeyHumanAuthoritativeBundle = {
  state: OkeyAuthoritativeMatchState;
  player_index: number;
  version: number;
  turn_deadline_at: string | null;
  command_applied: boolean;
};

type OkeyHumanCommandInput = {
  action: "command" | "manual-leave";
  matchId: string;
  actorUserId: string;
  commandId: string;
  command: OkeyAuthoritativeCommand | null;
  clientExpectedVersion: number | null;
  commandReceivedAtMs: number;
  bundle: OkeyHumanAuthoritativeBundle;
};

type OkeyHumanCommandResult =
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

type OkeyHumanCommandDependencies = {
  client: any;
  deterministicCommandId: (source: string) => Promise<string>;
  reloadManualLeaveBundle?: () => Promise<OkeyHumanAuthoritativeBundle | null>;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  now?: () => number;
  scheduleLifecycleAlarm?: (input: {
    matchId: string;
    state: OkeyAuthoritativeMatchState;
    version: number;
    runAt: string;
  }) => Promise<void>;
};

async function settleAuthoritativeOkeyMatchForViewer(input: {
  client: any;
  matchId: string;
  actorUserId: string;
  state: OkeyAuthoritativeMatchState;
  now: () => number;
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
  if (settlement && typeof settlement === "object" &&
      (settlement as { currency?: unknown }).currency === "fun") {
    const { data: rewardRow, error: rewardError } = await input.client
      .schema("okey").from("fun_match_rewards")
      .select("point_delta, gem_delta")
      .eq("match_id", input.matchId)
      .eq("user_id", input.actorUserId)
      .maybeSingle();
    if (rewardError) return { settlement: null, error: new Error(rewardError.message) };
    if (rewardRow) {
      playerReward = {
        pointDelta: Number(rewardRow.point_delta ?? 0),
        gemDelta: Number(rewardRow.gem_delta ?? 0),
      };
    }
  }
  return {
    settlement: settlement && typeof settlement === "object"
      ? { ...settlement, playerReward }
      : settlement,
    error: null,
  };
}

/** Owns the complete authoritative Human/Manual-Leave command lifecycle. */
export async function reconcileAuthoritativeHumanCommand(
  input: OkeyHumanCommandInput,
  dependencies: OkeyHumanCommandDependencies,
): Promise<OkeyHumanCommandResult> {
  const now = dependencies.now ?? Date.now;
  const initialState = input.bundle.state;
  if ((initialState.manualLeftPlayerIds ?? []).includes(input.actorUserId) &&
      !(input.action === "manual-leave" && input.bundle.command_applied)) {
    return { ok: false, error: "manual_leave_is_final", status: 403 };
  }

  if (input.bundle.command_applied) {
    const settled = await settleAuthoritativeOkeyMatchForViewer({
      client: dependencies.client,
      matchId: input.matchId,
      actorUserId: input.actorUserId,
      state: initialState,
      now,
    });
    if (settled.error) {
      console.error("Okey settlement recovery failed during duplicate", settled.error);
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

  if (input.action === "command" && input.clientExpectedVersion !== null &&
      input.clientExpectedVersion !== Number(input.bundle.version)) {
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
      const freshBundle = await dependencies.reloadManualLeaveBundle?.();
      if (!freshBundle) return { ok: false, error: "manual_leave_retry_fetch_failed", status: 409 };
      workingBundle = freshBundle;
      if (workingBundle.command_applied ||
          (workingBundle.state.manualLeftPlayerIds ?? []).includes(input.actorUserId)) {
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

    if (input.action === "command" && workingBundle.turn_deadline_at &&
        Date.parse(workingBundle.turn_deadline_at) <= input.commandReceivedAtMs) {
      return { ok: false, error: "turn_deadline_expired", status: 409 };
    }

    const workingState = workingBundle.state;
    const playerIndex = Number(workingBundle.player_index);
    const acceptedCommand = input.action === "manual-leave"
      ? { type: "manual-leave" as const }
      : input.command!;
    const commandType = acceptedCommand.type;
    const transition: OkeyAuthoritativeTransition<
      OkeyAuthoritativeCommand,
      OkeyAuthoritativeMatchState["roundState"]
    > = input.action === "manual-leave"
      ? { type: "manual-leave", actorPlayerIndex: playerIndex }
      : { type: "human-command", actorPlayerIndex: playerIndex, command: input.command! };
    const expectedVersion = input.action === "manual-leave"
      ? Number(workingBundle.version)
      : (input.clientExpectedVersion ?? Number(workingBundle.version));
    const nextVersion = expectedVersion + 1;
    const actingPlayer = workingState.roundState.players[workingState.roundState.currentPlayerIndex] ?? null;
    let gameplayEvents: ReturnType<typeof deriveOkeyDailyQuestGameplayEvents> = [];
    let committedSettlement: unknown = null;
    let committedBeforeSettlement: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent> | null = null;

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
        resolveDeadline: (nextState) => getOkeyMatchTurnDeadlineAfterTransition(
          workingState,
          nextState,
          workingBundle.turn_deadline_at,
        ),
        createActionEvents: (nextState) => {
          let actionEvents: OkeyActionEventDraft[] = acceptedCommand.type === "manual-leave"
            ? [{
                type: "leave",
                actorPlayerId: workingState.roundState.players[playerIndex]?.id ?? null,
                payload: {},
              }]
            : createOkeyCommandActionEvents(
                acceptedCommand,
                actingPlayer?.id ?? "",
                workingState.roundState,
              );
          const previousDiscard = workingState.roundState.discardPile.at(-1) ?? null;
          actionEvents = actionEvents.map((event) =>
            event.type === "draw" && event.payload.source === "discard" && previousDiscard
              ? { ...event, payload: { ...event.payload, tile: previousDiscard } }
              : event
          );
          const committedDiscard = nextState.roundState.discardPile.at(-1) ?? null;
          actionEvents = actionEvents.map((event) =>
            event.type === "discard" && committedDiscard
              ? { ...event, payload: { ...event.payload, tileId: committedDiscard.id, tile: committedDiscard } }
              : event
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
          const settled = await settleAuthoritativeOkeyMatchForViewer({
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
      if (!committed.state.matchFinished && dependencies.scheduleLifecycleAlarm) {
        await dependencies.scheduleLifecycleAlarm({
          matchId: input.matchId,
          state: committed.state,
          version: committed.version,
          runAt: getOkeyLifecycleRunAt(
            committed.state,
            committed.turn_deadline_at,
            now(),
          )!,
        });
      }
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
      if (input.action === "manual-leave" && conflict && attempt < maxCommitAttempts) continue;
      if (committedBeforeSettlement) {
        return {
          ok: false,
          error: "settlement_failed",
          status: 500,
          details,
          commit: committedBeforeSettlement,
        };
      }
      return { ok: false, error: conflict ? "version_conflict" : "commit_failed", status: conflict ? 409 : 500, details };
    }
  }
  return { ok: false, error: "manual_leave_retry_exhausted", status: 409 };
}

type OkeyMatchStartReconcileResult<TRoom = any> = {
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

type OkeyServerLifecycleAlarmOptions = {
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
  scheduleLifecycleAlarm?: (input: {
    matchId: string;
    state: OkeyAuthoritativeMatchState;
    version: number;
    runAt: string;
  }) => Promise<void>;
};

type OkeyServerLifecycleAlarmResult = {
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

/** One-shot executor: fetch latest bundle, validate due state, reconcile once via executeOkeyServerLifecycle. */
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
  const baseResult = { state, version, attempts: 1, turnDeadlineAt };

  if (options.initialVersion !== undefined && version !== Number(options.initialVersion)) {
    return { ok: true, executed: false, ...baseResult, reason: "already_transitioned" };
  }
  if (state.matchFinished) {
    return { ok: true, executed: false, ...baseResult, reason: "match_finished" };
  }

  const requestedAt = options.runAt;
  const requestedAtMs = requestedAt ? Date.parse(requestedAt) : NaN;
  if (Number.isFinite(requestedAtMs) && getNow() < requestedAtMs) {
    return {
      ok: true,
      executed: false,
      ...baseResult,
      nextRunAt: getOkeyLifecycleRunAt(state, turnDeadlineAt, getNow()) ?? requestedAt ?? null,
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
      nextRunAt: getOkeyLifecycleRunAt(reconciled.state, reconciled.turnDeadlineAt, getNow()),
      reason: reconciled.state.matchFinished ? "match_finished" : "not_eligible",
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

  const result: OkeyServerLifecycleAlarmResult = {
    ok: true,
    executed: true,
    state: reconciled.state,
    version: reconciled.version,
    attempts: 1,
    turnDeadlineAt: reconciled.turnDeadlineAt,
    reason,
  };

  if (!reconciled.state.matchFinished && options.scheduleLifecycleAlarm) {
    await options.scheduleLifecycleAlarm({
      matchId,
      state: reconciled.state,
      version: reconciled.version,
      runAt: getOkeyLifecycleRunAt(
        reconciled.state,
        reconciled.turnDeadlineAt,
        getNow(),
      )!,
    });
  }

  return result;
}

