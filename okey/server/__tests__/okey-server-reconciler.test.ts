import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAuthoritativeOkeyMatch,
  settleAuthoritativeOkeyRound,
  OKEY_ROUND_END_PRESENTATION_BUDGET,
  type OkeyAuthoritativeMatchState,
  type OkeyServerPlayerIdentity,
} from "../okey-authoritative.ts";

import {
  evaluateOkeyServerLifecycle,
  generateOkeyReconcilerCommandId,
  reconcileAuthoritativeEliminatedTurns,
  reconcileAuthoritativeTimeoutTurn,
  reconcileAuthoritativeNextRound,
  reconcileAuthoritativeMatchStart,
  reconcileAuthoritativeServerTurns,
  reconcileAuthoritativeServerLifecycleWakeup,
  runOkeyLifecycleReconciler,
  type OkeyAuthoritativeSnapshotBundle,
  type OkeyLifecycleDecision,
} from "../okey-server-reconciler.ts";

const mockPlayers: readonly [
  OkeyServerPlayerIdentity,
  OkeyServerPlayerIdentity,
  OkeyServerPlayerIdentity,
  OkeyServerPlayerIdentity,
] = [
  { id: "p1", name: "Player 1", controlledByBot: false },
  { id: "p2", name: "Player 2", controlledByBot: true, botDifficulty: "normal" },
  { id: "p3", name: "Player 3", controlledByBot: false },
  { id: "p4", name: "Player 4", controlledByBot: false },
];

function createTestBundle(
  customState?: Partial<OkeyAuthoritativeMatchState>,
  version = 1,
  turnDeadlineAt: string | null = "2026-09-02T12:00:30.000Z",
): OkeyAuthoritativeSnapshotBundle {
  const base = createAuthoritativeOkeyMatch(mockPlayers, 0);
  return {
    version,
    turn_deadline_at: turnDeadlineAt,
    state: {
      ...base,
      ...customState,
    },
    status: "playing",
  };
}

test("Priority 1: Terminal match supersedes all other lifecycle conditions", () => {
  const now = Date.parse("2026-09-02T12:00:40.000Z");
  const bundle = createTestBundle(
    {
      matchFinished: true,
      matchWinnerTeamId: "teamA",
      leaveTerminationReason: "last-human-winner",
    },
    5,
    "2026-09-02T12:00:10.000Z", // Past deadline
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "terminal");
  if (decision.type === "terminal") {
    assert.equal(decision.matchFinished, true);
    assert.equal(decision.winnerTeamId, "teamA");
    assert.equal(decision.reason, "last-human-winner");
  }
});

test("Priority 2: Eliminated current actor takes precedence over bot and timeout checks", () => {
  const now = Date.parse("2026-09-02T12:00:40.000Z");
  const bundle = createTestBundle(
    {
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        currentPlayerIndex: 0,
players: createAuthoritativeOkeyMatch(mockPlayers, 0).roundState.players.map(
  (player, idx) => ({
    ...player,
    eliminated: idx === 0,
    controlledByBot: true,
  }),
),
      },
    },
    8,
    "2026-09-02T12:00:10.000Z", // Expired deadline
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "eliminated-turn");
  if (decision.type === "eliminated-turn") {
    assert.equal(decision.expectedVersion, 8);
    assert.equal(decision.expectedActorId, "p1");
    assert.equal(decision.playerIndex, 0);
  }
});

test("Priority 3: Bot current actor takes precedence over turn deadline expiration", () => {
  const now = Date.parse("2026-09-02T12:00:40.000Z");
  const bundle = createTestBundle(
    {
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        currentPlayerIndex: 1, // Player 1 is bot
        hasDrawnThisTurn: false,
      },
    },
    12,
    "2026-09-02T12:00:10.000Z", // Expired deadline
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "bot-turn");
  if (decision.type === "bot-turn") {
    assert.equal(decision.expectedVersion, 12);
    assert.equal(decision.expectedActorId, "p2");
    assert.equal(decision.step, "draw");
    assert.equal(decision.ready, true);
  }
});

test("Priority 4: Expired human turn deadline is triggered when time is past deadline", () => {
  const now = Date.parse("2026-09-02T12:00:40.000Z");
  const deadline = "2026-09-02T12:00:30.000Z";
  const bundle = createTestBundle(
    {
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        currentPlayerIndex: 0, // Human player
      },
    },
    15,
    deadline,
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "expired-human-turn");
  if (decision.type === "expired-human-turn") {
    assert.equal(decision.expectedVersion, 15);
    assert.equal(decision.expectedTurnPlayerId, "p1");
    assert.equal(decision.expectedTurnDeadlineAt, deadline);
  }
});

