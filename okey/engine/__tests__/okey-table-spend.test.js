const { canSpendTileOnMeld, spendTileOnMeld } = require("../okey-engine.ts");

function tile(color, value, copy = 1) {
  return { id: `${color}-${value}-${copy}`, color, value, copy };
}

const okeyTile = { ...tile("red", 7), id: "okey-red-7" };

function player(id, teamId, hand, melds = [], opened = false) {
  return {
    id,
    name: id,
    kind: id === "human" ? "human" : "bot",
    teamId,
    hand,
    opened,
    melds,
    scoreOpened: opened ? 81 : 0,
    konkan: false,
    konkanEntryReason: null,
    pendingKonkanFromDiscard: false,
  };
}

function baseState(players, currentPlayerIndex = 0) {
  return {
    players,
    stagingMelds: [],
    teamFirstOpenScores: { teamA: 81, teamB: 81 },
    currentPlayerIndex,
    dealerIndex: 0,
    deck: [],
    discardPile: [],
    discardOwners: [],
    konkanDiscardPickCounts: {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    reshuffleCount: 0,
    indicatorTile: tile("red", 8),
    okeyTile,
    phase: "playing",
    winnerId: null,
    endReason: null,
    turnMessage: { code: "draw-tile", playerName: "تاقیکردنەوە" },
    hasDrawnThisTurn: true,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

{
  const spendTile = tile("blue", 9);
  const meld = {
    id: "opponent-run",
    ownerId: "opponent",
    kind: "run",
    tiles: [tile("blue", 6), tile("blue", 7), tile("blue", 8)],
    score: 21,
  };
  const state = baseState([
    player("human", "teamA", [spendTile], [], true),
    player("mate", "teamA", [], [], false),
    player("opponent", "teamB", [], [meld], true),
    player("opponent2", "teamB", [], [], false),
  ]);

  assert(canSpendTileOnMeld(state, 0, spendTile.id, "opponent", meld.id), "Opened current player should spend a valid run-end tile on an opponent meld.");
  const next = spendTileOnMeld(state, 0, spendTile.id, "opponent", meld.id);
  assert(next.players[0].hand.length === 0, "Spent tile should be removed from rack/hand.");
  assert(next.players[2].melds[0].tiles.map((entry) => entry.value).join(",") === "6,7,8,9", "Run should keep order and include the spent end tile.");
}

{
  const spendTile = tile("black", 4);
  const meld = {
    id: "mate-run",
    ownerId: "mate",
    kind: "run",
    tiles: [tile("black", 5), tile("black", 6), tile("black", 7)],
    score: 18,
  };
  const state = baseState([
    player("human", "teamA", [spendTile], [], true),
    player("mate", "teamA", [], [meld], true),
    player("opponent", "teamB", [], [], true),
    player("opponent2", "teamB", [], [], false),
  ]);

  const next = spendTileOnMeld(state, 0, spendTile.id, "mate", meld.id);
  assert(next.players[1].melds[0].tiles.map((entry) => entry.value).join(",") === "4,5,6,7", "Valid run-start tile should be spendable on teammate melds.");
}

{
  const spendTile = tile("yellow", 10);
  const duplicateColor = tile("red", 10, 2);
  const meld = {
    id: "opponent-set",
    ownerId: "opponent",
    kind: "set",
    tiles: [tile("red", 10), tile("blue", 10), tile("black", 10)],
    score: 30,
  };
  const state = baseState([
    player("human", "teamA", [spendTile, duplicateColor], [], true),
    player("mate", "teamA", [], [], false),
    player("opponent", "teamB", [], [meld], true),
    player("opponent2", "teamB", [], [], false),
  ]);

  assert(canSpendTileOnMeld(state, 0, spendTile.id, "opponent", meld.id), "Set should accept same number with a new color.");
  assert(!canSpendTileOnMeld(state, 0, duplicateColor.id, "opponent", meld.id), "Set should reject a repeated color.");
}

{
  const spendTile = tile("blue", 9);
  const meld = {
    id: "opponent-run",
    ownerId: "opponent",
    kind: "run",
    tiles: [tile("blue", 6), tile("blue", 7), tile("blue", 8)],
    score: 21,
  };
  const unopenedState = baseState([
    player("human", "teamA", [spendTile], [], false),
    player("mate", "teamA", [], [], false),
    player("opponent", "teamB", [], [meld], true),
    player("opponent2", "teamB", [], [], false),
  ]);
  const wrongTurnState = baseState([
    player("human", "teamA", [spendTile], [], true),
    player("mate", "teamA", [], [], false),
    player("opponent", "teamB", [], [meld], true),
    player("opponent2", "teamB", [], [], false),
  ], 2);

  assert(canSpendTileOnMeld(unopenedState, 0, spendTile.id, "opponent", meld.id), "An unopened player should be able to spend a valid tile and enter Konkan.");
  const konkanState = spendTileOnMeld(unopenedState, 0, spendTile.id, "opponent", meld.id);
  assert(konkanState.players[0].konkan, "Spending before opening must force the player into Konkan.");
  assert(konkanState.players[0].konkanEntryReason === "forced-table-add", "Forced Konkan should record the table-add reason.");
  assert(!canSpendTileOnMeld(wrongTurnState, 0, spendTile.id, "opponent", meld.id), "Player can spend only on their own turn.");
}

