export type TimeoutClaim = {
  expectedVersion: number;
  expectedTurnDeadlineAt: string;
  expectedTurnPlayerId: string;
};

export type TimeoutDisposition = "retry_at_deadline" | "already_processed" | "stale" | "failed";

export function advanceConsecutiveTimeout(current: number, threshold: number) {
  const streak = Math.max(0, current) + 1;
  return { streak, shouldTakeOver: streak >= threshold };
}

export const resetConsecutiveTimeout = () => 0;

export function createTimeoutClaim(claim: TimeoutClaim): TimeoutClaim | null {
  return Number.isSafeInteger(claim.expectedVersion) && claim.expectedVersion >= 0 &&
      !!claim.expectedTurnDeadlineAt && !!claim.expectedTurnPlayerId
    ? { ...claim }
    : null;
}

export const getTimeoutClaimKey = (claim: TimeoutClaim) =>
  `${claim.expectedVersion}:${claim.expectedTurnDeadlineAt}:${claim.expectedTurnPlayerId}`;

export function classifyTimeoutResult(input: { code?: unknown; error?: unknown }): TimeoutDisposition {
  if (input.code === "turn_timer_not_expired") return "retry_at_deadline";
  if (input.code === "already_processed" || input.error === "already_processed") return "already_processed";
  if (input.code === "stale_timeout" || input.error === "stale_timeout") return "stale";
  return "failed";
}

export function getServerClockOffsetMs(serverNow: unknown, clientNow = Date.now()) {
  if (typeof serverNow !== "string") return null;
  const parsed = Date.parse(serverNow);
  return Number.isFinite(parsed) ? parsed - clientNow : null;
}

export function getDeadlineRetryDelayMs(expiresAt: unknown, offsetMs: number, clientNow = Date.now()) {
  if (typeof expiresAt !== "string") return null;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? Math.max(0, parsed - (clientNow + offsetMs)) : null;
}