test("Human player within turn deadline remains idle (waiting for human action)", () => {
  const now = Date.parse("2026-09-02T12:00:20.000Z");
  const deadline = "2026-09-02T12:00:30.000Z";
  const bundle = createTestBundle(
    {
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        currentPlayerIndex: 0, // Human player
      },
    },
    15,
    deadline,
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "idle");
  if (decision.type === "idle") {
    assert.equal(decision.reason, "waiting_for_human_action");
    assert.equal(decision.turnDeadlineAt, deadline);
  }
});

test("Priority 5: Due next round triggers when round is finished and eligibleAt <= now", () => {
  const now = Date.parse("2026-09-02T12:05:10.000Z");
  const eligibleAt = "2026-09-02T12:05:00.000Z";
  const bundle = createTestBundle(
    {
      currentRound: 2,
      nextRoundEligibleAt: eligibleAt,
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        phase: "finished",
        winnerId: "p1",
      },
    },
    20,
    null,
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "due-next-round");
  if (decision.type === "due-next-round") {
    assert.equal(decision.expectedVersion, 20);
    assert.equal(decision.expectedRound, 2);
    assert.equal(decision.eligibleAt, eligibleAt);
  }
});

test("Round finished with future eligibleAt remains idle (next round countdown)", () => {
  const now = Date.parse("2026-09-02T12:04:50.000Z");
  const eligibleAt = "2026-09-02T12:05:00.000Z";
  const bundle = createTestBundle(
    {
      currentRound: 2,
      nextRoundEligibleAt: eligibleAt,
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        phase: "finished",
      },
    },
    20,
    null,
  );

  const decision = evaluateOkeyServerLifecycle(bundle, now);
  assert.equal(decision.type, "idle");
  if (decision.type === "idle") {
    assert.equal(decision.reason, "next_round_countdown");
    assert.equal(decision.eligibleAt, eligibleAt);
  }
});

test("Deterministic command IDs are identical for same inputs and distinct for different inputs", async () => {
  const id1 = await generateOkeyReconcilerCommandId("match-abc", "system-timeout", 4, "p1");
  const id2 = await generateOkeyReconcilerCommandId("match-abc", "system-timeout", 4, "p1");
  const id3 = await generateOkeyReconcilerCommandId("match-abc", "system-timeout", 5, "p1");
  const id4 = await generateOkeyReconcilerCommandId("match-abc", "bot-draw", 4, "p2");

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.notEqual(id1, id4);
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("reconcileAuthoritativeEliminatedTurns executes automatic draw/discard, advances turn, and creates actionEvents", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const eliminatedPlayerIndex = 1; // p2 is eliminated
  const initialDeck = [...baseMatch.roundState.deck];
  const expectedDrawnTile = initialDeck[0];

  const stateWithEliminated: OkeyAuthoritativeMatchState = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      currentPlayerIndex: eliminatedPlayerIndex,
      hasDrawnThisTurn: false,
      players: baseMatch.roundState.players.map((p, idx) =>
        idx === eliminatedPlayerIndex ? { ...p, eliminated: true } : p,
      ),
    },
  };

  const commits: any[] = [];
  const broadcasts: any[] = [];

  const mockClient = {
    rpc: (name: string, args: any) => {
      assert.equal(name, "okey_commit_authoritative_action");
      commits.push(args);
      return {
        single: async () => ({
          data: {
            applied: true,
            version: args.p_expected_version + 1,
            state: args.p_state,
            turn_deadline_at: args.p_turn_deadline_at,
            action_events: args.p_action_events,
          },
          error: null,
        }),
      };
    },
  };

  const result = await reconcileAuthoritativeEliminatedTurns({
    client: mockClient,
    matchId: "test-eliminated-match",
    state: stateWithEliminated,
    version: 10,
    turnDeadlineAt: null,
    broadcastStateUpdate: async (payload) => {
      broadcasts.push(payload);
    },
  });

  assert.equal(result.executedCount, 1);
  assert.equal(result.version, 11);
  assert.equal(commits.length, 1);
  assert.equal(broadcasts.length, 1);

  // Assert exact draw and discard action events:
  assert.equal(result.actionEvents.length, 2);
  assert.equal(result.actionEvents[0].type, "draw");
  assert.equal(result.actionEvents[0].actorPlayerId, "p2");
  assert.equal(result.actionEvents[1].type, "discard");
  assert.equal(result.actionEvents[1].actorPlayerId, "p2");
  assert.equal((result.actionEvents[1].payload as any).reason, "eliminated");

  // Assert top deck tile was placed into discard pile and removed from deck:
  assert.equal(result.state.roundState.discardPile.at(-1)?.id, expectedDrawnTile.id);
  assert.equal(result.state.roundState.deck.length, initialDeck.length - 1);

  // Assert turn progressed to the next player (p3):
  assert.equal(result.state.roundState.currentPlayerIndex, 2);

  // Assert player hands were NOT modified (eliminated player draws and directly discards):
  assert.equal(result.state.roundState.players[eliminatedPlayerIndex].hand.length, baseMatch.roundState.players[eliminatedPlayerIndex].hand.length);
  assert.equal(result.state.roundState.players[eliminatedPlayerIndex].eliminated, true);
});

