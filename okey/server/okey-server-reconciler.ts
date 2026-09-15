import { isActiveOkeyPlayer, isEliminatedOkeyPlayer } from "../engine/okeyengine-eliminated.ts";
import {
    createForcedDrawDiscardEvents,
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
    reduceAuthoritativeOkeyTransition,
    type OkeyAuthoritativeSnapshotBundle,
    type OkeyAuthoritativeTransition,
    type OkeyLifecycleDecision,
    type OkeyTurnCommit,
} from "./okey-turn-engine.ts";

export {
    evaluateOkeyServerLifecycle,
    type OkeyAuthoritativeSnapshotBundle,
    type OkeyLifecycleDecision
} from "./okey-turn-engine.ts";

type OkeyBotReconcileResult = {
  ok: boolean;
  processed: boolean;
  reason?: string;
  step?: "draw" | "discard";
  steps?: ("draw" | "discard")[];
  finalVersion?: number;
  error?: string;
  state?: OkeyAuthoritativeMatchState;
  turnDeadlineAt?: string | null;
};

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

type OkeyBotReconcileInput = {
  matchId: string;
  requesterUserId: string;
  expectedVersion: number;
  expectedActorId: string;
  preloadedBundle?: {
    status: string;
    version: number;
    state: OkeyAuthoritativeMatchState;
    turn_deadline_at: string | null;
  };
  preloadedDecision?: Extract<OkeyLifecycleDecision, { type: "bot-turn" }>;
};

type OkeyBotReconcileDependencies = {
  client: any;
  deterministicCommandId: (source: string) => Promise<string>;
  now?: () => number;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  scheduleLifecycleAlarm?: (input: {
    matchId: string;
    state: OkeyAuthoritativeMatchState;
    version: number;
    runAt: string;
  }) => Promise<void>;
};

async function broadcastOkeyBotState(
  client: any,
  payload: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  },
) {
  if (typeof client?.channel !== "function") return;
  const channel = client.channel(`okey-match:${payload.matchId}`);
  await channel.send({ type: "broadcast", event: "state_update", payload });
  if (typeof client?.removeChannel === "function") {
    await client.removeChannel(channel);
  }
}

