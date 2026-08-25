import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";

export type OkeyTurnView = {
  playerId: string | null;
  playerIndex: number | null;
  deadlineAt: string | null;
  durationSeconds: number | null;
  version: number | null;
  phase: OkeyMatchServerProjection["phase"] | null;
};

/** The sole presentation-facing view of authoritative turn ownership/time. */
export function selectOkeyTurnView(
  projection: OkeyMatchServerProjection | null | undefined,
): OkeyTurnView {
  if (!projection) {
    return { playerId: null, playerIndex: null, deadlineAt: null, durationSeconds: null, version: null, phase: null };
  }
  const playerIndex = projection.currentPlayerIndex;
  return {
    playerId: projection.players[playerIndex]?.id ?? null,
    playerIndex,
    deadlineAt: projection.turnDeadlineAt,
    durationSeconds: projection.turnDurationSeconds,
    version: projection.version,
    phase: projection.phase,
  };
}

