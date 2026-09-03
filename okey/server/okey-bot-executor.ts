import { createBotTurnClaim, classifyBotTurnClaim } from "../../lib/multiplayer/core/bot-turn-orchestration.ts";
import { projectSeatOwnership } from "../../lib/multiplayer/core/seat-ownership.ts";
import { chooseBotDrawSource, prepareBotTurn } from "../engine/okey-bot-engine.ts";
import { discardTile, drawTile } from "../engine/okey-engine.ts";
import {
  createBotPostDrawActionEvents,
  type OkeyActionEvent,
  type OkeyActionEventDraft,
} from "./okey-action-events.ts";
import {
  getNextOkeyMatchTurnDeadline,
  projectOkeyMatchPublicState,
  settleAuthoritativeOkeyRound,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
} from "./okey-authoritative.ts";

type OkeyAuthoritativeBundle = {
  version: number | string;
  status: "playing" | "finished";
  turn_deadline_at: string | null;
  player_index: number;
  state: OkeyAuthoritativeMatchState;
  command_applied: boolean;
};

export type OkeyBotExecutorResult = {
  ok: boolean;
  processed: boolean;
  reason?: string;
  step?: "draw" | "discard";
  steps?: ("draw" | "discard")[];
  finalVersion?: number;
  error?: string;
};

export type OkeyBotExecutorInput = {
  matchId: string;
  requesterUserId: string;
  expectedVersion: number;
  expectedActorId: string;
};

export type OkeyBotExecutorDependencies = {
  client: any;
  deterministicCommandId: (source: string) => Promise<string>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  broadcastStateUpdate?: (input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  }) => Promise<void>;
  dispatchContinuation?: (input: {
    matchId: string;
    state: OkeyAuthoritativeMatchState;
    version: number;
  }) => Promise<boolean | void>;
  dispatchLifecycleWakeup?: (input: {
    matchId: string;
    state: OkeyAuthoritativeMatchState;
    version: number;
    eligibleAt: string;
  }) => Promise<void>;
};

const MAX_BOT_TRANSITIONS_PER_INVOCATION = 1;

async function defaultBroadcast(
  client: any,
  input: {
    matchId: string;
    commandId: string;
    version: number;
    publicProjection: OkeyMatchServerProjection;
    actionEvents: OkeyActionEvent[];
  },
) {
  const channel = client.channel(`okey-match:${input.matchId}`);
  await channel.send({
    type: "broadcast",
    event: "state_update",
    payload: {
      matchId: input.matchId,
      commandId: input.commandId,
      version: input.version,
      publicProjection: input.publicProjection,
      actionEvents: input.actionEvents,
    },
  });
  await client.removeChannel(channel);
}

