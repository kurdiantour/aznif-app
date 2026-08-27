import assert from "node:assert/strict";
import test from "node:test";
import { RoomConnectionState } from "../room-connection-state.ts";

test("short disconnect reconnect preserves membership", () => {
  const state = new RoomConnectionState();
  const old = state.join("socket-a");
  assert.equal(state.beginGrace(old.connectionId, old.generation, 100), true);
  state.join("socket-b");
  assert.equal(state.finishGrace(old.connectionId, old.generation, 101), true);
  assert.equal(state.hasLiveConnection(), true);
});

test("an old socket generation cannot remove its replacement", () => {
  const state = new RoomConnectionState();
  const old = state.join("same-id");
  const replacement = state.join("same-id");
  assert.equal(state.beginGrace("same-id", old.generation, 100), false);
  assert.equal(state.get("same-id")?.generation, replacement.generation);
});

test("last connection is gone only after grace deadline", () => {
  const state = new RoomConnectionState();
  const lease = state.join("socket-a");
  state.beginGrace(lease.connectionId, lease.generation, 100);
  assert.equal(state.finishGrace(lease.connectionId, lease.generation, 99), false);
  assert.equal(state.finishGrace(lease.connectionId, lease.generation, 100), true);
  assert.equal(state.hasLiveConnection(), false);
});