type OkeyAuthoritativeExecutionInput = {
  client: any;
  state: OkeyAuthoritativeMatchState;
  transition?: OkeyAuthoritativeTransition<
    OkeyAuthoritativeCommand,
    OkeyAuthoritativeMatchState["roundState"]
  >;
  preReducedState?: OkeyAuthoritativeMatchState;
  transitionNow: number;
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

/** Private execution path shared by every authoritative turn controller. */
async function executeOkeyAuthoritativePipeline(
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
/** Central lifecycle-owned execution of one authoritative Bot transition. */
export async function reconcileAuthoritativeBotTurn(
  input: OkeyBotReconcileInput,
  dependencies: OkeyBotReconcileDependencies,
): Promise<OkeyBotReconcileResult> {
  const { client } = dependencies;
  const now = dependencies.now ?? Date.now;
  try {
    const bundle = input.preloadedBundle ?? (await (async () => {
      const { data, error } = await client
        .rpc("okey_get_authoritative_bundle", {
          p_match_id: input.matchId,
          p_user_id: input.requesterUserId,
          p_command_id: null,
        })
        .single();
      if (error || !data) return null;
      return data;
    })());
    if (!bundle) {
      return { ok: true, processed: false, reason: "match_not_found_or_forbidden" };
    }
    if (bundle.status !== "playing") {
      return { ok: true, processed: false, reason: "match_not_playing" };
    }

    const currentVersion = Number(bundle.version);
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
      return { ok: true, processed: false, reason: "invalid_version" };
    }
    if (currentVersion !== input.expectedVersion) {
      return { ok: true, processed: false, reason: "stale_bot_turn" };
    }

    const currentState = bundle.state as OkeyAuthoritativeMatchState;
    if (currentState.matchFinished) {
      return { ok: true, processed: false, reason: "match_finished" };
    }
    const decision = input.preloadedDecision ?? evaluateOkeyServerLifecycle({
      state: currentState,
      version: currentVersion,
      turn_deadline_at: bundle.turn_deadline_at as string | null,
    }, now());
    if (decision.type !== "bot-turn") {
      return {
        ok: true,
        processed: false,
        reason: decision.type === "idle" && decision.reason === "waiting_for_human_action"
          ? "current_player_is_human"
          : "stale_bot_turn",
      };
    }
    if (decision.expectedActorId !== input.expectedActorId) {
      return { ok: true, processed: false, reason: "stale_bot_turn" };
    }
    if (!decision.ready) {
      return {
        ok: true,
        processed: false,
        reason: decision.notBefore
          ? "bot_transition_not_eligible"
          : "bot_transition_invalid_eligibility",
      };
    }

    const intent = selectOkeyBotIntent({
      state: currentState.roundState,
      expectedActorId: decision.expectedActorId,
      step: decision.step,
      now: now(),
    });
    if (!intent) {
      return { ok: true, processed: false, reason: `bot_${decision.step}_rejected` };
    }

    const transitionNow = now();

    const { data: runtimeMatch, error: runtimeMatchError } = await client
      .schema("okey")
      .from("matches")
      .select("is_test")
      .eq("id", input.matchId)
      .maybeSingle();
    if (runtimeMatchError || !runtimeMatch) {
      throw new Error("okey_match_runtime_lookup_failed");
    }
    const isTestMatch = runtimeMatch.is_test === true;
    const nextVersion = currentVersion + 1;
    const commandType = `system-bot-${intent.step}`;
    const execution = await executeOkeyAuthoritativePipeline({
      client,
      state: currentState,
      transition: { type: "bot-action", roundState: intent.roundState },
      transitionNow,
      matchId: input.matchId,
      actorPlayerId: intent.actorPlayerId,
      commandId: () => dependencies.deterministicCommandId(
        `okey:${input.matchId}:${commandType}:${currentVersion}`,
      ),
      commandType,
      expectedVersion: currentVersion,
      resolveDeadline: (nextState) => getNextOkeyMatchTurnDeadline(nextState, now()),
      createActionEvents: () => intent.actionEvents,
      versionConflictResult: {
        applied: false,
        version: currentVersion,
        state: currentState,
        turn_deadline_at: bundle.turn_deadline_at as string | null,
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
        const { error: settlementError } = isTestMatch
          ? await client.schema("okey").from("matches").update({
              settlement_at: new Date(now()).toISOString(),
              settlement: { type: "test", economyApplied: false, winnerTeamId },
            }).eq("id", input.matchId).eq("is_test", true).is("settlement_at", null)
          : await client.rpc("okey_settle_match", {
              p_match_id: input.matchId,
              p_winner_team_id: winnerTeamId,
            });
        if (settlementError) {
          throw new Error(`okey_bot_settlement_failed: ${settlementError.message}`);
        }
      },
      broadcast: dependencies.broadcastStateUpdate ??
        ((payload) => broadcastOkeyBotState(client, payload)),
      broadcastFailureMessage: `Okey bot broadcast failed for ${input.matchId}`,
    });
    const committed = execution.committed;
    if (committed.applied === false) {
      return { ok: true, processed: false, reason: committed.rejectionReason ?? "already_processed" };
    }
    if (Number(committed.version) !== nextVersion) {
      throw new Error("okey_bot_commit_version_mismatch");
    }
    const committedState = committed.state;
    const committedDeadline = committed.turn_deadline_at ?? execution.deadline;
    const immediateBotRunAt = getOkeyLifecycleRunAt(committedState, committedDeadline, now());
    const currentPlayer = committedState.roundState.players[committedState.roundState.currentPlayerIndex];
    if (immediateBotRunAt &&
        currentPlayer && (currentPlayer.controlledByBot === true || currentPlayer.kind === 'bot') &&
        dependencies.scheduleLifecycleAlarm) {
      try {
        await dependencies.scheduleLifecycleAlarm({
          matchId: input.matchId,
          state: committedState,
          version: nextVersion,
          runAt: immediateBotRunAt,
        });
      } catch (error) {
        console.error(`Okey immediate bot lifecycle alarm scheduling failed for ${input.matchId}`, error);
      }
    }

    if (!committedState.matchFinished && committedState.roundState.phase === "finished") {
      if (committedState.nextRoundEligibleAt && dependencies.scheduleLifecycleAlarm) {
        try {
          await dependencies.scheduleLifecycleAlarm({
            matchId: input.matchId,
            state: committedState,
            version: nextVersion,
            runAt: committedState.nextRoundEligibleAt,
          });
        } catch (error) {
          console.error(`Okey bot lifecycle alarm scheduling failed for ${input.matchId}`, error);
        }
      }
    } else if (!committedState.matchFinished) {
      if (committedDeadline && dependencies.scheduleLifecycleAlarm) {
        try {
          await dependencies.scheduleLifecycleAlarm({
            matchId: input.matchId,
            state: committedState,
            version: nextVersion,
            runAt: committedDeadline,
          });
        } catch (error) {
          console.error(`Okey bot human-timeout lifecycle alarm scheduling failed for ${input.matchId}`, error);
        }
      }
    }

    return {
      ok: true,
      processed: true,
      step: intent.step,
      steps: [intent.step],
      finalVersion: nextVersion,
      state: committedState,
      turnDeadlineAt: committedDeadline,
      reason: committedState.matchFinished
        ? "match_finished"
        : committedState.roundState.phase === "finished"
          ? "round_finished"
          : "transition_committed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`process_bot_turns Okey failed for ${input.matchId}`, error);
    return { ok: false, processed: false, error: message };
  }
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
  isTestMatch: boolean;
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
  isTestMatch: boolean;
  now: () => number;
}): Promise<{ settlement: unknown; error: Error | null }> {
  if (!input.state.matchFinished) return { settlement: null, error: null };
  if (input.isTestMatch) {
    const settlement = {
      type: "test",
      economyApplied: false,
      winnerTeamId: input.state.matchWinnerTeamId,
    };
    const { error } = await input.client.schema("okey").from("matches").update({
      settlement_at: new Date(input.now()).toISOString(),
      settlement,
    }).eq("id", input.matchId).eq("is_test", true).is("settlement_at", null);
    return { settlement, error: error ? new Error(error.message) : null };
  }

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
      isTestMatch: input.isTestMatch,
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
        Date.parse(workingBundle.turn_deadline_at) <= now()) {
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
          gameplayEvents = input.isTestMatch ? [] : deriveOkeyDailyQuestGameplayEvents(
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
            isTestMatch: input.isTestMatch,
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

type OkeyEliminatedReconcileResult = {
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

    const nextVersion = currentVersion + 1;
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
    if (committed.applied === false) break;
    const committedVersion = Number(committed.version);
    const committedDeadline = committed.turn_deadline_at ?? execution.deadline;
    const committedState = committed.state ?? execution.nextState;
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

type OkeyTimeoutReconcileResult = {
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

  let actorPlayerId = decision.expectedTurnPlayerId;
  const execution = await executeOkeyAuthoritativePipeline({
    client: options.client,
    state: options.state,
    transition: {
      type: "timeout",
      deadlineAt: decision.expectedTurnDeadlineAt,
    },
    transitionNow: getNow(),
    matchId: options.matchId,
    actorPlayerId: () => actorPlayerId,
    commandId: () => options.deterministicCommandId
      ? options.deterministicCommandId(
          `okey:${options.matchId}:system-timeout:${options.version}:${actorPlayerId}`,
        )
      : generateOkeyReconcilerCommandId(
          options.matchId,
          "system-timeout",
          options.version,
          actorPlayerId,
        ),
    commandType: "system-timeout",
    expectedVersion: options.version,
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
    turnDeadlineAt: committed.turn_deadline_at ?? execution.deadline,
    executed: true,
    actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
  };
}
type OkeyNextRoundReconcileResult = {
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

  let actorPlayerId = "system";
  let commandState = options.state;
  const commandType = finishingTeamForfeit ? "round-end-team-forfeit" : "start-next-round";
  const execution = await executeOkeyAuthoritativePipeline({
    client: options.client,
    state: options.state,
    transition: finishingTeamForfeit ? undefined : { type: "next-round" },
    preReducedState: finishingTeamForfeit
      ? settleAuthoritativeOkeyRound(options.state)
      : undefined,
    transitionNow: getNow(),
    matchId: options.matchId,
    actorPlayerId: () => actorPlayerId,
    commandId: () => options.deterministicCommandId
      ? options.deterministicCommandId(
          `okey:${options.matchId}:${commandType}:${options.version}:${commandState.currentRound}`,
        )
      : generateOkeyReconcilerCommandId(
          options.matchId,
          commandType,
          options.version,
          String(commandState.currentRound),
        ),
    commandType,
    expectedVersion: options.version,
    resolveDeadline: (nextState) => {
      commandState = nextState;
      actorPlayerId = options.requesterUserId ||
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
    turnDeadlineAt: committed.turn_deadline_at ?? execution.deadline,
    executed: true,
    actionEvents: (committed.action_events ?? []) as OkeyActionEvent[],
  };
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

type OkeyServerReconcileResult = {
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
  initialDecision?: OkeyLifecycleDecision;
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

  const decision = options.initialDecision ?? evaluateOkeyServerLifecycle(initialBundle, getNow());
  if (decision.type === "idle" || decision.type === "terminal") {
    return {
      state: options.state,
      version: options.version,
      turnDeadlineAt: options.turnDeadlineAt,
      executedEliminatedCount: 0,
      botProcessed: false,
      executedTimeoutCount: 0,
      executedNextRoundCount: 0,
      actionEvents: [],
    };
  }

  let nextBundle: { state: OkeyAuthoritativeMatchState; version: number; turn_deadline_at: string | null } | null = null;

  switch (decision.type) {
    case "eliminated-turn": {
      const result = await reconcileAuthoritativeEliminatedTurns({
        client: options.client,
        matchId: options.matchId,
        state: options.state,
        version: options.version,
        turnDeadlineAt: options.turnDeadlineAt,
        broadcastStateUpdate: options.broadcastStateUpdate,
        deterministicCommandId: options.deterministicCommandId,
        now: getNow,
        maxIterations: 1,
      });
      if (result.executedCount > 0) {
        executedEliminatedCount = result.executedCount;
        allActionEvents.push(...result.actionEvents);
        nextBundle = { state: result.state, version: result.version, turn_deadline_at: result.turnDeadlineAt };
      }
      break;
    }
    case "bot-turn": {
      if (decision.ready) {
        const requesterId = options.requesterUserId || decision.expectedActorId;
        const result = await reconcileAuthoritativeBotTurn(
          {
            matchId: options.matchId,
            requesterUserId: requesterId,
            expectedVersion: decision.expectedVersion,
            expectedActorId: decision.expectedActorId,
            preloadedBundle: {
              status: "playing",
              version: options.version,
              state: options.state,
              turn_deadline_at: options.turnDeadlineAt,
            },
            preloadedDecision: decision,
          },
          {
            client: options.client,
            deterministicCommandId: options.deterministicCommandId ??
              (async (src: string) => generateOkeyReconcilerCommandId(options.matchId, "bot", options.version, src)),
            now: getNow,
            broadcastStateUpdate: options.broadcastStateUpdate,
          },
        );
        if (result.ok && result.processed && result.finalVersion && result.state) {
          botProcessed = true;
          nextBundle = {
            state: result.state,
            version: result.finalVersion,
            turn_deadline_at: result.turnDeadlineAt ?? null,
          };
        }
      }
      break;
    }
    case "expired-human-turn": {
      const result = await reconcileAuthoritativeTimeoutTurn({
        client: options.client,
        matchId: options.matchId,
        state: options.state,
        version: options.version,
        turnDeadlineAt: options.turnDeadlineAt,
        broadcastStateUpdate: options.broadcastStateUpdate,
        deterministicCommandId: options.deterministicCommandId,
        now: getNow,
      });
      if (result.executed) {
        executedTimeoutCount = 1;
        allActionEvents.push(...result.actionEvents);
        nextBundle = { state: result.state, version: result.version, turn_deadline_at: result.turnDeadlineAt };
      }
      break;
    }
    case "due-next-round": {
      const result = await reconcileAuthoritativeNextRound({
        client: options.client,
        matchId: options.matchId,
        requesterUserId: options.requesterUserId,
        state: options.state,
        version: options.version,
        broadcastStateUpdate: options.broadcastStateUpdate,
        deterministicCommandId: options.deterministicCommandId,
        now: getNow,
      });
      if (result.executed) {
        executedNextRoundCount = 1;
        allActionEvents.push(...result.actionEvents);
        nextBundle = { state: result.state, version: result.version, turn_deadline_at: result.turnDeadlineAt };
      }
      break;
    }
  }

  return {
    state: nextBundle ? nextBundle.state : options.state,
    version: nextBundle ? nextBundle.version : options.version,
    turnDeadlineAt: nextBundle ? nextBundle.turn_deadline_at : options.turnDeadlineAt,
    executedEliminatedCount,
    botProcessed,
    executedTimeoutCount,
    executedNextRoundCount,
    actionEvents: allActionEvents,
  };
}

type OkeyServerLifecycleAlarmOptions = {
  client: any;
  matchId: string;
  requesterUserId: string;
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
    | "not_eligible"
    | "missing_requester_user_id";
};

/** One-shot executor: fetch latest bundle, validate due state, reconcile once. */
export async function reconcileAuthoritativeServerLifecycleAlarm(
  options: OkeyServerLifecycleAlarmOptions,
): Promise<OkeyServerLifecycleAlarmResult> {
  const getNow = options.now ?? Date.now;
  const matchId = options.matchId;
  const requesterUserId = options.requesterUserId;
  if (!requesterUserId) {
    return {
      ok: true,
      executed: false,
      state: null,
      version: null,
      attempts: 0,
      reason: "missing_requester_user_id",
    };
  }

  const { data: bundleRaw, error: bundleError } = await options.client
    .rpc("okey_get_authoritative_bundle", {
      p_match_id: matchId,
      p_user_id: requesterUserId,
      p_command_id: null,
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
  const decision = evaluateOkeyServerLifecycle({
    state,
    version,
    turn_deadline_at: turnDeadlineAt,
  }, getNow());
  const nextRunAt = decision.type === "bot-turn"
    ? decision.notBefore
    : decision.type === "idle"
      ? ("eligibleAt" in decision ? decision.eligibleAt : decision.turnDeadlineAt)
      : turnDeadlineAt;
  const requestedAt = options.runAt;
  const requestedAtMs = requestedAt ? Date.parse(requestedAt) : NaN;
  const isEarlyRequest = Number.isFinite(requestedAtMs) && getNow() < requestedAtMs;
  const isWaitingDecision = decision.type === "idle" ||
    (decision.type === "bot-turn" && !decision.ready);
  if (isEarlyRequest || isWaitingDecision) {
    return {
      ok: true,
      executed: false,
      ...baseResult,
      nextRunAt: nextRunAt ?? requestedAt ?? null,
      reason: "not_eligible",
    };
  }

  const reconciled = await reconcileAuthoritativeServerTurns({
    client: options.client,
    matchId,
    requesterUserId,
    state,
    version,
    turnDeadlineAt,
    broadcastStateUpdate: options.broadcastStateUpdate,
    deterministicCommandId: options.deterministicCommandId,
    now: getNow,
    initialDecision: decision,
  });
  const executed = reconciled.version !== version;
  if (!executed) {
    return {
      ok: true,
      executed: false,
      state: reconciled.state,
      version: reconciled.version,
      attempts: 1,
      turnDeadlineAt: reconciled.turnDeadlineAt,
      reason: "already_transitioned",
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

