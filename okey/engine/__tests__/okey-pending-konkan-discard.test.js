const { drawTile, discardTile, openPlayerMelds } = require("../okey-engine.ts");

function tile(color, value, copy = 1) { return { id: `${color}-${value}-${copy}`, color, value, copy }; }
function meld(id, tiles, score = 30) { return { id, ownerId: "human", kind: "set", tiles, score }; }
function player(id, teamId, hand, opened = false, konkan = false) {
  return { id, name: id, kind: id === "human" ? "human" : "bot", teamId, hand, opened, melds: [], scoreOpened: opened ? 81 : 0, konkan, konkanEntryReason: konkan ? "discard-pick" : null, pendingKonkanFromDiscard: false };
}
function state(overrides = {}) {
  const openTiles = [tile("red", 10), tile("blue", 10), tile("black", 10), tile("red", 11), tile("blue", 11), tile("black", 11), tile("red", 12), tile("blue", 12), tile("black", 12)];
  const players = overrides.players ?? [
    player("human", "teamA", [...openTiles]),
    player("mate", "teamA", []),
    player("opponent", "teamB", []),
    player("opponent2", "teamB", []),
  ];
  return {
    players,
    stagingMelds: [],
    teamFirstOpenScores: { teamA: null, teamB: null },
    currentPlayerIndex: overrides.currentPlayerIndex ?? 0,
    dealerIndex: 0,
    deck: overrides.deck ?? [tile("yellow", 1)],
    discardPile: overrides.discardPile ?? [tile("yellow", 9)],
    discardOwners: overrides.discardOwners ?? [{ playerIndex: 2, playerId: "opponent" }],
    konkanDiscardPickCounts: {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    reshuffleCount: 0,
    indicatorTile: tile("red", 8),
    okeyTile: { ...tile("red", 7), id: "okey-red-7" },
    phase: "playing",
    winnerId: null,
    endReason: null,
    turnMessage: { code: "draw-tile", playerName: "تاقیکردنەوە" },
    hasDrawnThisTurn: false,
  };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function openMeldsFromHand(hand) {
  return [10, 11, 12].map((value) =>
    meld(`m${value}`, hand.filter((entry) => entry.value === value)),
  );
}

{
  const next = drawTile(state(), "discard");
  assert(next.players[0].pendingKonkanFromDiscard === true, "Discard draw should set pending KonKan.");
  assert(next.players[0].konkan === false, "Discard draw alone should not enter KonKan.");
  assert(next.players[0].konkanEntryReason === null, "Discard draw alone should not set KonKan reason.");
}

{
  const drawn = drawTile(state(), "discard");
  const opened = openPlayerMelds(drawn, 0, openMeldsFromHand(drawn.players[0].hand), 90);
  assert(opened.players[0].opened === true, "Successful open should open the player.");
  assert(opened.players[0].konkan === false, "Successful open after discard draw should not enter KonKan.");
  assert(opened.players[0].pendingKonkanFromDiscard === false, "Successful open should clear pending KonKan.");
}

{
  const drawn = drawTile(state(), "discard");
  const discarded = discardTile(drawn, drawn.players[0].hand[0].id);
  assert(discarded.players[0].konkan === true, "Discard without successful open should enter KonKan.");
  assert(discarded.players[0].konkanEntryReason === "discard-pick", "Discard-pick KonKan reason should be recorded.");
  assert(discarded.players[0].pendingKonkanFromDiscard === false, "Discard should clear pending KonKan.");
}

{
  const drawn = drawTile(state(), "discard");
  const failed = openPlayerMelds(drawn, 0, [openMeldsFromHand(drawn.players[0].hand)[0]], 30);
  assert(failed === drawn, "Failed open should not change state.");
  assert(failed.players[0].pendingKonkanFromDiscard === true, "Failed open should keep pending KonKan.");
  assert(failed.players[0].konkan === false, "Failed open should not enter KonKan.");
}

{
  const drawn = drawTile(state(), "discard");
  const restored = JSON.parse(JSON.stringify(drawn));
  assert(restored.players[0].pendingKonkanFromDiscard === true, "Saved/restored state should keep pending KonKan.");
  assert(restored.players[0].konkan === false, "Saved/restored pending state should not become KonKan.");
}

