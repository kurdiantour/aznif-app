import assert from "node:assert/strict";
import test from "node:test";

import { runDominoOneVsOnePostCommitLifecycle } from "../lifecycle/domino-one-vs-one-post-commit-lifecycle.ts";

function recordingClient(error: any = null) {
  const calls: any[] = [];
  return {
    calls,
    client: { rpc: async (name: string, payload: any) => {
      calls.push({ name, payload });
      return { data: null, error: name.includes("forfeits") ? error : null };
    } },
  };
}

test("move resets strikes and checks takeover for the next player", async () => {
  const { client, calls } = recordingClient();
  await runDominoOneVsOnePostCommitLifecycle({
    client, action: "move", roomId: "r", state: {}, status: "active",
    actingUserId: "p1", nextUserId: "p2",
  });
  assert.deepEqual(calls, [{
    name: "process_one_vs_one_turn_strikes",
    payload: { p_room_id: "r", p_acting_user_id: "p1", p_next_user_id: "p2", p_increment_acting: false },
  }]);
});

test("draw records only human activity or an auto-pass timeout", async () => {
  for (const [timedOut, autoPassed, expectedCalls, increment] of [
    [false, false, 1, false], [true, false, 0, false], [true, true, 1, true],
  ] as const) {
    const { client, calls } = recordingClient();
    await runDominoOneVsOnePostCommitLifecycle({
      client, action: "draw", roomId: "r", state: {}, status: null,
      actingUserId: "p1", nextUserId: "p2", timedOut, autoPassed,
    });
    assert.equal(calls.length, expectedCalls);
    if (calls[0]) assert.equal(calls[0].payload.p_increment_acting, increment);
  }
});

test("pass increments only timeout strikes", async () => {
  const { client, calls } = recordingClient();
  await runDominoOneVsOnePostCommitLifecycle({
    client, action: "pass", roomId: "r", state: {}, status: "active",
    actingUserId: "p1", nextUserId: "p2", timedOut: true,
  });
  assert.equal(calls[0].payload.p_increment_acting, true);
});

test("round completion resolves leave forfeits but a match completion does not", async () => {
  const round = recordingClient();
  await runDominoOneVsOnePostCommitLifecycle({
    client: round.client, action: "move", roomId: "r",
    state: { roundWinnerPlayerId: "p1" }, status: "active",
    actingUserId: "p1", nextUserId: "p1",
  });
  assert.equal(round.calls[0].name, "resolve_one_vs_one_round_leave_forfeits");

  const match = recordingClient();
  await runDominoOneVsOnePostCommitLifecycle({
    client: match.client, action: "move", roomId: "r",
    state: { roundWinnerPlayerId: "p1", winningTeamId: "teamA" }, status: "finished",
    actingUserId: "p1", nextUserId: "p1",
  });
  assert.deepEqual(match.calls, []);
});

test("forfeit resolution errors remain fatal", async () => {
  const failure = new Error("forfeit failed");
  const { client } = recordingClient(failure);
  await assert.rejects(runDominoOneVsOnePostCommitLifecycle({
    client, action: "pass", roomId: "r", state: { roundWinnerPlayerId: "p1" },
    status: "active", actingUserId: "p1", nextUserId: "p1",
  }), failure);
});
