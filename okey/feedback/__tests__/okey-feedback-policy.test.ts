import assert from "node:assert/strict";
import test from "node:test";
import { OkeyFeedbackGate } from "../okey-feedback-gate.ts";

test("each event key is consumed only once across rerenders", () => {
  const gate = new OkeyFeedbackGate({ soundEnabled: true, hapticsEnabled: true });
  assert.ok(gate.consume("discard", "discard:tile-1"));
  assert.equal(gate.consume("discard", "discard:tile-1"), null);
});

test("sound and haptics can be disabled independently", () => {
  const soundOnly = new OkeyFeedbackGate({ soundEnabled: true, hapticsEnabled: false });
  assert.deepEqual(soundOnly.consume("rack-move", "move:1"), {
    event: "rack-move",
    playSound: true,
    playHaptic: false,
  });

  const hapticOnly = new OkeyFeedbackGate({ soundEnabled: false, hapticsEnabled: true });
  assert.deepEqual(hapticOnly.consume("rack-move", "move:2"), {
    event: "rack-move",
    playSound: false,
    playHaptic: true,
  });
});

test("background suppresses feedback without consuming the event", () => {
  const gate = new OkeyFeedbackGate({ soundEnabled: true, hapticsEnabled: true });
  gate.setActive(false);
  assert.equal(gate.consume("timeout", "turn:1:timeout"), null);
  gate.setActive(true);
  assert.ok(gate.consume("timeout", "turn:1:timeout"));
});

test("resume never replays an event consumed before suspension", () => {
  const gate = new OkeyFeedbackGate({ soundEnabled: true, hapticsEnabled: true });
  assert.ok(gate.consume("draw-deck", "draw:tile-1"));
  gate.setActive(false);
  gate.setActive(true);
  assert.equal(gate.consume("draw-deck", "draw:tile-1"), null);
});

test("valid, invalid, round and match events remain distinct", () => {
  const gate = new OkeyFeedbackGate({ soundEnabled: true, hapticsEnabled: true });
  assert.equal(gate.consume("rack-move", "valid:1")?.event, "rack-move");
  assert.equal(gate.consume("invalid", "invalid:1")?.event, "invalid");
  assert.equal(gate.consume("round-win", "round:1")?.event, "round-win");
  assert.equal(gate.consume("match-loss", "match:1")?.event, "match-loss");
});

test("bounded history releases old keys", () => {
  const gate = new OkeyFeedbackGate({ soundEnabled: true, hapticsEnabled: true }, 2);
  gate.consume("rack-select", "1");
  gate.consume("rack-select", "2");
  gate.consume("rack-select", "3");
  assert.ok(gate.consume("rack-select", "1"));
});
