import type { OkeyTurnCommit } from "../../lib/multiplayer/okey/okey-turn-engine.ts";
import type { OkeyActionEvent, OkeyActionEventDraft } from "./okey-action-events.ts";
import {
  projectOkeyMatchPublicState,
  type OkeyAuthoritativeMatchState,
  type OkeyMatchServerProjection,
} from "./okey-authoritative.ts";

export type OkeyAuthoritativeBroadcastPayload = {
  matchId: string;
  commandId: string;
  version: number;
  publicProjection: OkeyMatchServerProjection;
  actionEvents: OkeyActionEvent[];
};

type PreparedOkeyAuthoritativeCommit = {
  state: OkeyAuthoritativeMatchState;
  projection: OkeyMatchServerProjection;
  deadline: string | null;
  status: "playing" | "finished";
  actionEvents: OkeyActionEventDraft[];
};

type OkeyAuthoritativeCommitGatewayInput = {
  client: any;
  matchId: string;
  actorPlayerId: string;
  commandId: string;
  expectedVersion: number;
  commandType: string;
  prepared: PreparedOkeyAuthoritativeCommit;
  /** Presence selects the gameplay-event commit wrapper, including for an empty array. */
  gameplayEvents?: unknown;
  fallbackState?: OkeyAuthoritativeMatchState;
  fallbackDeadline?: string | null;
  versionConflictResult?: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
  acceptRejectedDataWithError?: boolean;
  commitFailureCode: string;
  afterCommit?: (
    committed: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>,
  ) => Promise<OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent> | void>;
  broadcast?: (payload: OkeyAuthoritativeBroadcastPayload) => Promise<void>;
  broadcastFailureMessage?: string;
};

/**
 * The shared persistence boundary for every authoritative Okey controller.
 *
 * It owns the atomic RPC contract (version CAS + state + projection + deadline
 * + action events), optional Human gameplay events, committed-value
 * normalization, and publication of committed state only.
 */
export async function commitAuthoritativeOkeyAction(
  input: OkeyAuthoritativeCommitGatewayInput,
): Promise<OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>> {
  const parameters = {
    p_match_id: input.matchId,
    p_user_id: input.actorPlayerId,
    p_command_id: input.commandId,
    p_expected_version: input.expectedVersion,
    p_command_type: input.commandType,
    p_state: input.prepared.state,
    p_projection: input.prepared.projection,
    p_status: input.prepared.status,
    p_turn_deadline_at: input.prepared.deadline,
    ...(Object.prototype.hasOwnProperty.call(input, "gameplayEvents")
      ? { p_gameplay_events: input.gameplayEvents }
      : {}),
    p_action_events: input.prepared.actionEvents,
  };
  const rpcName = Object.prototype.hasOwnProperty.call(input, "gameplayEvents")
    ? "okey_commit_authoritative_action_with_events"
    : "okey_commit_authoritative_action";
  const { data, error } = await input.client.rpc(rpcName, parameters).single();

  if (error) {
    if (error.message?.includes("version_conflict") && input.versionConflictResult) {
      return input.versionConflictResult;
    }
    if (!(input.acceptRejectedDataWithError && data?.applied === false)) {
      throw new Error(error.message ?? input.commitFailureCode);
    }
  }
  if (!data) {
    throw new Error(error?.message ?? input.commitFailureCode);
  }

  const committed = data as OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent>;
  if (committed.applied === false) return committed;

  let normalized: OkeyTurnCommit<OkeyAuthoritativeMatchState, OkeyActionEvent> = {
    ...committed,
    state: committed.state ?? input.fallbackState ?? input.prepared.state,
    turn_deadline_at:
      committed.turn_deadline_at ?? input.fallbackDeadline ?? input.prepared.deadline,
    action_events: committed.action_events ?? [],
  };
  if (input.afterCommit) {
    normalized = (await input.afterCommit(normalized)) ?? normalized;
  }

  if (input.broadcast) {
    try {
      await input.broadcast({
        matchId: input.matchId,
        commandId: input.commandId,
        version: normalized.version,
        publicProjection: projectOkeyMatchPublicState(
          normalized.state,
          normalized.version,
          normalized.turn_deadline_at,
        ),
        actionEvents: normalized.action_events ?? [],
      });
    } catch (broadcastError) {
      console.error(
        input.broadcastFailureMessage ?? "Okey authoritative broadcast failed",
        broadcastError,
      );
    }
  }

  return normalized;
}