test("reconcileAuthoritativeEliminatedTurns handles chained consecutive eliminated players", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);

  // p2 (index 1) and p3 (index 2) are both eliminated
  const stateWithTwoEliminated: OkeyAuthoritativeMatchState = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      currentPlayerIndex: 1,
      hasDrawnThisTurn: false,
      players: baseMatch.roundState.players.map((p, idx) =>
        idx === 1 || idx === 2 ? { ...p, eliminated: true } : p,
      ),
    },
  };

  const commits: any[] = [];
  const mockClient = {
    rpc: (name: string, args: any) => {
      commits.push(args);
      return {
        single: async () => ({
          data: {
            applied: true,
            version: args.p_expected_version + 1,
            state: args.p_state,
            turn_deadline_at: args.p_turn_deadline_at,
            action_events: args.p_action_events,
          },
          error: null,
        }),
      };
    },
  };

  const result = await reconcileAuthoritativeEliminatedTurns({
    client: mockClient,
    matchId: "test-chain-match",
    state: stateWithTwoEliminated,
    version: 20,
    turnDeadlineAt: null,
  });

  assert.equal(result.executedCount, 2);
  assert.equal(result.version, 22);
  assert.equal(commits.length, 2);

  // Turn advanced past both p2 and p3 to p4 (index 3)
  assert.equal(result.state.roundState.currentPlayerIndex, 3);
});

test("reconcileAuthoritativeTimeoutTurn executes forced draw/discard when deadline expired and creates action events", async () => {
  const createdMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const baseMatch: OkeyAuthoritativeMatchState = {
    ...createdMatch,
    roundState: {
      ...createdMatch.roundState,
      hasDrawnThisTurn: false,
    },
  };
  const deadline = "2026-09-02T12:00:30.000Z";
  const now = Date.parse("2026-09-02T12:00:35.000Z");

  const commits: any[] = [];
  const broadcasts: any[] = [];

  const mockClient = {
    rpc: (name: string, args: any) => {
      assert.equal(name, "okey_commit_authoritative_action");
      commits.push(args);
      return {
        single: async () => ({
          data: {
            applied: true,
            version: args.p_expected_version + 1,
            state: args.p_state,
            turn_deadline_at: args.p_turn_deadline_at,
            action_events: args.p_action_events,
          },
          error: null,
        }),
      };
    },
  };

  const result = await reconcileAuthoritativeTimeoutTurn({
    client: mockClient,
    matchId: "test-timeout-match",
    state: baseMatch,
    version: 5,
    turnDeadlineAt: deadline,
    now: () => now,
    broadcastStateUpdate: async (payload) => {
      broadcasts.push(payload);
    },
  });

  assert.equal(result.executed, true);
  assert.equal(result.version, 6);
  assert.equal(commits.length, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal(commits[0].p_command_type, "system-timeout");

  // Action events should be forced draw + discard with reason "timeout":
  assert.equal(result.actionEvents.length, 2);
  assert.equal(result.actionEvents[0].type, "draw");
  assert.equal(result.actionEvents[0].actorPlayerId, "p1");
  assert.equal(result.actionEvents[1].type, "discard");
  assert.equal(result.actionEvents[1].actorPlayerId, "p1");
  assert.equal((result.actionEvents[1].payload as any).reason, "timeout");

  // Turn advanced from p1 (index 0) to p2 (index 1):
  assert.equal(result.state.roundState.currentPlayerIndex, 1);
});

test("reconcileAuthoritativeServerTurns chains Timeout -> Bot server-side until human player reached", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const deadline = "2026-09-02T12:00:30.000Z";
  const now = Date.parse("2026-09-02T12:00:35.000Z");

  let state = baseMatch;
  let currentVer = 5;
  let currentDeadline: string | null = deadline;
  const committedCommands: string[] = [];

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
              status: "playing",
              turn_deadline_at: currentDeadline,
              player_index: 0,
              state,
              command_applied: false,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        currentVer = args.p_expected_version + 1;
        state = args.p_state;
        currentDeadline = args.p_turn_deadline_at;
        committedCommands.push(args.p_command_type);
        return {
          single: async () => ({
            data: {
              applied: true,
              version: currentVer,
              state,
              turn_deadline_at: currentDeadline,
              action_events: args.p_action_events,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { is_test: false }, error: null }),
          }),
        }),
      }),
    }),
  };

  const result = await reconcileAuthoritativeServerTurns({
    client: mockClient,
    matchId: "test-timeout-bot-chain",
    requesterUserId: "p1",
    state: baseMatch,
    version: 5,
    turnDeadlineAt: deadline,
    now: () => now,
  });

  // Expired human turn (p1) -> Timeout (ver 6) -> Bot turn (p2) -> Bot draw (ver 7) -> Bot discard (ver 8) -> Human p3
  assert.equal(result.executedTimeoutCount, 1);
  assert.equal(result.botProcessed, true);
  assert.equal(result.version, 8);
  assert.deepEqual(committedCommands, ["system-timeout", "system-bot-draw", "system-bot-discard"]);
  assert.equal(result.state.roundState.currentPlayerIndex, 2); // Reached human p3
});

