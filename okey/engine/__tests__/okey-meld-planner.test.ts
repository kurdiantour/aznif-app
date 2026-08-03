import assert from "node:assert/strict";
import test from "node:test";
import { selectBestMeldPlan, type OkeyMeldCandidate } from "../okey-melds.ts";
import type { OkeyMeld, OkeyTile } from "../../types/okey.ts";

function tile(value: number): OkeyTile {
  return { id: `red-${value}`, color: "red", value, copy: 1, isFakeJoker: false };
}
function candidate(allTiles: OkeyTile[], start: number, size: number): OkeyMeldCandidate {
  const tiles = allTiles.slice(start, start + size);
  let mask = 0;
  for (let index = start; index < start + size; index += 1) mask |= 1 << index;
  const meld: OkeyMeld = {
    id: `candidate-${start}-${size}`,
    ownerId: "test",
    kind: "run",
    tiles,
    score: tiles.reduce((sum, entry) => sum + entry.value, 0),
  };
  return { mask, meld };
}
function contiguousRunCandidates(length: number) {
  const tiles = Array.from({ length }, (_, index) => tile(index + 3));
  const candidates: OkeyMeldCandidate[] = [];
  for (let start = 0; start < length; start += 1) {
    for (let size = 3; size <= 5 && start + size <= length; size += 1) candidates.push(candidate(tiles, start, size));
  }
  return { tiles, candidates };
}

for (const [length, expected] of [[6, [3, 3]], [7, [3, 4]], [8, [3, 5]]] as const) {
  test(`splits a ${length}-tile run deterministically into ${expected.join("+")}`, () => {
    const { candidates } = contiguousRunCandidates(length);
    const result = selectBestMeldPlan(candidates, length);
    assert.equal(result.usedTileCount, length);
    assert.deepEqual(result.melds.map((meld) => meld.tiles.length), expected);
    assert.ok(result.melds.every((meld) => meld.tiles.length >= 3 && meld.tiles.length <= 5));
  });
}

test("tie-breaking is independent of candidate input order", () => {
  const { candidates } = contiguousRunCandidates(8);
  const forward = selectBestMeldPlan(candidates, 8);
  const reverse = selectBestMeldPlan([...candidates].reverse(), 8);
  assert.deepEqual(forward.melds.map((meld) => meld.id), reverse.melds.map((meld) => meld.id));
});

test("never emits a candidate longer than five when only legal candidates are supplied", () => {
  const { candidates } = contiguousRunCandidates(13);
  const result = selectBestMeldPlan(candidates, 13);
  assert.equal(result.usedTileCount, 13);
  assert.ok(result.melds.every((meld) => meld.tiles.length >= 3 && meld.tiles.length <= 5));
});

test("honors the minimum remaining tile invariant used by rack and bots", () => {
  const { candidates } = contiguousRunCandidates(8);
  const result = selectBestMeldPlan(candidates, 8, 1);
  assert.ok(result.usedTileCount <= 7);
  assert.ok(8 - result.usedTileCount >= 1);
});

test("reports incomplete coverage when tiles cannot all form legal melds", () => {
  const { candidates } = contiguousRunCandidates(5);
  const result = selectBestMeldPlan(candidates, 6);
  assert.notEqual(result.usedTileCount, 6);
});