import assert from "node:assert/strict";
import test from "node:test";

import type { OkeyGameState, OkeyMeld, OkeyTile } from "../../types/okey.ts";
import {
    canDeclareBasicWin,
    canDeclareKonkanOpen,
    canDeclareKonkanWin,
    createInitialOkeyGame,
    declareKonkanOpen,
    discardTile,
    getRequiredOpenScore,
    hasLockedKonkanSet,
    hasSmallKonkanMeld,
    MAX_PLAYER_MELDS,
    openPlayerMelds,
    resolveTableMeldAction,
    spendTileOnMeld,
} from "../okey-engine.ts";
import { getMeldScore, getOrderedMeldScore } from "../okeyengine-melds.ts";

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
  const dummyLockMeld: OkeyMeld = {
    id: "table-lock-meld",
    ownerId: "other",
    kind: "set",
    tiles: [tile(7, "red"), tile(7, "blue"), tile(7, "black")],
    score: 21,
    locked: true,
    lockedByPlayerId: "self",
    lockedTileId: "locked-tile-1",
  };

  for (const pattern of patterns) {
    const officialRun = run(pattern);
    // Without lock: 4-tile meld is required
    assert.equal(canDeclareKonkanWin([...officialRun, ...run([2, 3, 4, 5], "yellow")], okeyTile), true);
    // Without lock: 3-tile meld is NOT valid
    assert.equal(canDeclareKonkanWin([...officialRun, ...run([2, 3, 4], "yellow")], okeyTile), false);
    // With lock: 3-tile meld is valid
    assert.equal(canDeclareKonkanWin([...officialRun, ...run([2, 3, 4], "yellow")], okeyTile, [dummyLockMeld]), true);
    // With lock: without 3-tile meld is NOT valid
    assert.equal(canDeclareKonkanWin(officialRun, okeyTile, [dummyLockMeld]), false);
  }
  assert.equal(canDeclareKonkanWin([...run([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]), ...run([2, 3, 4, 5], "yellow")], okeyTile), false);
});

test("Konkan declaration requires the submitted ten-tile run in exact rack order", () => {
  const state = createInitialOkeyGame(0);
  const officialRun = run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const completion = run([2, 3, 4, 5], "yellow");
  const finalDiscard = tile(12, "black");
  const prepared: OkeyGameState = {
    ...state,
    currentPlayerIndex: 0,
    okeyTile,
    players: state.players.map((player, index) => index === 0
      ? { ...player, konkan: true, konkanEntryReason: "discard-pick", hand: [...officialRun, ...completion, finalDiscard] }
      : player),
  };
  const orderedIds = officialRun.map((entry) => entry.id);
  const completionIds = completion.map((entry) => entry.id);
  assert.equal(canDeclareKonkanOpen(prepared, 0, orderedIds, completionIds, finalDiscard.id), true);
  assert.equal(canDeclareKonkanOpen(prepared, 0, [orderedIds[0], orderedIds[2], orderedIds[1], ...orderedIds.slice(3)], completionIds, finalDiscard.id), false);
  assert.equal(canDeclareKonkanOpen(prepared, 0), false);

  // Without lock, a 3-tile completion meld must NOT allow declaration
  const completion3 = run([2, 3, 4], "yellow");
  const preparedWith3Meld: OkeyGameState = {
    ...prepared,
    players: prepared.players.map((player, index) => index === 0
      ? { ...player, hand: [...officialRun, ...completion3, finalDiscard] }
      : player),
  };
  assert.equal(canDeclareKonkanOpen(preparedWith3Meld, 0, orderedIds, completion3.map((entry) => entry.id), finalDiscard.id), false);
});

test("opening thresholds cover initial, teammate, own-team, and opponent-first cases", () => {
  const state = createInitialOkeyGame(0);
  assert.equal(getRequiredOpenScore(state, 0), 81);
  const teammateOpened = { ...state, players: state.players.map((player, index) => index === 2 ? { ...player, opened: true } : player) };
  assert.equal(getRequiredOpenScore(teammateOpened, 0), 61);
  assert.equal(getRequiredOpenScore({ ...state, teamFirstOpenScores: { teamA: 90, teamB: null } }, 0), 61);
  assert.equal(getRequiredOpenScore({ ...state, teamFirstOpenScores: { teamA: null, teamB: 92 } }, 0), 93);
});

