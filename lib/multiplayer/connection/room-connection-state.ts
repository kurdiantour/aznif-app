export type ConnectionLease = {
  connectionId: string;
  generation: number;
  state: "active" | "grace";
  graceDeadlineMs: number | null;
};

export class RoomConnectionState {
  private readonly leases = new Map<string, ConnectionLease>();
  private nextGeneration = 0;

  join(connectionId: string): ConnectionLease {
    const lease = { connectionId, generation: ++this.nextGeneration, state: "active" as const, graceDeadlineMs: null };
    this.leases.set(connectionId, lease);
    return lease;
  }

  beginGrace(connectionId: string, generation: number, deadlineMs: number) {
    const current = this.leases.get(connectionId);
    if (!current || current.generation !== generation) return false;
    this.leases.set(connectionId, { ...current, state: "grace", graceDeadlineMs: deadlineMs });
    return true;
  }

  finishGrace(connectionId: string, generation: number, now = Date.now()) {
    const current = this.leases.get(connectionId);
    if (!current || current.generation !== generation || current.state !== "grace") return false;
    if (current.graceDeadlineMs === null || current.graceDeadlineMs > now) return false;
    this.leases.delete(connectionId);
    return true;
  }

  hasLiveConnection() { return this.leases.size > 0; }
  get(connectionId: string) { return this.leases.get(connectionId) ?? null; }
}

