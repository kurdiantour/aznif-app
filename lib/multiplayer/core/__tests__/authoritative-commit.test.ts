import assert from "node:assert/strict";
import test from "node:test";

import {
  commitMultiplayerAction,
  multiplayerConflictResponse,
} from "../authoritative-commit.ts";

test("commit uses the stable RPC and returns its data", async () => {
  const calls: any[] = [];
  const client = {
    rpc: async (name: string, parameters: any) => {
      calls.push({ name, parameters });
      return { data: { version: 4 }, error: null };
    },
  };
  const result = await commitMultiplayerAction(client, { p_mode: "1v1" });
  assert.deepEqual(calls, [{ name: "commit_multiplayer_action", parameters: { p_mode: "1v1" } }]);
  assert.deepEqual(result, { ok: true, data: { version: 4 } });
});

test("commit classifies only version conflicts as stale", async () => {
  const stale = new Error("STALE_GAME_STATE");
  const result = await commitMultiplayerAction({
    rpc: async () => ({ data: null, error: stale }),
  }, {});
  assert.deepEqual(result, { ok: false, kind: "stale", error: stale });

  const databaseError = new Error("database unavailable");
  await assert.rejects(
    commitMultiplayerAction({ rpc: async () => ({ data: null, error: databaseError }) }, {}),
    databaseError,
  );
});

test("conflict response preserves the existing public envelope", async () => {
  const response = multiplayerConflictResponse("Stale 1v1 state, please retry");
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Stale 1v1 state, please retry" });
});
