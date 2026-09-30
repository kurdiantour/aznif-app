import type { OptimisticCommand, ReconcileResult, VersionedSnapshot } from "./types";

export function getSnapshotVersion(snapshot: VersionedSnapshot | null | undefined): number {
  const version = Number(snapshot?.version ?? snapshot?.room?.version);
  return Number.isFinite(version) ? version : -1;
}

export function acceptsSnapshot(currentVersion: number, candidate: VersionedSnapshot): boolean {
  const candidateVersion = getSnapshotVersion(candidate);
  return candidateVersion >= 0 && candidateVersion >= currentVersion;
}

export function reconcileOptimisticCommand<TPayload, TProjection, TSnapshot>(
  pending: OptimisticCommand<TPayload, TProjection> | null,
  snapshot: TSnapshot & VersionedSnapshot,
  isConfirmed: (command: OptimisticCommand<TPayload, TProjection>, snapshot: TSnapshot) => boolean,
): ReconcileResult<OptimisticCommand<TPayload, TProjection>> {
  if (!pending || getSnapshotVersion(snapshot) <= pending.baseVersion) {
    return { pending, confirmed: false };
  }
  return isConfirmed(pending, snapshot)
    ? { pending: null, confirmed: true }
    : { pending, confirmed: false };
}
