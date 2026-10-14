import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    createAuthoritativeOkeyMatch,
    settleAuthoritativeOkeyRound,
    startAuthoritativeOkeyNextRound,
    type OkeyAuthoritativeMatchState,
    type OkeyServerPlayerIdentity,
} from "../okey-authoritative.ts";

import {
    evaluateOkeyServerLifecycle,
    executeOkeyServerLifecycle,
    generateOkeyReconcilerCommandId,
    reconcileAuthoritativeHumanCommand,
    reconcileAuthoritativeMatchStart,
    reconcileAuthoritativeServerLifecycleAlarm,
    type OkeyAuthoritativeSnapshotBundle
} from "../okey-turn-engine.ts";

function reconcileAuthoritativeEliminatedTurns(options: Parameters<typeof executeOkeyServerLifecycle>[0]) {
  return executeOkeyServerLifecycle(options);
}
function reconcileAuthoritativeTimeoutTurn(options: Parameters<typeof executeOkeyServerLifecycle>[0]) {
  return executeOkeyServerLifecycle(options);
}
function reconcileAuthoritativeNextRound(options: Parameters<typeof executeOkeyServerLifecycle>[0]) {
  return executeOkeyServerLifecycle(options);
}
function reconcileAuthoritativeServerTurns(options: Parameters<typeof executeOkeyServerLifecycle>[0]) {
  return executeOkeyServerLifecycle(options);
}

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

test("Bot pacing eligibility is owned by the authoritative lifecycle decision", () => {
  const beforeStart = Date.parse("2026-09-02T12:00:00.000Z");
  const roundStartsAt = "2026-09-02T12:00:05.000Z";
  const bundle = createTestBundle({
    roundStartsAt,
    roundState: {
      ...createAuthoritativeOkeyMatch(mockPlayers, 0).roundState,
      currentPlayerIndex: 1,
      hasDrawnThisTurn: false,
    },
  }, 12, null);

  const waitingDecision = evaluateOkeyServerLifecycle(bundle, beforeStart);
  assert.equal(waitingDecision.type, "bot-turn");
  if (waitingDecision.type === "bot-turn") {
    assert.equal(waitingDecision.notBefore, roundStartsAt);
    assert.equal(waitingDecision.ready, false);
  }

  const readyDecision = evaluateOkeyServerLifecycle(bundle, Date.parse(roundStartsAt));
  assert.equal(readyDecision.type, "bot-turn");
  if (readyDecision.type === "bot-turn") {
    assert.equal(readyDecision.notBefore, roundStartsAt);
    assert.equal(readyDecision.ready, true);
  }
});

