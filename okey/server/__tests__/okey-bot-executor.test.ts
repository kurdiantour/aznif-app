import assert from "node:assert/strict";
import test from "node:test";

import { handSeatToBot } from "../../engine/okey-bot-policy.ts";
import { executeOkeyBotTurn } from "../okey-bot-executor.ts";
import { createAuthoritativeOkeyMatch } from "../okey-authoritative.ts";

const players = [
  { id: "player-0", name: "Player 0" },
  { id: "player-1", name: "Player 1" },
  { id: "player-2", name: "Player 2" },
  { id: "player-3", name: "Player 3" },
] as const;

function botMatch(hasDrawnThisTurn: boolean) {
  const match = createAuthoritativeOkeyMatch(players, 0);
  const playerIndex = match.roundState.currentPlayerIndex;

  return {
    ...match,
    roundState: {
      ...handSeatToBot(match.roundState, playerIndex, "normal"),
      hasDrawnThisTurn,
    },
  };
}

function fakeClient(input: {
  state: ReturnType<typeof botMatch>;
  version?: number;
  applied?: boolean | ((attempt: number, args: any) => boolean);
  handoffError?: Error;
  commitError?: Error | null;
  isTest?: boolean;
  committedEvents?: any[];
}) {
  const calls = {
    commits: [] as any[],
    settlements: [] as any[],
  };

  const version = input.version ?? 5;

  const client: any = {
    rpc(name: string, args: any) {
      if (name === "okey_get_authoritative_bundle") {
        return {
          single: async () => ({
            data: {
              version,
              status: "playing",
              turn_deadline_at: null,
              player_index: 0,
              state: input.state,
              command_applied: false,
            },
            error: null,
          }),
        };
      }

      if (name === "okey_commit_authoritative_action") {
        calls.commits.push(args);

        return {
          single: async () => ({
            data: input.commitError
              ? null
              : {
                  applied:
                    typeof input.applied === "function"
                      ? input.applied(calls.commits.length, args)
                      : input.applied ?? true,
                  version: Number(args.p_expected_version) + 1,
                  action_events: input.committedEvents ?? [],
                },
            error: input.commitError ?? null,
          }),
        };
      }

      if (name === "okey_settle_match") {
        calls.settlements.push(args);
        return Promise.resolve({ error: null });
      }

      throw new Error(`unexpected_rpc:${name}`);
    },

    schema(schema: string) {
      assert.equal(schema, "okey");

      return {
        from(table: string) {
          assert.equal(table, "matches");

          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        is_test: input.isTest ?? false,
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    client,
    calls,
  };
}

async function execute(
  state: ReturnType<typeof botMatch>,
  options: Parameters<typeof fakeClient>[0] = { state },
) {
  const actor =
    state.roundState.players[state.roundState.currentPlayerIndex];

  const harness = fakeClient({
    ...options,
    state,
  });

  const broadcasts: any[] = [];

  const result = await executeOkeyBotTurn(
    {
      matchId: "match-1",
      requesterUserId: "requester-1",
      expectedVersion: options.version ?? 5,
      expectedActorId: actor.id,
    },
    {
      client: harness.client,
      deterministicCommandId: async (source) => `id:${source}`,
      now: () => Date.parse("2026-08-30T00:00:00.000Z"),
      wait: async () => undefined,
      broadcastStateUpdate: async (message) => {
        broadcasts.push(message);
      },
    },
  );

  return {
    result,
    broadcasts,
    ...harness,
  };
}

test(
  "a Bot draw claim commits exactly one draw transition per invocation",
  async () => {
    const state = botMatch(false);

    const { result, calls } = await execute(state);

    assert.equal(result.processed, true);
    assert.deepEqual(result.steps, ["draw"]);
    assert.equal(result.finalVersion, 6);
    assert.equal(result.reason, "transition_committed");

    assert.equal(calls.commits.length, 1);

    assert.equal(
      calls.commits[0].p_command_type,
      "system-bot-draw",
    );

    assert.equal(
      calls.commits[0].p_expected_version,
      5,
    );

    assert.equal(
      calls.commits[0].p_action_events[0].type,
      "draw",
    );

  },
);

test(
  "valid Bot discard claim commits the current discard step",
  async () => {
    const state = botMatch(true);

    const { result, calls } = await execute(state);

    assert.equal(result.processed, true);
    assert.deepEqual(result.steps, ["discard"]);
    assert.equal(result.reason, "transition_committed");

    assert.equal(calls.commits.length, 1);

    assert.equal(
      calls.commits[0].p_command_type,
      "system-bot-discard",
    );
  },
);

test(
  "stale version and stale actor execute no Bot step",
  async () => {
    const state = botMatch(false);

    const staleVersionHarness = fakeClient({
      state,
      version: 6,
    });

    const actor =
      state.roundState.players[
        state.roundState.currentPlayerIndex
      ];

    const staleVersion = await executeOkeyBotTurn(
      {
        matchId: "match-1",
        requesterUserId: "requester-1",
        expectedVersion: 5,
        expectedActorId: actor.id,
      },
      {
        client: staleVersionHarness.client,
        deterministicCommandId: async () => "id",
        wait: async () => undefined,
      },
    );

    assert.equal(
      staleVersion.reason,
      "stale_bot_turn",
    );

    assert.equal(
      staleVersionHarness.calls.commits.length,
      0,
    );

    const staleActorHarness = fakeClient({
      state,
    });

    const staleActor = await executeOkeyBotTurn(
      {
        matchId: "match-1",
        requesterUserId: "requester-1",
        expectedVersion: 5,
        expectedActorId: "other-player",
      },
      {
        client: staleActorHarness.client,
        deterministicCommandId: async () => "id",
        wait: async () => undefined,
      },
    );

    assert.equal(
      staleActor.reason,
      "stale_bot_turn",
    );

    assert.equal(
      staleActorHarness.calls.commits.length,
      0,
    );
  },
);

test(
  "Human-controlled actor is rejected before decision or commit",
  async () => {
    const human = createAuthoritativeOkeyMatch(
      players,
      0,
    );

    const harness = fakeClient({
      state: human as ReturnType<typeof botMatch>,
    });

    const actor =
      human.roundState.players[
        human.roundState.currentPlayerIndex
      ];

    const result = await executeOkeyBotTurn(
      {
        matchId: "match-1",
        requesterUserId: "requester-1",
        expectedVersion: 5,
        expectedActorId: actor.id,
      },
      {
        client: harness.client,
        deterministicCommandId: async () => "id",
        wait: async () => undefined,
      },
    );

    assert.equal(
      result.reason,
      "current_player_is_human",
    );

    assert.equal(
      harness.calls.commits.length,
      0,
    );
  },
);

test(
  "duplicate commit is normalized and never broadcasts",
  async () => {
    const state = botMatch(false);

    const {
      result,
      calls,
      broadcasts,
    } = await execute(state, {
      state,
      applied: false,
    });

    assert.equal(
      result.reason,
      "already_processed",
    );

    assert.equal(
      calls.commits.length,
      1,
    );

    assert.equal(
      broadcasts.length,
      0,
    );
  },
);

test(
  "version conflict is normalized as a stale Bot controller",
  async () => {
    const state = botMatch(false);

    const {
      result,
      calls,
    } = await execute(state, {
      state,
      commitError: new Error("version_conflict"),
    });

    assert.equal(
      result.reason,
      "stale_bot_controller",
    );

    assert.equal(
      calls.commits.length,
      1,
    );
  },
);

test(
  "finished match executes no Bot step",
  async () => {
    const state = {
      ...botMatch(false),
      matchFinished: true,
    };

    const {
      result,
      calls,
    } = await execute(state);

    assert.equal(
      result.reason,
      "match_finished",
    );

    assert.equal(
      calls.commits.length,
      0,
    );
  },
);

test(
  "successful commit broadcasts the committed action events",
  async () => {
    const state = botMatch(false);

    const events = [
      {
        matchId: "match-1",
        version: 6,
        sequence: 1,
        type: "draw",
        actorPlayerId: "player-1",
        payload: {},
      },
    ];

    const {
      result,
      broadcasts,
    } = await execute(state, {
      state,
      committedEvents: events,
    });

    assert.equal(
      result.processed,
      true,
    );

    assert.equal(
      broadcasts.length,
      1,
    );

    assert.equal(
      broadcasts[0].matchId,
      "match-1",
    );

    assert.equal(
      broadcasts[0].commandId,
      "id:okey:match-1:system-bot-draw:5",
    );

    assert.equal(
      broadcasts[0].version,
      6,
    );

    assert.equal(
      broadcasts[0].publicProjection.version,
      6,
    );

    assert.equal(
      broadcasts[0].publicProjection.players.some(
        (player: any) => Array.isArray(player.hand),
      ),
      false,
    );

    assert.deepEqual(
      broadcasts[0].actionEvents,
      events,
    );
  },
);

test(
  "a Bot terminal discard preserves canonical match settlement",
  async () => {
    const base = botMatch(true);

    const playerIndex =
      base.roundState.currentPlayerIndex;

    const terminal = {
      ...base,
      currentRound: 7,
      roundState: {
        ...base.roundState,
        players: base.roundState.players.map(
          (player, index) =>
            index === playerIndex
              ? {
                  ...player,
                  hand: [player.hand[0]],
                }
              : player,
        ),
      },
    };

    const {
      result,
      calls,
    } = await execute(terminal);

    assert.equal(
      result.processed,
      true,
    );

    assert.equal(
      result.reason,
      "match_finished",
    );

    assert.equal(
      calls.settlements.length,
      1,
    );

    assert.equal(
      calls.settlements[0].p_match_id,
      "match-1",
    );
  },
);

test(
  "one invocation commits only the claimed Bot step at the expected version",
  async () => {
    const state = botMatch(false);

    const {
      result,
      calls,
    } = await execute(state);

    assert.deepEqual(
      result.steps,
      ["draw"],
    );

    assert.deepEqual(
      calls.commits.map(
        (commit) => commit.p_expected_version,
      ),
      [5],
    );
  },
);

test(
  "one invocation stops after one transition even when the next seat is also a Bot",
  async () => {
    const state = botMatch(false);

    const nextPlayerIndex =
      (
        state.roundState.currentPlayerIndex + 1
      ) %
      state.roundState.players.length;

    const botChainState = {
      ...state,
      roundState: handSeatToBot(
        state.roundState,
        nextPlayerIndex,
        "normal",
      ),
    };

    const {
      result,
      calls,
    } = await execute(botChainState);

    assert.equal(
      result.reason,
      "transition_committed",
    );

    assert.deepEqual(
      result.steps,
      ["draw"],
    );

    assert.deepEqual(
      calls.commits.map(
        (commit) => commit.p_expected_version,
      ),
      [5],
    );
  },
);

test(
  "concurrent claims produce one applied result and one already-processed result",
  async () => {
    const state = botMatch(false);

    const actor =
      state.roundState.players[
        state.roundState.currentPlayerIndex
      ];

    let authoritativeVersion = 5;

    const harness = fakeClient({
      state,
      applied: (_attempt, args) => {
        if (
          Number(args.p_expected_version) !==
          authoritativeVersion
        ) {
          return false;
        }

        authoritativeVersion += 1;
        return true;
      },
    });

    const broadcasts: any[] = [];

    const run = () =>
      executeOkeyBotTurn(
        {
          matchId: "match-1",
          requesterUserId: "requester-1",
          expectedVersion: 5,
          expectedActorId: actor.id,
        },
        {
          client: harness.client,
          deterministicCommandId: async () =>
            "same-command-id",
          wait: async () => undefined,
          broadcastStateUpdate: async (message) => {
            broadcasts.push(message);
          },
        },
      );

    const results = await Promise.all([
      run(),
      run(),
    ]);

    assert.equal(
      results.filter(
        (result) => result.processed,
      ).length,
      1,
    );

    assert.equal(
      results.filter(
        (result) => !result.processed,
      ).length,
      1,
    );

    const appliedResult =
      results.find(
        (result) => result.processed,
      );

    const duplicateResult =
      results.find(
        (result) => !result.processed,
      );

    assert.ok(appliedResult);
    assert.ok(duplicateResult);

    assert.deepEqual(
      appliedResult.steps,
      ["draw"],
    );

    assert.equal(
      appliedResult.reason,
      "transition_committed",
    );

    assert.equal(
      duplicateResult.reason,
      "already_processed",
    );

    assert.equal(
      broadcasts.length,
      1,
    );

    assert.equal(
      harness.calls.commits.length,
      2,
    );
  },
);

test(
  "concurrent terminal claims settle exactly once",
  async () => {
    const base = botMatch(true);

    const playerIndex =
      base.roundState.currentPlayerIndex;

    const terminal = {
      ...base,
      currentRound: 7,
      roundState: {
        ...base.roundState,
        players: base.roundState.players.map(
          (player, index) =>
            index === playerIndex
              ? {
                  ...player,
                  hand: [player.hand[0]],
                }
              : player,
        ),
      },
    };

    const actor =
      terminal.roundState.players[
        playerIndex
      ];

    const harness = fakeClient({
      state: terminal,
      applied: (attempt) =>
        attempt === 1,
    });

    const run = () =>
      executeOkeyBotTurn(
        {
          matchId: "match-1",
          requesterUserId: "requester-1",
          expectedVersion: 5,
          expectedActorId: actor.id,
        },
        {
          client: harness.client,
          deterministicCommandId: async () =>
            "same-terminal-command-id",
          wait: async () => undefined,
          broadcastStateUpdate: async () =>
            undefined,
        },
      );

    const results = await Promise.all([
      run(),
      run(),
    ]);

    assert.equal(
      results.filter(
        (result) => result.processed,
      ).length,
      1,
    );

    assert.equal(
      harness.calls.settlements.length,
      1,
    );
  },
);
