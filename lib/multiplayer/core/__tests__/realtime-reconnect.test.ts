import assert from "node:assert/strict";
import test from "node:test";

import { RealtimeReconnectPolicy } from "../realtime-reconnect.ts";

test("realtime reconnect backoff preserves production timing and cap", () => {
  const policy = new RealtimeReconnectPolicy();
  assert.deepEqual(
    Array.from({ length: 6 }, () => policy.observe("CHANNEL_ERROR")),
    [1_000, 2_000, 4_000, 8_000, 15_000, 15_000],
  );
  assert.equal(policy.observe("SUBSCRIBED"), null);
  assert.equal(policy.observe("TIMED_OUT"), 1_000);
});

test("unrelated channel statuses do not schedule reconnects", () => {
  const policy = new RealtimeReconnectPolicy();
  assert.equal(policy.observe("CLOSED"), null);
  assert.equal(policy.getAttempt(), 0);
});
