import assert from "node:assert/strict";
import test from "node:test";
import { createInitialOkeyMatch } from "../../match/okey-match-state.ts";
import { OKEY_FINISH_REVEAL_MS, OKEY_TURN_DEADLINE_MS, reconcileOkeyMatchAfterInterruption } from "../okey-match-lifecycle.ts";

test("a short interruption preserves the active turn", () => {
  const match = createInitialOkeyMatch();
  const result = reconcileOkeyMatchAfterInterruption(match, OKEY_TURN_DEADLINE_MS - 1);
  assert.equal(result.match, match);
  assert.equal(result.turnExpired, false);
});

test("an expired interruption resolves exactly one active turn", () => {
  const match = createInitialOkeyMatch();
  const playerIndex = match.roundState.currentPlayerIndex;
  const result = reconcileOkeyMatchAfterInterruption(match, OKEY_TURN_DEADLINE_MS);
  assert.equal(result.turnExpired, true);
  assert.notEqual(result.match.roundState.currentPlayerIndex, playerIndex);
});

test("finish reveal and result countdown catch up without replaying animations", () => {
  const match = { ...createInitialOkeyMatch(), showFinishRevealPopup: true };
  const result = reconcileOkeyMatchAfterInterruption(match, OKEY_FINISH_REVEAL_MS + 2_000);
  assert.equal(result.match.showFinishRevealPopup, false);
  assert.equal(result.match.showRoundResultPopup, true);
  assert.equal(result.match.roundResultCountdownRemaining, 3);
});

test("a long interruption clamps a visible result countdown to zero", () => {
  const match = { ...createInitialOkeyMatch(), showRoundResultPopup: true, roundResultCountdownRemaining: 2 };
  const result = reconcileOkeyMatchAfterInterruption(match, 30_000);
  assert.equal(result.match.roundResultCountdownRemaining, 0);
  assert.equal(result.turnExpired, false);
});
