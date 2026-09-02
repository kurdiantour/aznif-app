import assert from "node:assert/strict";
import test from "node:test";

import {
  mapOkeySettlementToPopupRewards,
  shouldShowOkeyMatchResultPopup,
} from "../../components/OkeyMatchResultPopup.tsx";

const funSettlement = {
  type: "winner" as const,
  currency: "fun" as const,
  winnerTeamId: "teamA" as const,
  entryFeePerPlayer: 500,
  payoutPerWinner: 1000,
  playerReward: { pointDelta: 35, gemDelta: 10 },
};

test("Fun winner sees the net Coin gain plus backend Point and Gem rewards", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards(funSettlement, "teamA", "teamA"), {
    currencyLabel: "Coin", currencyDelta: 500, point: 35, gem: 10,
  });
});

test("Fun loser sees the lost entry fee and the backend loser rewards", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards({
    ...funSettlement,
    playerReward: { pointDelta: -15, gemDelta: 0 },
  }, "teamA", "teamB"), {
    currencyLabel: "Coin", currencyDelta: -500, point: -15, gem: 0,
  });
});

test("Aznif winner sees the net MC gain without Point or Gem", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards({
    ...funSettlement, currency: "aznif", entryFeePerPlayer: 20,
    payoutPerWinner: 38, playerReward: undefined,
  }, "teamA", "teamA"), {
    currencyLabel: "MC", currencyDelta: 18, point: 0, gem: 0,
  });
});

test("Aznif loser sees the lost entry fee", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards({
    ...funSettlement, currency: "aznif", entryFeePerPlayer: 20,
    payoutPerWinner: 38,
    playerReward: undefined,
  }, "teamA", "teamB"), {
    currencyLabel: "MC", currencyDelta: -20, point: 0, gem: 0,
  });
});

test("missing settlement stays pending instead of fabricating empty rewards", () => {
  assert.equal(mapOkeySettlementToPopupRewards(null, "teamA", "teamA"), null);
});

test("final popup stays hidden until the viewer settlement is present", () => {
  assert.equal(shouldShowOkeyMatchResultPopup(true, true, null), false);
  assert.equal(shouldShowOkeyMatchResultPopup(true, true, funSettlement), true);
  assert.equal(shouldShowOkeyMatchResultPopup(false, true, funSettlement), false);
});
