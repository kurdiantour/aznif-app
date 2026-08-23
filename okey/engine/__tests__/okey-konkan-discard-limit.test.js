const { drawTile, discardTile } = require("../okey-engine.ts");

function tile(color, value, copy = 1) { return { id: `${color}-${value}-${copy}`, color, value, copy }; }
function player(id, teamId, hand, konkan = false) {
  return { id, name: id, kind: id === "human" ? "human" : "bot", teamId, hand, opened: false, melds: [], scoreOpened: 0, konkan, konkanEntryReason: konkan ? "discard-pick" : null };
}
function state(overrides = {}) {
  const players = overrides.players ?? [
    player("human", "teamA", [tile("blue", 1), tile("blue", 2)]),
    player("mate", "teamA", []),
    player("konkan-opponent", "teamB", [], true),
    player("opponent2", "teamB", []),
  ];
  return {
    players,
    stagingMelds: [],
    teamFirstOpenScores: { teamA: null, teamB: null },
    currentPlayerIndex: overrides.currentPlayerIndex ?? 0,
    dealerIndex: 0,
    deck: [tile("yellow", 1), tile("yellow", 2), tile("yellow", 3)],
    discardPile: overrides.discardPile ?? [tile("red", 3)],
    discardOwners: overrides.discardOwners ?? [{ playerIndex: 2, playerId: "konkan-opponent" }],
    konkanDiscardPickCounts: overrides.konkanDiscardPickCounts ?? {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: overrides.mustFinishAfterSecondKonkanDiscardPickPlayerId ?? null,
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

{
  const next = drawTile(state(), "discard");
  assert(next.discardPile.length === 0, "First restricted discard pick should draw the tile.");
  assert(next.konkanDiscardPickCounts.human === 1, "First restricted pick should be counted.");
  assert(next.mustFinishAfterSecondKonkanDiscardPickPlayerId === null, "First restricted pick should not force finish.");
}

{
  const next = drawTile(state({ konkanDiscardPickCounts: { human: 1 } }), "discard");
  assert(next.konkanDiscardPickCounts.human === 2, "Second restricted pick should be counted.");
  assert(next.mustFinishAfterSecondKonkanDiscardPickPlayerId === "human", "Second restricted pick should force same-turn finish.");
}

{
  const openedPlayers = state().players.map((entry, index) =>
    index === 0 ? { ...entry, opened: true, scoreOpened: 42 } : entry
  );
  const next = drawTile(state({ players: openedPlayers }), "discard");
  assert(next.konkanDiscardPickCounts.human === 1, "Opened player's first restricted pick should be counted.");
  assert(next.mustFinishAfterSecondKonkanDiscardPickPlayerId === "human", "Opened player's first KonKan discard pick must force same-turn finish.");
}

{
  const picked = drawTile(state({ konkanDiscardPickCounts: { human: 1 } }), "discard");
  const burned = discardTile(picked, picked.players[0].hand[0].id);
  assert(burned.players[0].eliminated === true, "Discarding after second restricted pick should eliminate player.");
  assert(burned.currentPlayerIndex !== 0, "Turn order should skip eliminated player.");
}

{
  const blocked = drawTile(state({ konkanDiscardPickCounts: { human: 2 } }), "discard");
  assert(blocked.discardPile.length === 1, "Third restricted discard pick should be blocked.");
  assert(blocked.hasDrawnThisTurn === false, "Blocked third pick should not consume the draw.");
}

{
  const players = [
    player("human", "teamA", [], true),
    player("mate", "teamA", []),
    player("konkan-opponent", "teamB", [], true),
    player("opponent2", "teamB", []),
  ];
  const unlimited = drawTile(state({ players, konkanDiscardPickCounts: { human: 2 } }), "discard");
  assert(unlimited.discardPile.length === 0, "KonKan vs KonKan discard pick should ignore the limit.");
  assert(unlimited.konkanDiscardPickCounts.human === 2, "KonKan vs KonKan discard pick should not increment restricted count.");
}