test("reconcileAuthoritativeServerTurns chains Timeout -> Eliminated server-side", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  // Mark p2 as eliminated (and human, so it exercises eliminated path)
  const stateWithEliminatedP2: OkeyAuthoritativeMatchState = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      players: baseMatch.roundState.players.map((p, idx) =>
        idx === 1 ? { ...p, eliminated: true, controlledByBot: false } : p,
      ),
    },
  };
  const deadline = "2026-09-02T12:00:30.000Z";
  const now = Date.parse("2026-09-02T12:00:35.000Z");

  let state = stateWithEliminatedP2;
  let currentVer = 10;
  let currentDeadline: string | null = deadline;
  const committedCommands: string[] = [];

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
              status: "playing",
              turn_deadline_at: currentDeadline,
              player_index: 0,
              state,
              command_applied: false,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        currentVer = args.p_expected_version + 1;
        state = args.p_state;
        currentDeadline = args.p_turn_deadline_at;
        committedCommands.push(args.p_command_type);
        return {
          single: async () => ({
            data: {
              applied: true,
              version: currentVer,
              state,
              turn_deadline_at: currentDeadline,
              action_events: args.p_action_events,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { is_test: false }, error: null }),
          }),
        }),
      }),
    }),
  };

  const result = await reconcileAuthoritativeServerTurns({
    client: mockClient,
    matchId: "test-timeout-eliminated-chain",
    requesterUserId: "p1",
    state: stateWithEliminatedP2,
    version: 10,
    turnDeadlineAt: deadline,
    now: () => now,
  });

  // Expired human turn (p1) -> Timeout (ver 11) -> Eliminated turn (p2) -> Eliminated draw/discard (ver 12) -> Human p3
  assert.equal(result.executedTimeoutCount, 1);
  assert.equal(result.executedEliminatedCount, 1);
  assert.equal(result.version, 12);
  assert.deepEqual(committedCommands, ["system-timeout", "system-eliminated-turn"]);
  assert.equal(result.state.roundState.currentPlayerIndex, 2); // Reached human p3
});

