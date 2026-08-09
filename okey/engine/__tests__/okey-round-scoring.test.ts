import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialOkeyGame,
  getRoundResultScoreDetails,
} from "../okey-engine.ts";
import type { OkeyTile } from "../../types/okey.ts";

test("a fake joker left in hand scores as the round's effective okey value", () => {
  const state = createInitialOkeyGame(0);
  const fakeJoker: OkeyTile = {
    id: "fake-joker-test",
    color: "black",
    value: 0,
    copy: 1,
    isFakeJoker: true,
  };
  const fiveBlue: OkeyTile = {
    id: "blue-5-test",
    color: "blue",
    value: 5,
    copy: 1,
  };
  const loser = state.players[0];
  const winner = state.players[1];
  const finishedState = {
    ...state,
    phase: "finished" as const,
    winnerId: winner.id,
    endReason: "win" as const,
    okeyTile: { ...state.okeyTile, color: "red" as const, value: 8 },
    players: state.players.map((player, index) =>
      index === 0
        ? { ...player, opened: true, hand: [fakeJoker, fiveBlue] }
        : { ...player, opened: true, hand: [] },
    ),
  };

  const result = getRoundResultScoreDetails(finishedState);
  const loserDetail = result.details.find((detail) => detail.playerId === loser.id);

  assert.equal(loserDetail?.points, 13);
  assert.equal(result.scores[loser.teamId], 13);
});
