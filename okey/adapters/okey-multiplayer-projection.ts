import type { MultiplayerLifecycle } from "@/lib/multiplayer/match";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";

export function selectOkeyMultiplayerLifecycle(
  projection: OkeyMatchServerProjection,
): MultiplayerLifecycle {
  const roundFinished = projection.phase === "finished";
  const currentPlayer = projection.players[projection.currentPlayerIndex];
  return {
    status: projection.matchFinished
      ? "finished"
      : projection.phase === "playing"
        ? "playing"
        : "waiting",
    version: projection.version,
    roundId: String(projection.currentRound),
    completedRoundId: roundFinished
      ? `${projection.version}:${projection.currentRound}`
      : null,
    turnPlayerId: currentPlayer?.id ?? null,
    turnDeadlineAt: projection.turnDeadlineAt,
    nextRoundEligibleAt: projection.nextRoundEligibleAt,
    roundFinished,
    matchFinished: projection.matchFinished,
  };
}

export const buildOkeyCoreRoundResult = (projection: OkeyMatchServerProjection) =>
  projection.roundResults.at(-1) ?? null;

export const buildOkeyCoreFinalResult = (projection: OkeyMatchServerProjection) => ({
  winnerTeamId: projection.matchWinnerTeamId,
  scores: projection.matchScores,
  settlement: projection.settlement ?? null,
});

export function selectOkeyBotTurn(projection: OkeyMatchServerProjection) {
  if (projection.phase !== "playing" || projection.matchFinished) return null;
  const player = projection.players[projection.currentPlayerIndex];
  if (!player) return null;
  return {
    actorId: player.id,
    controlledByBot: player.controlledByBot === true || player.kind === "bot",
    notBefore: projection.roundStartsAt,
  };
}


export function getOkeyTimeoutError(error: unknown) {
  const value = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  return {
    code: typeof value.code === "string"
      ? value.code
      : typeof value.error === "string" ? value.error : undefined,
    serverNow: typeof value.serverNow === "string" ? value.serverNow : undefined,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
  };
}