test("reconcileAuthoritativeServerTurns executes bot turn through executeOkeyBotTurn and advances turn", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  // Current player is p2 (bot, index 1)
  let state = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      currentPlayerIndex: 1,
      hasDrawnThisTurn: false,
    },
  };
  let currentVer = 10;
  const committedPayloads: any[] = [];

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
              status: "playing",
              turn_deadline_at: null,
              player_index: 0,
              state,
              command_applied: false,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        currentVer = args.p_expected_version + 1;
        state = args.p_state;
        committedPayloads.push(args);
        return {
          single: async () => ({
            data: {
              applied: true,
              version: currentVer,
              state,
              turn_deadline_at: args.p_turn_deadline_at,
              action_events: args.p_action_events,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { is_test: false }, error: null }),
          }),
        }),
      }),
    }),
  };

  const result = await reconcileAuthoritativeServerTurns({
    client: mockClient,
    matchId: "test-bot-match",
    requesterUserId: "p1",
    state,
    version: 10,
    turnDeadlineAt: null,
  });

  assert.equal(result.botProcessed, true);
  assert.equal(result.version, 12); // Bot draw (11) + Bot discard (12)
  assert.equal(committedPayloads.length, 2);
  assert.equal(committedPayloads[0].p_command_type, "system-bot-draw");
  assert.equal(committedPayloads[1].p_command_type, "system-bot-discard");
  // Next player is p3 (human, index 2)
  assert.equal(result.state.roundState.currentPlayerIndex, 2);
});

test("runOkeyLifecycleReconciler re-evaluates state iteratively with injected transition executor", async () => {
  const initialBundle = createTestBundle(
    {
      roundState: {
        ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
        currentPlayerIndex: 1, // Bot turn
        hasDrawnThisTurn: false,
      },
    },
    10,
    null,
  );

  const executedSteps: string[] = [];

  const mockExecutor = async (
    decision: Exclude<OkeyLifecycleDecision, { type: "idle" }>,
    current: OkeyAuthoritativeSnapshotBundle,
  ): Promise<OkeyAuthoritativeSnapshotBundle | null> => {
    executedSteps.push(decision.type);

    if (decision.type === "bot-turn" && decision.step === "draw") {
      return {
        ...current,
        version: Number(current.version) + 1,
        state: {
          ...current.state,
          roundState: {
            ...current.state.roundState,
            hasDrawnThisTurn: true,
          },
        },
      };
    }

    if (decision.type === "bot-turn" && decision.step === "discard") {
      return {
        ...current,
        version: Number(current.version) + 1,
        turn_deadline_at: "2026-09-02T12:00:30.000Z",
        state: {
          ...current.state,
          roundState: {
            ...current.state.roundState,
            currentPlayerIndex: 0, // Moves to human player
            hasDrawnThisTurn: false,
          },
        },
      };
    }

    return null;
  };

  const result = await runOkeyLifecycleReconciler(initialBundle, {
    transitionExecutor: mockExecutor,
    now: () => Date.parse("2026-09-02T12:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.iterations, 2);
  assert.deepEqual(executedSteps, ["bot-turn", "bot-turn"]);
  assert.equal(result.finalDecision.type, "idle");
  assert.equal(Number(result.finalBundle.version), 12);
});

test("reconcileAuthoritativeNextRound starts next round after eligibleAt and emits round action event", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const settledRoundState = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished" as const,
      winnerId: "p1",
      endReason: "win" as const,
    },
  }, Date.parse("2026-09-02T12:00:07.000Z"));

  let currentVer = 15;
  let committedState: any = null;
  let committedCommandType = "";
  let committedActionEvents: any[] = [];

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_commit_authoritative_action") {
        currentVer = args.p_expected_version + 1;
        committedState = args.p_state;
        committedCommandType = args.p_command_type;
        committedActionEvents = args.p_action_events;
        return {
          single: async () => ({
            data: {
              applied: true,
              version: currentVer,
              state: committedState,
              turn_deadline_at: args.p_turn_deadline_at,
              action_events: args.p_action_events,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  // 1. Before eligibleAt: does not start
  const beforeResult = await reconcileAuthoritativeNextRound({
    client: mockClient,
    matchId: "test-next-round-match",
    state: settledRoundState,
    version: 15,
    now: () => Date.parse("2026-09-02T12:00:05.000Z"),
  });
  assert.equal(beforeResult.executed, false);

  // 2. At or after eligibleAt: starts round 2
  const afterResult = await reconcileAuthoritativeNextRound({
    client: mockClient,
    matchId: "test-next-round-match",
    state: settledRoundState,
    version: 15,
    now: () => Date.parse("2026-09-02T12:00:10.000Z"),
  });
  assert.equal(afterResult.executed, true);
  assert.equal(afterResult.version, 16);
  assert.equal(afterResult.state.currentRound, 2);
  assert.equal(afterResult.state.roundState.phase, "playing");
  assert.equal(committedCommandType, "start-next-round");
  assert.deepEqual(committedActionEvents, [
    { type: "round", actorPlayerId: null, payload: { round: 2 } },
  ]);
});

test("reconcileAuthoritativeMatchStart creates match state and starts room", async () => {
  let rpcCalled = false;
  let receivedMatchId = "";
  let receivedState: any = null;

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_start_match") {
        rpcCalled = true;
        receivedMatchId = args.p_match_id;
        receivedState = args.p_state;
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  };

  const result = await reconcileAuthoritativeMatchStart({
    client: mockClient,
    matchId: "test-room-start",
    members: mockPlayers,
    startingPlayerIndex: 0,
  });

  assert.equal(rpcCalled, true);
  assert.equal(receivedMatchId, "test-room-start");
  assert.equal(result.executed, true);
  assert.equal(result.state.roundState.phase, "playing");
  assert.equal(result.state.roundState.players.length, 4);

  // Test with startRoomAction (as used in okey_room production edge function)
  let customActionCalled = false;
  const customResult = await reconcileAuthoritativeMatchStart({
    client: mockClient,
    matchId: "test-room-custom",
    members: mockPlayers,
    startRoomAction: async ({ state, projection, turnDeadlineAt }) => {
      customActionCalled = true;
      assert.equal(state.roundState.phase, "playing");
      assert.ok(turnDeadlineAt);
      return { data: { matchId: "test-room-custom", status: "playing" }, error: null };
    },
  });
  assert.equal(customActionCalled, true);
  assert.equal(customResult.executed, true);
  assert.equal(customResult.room?.status, "playing");
});

test("reconcileAuthoritativeServerTurns chains Next Round -> Bot Turn when starting player is bot", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  // Round 1 ended with p2 winning. In round 2, dealer is p2 (bot, index 1) who receives 15 tiles!
  const settledRound1 = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished" as const,
      winnerId: "p2",
      endReason: "win" as const,
    },
  }, Date.parse("2026-09-02T12:00:07.000Z"));

  let currentVer = 20;
  let currentState: any = settledRound1;
  const committedCommands: string[] = [];

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
              status: "playing",
              turn_deadline_at: null,
              player_index: 0,
              state: currentState,
              command_applied: false,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        currentVer = args.p_expected_version + 1;
        currentState = args.p_state;
        committedCommands.push(args.p_command_type);
        return {
          single: async () => ({
            data: {
              applied: true,
              version: currentVer,
              state: currentState,
              turn_deadline_at: args.p_turn_deadline_at,
              action_events: args.p_action_events,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { is_test: false }, error: null }),
          }),
        }),
      }),
    }),
  };

  const result = await reconcileAuthoritativeServerTurns({
    client: mockClient,
    matchId: "test-next-round-bot-chain",
    requesterUserId: "p1",
    state: settledRound1,
    version: 20,
    turnDeadlineAt: null,
    now: () => Date.parse("2026-09-02T12:00:15.000Z"),
  });

  // Due next round (ver 21, round 2 start) -> p2 bot turn: starting player has 15 tiles, only needs to discard! (ver 22) -> Next is p3 (human)
  assert.equal(result.executedNextRoundCount, 1);
  assert.equal(result.botProcessed, true);
  assert.equal(result.state.currentRound, 2);
  assert.equal(result.state.roundState.phase, "playing");
  assert.deepEqual(committedCommands, ["start-next-round", "system-bot-discard"]);
  assert.equal(result.state.roundState.currentPlayerIndex, 2); // Reached human p3
});

