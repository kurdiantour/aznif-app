import type { OkeyAuthoritativeMatchState } from "../../../okey/server/okey-authoritative.ts";
import { createBotTurnClaim } from "../../../lib/multiplayer/core/bot-turn-orchestration.ts";
import { projectSeatOwnership } from "../../../lib/multiplayer/core/seat-ownership.ts";

export type OkeyBotTurnClaim = {
  expectedVersion: number;
  expectedActorId: string;
};

export function getOkeyBotTurnClaim(
  state: OkeyAuthoritativeMatchState,
  version: number,
): OkeyBotTurnClaim | null {
  if (
    state.matchFinished ||
    state.roundState.phase !== "playing" ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) return null;

  const currentPlayer = state.roundState.players[state.roundState.currentPlayerIndex];
  if (!currentPlayer) return null;
  return createBotTurnClaim({
    version,
    actorId: currentPlayer.id,
    ownership: projectSeatOwnership({
      seatId: String(state.roundState.currentPlayerIndex),
      ownerPlayerId: currentPlayer.id,
      controlledByBot: currentPlayer.controlledByBot === true,
    }),
  });
}

export async function handOffOkeyBotTurn(input: {
  supabaseUrl: string;
  workerSecret: string;
  matchId: string;
  state: OkeyAuthoritativeMatchState;
  version: number;
}): Promise<boolean> {
  const claim = getOkeyBotTurnClaim(input.state, input.version);
  if (!claim) return false;

  const response = await fetch(`${input.supabaseUrl}/functions/v1/process_bot_turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-okey-worker-key": input.workerSecret,
    },
    body: JSON.stringify({
      mode: "okey",
      match_id: input.matchId,
      expected_version: claim.expectedVersion,
      expected_actor_id: claim.expectedActorId,
    }),
  });

  if (!response.ok) {
    throw new Error(`okey_bot_handoff_failed:${response.status}:${await response.text()}`);
  }
  return true;
}

export async function handOffOkeyServerLifecycle(input: {
  supabaseUrl: string;
  workerSecret: string;
  matchId: string;
  expectedVersion?: number;
  eligibleAt?: string | null;
  turnDeadlineAt?: string | null;
}): Promise<boolean> {
  const response = await fetch(`${input.supabaseUrl}/functions/v1/process_bot_turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-okey-worker-key": input.workerSecret,
    },
    body: JSON.stringify({
      mode: "okey",
      match_id: input.matchId,
      lifecycle_only: true,
      ...(Number.isSafeInteger(input.expectedVersion)
        ? { expected_version: input.expectedVersion }
        : {}),
      ...(input.eligibleAt ? { eligible_at: input.eligibleAt } : {}),
      ...(input.turnDeadlineAt ? { turn_deadline_at: input.turnDeadlineAt } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`okey_lifecycle_handoff_failed:${response.status}:${await response.text()}`);
  }
  return true;
}


