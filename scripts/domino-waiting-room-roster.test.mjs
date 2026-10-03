import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the actual effect's loader with deferred database responses, without
// mounting navigation, heartbeat, or unrelated React Native dependencies.
const source = readFileSync("domino/multiplayer/useDominoWaitingRoom.ts", "utf8");
const start = source.indexOf("    let mounted = true;", source.indexOf("// Realtime players roster"));
const end = source.indexOf("\n    void loadPlayers();", start);
assert.ok(start >= 0 && end > start);
const { outputText } = ts.transpileModule(
  `${source.slice(start, end)}\nreturn { loadPlayers, dispose: () => { mounted = false; } };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
);
const createLoader = new Function(
  "supabase", "setPlayers", "currentRoomId", "isOneVsOne",
  "assignDominoBotIdentities", "calculateLevelFromPoints", outputText,
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function setup(isOneVsOne = false) {
  const profiles = deferred();
  const freshRows = deferred();
  const oldRows = [
    { id: "self", user_id: "self", connected: true },
    { id: "opponent", user_id: "opponent", connected: true },
  ];
  let reads = 0;
  let roster = oldRows;
  const writes = [];
  const supabase = {
    from(table) {
      if (table === "profiles") return {
        select: () => ({ in: () => profiles.promise }),
      };
      assert.equal(table, isOneVsOne ? "one_vs_one_players" : "two_vs_two_players");
      return { select: () => ({ eq: () => ({ order: () => {
        reads++;
        return reads === 1 ? Promise.resolve({ data: oldRows }) : freshRows.promise;
      } }) }) };
    },
  };
  const loader = createLoader(supabase, (players) => {
    roster = players;
    writes.push(players.map((player) => player.id));
  }, "room", isOneVsOne, () => new Map(), () => 1);
  return {
    ...loader, profiles, freshRows, writes,
    get reads() { return reads; },
    get roster() { return roster; },
    removeOpponent() { roster = roster.filter((player) => player.id !== "opponent"); },
  };
}

for (const mode of ["1v1", "2v2"]) {
  test(`${mode}: removal during profile lookup cannot be overwritten by stale rows`, async () => {
    const state = setup(mode === "1v1");
    const initial = state.loadPlayers();
    await Promise.resolve(); // Old membership rows have arrived; profiles are pending.
    state.removeOpponent();
    await state.loadPlayers();
    await state.loadPlayers(); // A burst of events must coalesce into one reload.
    assert.equal(state.reads, 1);
    state.profiles.resolve({ data: [] });
    await initial;
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.roster.map((player) => player.id), ["self"]);
    assert.equal(state.reads, 2);
    state.freshRows.resolve({ data: [{ id: "self", user_id: "self", connected: true }] });
    await new Promise(setImmediate);
    assert.deepEqual(state.writes, [["self"]]);
    assert.equal(state.reads, 2);
  });
}

test("effect cleanup discards pending response and queued refresh", async () => {
  const state = setup();
  const initial = state.loadPlayers();
  await Promise.resolve();
  await state.loadPlayers();
  state.dispose();
  state.profiles.resolve({ data: [] });
  await initial;
  assert.deepEqual(state.writes, []);
  assert.equal(state.reads, 1);
});