test("Single Server Owner: Eliminated, Bot, Timeout, and Next-Round transitions have single Server owners and zero client triggers", () => {
  const edge = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const adapter = readFileSync("okey/adapters/supabase-okey-match-adapter.ts", "utf8");
  const hook = readFileSync("okey/hooks/useOkeyMultiplayerGame.ts", "utf8");
  const matchInterface = readFileSync("okey/adapters/okey-match-adapter.ts", "utf8");
  const matchAdapter = readFileSync("okey/adapters/okey-multiplayer-adapter.ts", "utf8");

  // Server owns reconciliation:
  assert.match(edge, /reconcileAuthoritativeServerTurns/);

  // Client triggers and adapter methods are completely removed (Server is single owner):
  assert.doesNotMatch(hook, /eliminatedClaimRef/);
  assert.doesNotMatch(hook, /playEliminatedTurn/);
  assert.doesNotMatch(hook, /selectBotTurn/);
  assert.doesNotMatch(hook, /canExecuteBotTurn/);
  assert.doesNotMatch(hook, /canClaimTimeout/);
  assert.doesNotMatch(hook, /getTimeoutError/);

  assert.doesNotMatch(adapter, /playEliminatedTurn/);
  assert.doesNotMatch(adapter, /processBotTurn/);
  assert.doesNotMatch(adapter, /resolveTimeout/);
  assert.doesNotMatch(adapter, /OkeyTurnTimeoutClaim/);
  assert.doesNotMatch(adapter, /startNextRound/);
  assert.doesNotMatch(adapter, /OkeyNextRoundClaim/);

  assert.doesNotMatch(matchInterface, /playEliminatedTurn/);
  assert.doesNotMatch(matchInterface, /processBotTurn/);
  assert.doesNotMatch(matchInterface, /startNextRound/);
  assert.doesNotMatch(matchInterface, /OkeyNextRoundClaim/);

  assert.doesNotMatch(matchAdapter, /async executeBotTurn/);
  assert.doesNotMatch(matchAdapter, /async claimTimeout/);
  assert.doesNotMatch(matchAdapter, /async startNextRound/);

  assert.doesNotMatch(edge, /action === "play-eliminated"/);
  assert.doesNotMatch(edge, /action === "resolve-timeout"/);
  assert.doesNotMatch(edge, /action === "start-next-round"/);
  assert.match(edge, /reconcileAuthoritativeServerLifecycleWakeup/);
});

