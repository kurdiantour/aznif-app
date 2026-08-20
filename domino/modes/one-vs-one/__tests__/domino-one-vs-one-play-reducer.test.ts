import assert from "node:assert/strict";
import test from "node:test";

import { reduceOneVsOnePlay } from "../authoritative/domino-one-vs-one-command-reducer.ts";

const tile = (id: string, left: number, right: number) => ({ id, left, right });
const players = [
  { user_id: "player-a", team_id: "teamA" as const, player_index: 0 },
  { user_id: "player-b", team_id: "teamB" as const, player_index: 1 },
];

test("play reducer removes one tile, scores the move and advances turn", () => {
  const played = tile("6-6", 6, 6);
  const board = { centerTile: played };
  const result = reduceOneVsOnePlay({
    state: { teamScores: { teamA: 10, teamB: 0 }, leaderPlayerId: "player-b" },
    hands: [[played, tile("1-2", 1, 2)], [tile("3-4", 3, 4)]],
    boneyard: [tile("0-0", 0, 0)],
    players,
    playerIndex: 0,
    actorUserId: "player-a",
    tile: played,
    branch: "right",
    nextBoard: board,
    nextSpinnerValue: 6,
    moveScore: 10,
    phaseStartedAt: "now",
    isSameTile: (left, right) => left.id === right.id,
    canNextPlayerDraw: () => true,
  });

  assert.deepEqual(result.nextState.handCounts, [1, 1]);
  assert.equal(result.nextState.teamScores.teamA, 20);
  assert.equal(result.nextState.currentTurnPlayerId, "player-b");
  assert.equal(result.nextState.canDrawTile, true);
  assert.equal(result.nextState.drawStartedAt, "now");
  assert.equal(result.nextState.lastScoringEvent.points, 10);
});

test("empty hand ends the round, adds opponent pips and keeps actor as leader", () => {
  const played = tile("6-6", 6, 6);
  const opponentHand = [tile("6-5", 6, 5)];
  const result = reduceOneVsOnePlay({
    state: { teamScores: { teamA: 0, teamB: 0 } },
    hands: [[played], opponentHand],
    boneyard: [],
    players,
    playerIndex: 0,
    actorUserId: "player-a",
    tile: played,
    nextBoard: { centerTile: played },
    nextSpinnerValue: 6,
    moveScore: 0,
    phaseStartedAt: "now",
    isSameTile: (left, right) => left.id === right.id,
    canNextPlayerDraw: () => {
      throw new Error("must_not_run_after_round_end");
    },
  });

  assert.equal(result.nextState.roundWinnerPlayerId, "player-a");
  assert.equal(result.nextState.leaderPlayerId, "player-a");
  assert.equal(result.nextState.teamScores.teamA, 10);
  assert.equal(result.nextState.endOfHandScoringEvent.openEndsTotal, 11);
  assert.equal(result.nextState.revealedFinalHands[1], opponentHand);
  assert.equal(result.nextState.canDrawTile, false);
});

test("play reducer rejects a tile not present in the authoritative hand", () => {
  assert.throws(() => reduceOneVsOnePlay({
    state: {},
    hands: [[], []],
    boneyard: [],
    players,
    playerIndex: 0,
    actorUserId: "player-a",
    tile: tile("missing", 1, 1),
    nextBoard: {},
    nextSpinnerValue: null,
    moveScore: 0,
    phaseStartedAt: "now",
    isSameTile: (left, right) => left.id === right.id,
    canNextPlayerDraw: () => false,
  }), /tile_not_found/);
});
