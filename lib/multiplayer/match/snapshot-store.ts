import type { MultiplayerLifecycle } from "./contracts";

/** Accepts only monotonic authoritative snapshots and resets cleanly per room. */
export class MultiplayerSnapshotStore<TSnapshot> {
  private snapshot: TSnapshot | null = null;
  private version = -1;
  private readonly selectLifecycle: (snapshot: TSnapshot) => MultiplayerLifecycle;

  constructor(
    selectLifecycle: (snapshot: TSnapshot) => MultiplayerLifecycle,
  ) {
    this.selectLifecycle = selectLifecycle;
  }

  apply(snapshot: TSnapshot): boolean {
    const nextVersion = this.selectLifecycle(snapshot).version;
    if (!Number.isSafeInteger(nextVersion) || nextVersion < 0) return false;
    if (nextVersion < this.version) return false;
    this.snapshot = snapshot;
    this.version = nextVersion;
    return true;
  }

  reset() {
    this.snapshot = null;
    this.version = -1;
  }

  getSnapshot() {
    return this.snapshot;
  }

  getVersion() {
    return this.version;
  }
}
