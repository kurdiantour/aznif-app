const COUNTDOWN_START_CLOCK_SAFETY_MS = 75;
const COUNTDOWN_START_RETRY_MS = 500;

export function getOkeyCountdownStartCheckDelay(
  countdownEndsAt: string,
  now = Date.now(),
) {
  const deadline = Date.parse(countdownEndsAt);
  if (!Number.isFinite(deadline)) return null;

  const remaining = deadline - now;
  return remaining > 0
    ? remaining + COUNTDOWN_START_CLOCK_SAFETY_MS
    : COUNTDOWN_START_RETRY_MS;
}