test("Server Lifecycle Wake-up: waits full presentation budget (8.5s) until nextRoundEligibleAt before executing Reconciler", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const budgetDelayMs = OKEY_ROUND_END_PRESENTATION_BUDGET.TOTAL_LIFECYCLE_DELAY_MS; // 8,500ms
  const eligibleAt = new Date(roundFinishTime + budgetDelayMs).toISOString();
  let currentTime = roundFinishTime;
  const sleptIntervals: number[] = [];

  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const settledMatch: OkeyAuthoritativeMatchState = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished",
      winnerId: "p1",
      endReason: "win",
    },
  }, roundFinishTime);

  // Step 1: Round finished sets nextRoundEligibleAt to exact budget (now + 8.5s)
  assert.equal(settledMatch.nextRoundEligibleAt, eligibleAt);
  assert.equal(budgetDelayMs, 8_500);

  // Step 2 & 3: Before 8.5s (during celebration and popup display), server lifecycle remains idle
  const celebrationMidpoint = evaluateOkeyServerLifecycle(
    createTestBundle(settledMatch, 10, null),
    roundFinishTime + OKEY_ROUND_END_PRESENTATION_BUDGET.CELEBRATION_DURATION_MS - 1_000, // t = 4.0s
  );
  assert.equal(celebrationMidpoint.type, "idle");
  if (celebrationMidpoint.type === "idle") {
    assert.equal(celebrationMidpoint.reason, "next_round_countdown");
  }

  const popupDisplayMidpoint = evaluateOkeyServerLifecycle(
    createTestBundle(settledMatch, 10, null),
    roundFinishTime + OKEY_ROUND_END_PRESENTATION_BUDGET.CELEBRATION_DURATION_MS + 1_500, // t = 6.5s
  );
  assert.equal(popupDisplayMidpoint.type, "idle");
  if (popupDisplayMidpoint.type === "idle") {
    assert.equal(popupDisplayMidpoint.reason, "next_round_countdown");
  }

  // Step 4: At t >= 8.5s, server reaches due-next-round
  const afterBudgetElapsed = evaluateOkeyServerLifecycle(
    createTestBundle(settledMatch, 10, null),
    roundFinishTime + budgetDelayMs, // t = 8.5s
  );
  assert.equal(afterBudgetElapsed.type, "due-next-round");

  let reconcileAttempts = 0;
  let serverCommitted = false;

  const mockClient = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: 10,
              turn_deadline_at: null,
              state: settledMatch,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        reconcileAttempts += 1;
        serverCommitted = true;
        const nextState = startAuthoritativeOkeyNextRound(settledMatch, currentTime);
        return {
          single: async () => ({
            data: {
              applied: true,
              version: 11,
              state: nextState,
              turn_deadline_at: "2026-09-02T12:00:38.500Z",
              action_events: [{ type: "round", payload: { round: 2 } }],
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  const wakeupResult = await reconcileAuthoritativeServerLifecycleWakeup({
    client: mockClient,
    matchId: "test-wakeup-delay",
    requesterUserId: "p1",
    initialState: settledMatch,
    initialVersion: 10,
    eligibleAt,
    now: () => currentTime,
    sleep: async (ms: number) => {
      sleptIntervals.push(ms);
      currentTime += ms;
    },
    maxRetryDurationMs: 14_000,
    retryIntervalMs: 500,
  });

  // Must have waited exactly 8,500 ms before executing the transition
  assert.deepEqual(sleptIntervals, [8_500]);
  assert.equal(wakeupResult.ok, true);
  assert.equal(wakeupResult.executed, true);
  assert.equal(wakeupResult.reason, "next_round_started");
  assert.equal(wakeupResult.state?.roundState.phase, "playing");
  assert.equal(wakeupResult.state?.currentRound, 2);
  assert.equal(serverCommitted, true);
  assert.equal(reconcileAttempts, 1);
});

test("Server Lifecycle Wake-up: retries on transient conflict and round never remains in phase=finished", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const budgetDelayMs = OKEY_ROUND_END_PRESENTATION_BUDGET.TOTAL_LIFECYCLE_DELAY_MS;
  const eligibleAt = new Date(roundFinishTime + budgetDelayMs).toISOString();
  let currentTime = roundFinishTime;
  const sleptIntervals: number[] = [];

  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const settledMatch: OkeyAuthoritativeMatchState = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished",
      winnerId: "p1",
      endReason: "win",
    },
  }, roundFinishTime);

  let attemptCount = 0;

  const mockClient = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: 10,
              turn_deadline_at: null,
              state: settledMatch,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        attemptCount += 1;
        // First 2 attempts fail with transient version conflict / lock
        if (attemptCount <= 2) {
          return {
            single: async () => ({
              data: { applied: false },
              error: { message: "version_conflict" },
            }),
          };
        }
        // 3rd attempt succeeds
        const nextState = startAuthoritativeOkeyNextRound(settledMatch, currentTime);
        return {
          single: async () => ({
            data: {
              applied: true,
              version: 11,
              state: nextState,
              turn_deadline_at: "2026-09-02T12:00:39.500Z",
              action_events: [{ type: "round", payload: { round: 2 } }],
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  const wakeupResult = await reconcileAuthoritativeServerLifecycleWakeup({
    client: mockClient,
    matchId: "test-wakeup-retry",
    requesterUserId: "p1",
    initialState: settledMatch,
    initialVersion: 10,
    eligibleAt,
    now: () => currentTime,
    sleep: async (ms: number) => {
      sleptIntervals.push(ms);
      currentTime += ms;
    },
    maxRetryDurationMs: 14_000,
    retryIntervalMs: 500,
  });

  // Slept 8500ms initially + 500ms after attempt 1 + 500ms after attempt 2 = 9500ms
  assert.deepEqual(sleptIntervals, [8_500, 500, 500]);
  assert.equal(wakeupResult.ok, true);
  assert.equal(wakeupResult.executed, true);
  assert.equal(wakeupResult.reason, "next_round_started");
  assert.equal(wakeupResult.state?.roundState.phase, "playing");
  assert.equal(wakeupResult.state?.currentRound, 2);
  assert.equal(attemptCount, 3);
});

test("Server Lifecycle Wake-up: gracefully recognizes if match was already transitioned by concurrent worker", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const budgetDelayMs = OKEY_ROUND_END_PRESENTATION_BUDGET.TOTAL_LIFECYCLE_DELAY_MS;
  const eligibleAt = new Date(roundFinishTime + budgetDelayMs).toISOString();
  let currentTime = roundFinishTime;

  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const settledMatch: OkeyAuthoritativeMatchState = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished",
      winnerId: "p1",
      endReason: "win",
    },
  }, roundFinishTime);

  const alreadyStartedMatch = startAuthoritativeOkeyNextRound(settledMatch, roundFinishTime + budgetDelayMs);

  const mockClient = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: 11,
              turn_deadline_at: "2026-09-02T12:00:38.500Z",
              state: alreadyStartedMatch,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  const wakeupResult = await reconcileAuthoritativeServerLifecycleWakeup({
    client: mockClient,
    matchId: "test-wakeup-concurrent",
    requesterUserId: "p1",
    initialState: settledMatch,
    initialVersion: 10,
    eligibleAt,
    now: () => currentTime,
    sleep: async (ms: number) => {
      currentTime += ms;
    },
    maxRetryDurationMs: 14_000,
    retryIntervalMs: 500,
  });

  assert.equal(wakeupResult.ok, true);
  assert.equal(wakeupResult.state?.roundState.phase, "playing");
  assert.equal(wakeupResult.reason, "already_transitioned");
});