import type { OkeyAuthoritativeCommand, OkeyServerProjection } from "@/okey/server/okey-authoritative";

export interface OnlineOkeyMatchAdapter {
  readonly kind: "online";
  getSnapshot(): OkeyServerProjection | null;
  subscribe(listener: (snapshot: OkeyServerProjection) => void): () => void;
  dispatch(command: OkeyAuthoritativeCommand): Promise<void>;
  reconnect(): Promise<void>;
  leave(): Promise<void>;
}
