import assert from "node:assert/strict";
import test from "node:test";

import { getOpenableRackLayout, getOrderedKonkanRunCandidates, getRackDisplayScore } from "../okey-rack-layout.ts";
import type { OkeyTile } from "../../types/okey.ts";

function tile(id: string, color: OkeyTile["color"], value: number): OkeyTile {
  return { id, color, value, copy: 1, isFakeJoker: false };
}

const okeyTile = tile("okey", "yellow", 13);
const validRun = [
  tile("r3", "red", 3),
  tile("r4", "red", 4),
  tile("r5", "red", 5),
];
const validSet = [
  tile("r9", "red", 9),
  tile("b9", "blue", 9),
  tile("k9", "black", 9),
];
const looseTile = tile("loose", "blue", 2);

test("accepts only complete contiguous rack groups plus one separated discard", () => {
  const result = getOpenableRackLayout([validRun, validSet, [looseTile]], okeyTile);

  assert.equal(result.melds.length, 2);
  assert.deepEqual(
    result.melds.map((meld) => meld.tiles.map((entry) => entry.id)),
    [validRun.map((entry) => entry.id), validSet.map((entry) => entry.id)],
  );
});

test("counts a complete contiguous meld even when unrelated tiles remain", () => {
  const attached = tile("attached", "black", 12);
  const result = getOpenableRackLayout([[...validRun, attached], validSet, [looseTile]], okeyTile);

  assert.deepEqual(
    result.melds.map((meld) => meld.tiles.map((entry) => entry.id)),
    [validRun.map((entry) => entry.id), validSet.map((entry) => entry.id)],
  );
  assert.equal(result.score, 39);
});

test("does not combine matching tiles across separate rack blocks", () => {
  const result = getOpenableRackLayout(
    [validRun.slice(0, 2), [validRun[2]], validSet, [looseTile]],
    okeyTile,
  );

  assert.deepEqual(result.melds.map((meld) => meld.tiles.map((entry) => entry.id)), [validSet.map((entry) => entry.id)]);
  assert.equal(result.score, 27);
});

test("Konkan candidates never cross rack gaps and preserve slot order", () => {
  const ordered = Array.from({ length: 11 }, (_, index) => tile(`red-${index + 1}`, "red", index + 1));
  const candidates = getOrderedKonkanRunCandidates([ordered]);
  assert.deepEqual(candidates, [ordered.slice(0, 10).map((entry) => entry.id), ordered.slice(1, 11).map((entry) => entry.id)]);
  assert.deepEqual(getOrderedKonkanRunCandidates([ordered.slice(0, 5), ordered.slice(5, 10)]), []);
});

test("does not use a joker outside an incomplete group", () => {
  const joker = tile("joker", okeyTile.color, okeyTile.value);
  const incompleteRun = validRun.slice(0, 2);
  const result = getOpenableRackLayout(
    [incompleteRun, [joker], validSet, [looseTile]],
    okeyTile,
  );

  assert.deepEqual(result.melds.map((meld) => meld.tiles.map((entry) => entry.id)), [validSet.map((entry) => entry.id)]);
  assert.equal(result.score, 27);
});

test("keeps displayed and Open scores aligned to arranged complete melds", () => {
  const groups = [[...validRun, tile("attached-score", "black", 12)], validSet, [looseTile]];
  const openable = getOpenableRackLayout(groups, okeyTile);

  assert.equal(getRackDisplayScore(groups, okeyTile), openable.score);
  assert.equal(openable.score, 39);
});