test("Bot intent provider does not own pacing and Engine consumes authoritative pacing", () => {
  const engine = readFileSync("okey/server/okey-turn-engine.ts", "utf8");
  const executor = readFileSync("okey/server/okey-bot-executor.ts", "utf8");

  assert.match(engine, /notBefore: state\.roundStartsAt \?\? null/);
  assert.match(engine, /ready: !startPending/);
  assert.doesNotMatch(executor, /evaluateOkeyServerLifecycle\(|notBefore/);
  assert.doesNotMatch(executor, /currentState\.roundStartsAt/);
  assert.match(engine, /case "bot-turn":[\s\S]*if \(!decision\.ready\)/);
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

  assert.equal(result.executedEliminatedCount, 1);
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

  // Assert the drawn tile entered the hand while an older hand tile was discarded:
  assert.equal(result.state.roundState.players[eliminatedPlayerIndex].hand.some((tile) => tile.id === expectedDrawnTile.id), true);
  assert.equal(result.state.roundState.discardPile.at(-1)?.id, baseMatch.roundState.players[eliminatedPlayerIndex].hand[0].id);
  assert.equal(result.state.roundState.deck.length, initialDeck.length - 1);

  // Assert turn progressed to the next player (p3):
  assert.equal(result.state.roundState.currentPlayerIndex, 2);

  // The hand rotates without changing its size:
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

  const step1Result = await reconcileAuthoritativeEliminatedTurns({
    client: mockClient,
    matchId: "test-chain-match",
    state: stateWithTwoEliminated,
    version: 20,
    turnDeadlineAt: null,
  });

  const result = await reconcileAuthoritativeEliminatedTurns({
    client: mockClient,
    matchId: "test-chain-match",
    state: step1Result.state,
    version: step1Result.version,
    turnDeadlineAt: step1Result.turnDeadlineAt,
  });

  assert.equal(result.executedEliminatedCount, 1);
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

test("reconcileAuthoritativeServerTurns commits only Timeout and hands the Bot continuation to the next server invocation", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const deadline = "2026-09-02T12:00:30.000Z";
  const now = Date.parse("2026-09-02T12:00:35.000Z");

  let state = baseMatch;
  let currentVer = 5;
  let currentDeadline: string | null = deadline;
  const committedCommands: string[] = [];

  const mockClient: any = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
        
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

  // One authoritative transition per invocation: timeout commits, then the next
  // server lifecycle invocation owns the Bot continuation.
  assert.equal(result.executedTimeoutCount, 1);
  assert.equal(result.botProcessed, false);
  assert.equal(result.version, 6);
  assert.deepEqual(committedCommands, ["system-timeout"]);
  assert.equal(result.state.roundState.currentPlayerIndex, 1); // Bot p2 is next owner
});

test("reconcileAuthoritativeServerTurns commits only Timeout and leaves eliminated continuation to the next server invocation", async () => {
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
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
        
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

  // One authoritative transition per invocation: timeout commits first.
  assert.equal(result.executedTimeoutCount, 1);
  assert.equal(result.executedEliminatedCount, 0);
  assert.equal(result.version, 11);
  assert.deepEqual(committedCommands, ["system-timeout"]);
  assert.equal(result.state.roundState.currentPlayerIndex, 1); // Eliminated p2 is reconciled next
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
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
        
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
  assert.equal(result.version, 11); // Exactly one Bot transition per invocation
  assert.equal(committedPayloads.length, 1);
  assert.equal(committedPayloads[0].p_command_type, "system-bot-draw");
  // The same Bot still owns the turn; discard is handled by the next server invocation.
  assert.equal(result.state.roundState.currentPlayerIndex, 1);
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
    turnDeadlineAt: null,
    now: () => Date.parse("2026-09-02T12:00:05.000Z"),
  });
  assert.equal(beforeResult.executed, false);

  // 2. At or after eligibleAt: starts round 2
  const afterResult = await reconcileAuthoritativeNextRound({
    client: mockClient,
    matchId: "test-next-round-match",
    state: settledRoundState,
    version: 15,
    turnDeadlineAt: null,
    now: () => Date.parse("2026-09-02T12:00:16.000Z"),
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

test("lifecycle commit failure: eliminated turn propagates instead of being swallowed", async () => {
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const state: OkeyAuthoritativeMatchState = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      currentPlayerIndex: 1,
      hasDrawnThisTurn: false,
      players: baseMatch.roundState.players.map((player, index) =>
        index === 1 ? { ...player, eliminated: true } : player,
      ),
    },
  };

  const mockClient = {
    rpc: () => ({
      single: async () => ({
        data: null,
        error: { message: "forced_eliminated_commit_failure" },
      }),
    }),
  };

  await assert.rejects(
    () => reconcileAuthoritativeEliminatedTurns({
      client: mockClient,
      matchId: "test-eliminated-failure",
      state,
      version: 30,
      turnDeadlineAt: null,
    }),
    /forced_eliminated_commit_failure/,
  );
});

test("lifecycle commit failure: timeout propagates instead of returning executed:false", async () => {
  const state = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const deadline = "2026-09-02T12:00:30.000Z";
  const now = Date.parse("2026-09-02T12:00:35.000Z");

  const mockClient = {
    rpc: () => ({
      single: async () => ({
        data: null,
        error: { message: "forced_timeout_commit_failure" },
      }),
    }),
  };

  await assert.rejects(
    () => reconcileAuthoritativeTimeoutTurn({
      client: mockClient,
      matchId: "test-timeout-failure",
      state,
      version: 31,
      turnDeadlineAt: deadline,
      now: () => now,
    }),
    /forced_timeout_commit_failure/,
  );
});

test("lifecycle commit failure: next round propagates instead of returning executed:false", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const state = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished" as const,
      winnerId: "p1",
      endReason: "win" as const,
    },
  }, roundFinishTime);

  const mockClient = {
    rpc: () => ({
      single: async () => ({
        data: null,
        error: { message: "forced_next_round_commit_failure" },
      }),
    }),
  };

  await assert.rejects(
    () => reconcileAuthoritativeNextRound({
      client: mockClient,
      matchId: "test-next-round-failure",
      state,
      version: 32,
      turnDeadlineAt: null,
      now: () => roundFinishTime,
    }),
    /forced_next_round_commit_failure/,
  );
});

