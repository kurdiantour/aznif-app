import assert from "node:assert/strict";
import test from "node:test";

import { formatAznif, formatCurrencyAmount } from "../aznif-display.ts";

test("formats raw Aznif using the display scale", () => {
  const examples: [number, string][] = [
    [1.75, "1,750"],
    [1.3, "1,300"],
    [3, "3,000"],
    [7, "7,000"],
    [13.3, "13,300"],
    [23.25, "23,250"],
  ];

  for (const [rawAmount, expected] of examples) {
    assert.equal(formatAznif(rawAmount), expected);
  }
});

test("does not scale Coin or Gem amounts", () => {
  assert.equal(formatCurrencyAmount(1.75, "Coin"), "1.75");
  assert.equal(formatCurrencyAmount(1.75, "Gem"), "1.75");
});
