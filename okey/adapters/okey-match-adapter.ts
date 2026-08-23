import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";


export type OkeyBotTurnClaim = {
  expectedVersion: number;
  expectedActorId: string;
};

export type OkeyBotTurnResult = {
  ok: boolean;
  processed: boolean;
  reason?: string;
};

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

  dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void>;

  processBotTurn(claim: OkeyBotTurnClaim): Promise<OkeyBotTurnResult>;

  playEliminatedTurn(claim: OkeyEliminatedTurnClaim): Promise<void>;

  startNextRound(claim: OkeyNextRoundClaim): Promise<void>;

  reconnect(): Promise<void>;

  leave(): Promise<void>;
}
