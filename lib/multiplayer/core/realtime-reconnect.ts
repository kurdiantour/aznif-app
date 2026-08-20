export type RealtimeChannelStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | string;

export class RealtimeReconnectPolicy {
  private attempt = 0;
  private readonly baseDelayMs: number;
  private readonly maximumDelayMs: number;

  constructor(baseDelayMs = 1_000, maximumDelayMs = 15_000) {
    this.baseDelayMs = baseDelayMs;
    this.maximumDelayMs = maximumDelayMs;
  }

  observe(status: RealtimeChannelStatus): number | null {
    if (status === "SUBSCRIBED") {
      this.attempt = 0;
      return null;
    }
    if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return null;
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.attempt),
      this.maximumDelayMs,
    );
    this.attempt += 1;
    return delay;
  }

  reset() {
    this.attempt = 0;
  }

  getAttempt() {
    return this.attempt;
  }
}
