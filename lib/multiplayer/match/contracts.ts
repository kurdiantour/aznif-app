import type { RealtimeChannelStatus } from "../core/realtime-reconnect";

export type MultiplayerMatchPhase =
  | "loading"
  | "waiting"
  | "playing"
  | "round_result"
  | "next_round_countdown"
  | "match_finished"
  | "cancelled"
  | "exited";

export type MultiplayerLifecycle = {
  status: "waiting" | "playing" | "cancelled" | "finished";
  version: number;
  roundId: string | null;
  completedRoundId: string | null;
  turnPlayerId: string | null;
  turnDeadlineAt: string | null;
  nextRoundEligibleAt?: string | null;
  roundFinished: boolean;
  matchFinished: boolean;
};

export type MultiplayerTimeoutClaim = {
  expectedVersion: number;
  expectedTurnDeadlineAt: string;
  expectedTurnPlayerId: string;
};

export type MultiplayerBotTurn = {
  actorId: string;
  controlledByBot: boolean;
  notBefore?: string | null;
};

export type MultiplayerSubscription<TSnapshot> = {
  onInvalidated: (publicSnapshot?: TSnapshot) => void;
  onStatus: (status: RealtimeChannelStatus, error?: unknown) => void;
};

export interface MultiplayerMatchAdapter<TSnapshot> {
  load(): Promise<TSnapshot>;
  resume?(): Promise<TSnapshot>;
  subscribe(observer: MultiplayerSubscription<TSnapshot>): () => void;
  claimTimeout?(claim: MultiplayerTimeoutClaim): Promise<TSnapshot | void>;
  executeBotTurn?(claim: { expectedVersion: number; expectedActorId: string }): Promise<TSnapshot | void>;
  startNextRound?(completedRoundId: string): Promise<TSnapshot | void>;
  leave(): Promise<void>;
}

export type TimeoutErrorDetails = {
  code?: string;
  serverNow?: string;
  expiresAt?: string;
};

export type MultiplayerMatchOptions<TSnapshot, TRoundResult, TFinalResult> = {
  roomId?: string;
  adapter: MultiplayerMatchAdapter<TSnapshot> | null;
  selectLifecycle: (snapshot: TSnapshot) => MultiplayerLifecycle;
  buildRoundResult: (snapshot: TSnapshot) => TRoundResult | null;
  buildFinalResult: (snapshot: TSnapshot) => TFinalResult | null;
  getSnapshotServerNow?: (snapshot: TSnapshot) => string | null;
  getTimeoutError?: (error: unknown) => TimeoutErrorDetails;
  canClaimTimeout?: (snapshot: TSnapshot, claim: MultiplayerTimeoutClaim) => boolean;
  selectBotTurn?: (snapshot: TSnapshot) => MultiplayerBotTurn | null;
  canExecuteBotTurn?: (snapshot: TSnapshot) => boolean;
  botRetryDelayMs?: number;
  roundResultDurationMs?: number;
  terminalRoundResultDurationMs?: number | null;
  terminalRoundPresentation?: "always" | "transition-only" | "never";
  nextRoundCountdownSeconds?: number;
  roundSyncIntervalMs?: number;
  staleAfterMs?: number;
  watchdogIntervalMs?: number;
};
