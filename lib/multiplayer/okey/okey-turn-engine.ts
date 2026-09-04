/**
 * The single authoritative pipeline used by every Okey turn controller.
 *
 * Controllers may decide what should happen, but they cannot commit or
 * broadcast on their own.  Keeping those effects here makes the execution
 * order explicit and prevents Human, Bot and Timeout from drifting apart.
 */
export type OkeyTurnController =
  | "human"
  | "bot"
  | "timeout"
  | "disconnect"
  | "reconnect"
  | "manual-leave"
  | "elimination";

export type OkeyTurnCommit<TState, TEvent> = {
  applied?: boolean;
  version: number;
  state: TState;
  turn_deadline_at: string | null;
  action_events?: TEvent[];
  rejectionReason?: string;
};

export type PreparedOkeyTurn<TState, TProjection, TEventDraft> = {
  state: TState;
  projection: TProjection;
  deadline: string | null;
  status: "playing" | "finished";
  actionEvents: TEventDraft[];
};

export type OkeyTurnEngineInput<
  TIntent,
  TState,
  TProjection,
  TEventDraft,
  TEvent,
> = {
  controller: OkeyTurnController;
  matchId: string;
  actorPlayerId: string;
  commandId: string;
  commandType: string;
  expectedVersion: number;
  intent: TIntent;
  /** Validate the controller intent and produce the one proposed transition. */
  validate: (intent: TIntent) => PreparedOkeyTurn<TState, TProjection, TEventDraft>;
  /** The only database write in the pipeline. */
  commit: (
    prepared: PreparedOkeyTurn<TState, TProjection, TEventDraft>,
  ) => Promise<OkeyTurnCommit<TState, TEvent>>;
  /** Advance server-owned lifecycle work from the committed state, if needed. */
  advance?: (
    committed: OkeyTurnCommit<TState, TEvent>,
  ) => Promise<OkeyTurnCommit<TState, TEvent>>;
  /** Publish only committed/advanced state. */
  broadcast?: (input: {
    matchId: string;
    controller: OkeyTurnController;
    commandId: string;
    version: number;
    state: TState;
    turnDeadlineAt: string | null;
    actionEvents: TEvent[];
  }) => Promise<void>;
};

export type OkeyTurnEngineResult<TState, TEvent> = {
  controller: OkeyTurnController;
  committed: OkeyTurnCommit<TState, TEvent>;
};

export async function executeAuthoritativeOkeyTurn<
  TIntent,
  TState,
  TProjection,
  TEventDraft,
  TEvent,
>(
  input: OkeyTurnEngineInput<TIntent, TState, TProjection, TEventDraft, TEvent>,
): Promise<OkeyTurnEngineResult<TState, TEvent>> {
  // Controller -> Validate
  const prepared = input.validate(input.intent);

  // Validate -> Commit
  const committed = await input.commit(prepared);
  if (!committed) throw new Error("okey_turn_commit_missing");
  if (committed.applied === false) {
    return { controller: input.controller, committed };
  }

  // Commit -> Advance
  const advanced = input.advance ? await input.advance(committed) : committed;

  // Advance -> Broadcast
  if (input.broadcast) {
    await input.broadcast({
      matchId: input.matchId,
      controller: input.controller,
      commandId: input.commandId,
      version: advanced.version,
      state: advanced.state,
      turnDeadlineAt: advanced.turn_deadline_at,
      actionEvents: advanced.action_events ?? [],
    });
  }

  return { controller: input.controller, committed: advanced };
}
