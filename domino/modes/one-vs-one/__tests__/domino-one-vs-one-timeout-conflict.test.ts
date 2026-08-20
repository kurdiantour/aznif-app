import assert from "node:assert/strict";
import test from "node:test";

import { reconcileDominoOneVsOneCommit } from "../server/domino-one-vs-one-timeout-conflict.ts";

function clientWithRoom(room: any, error: any = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: room, error }),
  };
  return { from: () => chain };
}

const responseFactory = (code: any, message: string, room: any) =>
  new Response(JSON.stringify({ code, message, version: room.version }), { status: 409 });

test("successful commits pass through without loading the room", async () => {
  const result = await reconcileDominoOneVsOneCommit({
    client: { from: () => { throw new Error("must not load"); } },
    commit: { ok: true, data: { version: 2 } },
    timedOut: true,
    roomId: "r1",
    expectedVersion: 1,
    originalRoom: { version: 1 },
    alreadyProcessedMessage: "done",
    staleMessage: "stale",
    timeoutResponse: responseFactory,
  });
  assert.deepEqual(result, { ok: true, updatedRoom: { version: 2 } });
});

test("manual conflicts preserve the ordinary 1v1 envelope", async () => {
  const result = await reconcileDominoOneVsOneCommit({
    client: clientWithRoom(null),
    commit: { ok: false, kind: "stale", error: new Error("STALE_GAME_STATE") },
    timedOut: false,
    roomId: "r1",
    expectedVersion: 1,
    originalRoom: { version: 1 },
    alreadyProcessedMessage: "done",
    staleMessage: "stale",
    timeoutResponse: responseFactory,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(await result.response.json(), { error: "Stale 1v1 state, please retry" });
});

test("timeout conflicts distinguish processed and still-stale claims", async () => {
  for (const [latestVersion, expectedCode] of [[3, "already_processed"], [2, "stale_timeout"]] as const) {
    const result = await reconcileDominoOneVsOneCommit({
      client: clientWithRoom({ version: latestVersion }),
      commit: { ok: false, kind: "stale", error: new Error("STALE_GAME_STATE") },
      timedOut: true,
      roomId: "r1",
      expectedVersion: 2,
      originalRoom: { version: 2 },
      alreadyProcessedMessage: "done",
      staleMessage: "stale",
      timeoutResponse: responseFactory,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal((await result.response.json()).code, expectedCode);
  }
});
