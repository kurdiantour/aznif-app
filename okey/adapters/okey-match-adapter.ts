import type { OkeyActionEvent } from "@/okey/server/okey-action-events";
import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";

export type OkeyCommittedTransition = {
  version: number;
  previousProjection: OkeyMatchServerProjection | null;
  projection: OkeyMatchServerProjection;
  actionEvents: OkeyActionEvent[];
};

export interface OnlineOkeyMatchAdapter {
  readonly kind: "online";

  getCurrentUserId(): Promise<string | null>;

  getServerClockOffsetMs(): number;

  getSnapshot():
    | OkeyMatchServerProjection
    | null;

  refresh(): Promise<void>;

  subscribe(
    listener: (
      snapshot:
        OkeyMatchServerProjection,
    ) => void,
  ): () => void;

  subscribeActionEvents(listener: (event: OkeyActionEvent) => void): () => void;

  subscribeCommittedTransitions(
    listener: (transition: OkeyCommittedTransition) => void,
  ): () => void;

  subscribeReset(listener: () => void): () => void;

  dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void>;

  reconnect(): Promise<void>;

  leave(): Promise<void>;
}