export async function executeOkeyBotTurn(
  input: OkeyBotExecutorInput,
  dependencies: OkeyBotExecutorDependencies,
): Promise<OkeyBotExecutorResult> {
  const { client } = dependencies;
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? ((milliseconds) =>
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)));

  try {
    const { data: bundleRaw, error: bundleError } = await client
      .rpc("okey_get_authoritative_bundle", {
        p_match_id: input.matchId,
        p_user_id: input.requesterUserId,
        p_command_id: null,
      })
      .single();

    const bundle = bundleRaw as OkeyAuthoritativeBundle | null;
    if (bundleError || !bundle) {
      return { ok: true, processed: false, reason: "match_not_found_or_forbidden" };
    }
    if (bundle.status !== "playing") {
      return { ok: true, processed: false, reason: "match_not_playing" };
    }

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

    let currentState = bundle.state;
    const roundStartsAtMs = Date.parse(currentState.roundStartsAt ?? "");
    const roundStartWaitMs = Number.isFinite(roundStartsAtMs)
      ? Math.max(0, roundStartsAtMs - now())
      : 0;
    if (roundStartWaitMs > 0) await wait(roundStartWaitMs);
    if (currentState.matchFinished) {
      return { ok: true, processed: false, reason: "match_finished" };
    }

    let currentVersion = Number(bundle.version);
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
      return { ok: true, processed: false, reason: "invalid_version" };
    }
    if (currentVersion !== input.expectedVersion) {
      return { ok: true, processed: false, reason: "stale_bot_turn" };
    }

    const steps: ("draw" | "discard")[] = [];
    const completed = (reason: string): OkeyBotExecutorResult => steps.length > 0
      ? {
          ok: true,
          processed: true,
          step: steps[0],
          steps,
          finalVersion: currentVersion,
          reason,
        }
      : { ok: true, processed: false, reason };

    while (steps.length < MAX_BOT_TRANSITIONS_PER_INVOCATION) {
      if (currentState.matchFinished) return completed("match_finished");
if (currentState.roundState.phase !== "playing") {
  return completed("round_finished");
}

      const currentPlayerIndex = currentState.roundState.currentPlayerIndex;
      const currentPlayer = currentState.roundState.players[currentPlayerIndex];
      const ownership = currentPlayer
        ? projectSeatOwnership({
            seatId: String(currentPlayerIndex),
            ownerPlayerId: currentPlayer.id,
            controlledByBot: currentPlayer.controlledByBot === true,
          })
        : null;

      if (steps.length === 0) {
        if (currentPlayer?.id !== input.expectedActorId) {
          return { ok: true, processed: false, reason: "stale_bot_turn" };
        }
        const observedClaim = createBotTurnClaim({
          version: input.expectedVersion,
          actorId: input.expectedActorId,
          ownership: ownership?.ownerPlayerId === input.expectedActorId ? ownership : null,
        });
        if (!observedClaim) {
          return {
            ok: true,
            processed: false,
            reason: ownership?.controller === "bot" ? "stale_bot_turn" : "current_player_is_human",
          };
        }
        const disposition = classifyBotTurnClaim({
          claim: observedClaim,
          currentVersion,
          currentActorId: currentPlayer.id,
          currentOwnership: ownership,
        });
        if (disposition === "already_processed" || disposition === "stale") {
          return { ok: true, processed: false, reason: "stale_bot_turn" };
        }
        if (disposition === "human_controlled") {
          return { ok: true, processed: false, reason: "current_player_is_human" };
        }
      } else if (!currentPlayer || ownership?.controller !== "bot") {
        return completed("human_turn");
      }

      if (!currentPlayer) return completed("turn_player_not_found");

      const botStep = currentState.roundState.hasDrawnThisTurn ? "discard" : "draw";
      const botOptions = { difficulty: currentPlayer.botDifficulty ?? "normal" } as const;
      let actionEventDrafts: OkeyActionEventDraft[];
      let nextRoundState;

      if (botStep === "draw") {
        const source = chooseBotDrawSource(currentState.roundState, botOptions);
        nextRoundState = drawTile(currentState.roundState, source);
        actionEventDrafts = [{
          type: "draw",
          actorPlayerId: currentPlayer.id,
          payload: {
            source,
            ...(source === "discard"
              ? { tile: currentState.roundState.discardPile.at(-1) ?? null }
              : {}),
          },
        }];
      } else {
        const prepared = prepareBotTurn(currentState.roundState, botOptions);
        nextRoundState = prepared.discardTileId
          ? discardTile(prepared.state, prepared.discardTileId)
          : prepared.state;
        const discardedTile = prepared.discardTileId
          ? prepared.state.players[currentPlayerIndex]?.hand.find(
              (tile) => tile.id === prepared.discardTileId,
            ) ?? null
          : null;
        const konkanRunIds = new Set(prepared.decision.konkanRunTileIds);
        const konkanActorHand = prepared.state.players[currentPlayerIndex]?.hand ?? [];
        actionEventDrafts = createBotPostDrawActionEvents({
          actorPlayerId: currentPlayer.id,
          openedMelds: prepared.decision.opened
            ? prepared.state.players[currentPlayerIndex]?.melds
            : undefined,
          openedScore: prepared.state.players[currentPlayerIndex]?.scoreOpened,
          spentTileIds: prepared.decision.spentTileIds,
          declaredKonkan: prepared.decision.declaredKonkan,
          discardedTile,
          konkanRunTiles: prepared.decision.konkanRunTileIds
            .map((tileId) => konkanActorHand.find((tile) => tile.id === tileId))
            .filter((tile): tile is NonNullable<typeof tile> => !!tile),
          konkanCompletionMeldTiles: prepared.decision.declaredKonkan
            ? konkanActorHand.filter((tile) => !konkanRunIds.has(tile.id))
            : [],
        });
      }

      if (nextRoundState === currentState.roundState) {
        return completed(`bot_${botStep}_rejected`);
      }

      const nextState = settleAuthoritativeOkeyRound({
        ...currentState,
        roundState: nextRoundState,
      });
      const nextVersion = currentVersion + 1;
      const deadline = getNextOkeyMatchTurnDeadline(nextState);
      const commandId = await dependencies.deterministicCommandId(
        `okey:${input.matchId}:system-bot-${botStep}:${currentVersion}`,
      );
      const publicProjection = projectOkeyMatchPublicState(
        nextState,
        nextVersion,
        deadline,
      );
      const { data: commit, error: commitError } = await client
        .rpc("okey_commit_authoritative_action", {
          p_match_id: input.matchId,
          p_user_id: currentPlayer.id,
          p_command_id: commandId,
          p_expected_version: currentVersion,
          p_command_type: `system-bot-${botStep}`,
          p_state: nextState,
          p_projection: publicProjection,
          p_status: nextState.matchFinished ? "finished" : "playing",
          p_turn_deadline_at: deadline,
          p_action_events: actionEventDrafts,
        })
        .single();

      if (commitError || !commit) {
        if (commitError?.message?.includes("version_conflict")) {
          return completed("stale_bot_controller");
        }
        throw new Error(commitError?.message ?? "okey_bot_commit_failed");
      }
      if ((commit as { applied?: boolean }).applied === false) {
        return completed("already_processed");
      }

      const committedVersion = Number((commit as { version: number }).version);
      if (!Number.isSafeInteger(committedVersion) || committedVersion !== nextVersion) {
        throw new Error("okey_bot_commit_version_mismatch");
      }
      const committedDeadline = (commit as { turn_deadline_at?: string | null }).turn_deadline_at ?? deadline;
      const committedState = (commit as { state?: OkeyAuthoritativeMatchState }).state ?? nextState;
      const committedPublicProjection = projectOkeyMatchPublicState(
        committedState,
        committedVersion,
        committedDeadline,
      );
      const actionEvents = (commit as { action_events?: OkeyActionEvent[] }).action_events ?? [];
      try {
        await (dependencies.broadcastStateUpdate
            ? dependencies.broadcastStateUpdate({
              matchId: input.matchId,
              commandId,
              version: committedVersion,
              publicProjection: committedPublicProjection,
              actionEvents,
            })
            : defaultBroadcast(client, {
              matchId: input.matchId,
              commandId,
              version: committedVersion,
              publicProjection: committedPublicProjection,
              actionEvents,
            }));
      } catch (broadcastError) {
        console.error(`Okey bot broadcast failed for ${input.matchId}`, broadcastError);
      }

      steps.push(botStep);
      currentState = committedState;
      currentVersion = committedVersion;

      if (currentState.matchFinished) {
        const winnerTeamId = currentState.matchWinnerTeamId;
        if (!winnerTeamId && currentState.leaveTerminationReason !== "no-humans") {
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
        return completed("match_finished");
      }

      if (currentState.roundState.phase === "finished") {
        if (currentState.nextRoundEligibleAt && dependencies.dispatchLifecycleWakeup) {
          try {
            await dependencies.dispatchLifecycleWakeup({
              matchId: input.matchId,
              state: currentState,
              version: currentVersion,
              eligibleAt: currentState.nextRoundEligibleAt,
            });
          } catch (wakeupError) {
            console.error(`Okey bot lifecycle wakeup dispatch failed for ${input.matchId}`, wakeupError);
          }
        }
        return completed("round_finished");
      }

      if (dependencies.dispatchContinuation) {
        const nextClaim = getOkeyBotTurnClaim(currentState, currentVersion);
        if (nextClaim) {
          try {
            await dependencies.dispatchContinuation({
              matchId: input.matchId,
              state: currentState,
              version: currentVersion,
            });
          } catch (continuationError) {
            console.error(`Okey bot continuation dispatch failed for ${input.matchId}`, continuationError);
          }
        }
      }
    }

    return completed("transition_committed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`process_bot_turns Okey failed for ${input.matchId}`, error);
    return { ok: false, processed: false, error: message };
  }
}