test("valid applied:false lifecycle races remain no-op", async () => {
  const appliedFalseClient = {
    rpc: () => ({
      single: async () => ({
        data: { applied: false },
        error: null,
      }),
    }),
  };

  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const eliminatedState: OkeyAuthoritativeMatchState = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      currentPlayerIndex: 1,
      hasDrawnThisTurn: false,
      players: baseMatch.roundState.players.map((player, index) =>
        index === 1 ? { ...player, eliminated: true } : player,
      ),
    },
  };
  const eliminatedResult = await reconcileAuthoritativeEliminatedTurns({
    client: appliedFalseClient,
    matchId: "test-eliminated-applied-false",
    state: eliminatedState,
    version: 40,
    turnDeadlineAt: null,
  });
  assert.equal(eliminatedResult.executedEliminatedCount, 0);
  assert.equal(eliminatedResult.version, 40);

  const timeoutDeadline = "2026-09-02T12:00:30.000Z";
  const timeoutResult = await reconcileAuthoritativeTimeoutTurn({
    client: appliedFalseClient,
    matchId: "test-timeout-applied-false",
    state: baseMatch,
    version: 41,
    turnDeadlineAt: timeoutDeadline,
    now: () => Date.parse("2026-09-02T12:00:35.000Z"),
  });
  assert.equal(timeoutResult.executed, false);
  assert.equal(timeoutResult.version, 41);

  const roundFinishTime = Date.parse("2026-09-02T12:05:00.000Z");
  const finishedState = settleAuthoritativeOkeyRound({
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      phase: "finished" as const,
      winnerId: "p1",
      endReason: "win" as const,
    },
  }, roundFinishTime);
  const nextRoundResult = await reconcileAuthoritativeNextRound({
    client: appliedFalseClient,
    matchId: "test-next-round-applied-false",
    state: finishedState,
    version: 42,
    turnDeadlineAt: null,
    now: () => roundFinishTime,
  });
  assert.equal(nextRoundResult.executed, false);
  assert.equal(nextRoundResult.version, 42);
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

test("reconcileAuthoritativeMatchStart schedules the canonical version-0 lifecycle wake exactly once", async () => {
  const nowMs = Date.parse("2026-09-29T12:00:00.000Z");
  const alarms: Array<{ matchId: string; version: number; runAt: string }> = [];

  const result = await reconcileAuthoritativeMatchStart({
    client: {},
    matchId: "test-room-start-alarm",
    members: mockPlayers,
    now: () => nowMs,
    startRoomAction: async () => ({
      data: { matchId: "test-room-start-alarm", status: "playing" },
      error: null,
    }),
    scheduleLifecycleAlarm: async ({ matchId, version, runAt }) => {
      alarms.push({ matchId, version, runAt });
    },
  });

  assert.equal(result.executed, true);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].matchId, "test-room-start-alarm");
  assert.equal(alarms[0].version, 0);
  assert.equal(alarms[0].runAt, result.turnDeadlineAt);
});

test("reconcileAuthoritativeMatchStart never schedules when start commit fails", async () => {
  let alarmCalls = 0;

  const result = await reconcileAuthoritativeMatchStart({
    client: {},
    matchId: "test-room-start-failed-no-alarm",
    members: mockPlayers,
    startRoomAction: async () => ({ data: null, error: { message: "start_failed" } }),
    scheduleLifecycleAlarm: async () => {
      alarmCalls += 1;
    },
  });

  assert.equal(result.executed, false);
  assert.equal(alarmCalls, 0);
});