test("a burned opener no longer raises the opposing threshold, while existing opens remain intact", () => {
  const state = createInitialOkeyGame(0);
  const originalOpponentMelds = state.players[1].melds;
  const prepared: OkeyGameState = {
    ...state,
    teamFirstOpenScores: { teamA: 95, teamB: null },
    players: state.players.map((player, index) => {
      if (index === 0) return { ...player, opened: true, firstOpenScore: 95, scoreOpened: 95 };
      return player;
    }),
  };

  assert.equal(getRequiredOpenScore(prepared, 1), 96);
  assert.equal(getRequiredOpenScore(prepared, 3), 96);
  const burned = {
    ...prepared,
    players: prepared.players.map((player, index) => index === 0 ? { ...player, eliminated: true } : player),
  };

  assert.equal(getRequiredOpenScore(burned, 1), 81);
  assert.equal(getRequiredOpenScore(burned, 3), 81);

  const activeOpponentOpenedAfterBurn = {
    ...burned,
    teamFirstOpenScores: { teamA: 95, teamB: 95 },
    players: burned.players.map((player, index) => index === 1
      ? { ...player, opened: true, firstOpenScore: 95, scoreOpened: 95 }
      : player),
  };
  assert.equal(getRequiredOpenScore(activeOpponentOpenedAfterBurn, 2), 96);

  const opponentOpenedBeforeBurn = {
    ...prepared,
    teamFirstOpenScores: { teamA: 95, teamB: 81 },
    players: prepared.players.map((player, index) => index === 1
      ? { ...player, opened: true, firstOpenScore: 81, scoreOpened: 81 }
      : player),
  };
  const opponentOpenedAfterBurn = {
    ...opponentOpenedBeforeBurn,
    players: opponentOpenedBeforeBurn.players.map((player, index) => index === 0 ? { ...player, eliminated: true } : player),
  };
  assert.equal(opponentOpenedAfterBurn.players[1].opened, true);
  assert.equal(opponentOpenedAfterBurn.players[1].scoreOpened, 81);
  assert.deepEqual(opponentOpenedAfterBurn.players[1].melds, originalOpponentMelds);
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

test("an ambiguous Joker spend exposes both endpoints and applies the selected one", () => {
  const state = createInitialOkeyGame(0);
  const joker = wildcard("spend-joker");
  const targetTiles = run([9, 10, 11]);
  const prepared: OkeyGameState = {
    ...state,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: state.players.map((player, index) => index === 0
      ? { ...player, opened: true, hand: [joker, tile(2, "yellow")] }
      : index === 1
        ? { ...player, opened: true, melds: [meld("ambiguous-spend", "run", targetTiles)] }
        : player),
  };

  const targetPlayer = prepared.players[1];
  const action = resolveTableMeldAction(
    prepared,
    0,
    joker.id,
    targetPlayer.id,
    "ambiguous-spend",
  );
  assert.equal(action?.type, "spend");
  assert.deepEqual(action?.runEndOptions, [
    { runEnd: "start", value: 8 },
    { runEnd: "end", value: 12 },
  ]);
  assert.equal(
    spendTileOnMeld(prepared, 0, joker.id, targetPlayer.id, "ambiguous-spend"),
    prepared,
  );

  const spent = spendTileOnMeld(
    prepared,
    0,
    joker.id,
    targetPlayer.id,
    "ambiguous-spend",
    "start",
  );
  assert.deepEqual(
    spent.players[1].melds[0].tiles.map((entry) => entry.id),
    [joker.id, ...targetTiles.map((entry) => entry.id)],
  );
});

test("Konkan win validation strictly enforces lock and meld size rules", () => {
  const officialRun = run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const meld4 = run([2, 3, 4, 5], "yellow");
  const meld3 = run([2, 3, 4], "yellow");
  const discardTileItem = tile(12, "black");

  const lockedMeld: OkeyMeld = {
    id: "table-lock-meld-1",
    ownerId: "opponent",
    kind: "set",
    tiles: [tile(8, "red"), tile(8, "blue"), tile(8, "black")],
    score: 24,
    locked: true,
    lockedByPlayerId: "human",
    lockedTileId: "locked-tile-1",
  };

  // 1. Without Lock:
  // Run 10 + Meld 4 -> Valid Win
  assert.equal(canDeclareKonkanWin([...officialRun, ...meld4], okeyTile, []), true);
  // Run 10 + Meld 3 -> Invalid (must NOT win without Lock)
  assert.equal(canDeclareKonkanWin([...officialRun, ...meld3], okeyTile, []), false);
  // Run 10 only -> Invalid
  assert.equal(canDeclareKonkanWin(officialRun, okeyTile, []), false);

  // 2. With Lock:
  // Run 10 + Meld 3 + Lock -> Valid Win
  assert.equal(canDeclareKonkanWin([...officialRun, ...meld3], okeyTile, [lockedMeld]), true);
  // Run 10 + Meld 4 + Lock -> Valid Win (Meld >= 3 is allowed)
  assert.equal(canDeclareKonkanWin([...officialRun, ...meld4], okeyTile, [lockedMeld]), true);
  // Run 10 + Lock without Meld 3 -> Invalid (Lock does NOT replace Meld!)
  assert.equal(canDeclareKonkanWin(officialRun, okeyTile, [lockedMeld]), false);
  // Run 10 + 3 non-meld junk tiles + Lock -> Invalid
  const junk3 = [tile(2, "yellow"), tile(7, "black"), tile(11, "blue")];
  assert.equal(canDeclareKonkanWin([...officialRun, ...junk3], okeyTile, [lockedMeld]), false);

  // 3. hasSmallKonkanMeld minSize enforcement
  assert.equal(hasSmallKonkanMeld(meld4, okeyTile, 4), true);
  assert.equal(hasSmallKonkanMeld(meld3, okeyTile, 4), false);
  assert.equal(hasSmallKonkanMeld(meld3, okeyTile, 3), true);
  assert.equal(hasSmallKonkanMeld(junk3, okeyTile, 3), false);

  // 4. hasLockedKonkanSet helper
  assert.equal(hasLockedKonkanSet([lockedMeld], okeyTile), true);
  assert.equal(hasLockedKonkanSet([{ ...lockedMeld, locked: false }], okeyTile), false);
  assert.equal(hasLockedKonkanSet([], okeyTile), false);

  // 5. Normal discardTile NEVER finishes KonKan round
  const baseState = createInitialOkeyGame(0);
  // Setup player with Run 10 + Meld 4 + Discard (no lock)
  const readyHandNoLock = [...officialRun, ...meld4, discardTileItem];
  const stateNoLock: OkeyGameState = {
    ...baseState,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: baseState.players.map((p, idx) => idx === 0
      ? { ...p, konkan: true, konkanEntryReason: "discard-pick", hand: readyHandNoLock }
      : p),
  };
  // Normal discard must NOT win or finish the round for a Konkan player
  const afterNormalDiscard = discardTile(stateNoLock, discardTileItem.id);
  assert.equal(afterNormalDiscard.phase, "playing");
  assert.equal(afterNormalDiscard.winnerId, null);

  // 6. KonKan win only via declareKonkanOpen with automatic final discard
  const officialRunIds = officialRun.map((t) => t.id);
  const meld4Ids = meld4.map((t) => t.id);
  const meld3Ids = meld3.map((t) => t.id);

  // Without lock: declareKonkanOpen wins and auto-discards the final tile
  const wonNoLock = declareKonkanOpen(
    stateNoLock,
    0,
    officialRunIds,
    meld4Ids,
    discardTileItem.id,
  );
  assert.equal(wonNoLock.phase, "finished");
  assert.equal(wonNoLock.winnerId, stateNoLock.players[0].id);
  assert.equal(wonNoLock.endReason, "win");
  assert.equal(wonNoLock.discardPile.at(-1)?.id, discardTileItem.id);
  assert.deepEqual(wonNoLock.discardOwners.at(-1), { playerIndex: 0, playerId: stateNoLock.players[0].id });
  assert.equal(wonNoLock.players[0].hand.some((t) => t.id === discardTileItem.id), false);

  // Setup player with Run 10 + Meld 3 + Discard (no lock) -> declareKonkanOpen must FAIL
  const invalidHandNoLock = [...officialRun, ...meld3, discardTileItem];
  const stateInvalidNoLock: OkeyGameState = {
    ...baseState,
    currentPlayerIndex: 0,
    hasDrawnThisTurn: true,
    okeyTile,
    players: baseState.players.map((p, idx) => idx === 0
      ? { ...p, konkan: true, konkanEntryReason: "discard-pick", hand: invalidHandNoLock }
      : p),
  };
  const failedNoLock = declareKonkanOpen(
    stateInvalidNoLock,
    0,
    officialRunIds,
    meld3Ids,
    discardTileItem.id,
  );
  assert.equal(failedNoLock.phase, "playing");
  assert.equal(failedNoLock.winnerId, null);

  // Setup player with Run 10 + Meld 3 + Discard (WITH lock on table) -> declareKonkanOpen must WIN
  const stateWithLock: OkeyGameState = {
    ...stateInvalidNoLock,
    players: stateInvalidNoLock.players.map((p, idx) => {
      if (idx === 0) return p;
      if (idx === 1) return { ...p, opened: true, melds: [{ ...lockedMeld, lockedByPlayerId: stateInvalidNoLock.players[0].id }] };
      return p;
    }),
  };
  // Normal discard still must NOT win
  const noWinDiscardWithLock = discardTile(stateWithLock, discardTileItem.id);
  assert.equal(noWinDiscardWithLock.phase, "playing");
  assert.equal(noWinDiscardWithLock.winnerId, null);

  // declareKonkanOpen with lock -> valid win
  const wonWithLock = declareKonkanOpen(
    stateWithLock,
    0,
    officialRunIds,
    meld3Ids,
    discardTileItem.id,
  );
  assert.equal(wonWithLock.phase, "finished");
  assert.equal(wonWithLock.winnerId, stateWithLock.players[0].id);
  assert.equal(wonWithLock.endReason, "win");
  assert.equal(wonWithLock.discardPile.at(-1)?.id, discardTileItem.id);
  assert.deepEqual(wonWithLock.discardOwners.at(-1), { playerIndex: 0, playerId: stateWithLock.players[0].id });
  assert.equal(wonWithLock.players[0].hand.some((t) => t.id === discardTileItem.id), false);
});
