import type {
  MultiplayerLifecycle,
  MultiplayerMatchPhase,
  MultiplayerTimeoutClaim,
} from "./contracts";

export function deriveMatchPhase(lifecycle: MultiplayerLifecycle): MultiplayerMatchPhase {
  if (lifecycle.status === "cancelled") return "cancelled";
  if (lifecycle.matchFinished) return "match_finished";
  if (lifecycle.roundFinished) return "round_result";
  if (lifecycle.status === "playing") return "playing";
  return "waiting";
}

export function createTurnTimeoutClaim(
  lifecycle: MultiplayerLifecycle,
): MultiplayerTimeoutClaim | null {
  if (
    lifecycle.status !== "playing" || lifecycle.roundFinished || lifecycle.matchFinished ||
    lifecycle.version < 0 || !lifecycle.turnPlayerId || !lifecycle.turnDeadlineAt
  ) return null;
  if (!Number.isFinite(Date.parse(lifecycle.turnDeadlineAt))) return null;
  return {
    expectedVersion: lifecycle.version,
    expectedTurnDeadlineAt: lifecycle.turnDeadlineAt,
    expectedTurnPlayerId: lifecycle.turnPlayerId,
  };
}

export const getTurnIdentity = (claim: MultiplayerTimeoutClaim) =>
  `${claim.expectedVersion}:${claim.expectedTurnDeadlineAt}:${claim.expectedTurnPlayerId}`;

export function projectDeadlineMs(
  deadlineAt: string | null,
  serverClockOffsetMs: number,
  nowMs = Date.now(),
) {
  if (!deadlineAt) return null;
  const deadline = Date.parse(deadlineAt);
  return Number.isFinite(deadline)
    ? Math.max(0, deadline - (nowMs + serverClockOffsetMs))
    : null;
}

