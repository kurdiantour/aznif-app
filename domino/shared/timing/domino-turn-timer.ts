export const DOMINO_HUMAN_TURN_DURATION_SECONDS = 25;
export const DOMINO_HUMAN_TURN_DURATION_MS =
  DOMINO_HUMAN_TURN_DURATION_SECONDS * 1_000;

export function projectDominoTurnSecondsLeft(input: {
  turnStartedAtMs: number;
  nowMs: number;
  durationSeconds?: number;
}) {
  const durationSeconds =
    input.durationSeconds ?? DOMINO_HUMAN_TURN_DURATION_SECONDS;
  if (!Number.isFinite(input.turnStartedAtMs)) return durationSeconds;
  const elapsedSeconds = Math.floor(
    (input.nowMs - input.turnStartedAtMs) / 1_000,
  );
  return Math.max(0, Math.min(durationSeconds, durationSeconds - elapsedSeconds));
}
