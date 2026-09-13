export async function scheduleAznifGameLifecycle(input: {
  schedulerUrl: string;
  lifecycleSecret: string;
  gameType: string;
  matchId: string;
  expectedVersion: number;
  runAt: string;
}): Promise<boolean> {
  if (!Number.isFinite(Date.parse(input.runAt))) {
    throw new Error("aznif_lifecycle_invalid_run_at");
  }
  const response = await fetch(input.schedulerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "authorization": `Bearer ${input.lifecycleSecret}`,
    },
    body: JSON.stringify({
      gameType: input.gameType,
      matchId: input.matchId,
      expectedVersion: input.expectedVersion,
      runAt: input.runAt,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `aznif_lifecycle_alarm_failed:${response.status}:${await response.text()}`,
    );
  }
  return true;
}