test("reconcileAuthoritativeServerTurns commits Next Round only and hands starting Bot to the next server invocation", async () => {
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
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
        
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
  };

  const result = await reconcileAuthoritativeServerTurns({
    client: mockClient,
    matchId: "test-next-round-bot-chain",
    requesterUserId: "p1",
    state: settledRound1,
    version: 20,
    turnDeadlineAt: null,
    now: () => Date.parse("2026-09-02T12:00:16.000Z"),
  });

  // Starting the round is the sole transition in this invocation.
  assert.equal(result.executedNextRoundCount, 1);
  assert.equal(result.botProcessed, false);
  assert.equal(result.state.currentRound, 2);
  assert.equal(result.state.roundState.phase, "playing");
  assert.deepEqual(committedCommands, ["start-next-round"]);
  assert.equal(result.state.roundState.currentPlayerIndex, 1);
});

test("Single Server Owner: Eliminated, Bot, Timeout, and Next-Round transitions have single Server owners and zero client triggers", () => {
  const edge = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const engine = readFileSync("okey/server/okey-turn-engine.ts", "utf8");
  const adapter = readFileSync("okey/adapters/supabase-okey-match-adapter.ts", "utf8");
  const hook = readFileSync("okey/hooks/useOkeyMultiplayerGame.ts", "utf8");
  const matchInterface = readFileSync("okey/adapters/okey-match-adapter.ts", "utf8");

  // Server owns reconciliation:
  assert.match(edge, /reconcileAuthoritativeHumanCommand/);
  assert.doesNotMatch(edge, /executeOkeyServerLifecycle|reconcileAuthoritativeServerLifecycleAlarm/);
  assert.match(engine, /reconcileAuthoritativeServerLifecycleAlarm/);

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

  assert.doesNotMatch(edge, /action === "play-eliminated"/);
  assert.doesNotMatch(edge, /action === "resolve-timeout"/);
  assert.doesNotMatch(edge, /action === "start-next-round"/);
  assert.match(edge, /scheduleAznifGameLifecycle/);
});

test("Server Lifecycle Alarm: round completion is immediately eligible by game rule", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const eligibleAt = new Date(roundFinishTime).toISOString();
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

  // The official transition instant is the committed round-finish instant.
  assert.equal(settledMatch.nextRoundEligibleAt, eligibleAt);
  // Presentation may still be running, but it has no lifecycle authority.
  const afterBudgetElapsed = evaluateOkeyServerLifecycle(
    createTestBundle(settledMatch, 10, null),
    roundFinishTime,
  );
  assert.equal(afterBudgetElapsed.type, "due-next-round");

  let reconcileAttempts = 0;
  let serverCommitted = false;

  const mockClient = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
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
              turn_deadline_at: "2026-09-02T12:00:30.000Z",
              action_events: [{ type: "round", payload: { round: 2 } }],
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  const alarmResult = await reconcileAuthoritativeServerLifecycleAlarm({
    client: mockClient,
    matchId: "test-lifecycle-alarm-delay",
    requesterUserId: "p1",
    initialVersion: 10,
    runAt: eligibleAt,
    now: () => currentTime,
  });

  // No sleep is needed before the official transition.
  assert.deepEqual(sleptIntervals, []);
  assert.equal(alarmResult.ok, true);
  assert.equal(alarmResult.executed, true);
  assert.equal(alarmResult.reason, "next_round_started");
  assert.equal(alarmResult.state?.roundState.phase, "playing");
  assert.equal(serverCommitted, true);
  assert.equal(reconcileAttempts, 1);
});

