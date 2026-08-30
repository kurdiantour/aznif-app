import type { OkeyActionEvent } from "@/okey/server/okey-action-events";
import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";


export type OkeyNextRoundClaim = {
  expectedVersion: number;
  expectedRound: number;
};

export type OkeyEliminatedTurnClaim = {
  expectedVersion: number;
  expectedActorId: string;
};

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

  dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void>;

  playEliminatedTurn(claim: OkeyEliminatedTurnClaim): Promise<void>;

  startNextRound(claim: OkeyNextRoundClaim): Promise<void>;

  reconnect(): Promise<void>;

  leave(): Promise<void>;
}
