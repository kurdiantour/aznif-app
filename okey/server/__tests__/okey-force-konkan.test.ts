import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAuthoritativeOkeyMatchCommand,
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
  OkeyCommandError,
  startAuthoritativeOkeyNextRound,
  type OkeyAuthoritativeMatchState,
} from "../okey-authoritative.ts";

const players = [
  { id: "player-0", name: "Player 0" },
  { id: "player-1", name: "Player 1" },
  { id: "player-2", name: "Player 2" },
  { id: "player-3", name: "Player 3" },
] as const;

function matchBeforeDetermineRound(teamAScore: number, teamBScore: number): OkeyAuthoritativeMatchState {
  const match = createAuthoritativeOkeyMatch(players, 0);
  const winnerId = match.roundState.players[0].id;
  return {
    ...match,
    currentRound: 6,
    matchScores: { teamA: teamAScore, teamB: teamBScore },
    roundResults: [{
      round: 6,
      winnerId,
      winnerTeamId: "teamA",
      teamAScore: 0,
      teamBScore: 0,
      endReason: "win",
    }],
    roundState: {
      ...match.roundState,
      phase: "finished",
      winnerId,
      endReason: "win",
    },
  };
}

const startMs = Date.parse("2026-08-26T12:00:00.000Z");

test("199 points starts an ordinary determine round", () => {
  const next = startAuthoritativeOkeyNextRound(matchBeforeDetermineRound(199, 0), startMs);
  assert.equal(next.currentRound, 7);
  assert.equal(next.forcedKonkanTeamId, null);
  assert.equal(next.roundStartsAt, null);
  assert.ok(next.roundState.players.every((player) => !player.konkan));
});

test("200 and 399 points force the trailing team into Konkan for five seconds", () => {
  for (const gap of [200, 399]) {
    const next = startAuthoritativeOkeyNextRound(matchBeforeDetermineRound(gap, 0), startMs);
    assert.equal(next.currentRound, 7);
    assert.equal(next.forcedKonkanTeamId, "teamA");
    assert.equal(next.roundStartsAt, "2026-08-26T12:00:05.000Z");
    assert.ok(next.roundState.players.filter((player) => player.teamId === "teamA").every(
      (player) => player.konkan && player.konkanEntryReason === "forced-final-round",
    ));
    assert.ok(next.roundState.players.filter((player) => player.teamId === "teamB").every(
      (player) => !player.konkan,
    ));
  }
});

test("400 points ends the match before the determine round", () => {
  const next = startAuthoritativeOkeyNextRound(matchBeforeDetermineRound(400, 0), startMs);
  assert.equal(next.matchFinished, true);
  assert.equal(next.matchWinnerTeamId, "teamB");
  assert.equal(next.currentRound, 6);
  assert.equal(next.forcedKonkanTeamId, null);
  assert.equal(next.roundStartsAt, null);
});

test("commands stay locked until the forced-Konkan announcement ends", () => {
  const next = startAuthoritativeOkeyNextRound(matchBeforeDetermineRound(200, 0), startMs);
  const actorIndex = next.roundState.currentPlayerIndex;
  const tileId = next.roundState.players[actorIndex].hand[0].id;

  assert.throws(
    () => applyAuthoritativeOkeyMatchCommand(next, actorIndex, { type: "discard", tileId }, startMs + 4_999),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );

  const moved = applyAuthoritativeOkeyMatchCommand(
    next,
    actorIndex,
    { type: "discard", tileId },
    startMs + 5_000,
  );
  assert.equal(moved.roundState.discardPile.at(-1)?.id, tileId);
  assert.equal(
    getNextOkeyMatchTurnDeadline(next, startMs),
    "2026-08-26T12:00:35.000Z",
  );
});