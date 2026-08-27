export type SocketHealth = "idle" | "connecting" | "healthy" | "reconnecting" | "closed";

export class SocketHealthMonitor {
  private lastPongAt = 0;
  constructor(readonly timeoutMs = 35_000) {}
  observePong(now = Date.now()) { this.lastPongAt = now; }
  isHealthy(now = Date.now()) { return this.lastPongAt > 0 && now - this.lastPongAt <= this.timeoutMs; }
  reset() { this.lastPongAt = 0; }
}

