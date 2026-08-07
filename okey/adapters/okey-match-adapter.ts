import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";

export interface OnlineOkeyMatchAdapter {
  readonly kind: "online";

  getSnapshot():
    | OkeyMatchServerProjection
    | null;

  subscribe(
    listener: (
      snapshot:
        OkeyMatchServerProjection,
    ) => void,
  ): () => void;

  dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void>;

  reconnect(): Promise<void>;

  leave(): Promise<void>;
}