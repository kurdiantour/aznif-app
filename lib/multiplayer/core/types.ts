export type VersionedSnapshot = { version?: number; room?: { version?: number } };

export type OptimisticCommand<TPayload, TProjection> = {
  id: string;
  scopeId: string;
  baseVersion: number;
  payload: TPayload;
  projection: TProjection;
};

export type ReconcileResult<TCommand> = {
  pending: TCommand | null;
  confirmed: boolean;
};