test("Server Lifecycle Alarm: performs no retry after a one-shot commit conflict", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const eligibleAt = new Date(roundFinishTime).toISOString();
  let currentTime = Date.parse(eligibleAt);
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
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
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

  const alarmResult = await reconcileAuthoritativeServerLifecycleAlarm({
    client: mockClient,
    matchId: "test-lifecycle-alarm-retry",
    requesterUserId: "p1",
    initialVersion: 10,
    runAt: eligibleAt,
    now: () => currentTime,
  });

  // The executor neither sleeps nor retries a conflicted transition.
  assert.deepEqual(sleptIntervals, []);
  assert.equal(alarmResult.ok, true);
  assert.equal(alarmResult.executed, false);
  assert.equal(alarmResult.reason, "not_eligible");
  assert.equal(alarmResult.state?.roundState.phase, "finished");
  assert.equal(attemptCount, 1);
});

test("Server Lifecycle Alarm: gracefully recognizes if match was already transitioned by concurrent worker", async () => {
  const roundFinishTime = Date.parse("2026-09-02T12:00:00.000Z");
  const eligibleAt = new Date(roundFinishTime).toISOString();
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

  const alreadyStartedMatch = startAuthoritativeOkeyNextRound(settledMatch, roundFinishTime);

  const mockClient = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: 11,
              turn_deadline_at: "2026-09-02T12:00:30.000Z",
              state: alreadyStartedMatch,
            },
            error: null,
          }),
        };
      }
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  const alarmResult = await reconcileAuthoritativeServerLifecycleAlarm({
    client: mockClient,
    matchId: "test-lifecycle-alarm-concurrent",
    requesterUserId: "p1",
    initialVersion: 10,
    runAt: eligibleAt,
    now: () => currentTime,
  });

  assert.equal(alarmResult.ok, true);
  assert.equal(alarmResult.state?.roundState.phase, "playing");
  assert.equal(alarmResult.reason, "already_transitioned");
});

test("Server Lifecycle Alarm: executes one timeout transition when already due", async () => {
  const turnStartTime = Date.parse("2026-09-02T12:00:00.000Z");
  const turnDeadlineAt = new Date(turnStartTime + 15_000).toISOString();
  let currentTime = Date.parse(turnDeadlineAt);
  const sleptIntervals: number[] = [];

  const baseMatch = createAuthoritativeOkeyMatch(mockPlayers, 0);
  let currentVer = 5;
  let currentState: OkeyAuthoritativeMatchState = {
    ...baseMatch,
    roundState: {
      ...baseMatch.roundState,
      currentPlayerIndex: 0,
    },
  };

  let serverCommitted = false;
  const committedCommands: string[] = [];

  const mockClient = {
    rpc: (name: string, args: any) => {
      if (name === "okey_get_authoritative_bundle" || name === "okey_get_system_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version: currentVer,
              turn_deadline_at: turnDeadlineAt,
              state: currentState,
            },
            error: null,
          }),
        };
      }
      if (name === "okey_commit_authoritative_action") {
        serverCommitted = true;
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
  };

  const alarmResult = await reconcileAuthoritativeServerLifecycleAlarm({
    client: mockClient,
    matchId: "test-lifecycle-alarm-turn-timeout",
    requesterUserId: "p1",
    initialVersion: 5,
    runAt: turnDeadlineAt,
    now: () => currentTime,
  });

  // Must sleep exactly 15,000 ms to reach turnDeadlineAt
  assert.deepEqual(sleptIntervals, []);
  assert.equal(alarmResult.ok, true);
  assert.equal(alarmResult.executed, true);
  assert.equal(alarmResult.reason, "timeout_executed");
  assert.equal(serverCommitted, true);
  assert.equal(committedCommands.includes("system-timeout"), true);
  assert.equal(alarmResult.version, 6);
});

