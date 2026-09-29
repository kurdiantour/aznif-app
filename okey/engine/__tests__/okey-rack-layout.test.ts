import assert from "node:assert/strict";
import test from "node:test";

import {
  findKonkanRackLayoutCandidates,
  getOpenableRackLayout,
  getOrderedKonkanRunCandidates,
} from "../okey-rack-layout.ts";
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

test("keeps Open score aligned to arranged complete melds", () => {
  const groups = [[...validRun, tile("attached-score", "black", 12)], validSet, [looseTile]];
  const openable = getOpenableRackLayout(groups, okeyTile);

  assert.equal(openable.score, 39);
});

test("findKonkanRackLayoutCandidates requires contiguous Run 10, contiguous completion meld, and exactly 1 discard", () => {
  const run10 = Array.from({ length: 10 }, (_, index) => tile(`r-${index + 1}`, "red", index + 1));
  const meld4 = [
    tile("b2", "blue", 2),
    tile("b3", "blue", 3),
    tile("b4", "blue", 4),
    tile("b5", "blue", 5),
  ];
  const meld3 = meld4.slice(0, 3);
  const discard = tile("d1", "yellow", 1);

  // 1. Without lock: Run 10 + Meld 4 + Discard 1 -> valid candidate
  const candidatesNoLock = findKonkanRackLayoutCandidates(
    [run10, meld4, [discard]],
    okeyTile,
    false,
  );
  assert.equal(candidatesNoLock.length, 1);
  assert.deepEqual(candidatesNoLock[0].orderedRunTileIds, run10.map((t) => t.id));
  assert.deepEqual(candidatesNoLock[0].completionMeldTileIds, meld4.map((t) => t.id));
  assert.equal(candidatesNoLock[0].discardTileId, discard.id);

  // 2. Without lock: 3-tile meld -> NOT valid
  const candidatesWithMeld3NoLock = findKonkanRackLayoutCandidates(
    [run10, meld3, [discard]],
    okeyTile,
    false,
  );
  assert.equal(candidatesWithMeld3NoLock.length, 0);

  // 3. With lock: 3-tile meld + 1 discard -> valid candidate
  const candidatesWithLock = findKonkanRackLayoutCandidates(
    [run10, meld3, [discard]],
    okeyTile,
    true,
  );
  assert.equal(candidatesWithLock.length, 1);
  assert.deepEqual(candidatesWithLock[0].orderedRunTileIds, run10.map((t) => t.id));
  assert.deepEqual(candidatesWithLock[0].completionMeldTileIds, meld3.map((t) => t.id));
  assert.equal(candidatesWithLock[0].discardTileId, discard.id);

  // 4. Scrambled / broken run across rack gap -> NOT valid
  const brokenRun = [run10.slice(0, 5), run10.slice(5, 10), meld4, [discard]];
  assert.equal(findKonkanRackLayoutCandidates(brokenRun, okeyTile, false).length, 0);

  // 5. Scrambled / broken meld -> NOT valid
  const brokenMeld = [
    tile("b2", "blue", 2),
    tile("b4", "blue", 4),
    tile("b3", "blue", 3),
    tile("b5", "blue", 5),
  ];
  const brokenMeldGroups = [run10, brokenMeld, [discard]];
  assert.equal(findKonkanRackLayoutCandidates(brokenMeldGroups, okeyTile, false).length, 0);

  // 6. Run 10 and Meld in the same contiguous group -> valid candidate
  const sameGroup = [[...run10, ...meld4], [discard]];
  const candidatesSameGroup = findKonkanRackLayoutCandidates(sameGroup, okeyTile, false);
  assert.equal(candidatesSameGroup.length, 1);
  assert.deepEqual(candidatesSameGroup[0].orderedRunTileIds, run10.map((t) => t.id));
  assert.deepEqual(candidatesSameGroup[0].completionMeldTileIds, meld4.map((t) => t.id));
  assert.equal(candidatesSameGroup[0].discardTileId, discard.id);
});
