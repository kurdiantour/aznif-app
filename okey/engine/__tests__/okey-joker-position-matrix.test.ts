import assert from "node:assert/strict";
import test from "node:test";

import { canDeclareKonkanWin } from "../okey-engine.ts";
import { getOrderedMeldScore } from "../okey-melds.ts";
import type { OkeyTile } from "../../types/okey.ts";

const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
let sequence = 0;
function tile(value: number, color: OkeyTile["color"] = "red"): OkeyTile {
  sequence += 1;
  return { id: `${color}-${value}-${sequence}`, color, value, copy: 1 };
}
function wildcard(): OkeyTile {
  sequence += 1;
  return { id: `wild-${sequence}`, color: okeyTile.color, value: okeyTile.value, copy: 1 };
}

test("a joker is accepted at every position of every supported run length", () => {
  for (let length = 3; length <= 13; length += 1) {
    for (let jokerIndex = 0; jokerIndex < length; jokerIndex += 1) {
      const run = Array.from({ length }, (_, index) => tile(index + 1));
      run[jokerIndex] = wildcard();
      assert.notEqual(getOrderedMeldScore(run, okeyTile), null, `length ${length}, joker ${jokerIndex}`);
    }
  }
});

test("a joker is accepted at every position of the official Konkan run", () => {
  for (let jokerIndex = 0; jokerIndex < 10; jokerIndex += 1) {
    const officialRun = Array.from({ length: 10 }, (_, index) => tile(index + 1));
    officialRun[jokerIndex] = wildcard();
    const completion = [tile(2, "yellow"), tile(3, "yellow"), tile(4, "yellow")];
    assert.equal(canDeclareKonkanWin([...officialRun, ...completion], okeyTile), true, `joker ${jokerIndex}`);
  }
});