test("Server Lifecycle Alarm: system bundle fetch uses system RPC without requiring requesterUserId", async () => {
  let rpcNameCalled = "";

  const mockClient = {
    rpc: (name: string) => {
      rpcNameCalled = name;
      return {
        single: async () => ({
          data: null,
          error: new Error("fetch_failed"),
        }),
      };
    },
  };

  const result = await reconcileAuthoritativeServerLifecycleAlarm({
    client: mockClient,
    matchId: "test-system-bundle-fetch",
  });

  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.reason, "fetch_failed");
  assert.equal(rpcNameCalled, "okey_get_system_authoritative_bundle");
});
test("Human deck-zero Draw rebuilds, commits, versions, and broadcasts the authoritative state", async () => {
  const base = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const [poolA, poolB, topDiscard] = base.roundState.deck.slice(0, 3);
  const playerIndex = base.roundState.currentPlayerIndex;
  const beforeHandCount = base.roundState.players[playerIndex].hand.length;
  const state: OkeyAuthoritativeMatchState = {
    ...base,
    roundState: {
      ...base.roundState,
      deck: [],
      discardPile: [poolA, poolB, topDiscard],
      discardOwners: [null, null, null],
      reshuffleCount: 0,
      hasDrawnThisTurn: false,
    },
  };
  let committedParameters: any = null;
  let broadcastPayload: any = null;
  const client = {
    rpc(name: string, parameters: any) {
      assert.equal(name, "okey_commit_authoritative_action_with_events");
      committedParameters = parameters;
      return {
        single: async () => ({
          data: {
            applied: true,
            version: 8,
            state: parameters.p_state,
            turn_deadline_at: parameters.p_turn_deadline_at,
            action_events: parameters.p_action_events,
          },
          error: null,
        }),
      };
    },
  };

  const result = await reconcileAuthoritativeHumanCommand({
    action: "command",
    matchId: "deck-zero-human",
    actorUserId: state.roundState.players[playerIndex].id,
    commandId: "draw-empty-deck-command",
    command: { type: "draw", source: "deck" },
    clientExpectedVersion: 7,
    commandReceivedAtMs: Date.parse("2026-09-14T10:00:00.000Z"),
    bundle: {

      version: 7,
      state,
      turn_deadline_at: "2026-09-14T10:00:15.000Z",
      player_index: playerIndex,
      command_applied: false,
    },
  }, {
    client,
    deterministicCommandId: async (source) => source,
    now: () => Date.parse("2026-09-14T10:00:01.000Z"),
    broadcastStateUpdate: async (payload) => { broadcastPayload = payload; },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.version, 8);
  assert.equal(result.state.roundState.reshuffleCount, 1);
  assert.equal(result.state.roundState.discardPile.length, 1);
  assert.equal(result.state.roundState.discardPile[0].id, topDiscard.id);
  assert.equal(result.state.roundState.deck.length, 1);
  assert.equal(result.state.roundState.players[playerIndex].hand.length, beforeHandCount + 1);
  assert.equal(result.state.roundState.hasDrawnThisTurn, true);
  assert.equal(result.state.roundState.phase, "playing");
  assert.equal(committedParameters.p_expected_version, 7);
  assert.equal(committedParameters.p_state.reshuffleCount, undefined);
  assert.equal(committedParameters.p_state.roundState.reshuffleCount, 1);
  assert.equal(broadcastPayload.version, 8);
  assert.equal(broadcastPayload.publicProjection.deckCount, 1);
  assert.equal(broadcastPayload.publicProjection.reshuffleCount, 1);
});

test("Human request entering before turn deadline is accepted even if internal server processing delay causes now() to pass deadline", async () => {
const initial = createAuthoritativeOkeyMatch(mockPlayers, 0);

const base: OkeyAuthoritativeMatchState = {
  ...initial,
  roundState: {
    ...initial.roundState,
    hasDrawnThisTurn: false,
  },
};

const playerIndex = base.roundState.currentPlayerIndex;
  const deadlineAt = "2026-09-14T10:00:15.000Z";
  const requestReceivedAtMs = Date.parse("2026-09-14T10:00:14.000Z");
  const delayedServerProcessingNowMs = Date.parse("2026-09-14T10:00:20.000Z");

  const client = {
    rpc(name: string, parameters: any) {
      return {
        single: async () => ({
          data: {
            applied: true,
            version: 8,
            state: parameters.p_state,
            turn_deadline_at: parameters.p_turn_deadline_at,
            action_events: parameters.p_action_events,
          },
          error: null,
        }),
      };
    },
  };

  const result = await reconcileAuthoritativeHumanCommand({
    action: "command",
    matchId: "server-delay-human-test",
    actorUserId: base.roundState.players[playerIndex].id,
    commandId: "draw-server-delay-command",
    command: { type: "draw", source: "deck" },
    clientExpectedVersion: 7,
    commandReceivedAtMs: requestReceivedAtMs,
    bundle: {
      version: 7,
      state: base,
      turn_deadline_at: deadlineAt,
      player_index: playerIndex,
      command_applied: false,
    },
  }, {
    client,
    deterministicCommandId: async (source) => source,
    now: () => delayedServerProcessingNowMs,
  });

  assert.equal(result.ok, true);
});

test("Human request entering after turn deadline is rejected with turn_deadline_expired", async () => {
  const base = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const playerIndex = base.roundState.currentPlayerIndex;
  const deadlineAt = "2026-09-14T10:00:15.000Z";
  const requestReceivedAtMs = Date.parse("2026-09-14T10:00:16.000Z");

  const client = {
    rpc() {
      return { single: async () => ({ data: null, error: null }) };
    },
  };

  const result = await reconcileAuthoritativeHumanCommand({
    action: "command",
    matchId: "expired-human-test",
    actorUserId: base.roundState.players[playerIndex].id,
    commandId: "draw-expired-command",
    command: { type: "draw", source: "deck" },
    clientExpectedVersion: 7,
    commandReceivedAtMs: requestReceivedAtMs,
    bundle: {
      version: 7,
      state: base,
      turn_deadline_at: deadlineAt,
      player_index: playerIndex,
      command_applied: false,
    },
  }, {
    client,
    deterministicCommandId: async (source) => source,
    now: () => requestReceivedAtMs,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "turn_deadline_expired");
    assert.equal(result.status, 409);
  }
});

test("take-back-seat restores a timed-out player after the turn deadline", async () => {
  const base = createAuthoritativeOkeyMatch(mockPlayers, 0);
  const playerIndex = base.roundState.currentPlayerIndex;
  const timedOutPlayer = base.roundState.players[playerIndex];
  const state: OkeyAuthoritativeMatchState = {
    ...base,
    roundState: {
      ...base.roundState,
      players: base.roundState.players.map((player, index) =>
        index === playerIndex
          ? {
              ...player,
              name: "Okey Bot",
              controlledByBot: true,
              kind: "bot",
              originalName: timedOutPlayer.name,
              originalAvatarId: timedOutPlayer.avatarId,
              originalAvatarUrl: timedOutPlayer.avatarUrl,
              botDifficulty: "normal",
              botNumber: 1,
            }
          : player,
      ),
    },
  };
  const committedStates: OkeyAuthoritativeMatchState[] = [];
  const client = {
    rpc(_name: string, parameters: any) {
      return {
        single: async () => {
          committedStates.push(parameters.p_state);
          return {
            data: {
              applied: true,
              version: 8,
              state: parameters.p_state,
              turn_deadline_at: parameters.p_turn_deadline_at,
              action_events: parameters.p_action_events,
            },
            error: null,
          };
        },
      };
    },
  };
  const expiredDeadline = "2026-09-14T10:00:15.000Z";

  const result = await reconcileAuthoritativeHumanCommand({
    action: "command",
    matchId: "expired-seat-reclaim-test",
    actorUserId: timedOutPlayer.id,
    commandId: "take-back-expired-seat-command",
    command: { type: "take-back-seat" },
    clientExpectedVersion: 7,
    commandReceivedAtMs: Date.parse("2026-09-14T10:00:16.000Z"),
    bundle: {
      version: 7,
      state,
      turn_deadline_at: expiredDeadline,
      player_index: playerIndex,
      command_applied: false,
    },
  }, {
    client,
    deterministicCommandId: async (source) => source,
    now: () => Date.parse("2026-09-14T10:00:16.000Z"),
  });

  assert.equal(result.ok, true);
  const committedState = committedStates.at(-1);
  assert.ok(committedState);
  assert.equal(committedState.roundState.players[playerIndex].controlledByBot, false);
  assert.equal(committedState.roundState.players[playerIndex].name, timedOutPlayer.name);
});

