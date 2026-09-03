import type { OkeyActionEvent } from "@/okey/server/okey-action-events";
import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";

export interface OnlineOkeyMatchAdapter {
  readonly kind: "online";

  getCurrentUserId(): Promise<string | null>;

  getSnapshot():
    | OkeyMatchServerProjection
    | null;

  subscribe(
    listener: (
      snapshot:
        OkeyMatchServerProjection,
    ) => void,
  ): () => void;

  subscribeActionEvents(listener: (event: OkeyActionEvent) => void): () => void;

  subscribeReset(listener: () => void): () => void;

  dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void>;

  reconnect(): Promise<void>;

  leave(): Promise<void>;
}
