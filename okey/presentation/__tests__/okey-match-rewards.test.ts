import assert from "node:assert/strict";
import test from "node:test";

import { mapOkeySettlementToPopupRewards } from "../okey-match-rewards.ts";

const funSettlement = {
  type: "winner" as const,
  currency: "fun" as const,
  winnerTeamId: "teamA" as const,
  entryFeePerPlayer: 500,
  payoutPerWinner: 1000,
  playerReward: { pointDelta: 35, gemDelta: 10 },
};

test("Fun winner receives the full Coin payout plus backend Point and Gem rewards", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards(funSettlement, "teamA", "teamA"), {
    currencyLabel: "Coin", currencyDelta: 1000, point: 35, gem: 10,
  });
});

test("Fun loser receives zero payout and the backend loser rewards", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards({
    ...funSettlement,
    playerReward: { pointDelta: -15, gemDelta: 0 },
  }, "teamA", "teamB"), {
    currencyLabel: "Coin", currencyDelta: 0, point: -15, gem: 0,
  });
});

test("Aznif winner receives the full MC payout without Point or Gem", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards({
    ...funSettlement, currency: "aznif", entryFeePerPlayer: 20,
    payoutPerWinner: 38, playerReward: undefined,
  }, "teamA", "teamA"), {
    currencyLabel: "MC", currencyDelta: 38, point: 0, gem: 0,
  });
});

test("Aznif loser receives zero payout", () => {
  assert.deepEqual(mapOkeySettlementToPopupRewards({
    ...funSettlement, currency: "aznif", payoutPerWinner: 38,
    playerReward: undefined,
  }, "teamA", "teamB"), {
    currencyLabel: "MC", currencyDelta: 0, point: 0, gem: 0,
  });
});

test("missing settlement stays pending instead of fabricating empty rewards", () => {
  assert.equal(mapOkeySettlementToPopupRewards(null, "teamA", "teamA"), null);
});
