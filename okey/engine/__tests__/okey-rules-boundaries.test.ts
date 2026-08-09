import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeclareBasicWin,
  canDeclareKonkanWin,
  createInitialOkeyGame,
  discardTile,
  getRequiredOpenScore,
  MAX_PLAYER_MELDS,
  openPlayerMelds,
  spendTileOnMeld,
} from "../okey-engine.ts";
import { getMeldScore, getOrderedMeldScore } from "../okey-melds.ts";
import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";

const okeyTile: OkeyTile = { id: "okey", color: "blue", value: 13, copy: 1 };
let tileSequence = 0;
function tile(value: number, color: OkeyTile["color"] = "red", options: Partial<OkeyTile> = {}): OkeyTile {
  tileSequence += 1;
  return { id: `${color}-${value}-${tileSequence}`, color, value, copy: 1, ...options };
}
function wildcard(id = `wild-${++tileSequence}`): OkeyTile {
  return { id, color: okeyTile.color, value: okeyTile.value, copy: 1 };
}
function run(values: number[], color: OkeyTile["color"] = "red") {
  return values.map((value) => tile(value, color));
}
function meld(id: string, kind: OkeyMeld["kind"], tiles: OkeyTile[]): OkeyMeld {
  return { id, ownerId: "human", kind, tiles, score: getMeldScore(tiles, okeyTile) ?? 0 };
}

test("ascending and descending runs are valid at every supported length", () => {
  for (let length = 3; length <= 13; length += 1) {
    const ascending = run(Array.from({ length }, (_, index) => index + 1));
    const descending = [...ascending].reverse();
    assert.notEqual(getOrderedMeldScore(ascending, okeyTile), null, `ascending length ${length}`);
    assert.notEqual(getOrderedMeldScore(descending, okeyTile), null, `descending length ${length}`);
  }
});

test("ace wraps only after thirteen, in both directions", () => {
  assert.equal(getOrderedMeldScore(run([12, 13, 1]), okeyTile), 30);
  assert.equal(getOrderedMeldScore(run([1, 13, 12]), okeyTile), 30);
  assert.equal(getOrderedMeldScore(run([13, 1, 2]), okeyTile), null);
  assert.equal(getOrderedMeldScore(run([2, 1, 13]), okeyTile), null);
});

test("wildcards cover run and set gaps while the forbidden double-joker triple is rejected", () => {
  assert.equal(getMeldScore([tile(4), wildcard(), tile(6)], okeyTile), 15);
  assert.equal(getMeldScore([tile(7, "red"), wildcard(), tile(7, "black")], okeyTile), 21);
  assert.equal(getMeldScore([tile(4), wildcard(), wildcard()], okeyTile), null);
  assert.notEqual(getMeldScore([tile(4), wildcard(), wildcard(), tile(7)], okeyTile), null);
});

test("fake joker is the effective okey tile and never a wildcard", () => {
  const fake = tile(0, "black", { isFakeJoker: true });
  assert.notEqual(getOrderedMeldScore([tile(11, "blue"), tile(12, "blue"), fake], okeyTile), null);
  assert.equal(getOrderedMeldScore([tile(5, "red"), fake, tile(7, "red")], okeyTile), null);
  assert.notEqual(getMeldScore([tile(13, "red"), tile(13, "black"), fake], okeyTile), null);
});

test("basic win partitions fourteen tiles and rejects an incomplete hand", () => {
  const winning = [...run([1, 2, 3, 4, 5]), ...run([6, 7, 8]), ...run([9, 10, 11]), ...run([11, 12, 13], "black")];
  assert.equal(winning.length, 14);
  assert.equal(canDeclareBasicWin(winning, okeyTile), true);
  assert.equal(canDeclareBasicWin([...winning.slice(0, 13), tile(8, "yellow")], okeyTile), false);
});

test("all five official Konkan runs accept a valid completion meld", () => {
  const patterns = [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    [5, 6, 7, 8, 9, 10, 11, 12, 13, 1],
  ];
  for (const pattern of patterns) {
    assert.equal(canDeclareKonkanWin([...run(pattern), ...run([2, 3, 4], "yellow")], okeyTile), true);
  }
  assert.equal(canDeclareKonkanWin([...run([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]), ...run([2, 3, 4], "yellow")], okeyTile), false);
});

test("opening thresholds cover initial, teammate, own-team, and opponent-first cases", () => {
  const state = createInitialOkeyGame(0);
  assert.equal(getRequiredOpenScore(state, 0), 81);
  const teammateOpened = { ...state, players: state.players.map((player, index) => index === 2 ? { ...player, opened: true } : player) };
  assert.equal(getRequiredOpenScore(teammateOpened, 0), 61);
  assert.equal(getRequiredOpenScore({ ...state, teamFirstOpenScores: { teamA: 90, teamB: null } }, 0), 61);
  assert.equal(getRequiredOpenScore({ ...state, teamFirstOpenScores: { teamA: null, teamB: 92 } }, 0), 93);
});

test("the seven-meld ceiling rejects an otherwise valid additional meld", () => {
  const state = createInitialOkeyGame(0);
  const submittedTiles = run([3, 4, 5]);
  const existing = Array.from({ length: MAX_PLAYER_MELDS }, (_, index) => meld(`existing-${index}`, "run", run([6, 7, 8], index % 2 ? "red" : "yellow")));
  const prepared: OkeyGameState = {
    ...state,
    okeyTile,
    players: state.players.map((player, index) => index === 0
      ? { ...player, opened: true, melds: existing, hand: [...submittedTiles, tile(12)] }
      : player),
  };
  assert.equal(openPlayerMelds(prepared, 0, [meld("extra", "run", submittedTiles)], 0), prepared);
});

test("joker replacement can be followed by the winning discard without premature finish", () => {
  const state = createInitialOkeyGame(0);
  const replacement = tile(7, "blue");
  const targetTiles = [tile(7, "red"), wildcard("target-wild"), tile(7, "black")];
  const prepared: OkeyGameState = {
    ...state,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: state.players.map((player, index) => index === 0
      ? { ...player, opened: true, hand: [replacement] }
      : index === 1
        ? { ...player, opened: true, melds: [meld("target", "set", targetTiles)] }
        : player),
  };
  const replaced = spendTileOnMeld(prepared, 0, replacement.id, prepared.players[1].id, "target");
  assert.equal(replaced.phase, "playing");
  assert.equal(replaced.players[0].hand.length, 1);
  const finished = discardTile(replaced, replaced.players[0].hand[0].id);
  assert.equal(finished.phase, "finished");
  assert.equal(finished.winnerId, prepared.players[0].id);
});
