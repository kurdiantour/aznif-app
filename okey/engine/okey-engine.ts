import type {
  OkeyColor,
  OkeyDiscardOwner,
  OkeyDrawSource,
  OkeyGameState,
  OkeyMeld,
  OkeyTeamId,
  OkeyTile,
} from "../types/okey.ts";
import { getMeldScore, getOkeyScoreValue, getOrderedMeldScore, hasForbiddenThreeTileDoubleJoker, selectBestMeldPlan } from "./okey-melds.ts";
import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";

const COLORS: OkeyColor[] = [...OKEY_RULESET_V1.tiles.colors];
const PLAYER_COUNT = OKEY_RULESET_V1.table.playerCount;
const INITIAL_DEALER_HAND_SIZE = OKEY_RULESET_V1.hand.dealerInitialSize;
const INITIAL_HAND_SIZE = OKEY_RULESET_V1.hand.playerInitialSize;
const WINNING_HAND_SIZE = OKEY_RULESET_V1.hand.basicWinningSize;
const INITIAL_OPEN_SCORE = OKEY_RULESET_V1.opening.initialMinimumScore;
const TEAMMATE_OPEN_SCORE = OKEY_RULESET_V1.opening.teammateMinimumScore;
const MAX_DRAW_PILE_RESHUFFLES = OKEY_RULESET_V1.drawPile.maximumReshuffles;
export const MAX_PLAYER_MELDS = OKEY_RULESET_V1.meld.maximumPlayerMelds;
const COUNTER_CLOCKWISE_TURN_ORDER = OKEY_RULESET_V1.table.counterClockwiseTurnOrder;

type SpendTarget = {
  targetPlayerIndex: number;
  meldIndex: number;
  tiles: OkeyTile[];
  score: number;
  delta: number;
  releasedTile?: OkeyTile;
};

type KonkanSetLockTarget = {
  targetPlayerIndex: number;
  meldIndex: number;
  tiles: OkeyTile[];
  score: number;
};

function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function createTileSet(): OkeyTile[] {
  const tiles: OkeyTile[] = [];
  for (const color of COLORS) {
    for (let value = OKEY_RULESET_V1.tiles.minimumValue; value <= OKEY_RULESET_V1.tiles.maximumValue; value += 1) {
      for (let copy = 1; copy <= OKEY_RULESET_V1.tiles.copiesPerTile; copy += 1) {
        tiles.push({ id: `${color}-${value}-${copy}`, color, value, copy: copy as 1 | 2 });
      }
    }
  }
  for (let copy = 1; copy <= OKEY_RULESET_V1.tiles.fakeJokerCount; copy += 1) {
    tiles.push({ id: `fake-joker-${copy}`, color: "black", value: 0, copy: copy as 1 | 2, isFakeJoker: true });
  }
  return tiles;
}

function getJokerTileFromIndicator(indicatorTile: OkeyTile): OkeyTile {
  return {
    ...indicatorTile,
    id: `okey-${indicatorTile.color}-${indicatorTile.value}`,
    value: indicatorTile.value === OKEY_RULESET_V1.tiles.minimumValue
      ? OKEY_RULESET_V1.tiles.maximumValue
      : indicatorTile.value - 1,
    copy: 1,
  };
}

function getEffectiveTile(tile: OkeyTile, okeyTile: OkeyTile): OkeyTile {
  if (!tile.isFakeJoker) return tile;
  return { ...tile, color: okeyTile.color, value: okeyTile.value };
}

function sortTiles(tiles: OkeyTile[], okeyTile?: OkeyTile): OkeyTile[] {
  const colorOrder = new Map<OkeyColor, number>([
    ["red", 0],
    ["blue", 1],
    ["black", 2],
    ["yellow", 3],
  ]);

  return [...tiles].sort((left, right) => {
    const effectiveLeft = okeyTile ? getEffectiveTile(left, okeyTile) : left;
    const effectiveRight = okeyTile ? getEffectiveTile(right, okeyTile) : right;
    const leftWildcard = okeyTile ? isOkeyWildcard(left, okeyTile) : false;
    const rightWildcard = okeyTile ? isOkeyWildcard(right, okeyTile) : false;

    if (leftWildcard !== rightWildcard) return leftWildcard ? 1 : -1;
    return (
      (colorOrder.get(effectiveLeft.color) ?? 0) -
        (colorOrder.get(effectiveRight.color) ?? 0) ||
      effectiveLeft.value - effectiveRight.value ||
      effectiveLeft.copy - effectiveRight.copy
    );
  });
}

function getOkeyTeamIdForPlayerIndex(playerIndex: number): OkeyTeamId {
  return OKEY_RULESET_V1.table.seatTeamIds[playerIndex] ?? "teamA";
}

export function getTeamFirstOpenScore(state: OkeyGameState, teamId: OkeyTeamId): number | null {
  return state.teamFirstOpenScores[teamId] ?? null;
}

function getOpponentTeamId(teamId: OkeyTeamId): OkeyTeamId {
  return teamId === "teamA" ? "teamB" : "teamA";
}

export function getRequiredOpenScore(state: OkeyGameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  if (!player) return INITIAL_OPEN_SCORE;

  const teammateOpened = state.players.some(
    (entry, index) => index !== playerIndex && entry.teamId === player.teamId && entry.opened,
  );
  if (teammateOpened) return TEAMMATE_OPEN_SCORE;

  const ownFirstOpenScore = getTeamFirstOpenScore(state, player.teamId);
  if (ownFirstOpenScore !== null) return TEAMMATE_OPEN_SCORE;

  const opponentFirstOpenScore = getTeamFirstOpenScore(state, getOpponentTeamId(player.teamId));
  return opponentFirstOpenScore === null
    ? INITIAL_OPEN_SCORE
    : opponentFirstOpenScore + OKEY_RULESET_V1.opening.opponentFirstOpenIncrement;
}
function getTurnMessage(playerName: string, hasDrawnThisTurn: boolean): OkeyGameState["turnMessage"] {
  return { code: hasDrawnThisTurn ? "discard-tile" : "draw-tile", playerName };
}

export function createInitialOkeyGame(
  dealerIndex = Math.floor(Math.random() * PLAYER_COUNT),
  random: () => number = Math.random,
): OkeyGameState {
  const safeDealerIndex = Number.isInteger(dealerIndex) && dealerIndex >= 0 && dealerIndex < PLAYER_COUNT
    ? dealerIndex
    : 0;
  const shuffledTiles = shuffle(createTileSet(), random);
  /*
   * This is a neutral deal factory. Every seat begins as a human seat;
   * the authoritative room service immediately assigns the four real player
   * identities. Temporary automated control is only enabled later by the takeover worker.
   */
const players = Array.from({ length: PLAYER_COUNT }, (_, index) => ({
  id: `seat-${index}`,
  name: `Player ${index + 1}`,
  kind: "human" as const,
  teamId: getOkeyTeamIdForPlayerIndex(index),
  hand: [] as OkeyTile[],
  opened: false,
  melds: [],
  scoreOpened: 0,
  firstOpenScore: null,
  konkan: false,
  konkanEntryReason: null,
  pendingKonkanFromDiscard: false,
}));

  for (let playerIndex = 0; playerIndex < PLAYER_COUNT; playerIndex += 1) {
    const handSize = playerIndex === safeDealerIndex ? INITIAL_DEALER_HAND_SIZE : INITIAL_HAND_SIZE;
    players[playerIndex].hand = shuffledTiles.splice(0, handSize);
  }

  const indicatorTileIndex = shuffledTiles.findIndex((tile) => !tile.isFakeJoker);
  const indicatorTile = shuffledTiles.splice(indicatorTileIndex, 1)[0];
  const okeyTile = getJokerTileFromIndicator(indicatorTile);
  const deck = shuffledTiles.map((tile) => withJokerOrigin(tile, okeyTile, "natural"));
  const playersWithSortedHands = players.map((player) => ({
    ...player,
    hand: sortTiles(
      player.hand.map((tile) => withJokerOrigin(tile, okeyTile, "natural")),
      okeyTile,
    ),
  }));

  return {
    players: playersWithSortedHands,
    stagingMelds: [],
    teamFirstOpenScores: { teamA: null, teamB: null },
    currentPlayerIndex: safeDealerIndex,
    dealerIndex: safeDealerIndex,
    deck,
    discardPile: [],
    discardOwners: [],
    konkanDiscardPickCounts: {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    reshuffleCount: 0,
    indicatorTile,
    okeyTile,
    phase: "playing",
    winnerId: null,
    endReason: null,
    turnMessage: getTurnMessage(playersWithSortedHands[safeDealerIndex].name, true),
    hasDrawnThisTurn: true,
  };
}
export function getTileLabel(tile: OkeyTile): string {
  if (tile.isFakeJoker) return "ج";
  return String(tile.value);
}

export function isOkeyWildcard(tile: OkeyTile, okeyTile: OkeyTile): boolean {
  if (tile.isFakeJoker) return false;
  return tile.color === okeyTile.color && tile.value === okeyTile.value;
}

function withJokerOrigin(tile: OkeyTile, okeyTile: OkeyTile, jokerOrigin: "natural" | "stolen"): OkeyTile {
  return isOkeyWildcard(tile, okeyTile) ? { ...tile, jokerOrigin } : tile;
}

function withoutTile(tiles: OkeyTile[], tileId: string): OkeyTile[] {
  return tiles.filter((tile) => tile.id !== tileId);
}

function getNextCounterClockwisePlayerIndex(currentPlayerIndex: number) {
  const currentTurnOrderIndex = COUNTER_CLOCKWISE_TURN_ORDER.findIndex(
    (playerIndex) => playerIndex === currentPlayerIndex,
  );
  if (currentTurnOrderIndex < 0) return COUNTER_CLOCKWISE_TURN_ORDER[0];
  return COUNTER_CLOCKWISE_TURN_ORDER[
    (currentTurnOrderIndex + 1) % COUNTER_CLOCKWISE_TURN_ORDER.length
  ];
}

function advanceTurn(state: OkeyGameState): OkeyGameState {
  return {
    ...state,
    currentPlayerIndex: getNextCounterClockwisePlayerIndex(state.currentPlayerIndex),
    hasDrawnThisTurn: false,
  };
}

export function movePlayerHandTile(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetIndex: number,
): OkeyGameState {
  const player = state.players[playerIndex];
  if (!player || player.eliminated) return state;

  const currentIndex = player.hand.findIndex((tile) => tile.id === tileId);
  if (currentIndex < 0) return state;

  const nextHand = [...player.hand];
  const [tile] = nextHand.splice(currentIndex, 1);
  const safeTargetIndex = Math.max(0, Math.min(targetIndex, nextHand.length));
  nextHand.splice(safeTargetIndex, 0, tile);

  return {
    ...state,
    players: state.players.map((entry, index) =>
      index === playerIndex ? { ...entry, hand: nextHand } : entry,
    ),
  };
}
export function movePlayerHandTiles(
  state: OkeyGameState,
  playerIndex: number,
  tileIds: string[],
  targetIndex: number,
): OkeyGameState {
  const player = state.players[playerIndex];
  if (!player || player.eliminated || tileIds.length === 0) return state;

  const tileIdSet = new Set(tileIds);
  const movingTilesById = new Map(player.hand.map((tile) => [tile.id, tile]));
  const movingTiles = tileIds
    .map((tileId) => movingTilesById.get(tileId))
    .filter((tile): tile is OkeyTile => tile !== undefined);

  if (movingTiles.length !== tileIds.length) return state;

  const remainingHand = player.hand.filter((tile) => !tileIdSet.has(tile.id));
  const safeTargetIndex = Math.max(0, Math.min(targetIndex, remainingHand.length));
  const nextHand = [
    ...remainingHand.slice(0, safeTargetIndex),
    ...movingTiles,
    ...remainingHand.slice(safeTargetIndex),
  ];

  return {
    ...state,
    players: state.players.map((entry, index) =>
      index === playerIndex ? { ...entry, hand: nextHand } : entry,
    ),
  };
}
export function sortPlayerHand(state: OkeyGameState, playerIndex: number): OkeyGameState {
  return {
    ...state,
    players: state.players.map((player, index) =>
      index === playerIndex && !player.eliminated
        ? { ...player, hand: sortTiles(player.hand, state.okeyTile) }
        : player,
    ),
  };
}

function normalizeOpenMelds(melds: OkeyMeld[], okeyTile: OkeyTile): { melds: OkeyMeld[]; score: number } | null {
  const normalized: OkeyMeld[] = [];
  for (const source of melds) {
    if (source.kind !== "run" && source.kind !== "set") return null;
    const sourceTiles = source.kind === "run" && source.tiles.length > 5 ? orderRunTiles(source.tiles, okeyTile) : source.tiles;
    if (!sourceTiles) return null;
    const candidates = [];
    for (let start = 0; start < sourceTiles.length; start += 1) {
      for (let size = 3; size <= 5 && start + size <= sourceTiles.length; size += 1) {
        const tiles = sourceTiles.slice(start, start + size);
        const score = source.kind === "run" ? getOrderedMeldScore(tiles, okeyTile) : getMeldScore(tiles, okeyTile);
        if (score === null || getMeldKind(tiles, okeyTile) !== source.kind) continue;
        let mask = 0;
        for (let index = start; index < start + size; index += 1) mask |= 1 << index;
        candidates.push({ mask, meld: { ...source, id: `${source.id}-split-${start}-${size}`, tiles, score } });
      }
    }
    const plan = selectBestMeldPlan(candidates, sourceTiles.length);
    if (plan.usedTileCount !== sourceTiles.length) return null;
    normalized.push(...plan.melds);
  }
  return { melds: normalized, score: normalized.reduce((total, meld) => total + meld.score, 0) };
}
export function openPlayerMelds(
  state: OkeyGameState,
  playerIndex: number,
  melds: OkeyMeld[],
  score: number,
): OkeyGameState {
  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) return state;
  const player = state.players[playerIndex];
  if (!player || player.eliminated || melds.length === 0) return state;
  if (player.konkan) return state;

  const normalized = normalizeOpenMelds(melds, state.okeyTile);
  if (!normalized || normalized.melds.length === 0) return state;
  melds = normalized.melds;
  score = normalized.score;
  if (player.melds.length + melds.length > MAX_PLAYER_MELDS) return state;

  const handTileIds = new Set(player.hand.map((tile) => tile.id));
  const openedTileIdList = melds.flatMap((meld) => meld.tiles.map((tile) => tile.id));
  const openedTileIds = new Set(openedTileIdList);
  if (openedTileIds.size !== openedTileIdList.length || openedTileIdList.some((id) => !handTileIds.has(id))) return state;

  const requiredOpenScore = player.opened ? 0 : getRequiredOpenScore(state, playerIndex);
  if (score < requiredOpenScore) return state;
  const nextHand = player.hand.filter((tile) => !openedTileIds.has(tile.id));
  const nextMelds = [
    ...player.melds,
    ...melds.map((meld, index) => ({
      ...meld,
      id: `${player.id}-open-${Date.now()}-${index}`,
      ownerId: player.id,
    })),
  ];

  const nextState = {
    ...state,
    stagingMelds: [],
    teamFirstOpenScores: {
      ...state.teamFirstOpenScores,
      [player.teamId]: state.teamFirstOpenScores[player.teamId] ?? score,
    },
players: state.players.map((entry, index) =>
  index === playerIndex
    ? {
        ...entry,
        hand: nextHand,
        opened: true,
        melds: nextMelds,
        scoreOpened: entry.scoreOpened + score,
        firstOpenScore: entry.firstOpenScore ?? score,
        pendingKonkanFromDiscard: false,
      }
    : entry,
),
  };

  return nextState;
}
function getSpendCandidatePlayerIndexes(state: OkeyGameState, playerIndex: number) {
  const player = state.players[playerIndex];
  if (!player) return [];

  const ownIndexes = [playerIndex];
  const teammateIndexes = state.players
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => index !== playerIndex && entry.teamId === player.teamId && entry.opened)
    .map(({ index }) => index);
  const opponentIndexes = state.players
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.teamId !== player.teamId && entry.opened)
    .map(({ index }) => index);

  return [...ownIndexes, ...teammateIndexes, ...opponentIndexes];
}

function getMeldScoreForKind(kind: OkeyMeld["kind"], tiles: OkeyTile[], okeyTile: OkeyTile) {
  return kind === "run" ? getOrderedMeldScore(tiles, okeyTile) : getMeldScore(tiles, okeyTile);
}

function getMeldWithJokerReplaced(meld: OkeyMeld, tile: OkeyTile, okeyTile: OkeyTile) {
  if (meld.kind !== "run" && meld.kind !== "set") return null;
  if (tile.isFakeJoker || isOkeyWildcard(tile, okeyTile)) return null;

  let best: { tiles: OkeyTile[]; score: number; releasedTile: OkeyTile } | null = null;
  for (let tileIndex = 0; tileIndex < meld.tiles.length; tileIndex += 1) {
    const releasedTile = meld.tiles[tileIndex];
    if (!isOkeyWildcard(releasedTile, okeyTile)) continue;

    const tiles = [
      ...meld.tiles.slice(0, tileIndex),
      tile,
      ...meld.tiles.slice(tileIndex + 1),
    ];
    const score = getMeldScoreForKind(meld.kind, tiles, okeyTile);
    if (score === null) continue;

    if (!best || score > best.score) {
      best = { tiles, score, releasedTile };
    }
  }

  return best;
}
function getMeldWithTileAdded(
  meld: OkeyMeld,
  tile: OkeyTile,
  okeyTile: OkeyTile,
) {
  if (meld.kind !== "run" && meld.kind !== "set") return null;
  if (meld.locked && (meld.kind !== "run" || !meld.lockedTileId)) return null;

  const lockedTileIndex = meld.lockedTileId
    ? meld.tiles.findIndex((entry) => entry.id === meld.lockedTileId)
    : -1;
  if (meld.locked && lockedTileIndex !== 0 && lockedTileIndex !== meld.tiles.length - 1) return null;

  const candidates =
    meld.kind === "run"
      ? [
          [tile, ...meld.tiles],
          [...meld.tiles, tile],
        ]
      : [[...meld.tiles, tile]];

  let best: {
    tiles: OkeyTile[];
    score: number;
    insertionIndex: number;
  } | null = null;

  for (
    let insertionIndex = 0;
    insertionIndex < candidates.length;
    insertionIndex += 1
  ) {
    const addsAtLockedEnd = meld.locked && (
      (lockedTileIndex === 0 && insertionIndex === 0) ||
      (lockedTileIndex === meld.tiles.length - 1 && insertionIndex === 1)
    );
    if (addsAtLockedEnd) continue;

    const tiles = candidates[insertionIndex];
    const score =
      meld.kind === "run"
        ? getOrderedMeldScore(tiles, okeyTile)
        : getMeldScore(tiles, okeyTile);

    if (score === null) continue;

    if (
      !best ||
      score > best.score ||
      (score === best.score && insertionIndex > best.insertionIndex)
    ) {
      best = { tiles, score, insertionIndex };
    }
  }

  return best;
}

function findBestSpendTarget(state: OkeyGameState, playerIndex: number, tile: OkeyTile): SpendTarget | null {
  for (const targetPlayerIndex of getSpendCandidatePlayerIndexes(state, playerIndex)) {
    const targetPlayer = state.players[targetPlayerIndex];
    if (!targetPlayer.opened) continue;

    let bestForPlayer: SpendTarget | null = null;
    for (let meldIndex = 0; meldIndex < targetPlayer.melds.length; meldIndex += 1) {
      const meld = targetPlayer.melds[meldIndex];
      const replaced = getMeldWithJokerReplaced(meld, tile, state.okeyTile);
      if (replaced) {
        const delta = replaced.score - meld.score;
        return { targetPlayerIndex, meldIndex, tiles: replaced.tiles, score: replaced.score, delta, releasedTile: replaced.releasedTile };
      }

      const added = getMeldWithTileAdded(meld, tile, state.okeyTile);
      if (!added) continue;

      const delta = added.score - meld.score;
      if (!bestForPlayer || delta > bestForPlayer.delta) {
        bestForPlayer = { targetPlayerIndex, meldIndex, tiles: added.tiles, score: added.score, delta };
      }
    }

    if (bestForPlayer) return bestForPlayer;
  }

  return null;
}

export function canSpendTileOnBestMeld(state: OkeyGameState, playerIndex: number, tileId: string): boolean {
  if (state.phase !== "playing") return false;
  if (state.currentPlayerIndex !== playerIndex) return false;
  const player = state.players[playerIndex];
  if (!player || player.eliminated) return false;
  const tile = player.hand.find((entry) => entry.id === tileId);
  return tile ? findBestSpendTarget(state, playerIndex, tile) !== null : false;
}

function findSpecificSpendTarget(
  state: OkeyGameState,
  playerIndex: number,
  tile: OkeyTile,
  targetPlayerId: string,
  targetMeldId: string,
): SpendTarget | null {
  const player = state.players[playerIndex];
  if (!player) return null;

  const allowedIndexes = new Set(getSpendCandidatePlayerIndexes(state, playerIndex));
  const targetPlayerIndex = state.players.findIndex((entry) => entry.id === targetPlayerId);
  if (!allowedIndexes.has(targetPlayerIndex)) return null;

  const targetPlayer = state.players[targetPlayerIndex];
  if (!targetPlayer?.opened) return null;

  const meldIndex = targetPlayer.melds.findIndex((meld) => meld.id === targetMeldId);
  if (meldIndex < 0) return null;

  const meld = targetPlayer.melds[meldIndex];
  const replaced = getMeldWithJokerReplaced(meld, tile, state.okeyTile);
  if (replaced) {
    return {
      targetPlayerIndex,
      meldIndex,
      tiles: replaced.tiles,
      score: replaced.score,
      delta: replaced.score - meld.score,
      releasedTile: replaced.releasedTile,
    };
  }

  const added = getMeldWithTileAdded(meld, tile, state.okeyTile);
  if (!added) return null;

  return {
    targetPlayerIndex,
    meldIndex,
    tiles: added.tiles,
    score: added.score,
    delta: added.score - meld.score,
  };
}

export function canSpendTileOnMeld(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): boolean {
  if (state.phase !== "playing") return false;
  if (state.currentPlayerIndex !== playerIndex) return false;
  const player = state.players[playerIndex];
  if (!player || player.eliminated) return false;
  const tile = player.hand.find((entry) => entry.id === tileId);
  return tile ? findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId) !== null : false;
}

function getLockedKonkanSetsForPlayer(state: OkeyGameState, playerId: string): OkeyMeld[] {
  return state.players.flatMap((player) =>
    player.melds.filter(
      (meld) => meld.locked && meld.lockedByPlayerId === playerId && meld.kind === "set",
    ),
  );
}

function findKonkanSetLockTarget(
  state: OkeyGameState,
  playerIndex: number,
  tile: OkeyTile,
  targetPlayerId: string,
  targetMeldId: string,
): KonkanSetLockTarget | null {
  const player = state.players[playerIndex];
  if (!player?.konkan) return null;
  const alreadyLocked = state.players.some((entry) =>
    entry.melds.some((meld) => meld.locked && meld.lockedByPlayerId === player.id),
  );
  if (alreadyLocked) return null;

  const targetPlayerIndex = state.players.findIndex((entry) => entry.id === targetPlayerId);
  if (targetPlayerIndex < 0) return null;

  const targetPlayer = state.players[targetPlayerIndex];
  if (!targetPlayer.opened) return null;
  const meldIndex = targetPlayer.melds.findIndex((meld) => meld.id === targetMeldId);
  if (meldIndex < 0) return null;

  const meld = targetPlayer.melds[meldIndex];
  if (meld.locked || (meld.kind !== "run" && meld.kind !== "set")) return null;
  const added = getMeldWithTileAdded(meld, tile, state.okeyTile);
  if (!added) return null;

  return { targetPlayerIndex, meldIndex, tiles: added.tiles, score: added.score };
}

export function canLockKonkanSet(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): boolean {
  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) return false;
  const player = state.players[playerIndex];
  const tile = player?.hand.find((entry) => entry.id === tileId);
  return !player?.eliminated && !!tile && findKonkanSetLockTarget(state, playerIndex, tile, targetPlayerId, targetMeldId) !== null;
}

export function lockKonkanSet(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): OkeyGameState {
  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) return state;
  const player = state.players[playerIndex];
  const tile = player?.hand.find((entry) => entry.id === tileId);
  if (!player || player.eliminated || !tile) return state;

  const target = findKonkanSetLockTarget(state, playerIndex, tile, targetPlayerId, targetMeldId);
  if (!target) return state;

  const nextHand = withoutTile(player.hand, tileId);
  return {
    ...state,
    players: state.players.map((entry, index) => {
      if (index === playerIndex) {
        return { ...entry, hand: sortTiles(nextHand, state.okeyTile) };
      }
      if (index !== target.targetPlayerIndex) return entry;

      return {
        ...entry,
        melds: entry.melds.map((meld, meldIndex) =>
          meldIndex === target.meldIndex
            ? {
                ...meld,
                tiles: target.tiles,
                score: target.score,
                locked: true,
                lockedByPlayerId: player.id,
                lockedTileId: tile.id,
                originalOwnerPlayerId: meld.ownerId || entry.id,
              }
            : meld,
        ),
      };
    }),
    turnMessage: { code: "set-locked", playerName: player.name },
  };
}


function spendTileOnTarget(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  target: SpendTarget,
): OkeyGameState {
  const player = state.players[playerIndex];
  const spentTiles = target.tiles.map((tile) =>
    tile.id === tileId ? { ...tile, spentByPlayerId: player.id } : tile,
  );
  const spentHand = withoutTile(player.hand, tileId);
  const nextHand = target.releasedTile
    ? [...spentHand, withJokerOrigin(target.releasedTile, state.okeyTile, "stolen")]
    : spentHand;
  const nextPlayers = state.players.map((entry, index) => {
    const nextMelds = index === target.targetPlayerIndex
      ? entry.melds.map((meld, meldIndex) =>
          meldIndex === target.meldIndex
            ? { ...meld, tiles: spentTiles, score: target.score }
            : meld,
        )
      : entry.melds;

    if (index === playerIndex) {
      const entersKonkan = !player.opened;
      return {
        ...entry,
        hand: sortTiles(nextHand, state.okeyTile),
        melds: nextMelds,
        konkan: entry.konkan || entersKonkan,
        konkanEntryReason: entry.konkanEntryReason ?? (entersKonkan
          ? target.releasedTile ? "joker-replacement" : "forced-table-add"
          : null),
      };
    }

    if (index === target.targetPlayerIndex) {
      return {
        ...entry,
        melds: nextMelds,
      };
    }

    return entry;
  });

  const nextState: OkeyGameState = {
    ...state,
    players: nextPlayers,
    turnMessage: target.releasedTile
      ? { code: "joker-released", playerName: player.name }
      : { code: "tile-added", playerName: player.name },
  };

  return nextState;
}

export function spendTileOnMeld(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): OkeyGameState {
  if (state.phase !== "playing") return state;
  if (state.currentPlayerIndex !== playerIndex) return state;
  const player = state.players[playerIndex];
  if (!player || player.eliminated) return state;
  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return state;
  const target = findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId);
  return target ? spendTileOnTarget(state, playerIndex, tileId, target) : state;
}
export function spendTileOnBestMeld(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
): OkeyGameState {
  if (state.phase !== "playing") return state;
  if (state.currentPlayerIndex !== playerIndex) return state;

  const player = state.players[playerIndex];
  if (!player || player.eliminated) return state;

  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return state;

  const target = findBestSpendTarget(state, playerIndex, tile);
  return target ? spendTileOnTarget(state, playerIndex, tileId, target) : state;
}
function finishTileCycleLimit(state: OkeyGameState): OkeyGameState {
  return {
    ...state,
    phase: "finished",
    winnerId: null,
    endReason: "tile-cycle-limit",
    turnMessage: { code: "tile-cycle-limit" },
  };
}

function rebuildDrawPileFromDiscardPool(state: OkeyGameState): OkeyGameState {
  if (state.deck.length > 0) return state;
  if (state.reshuffleCount >= MAX_DRAW_PILE_RESHUFFLES) return finishTileCycleLimit(state);

  const topIndex = state.discardPile.length - 1;
  const topDiscard = state.discardPile[topIndex] ?? null;
  const topDiscardOwner = state.discardOwners[topIndex] ?? null;
  const discardPool = state.discardPile
    .slice(0, Math.max(0, topIndex))
    .filter((_, index) => {
      const owner = state.discardOwners[index];
      return !owner || !state.players[owner.playerIndex]?.eliminated;
    });
  if (discardPool.length === 0) return finishTileCycleLimit(state);

  return {
    ...state,
    deck: shuffle(discardPool),
    discardPile: topDiscard ? [topDiscard] : [],
    discardOwners: topDiscard ? [topDiscardOwner] : [],
    reshuffleCount: state.reshuffleCount + 1,
    turnMessage: {
      code: "draw-pile-reshuffled",
      current: state.reshuffleCount + 1,
      maximum: MAX_DRAW_PILE_RESHUFFLES,
    },
  };
}
export function drawTile(state: OkeyGameState, source: OkeyDrawSource): OkeyGameState {
  if (state.phase !== "playing" || state.hasDrawnThisTurn) return state;

  const preparedState = source === "deck" ? rebuildDrawPileFromDiscardPool(state) : state;
  if (preparedState.phase !== "playing") return preparedState;

  const player = preparedState.players[preparedState.currentPlayerIndex];
  if (player.eliminated) return preparedState;
  const fromDiscard = source === "discard";
  const drawnTile = fromDiscard ? preparedState.discardPile[preparedState.discardPile.length - 1] : preparedState.deck[0];
  if (!drawnTile) return preparedState;

  const discardOwner = fromDiscard ? preparedState.discardOwners[preparedState.discardOwners.length - 1] ?? null : null;
  const discardOwnerPlayer = discardOwner ? preparedState.players[discardOwner.playerIndex] : null;
  if (fromDiscard && discardOwnerPlayer?.eliminated) return preparedState;
  const restrictedKonkanDiscardPick =
    fromDiscard &&
    !!discardOwnerPlayer?.konkan &&
    discardOwnerPlayer.id !== player.id &&
    !(player.konkan && discardOwnerPlayer.konkan);
  const currentKonkanDiscardPickCount = preparedState.konkanDiscardPickCounts[player.id] ?? 0;
  if (restrictedKonkanDiscardPick && currentKonkanDiscardPickCount >= OKEY_RULESET_V1.konkan.maximumRestrictedDiscardPicks) return preparedState;
  const nextKonkanDiscardPickCount = restrictedKonkanDiscardPick
    ? currentKonkanDiscardPickCount + 1
    : currentKonkanDiscardPickCount;
  const nextDrawnTile = withJokerOrigin(drawnTile, preparedState.okeyTile, "natural");

  const startsPendingKonkan = fromDiscard && !player.opened && !player.konkan;
  const nextPlayers = preparedState.players.map((entry, index) =>
    index === preparedState.currentPlayerIndex
      ? {
          ...entry,
          hand: sortTiles([...player.hand, nextDrawnTile], preparedState.okeyTile),
          pendingKonkanFromDiscard: entry.pendingKonkanFromDiscard || startsPendingKonkan,
        }
      : entry,
  );

  return {
    ...preparedState,
    players: nextPlayers,
    deck: fromDiscard ? preparedState.deck : preparedState.deck.slice(1),
    discardPile: fromDiscard ? preparedState.discardPile.slice(0, -1) : preparedState.discardPile,
    discardOwners: fromDiscard ? preparedState.discardOwners.slice(0, -1) : preparedState.discardOwners,
    konkanDiscardPickCounts: restrictedKonkanDiscardPick
      ? { ...preparedState.konkanDiscardPickCounts, [player.id]: nextKonkanDiscardPickCount }
      : preparedState.konkanDiscardPickCounts,
    mustFinishAfterSecondKonkanDiscardPickPlayerId:
      restrictedKonkanDiscardPick && nextKonkanDiscardPickCount === OKEY_RULESET_V1.konkan.maximumRestrictedDiscardPicks
        ? player.id
        : preparedState.mustFinishAfterSecondKonkanDiscardPickPlayerId,
    hasDrawnThisTurn: true,
    turnMessage: getTurnMessage(player.name, true),
  };
}
export function playEliminatedTurn(state: OkeyGameState): OkeyGameState {
  if (state.phase !== "playing" || state.hasDrawnThisTurn) return state;
  const player = state.players[state.currentPlayerIndex];
  if (!player?.eliminated) return state;

  const preparedState = rebuildDrawPileFromDiscardPool(state);
  if (preparedState.phase !== "playing") return preparedState;
  const drawnTile = preparedState.deck[0];
  if (!drawnTile) return preparedState;

  const nextState = advanceTurn({
    ...preparedState,
    deck: preparedState.deck.slice(1),
    discardPile: [...preparedState.discardPile, drawnTile],
    discardOwners: [...preparedState.discardOwners, {
      playerIndex: preparedState.currentPlayerIndex,
      playerId: player.id,
    }],
  });
  const nextPlayer = nextState.players[nextState.currentPlayerIndex];
  return { ...nextState, turnMessage: getTurnMessage(nextPlayer.name, false) };
}
function getCombinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [
    ...getCombinations(rest, size - 1).map((combo) => [first, ...combo]),
    ...getCombinations(rest, size),
  ];
}

function isSameNumberGroup(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumSetSize) return false;
  if (hasForbiddenThreeTileDoubleJoker(tiles, okeyTile)) return false;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  if (!regularTiles.length) return true;

  const value = regularTiles[0].value;
  if (!regularTiles.every((tile) => tile.value === value)) return false;

  const colors = new Set(regularTiles.map((tile) => tile.color));
  return colors.size === regularTiles.length && tiles.length <= COLORS.length;
}

function valueMatchesRunSlot(value: number, runSlot: number) {
  return value === runSlot || (
    value === OKEY_RULESET_V1.tiles.minimumValue
    && runSlot === OKEY_RULESET_V1.tiles.maximumValue + 1
  );
}

function canValuesFormRun(values: number[], wildcardCount: number, targetSize: number) {
  if (!values.length) return targetSize >= OKEY_RULESET_V1.meld.minimumSize
    && targetSize <= OKEY_RULESET_V1.meld.maximumRunSize;

  const uniqueValues = [...new Set(values)].sort((left, right) => left - right);
  if (uniqueValues.length !== values.length) return false;

  const runStarts = Array.from(
    { length: OKEY_RULESET_V1.tiles.maximumValue + 1 - targetSize },
    (_, index) => index + OKEY_RULESET_V1.tiles.minimumValue,
  );
  if (targetSize >= OKEY_RULESET_V1.meld.minimumSize) {
    runStarts.push(OKEY_RULESET_V1.tiles.maximumValue + 1 - targetSize + 1);
  }

  for (const start of runStarts) {
    const sequence = Array.from({ length: targetSize }, (_, index) => start + index);
    const allValuesFit = uniqueValues.every((value) =>
      sequence.some((runSlot) => valueMatchesRunSlot(value, runSlot)),
    );
    if (!allValuesFit) continue;

    const missingCount = sequence.filter(
      (runSlot) => !uniqueValues.some((value) => valueMatchesRunSlot(value, runSlot)),
    ).length;
    if (missingCount <= wildcardCount) return true;
  }

  return false;
}

function isColorRun(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumRunSize) return false;
  if (hasForbiddenThreeTileDoubleJoker(tiles, okeyTile)) return false;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  const wildcardCount = tiles.length - regularTiles.length;
  if (!regularTiles.length) return true;

  const color = regularTiles[0].color;
  if (!regularTiles.every((tile) => tile.color === color)) return false;

  return canValuesFormRun(
    regularTiles.map((tile) => tile.value),
    wildcardCount,
    tiles.length,
  );
}

function isValidMeld(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  return isSameNumberGroup(tiles, okeyTile) || isColorRun(tiles, okeyTile);
}

function canPartitionIntoMelds(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (tiles.length === 0) return true;
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize) return false;

  const [first] = tiles;
  const maxMeldSize = Math.min(OKEY_RULESET_V1.meld.maximumRunSize, tiles.length);

  for (let size = OKEY_RULESET_V1.meld.minimumSize; size <= maxMeldSize; size += 1) {
    const combinations = getCombinations(tiles.slice(1), size - 1);
    for (const combo of combinations) {
      const candidate = [first, ...combo];
      if (!isValidMeld(candidate, okeyTile)) continue;

      const candidateIds = new Set(candidate.map((tile) => tile.id));
      const remaining = tiles.filter((tile) => !candidateIds.has(tile.id));
      if (canPartitionIntoMelds(remaining, okeyTile)) return true;
    }
  }

  return false;
}

function isOfficialKonkanRun(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (tiles.length !== OKEY_RULESET_V1.konkan.officialRunSize) return false;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  const wildcardCount = tiles.length - regularTiles.length;
  if (!regularTiles.length) return false;

  const color = regularTiles[0].color;
  if (!regularTiles.every((tile) => tile.color === color)) return false;

  const values = regularTiles.map((tile) => tile.value);
  if (new Set(values).size !== values.length) return false;

  const patterns = OKEY_RULESET_V1.konkan.officialRunPatterns;

  return patterns.some((pattern) => {
    const allRegularFit = values.every((value) => pattern.some((entry) => entry === value));
    if (!allRegularFit) return false;

    const missingCount = pattern.filter((value) => !values.includes(value)).length;
    return missingCount === wildcardCount;
  });
}

function hasSmallKonkanMeld(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  for (
    let size = OKEY_RULESET_V1.konkan.completionMeldMinimumSize;
    size <= OKEY_RULESET_V1.konkan.completionMeldMaximumSize;
    size += 1
  ) {
    const combinations = getCombinations(tiles, size);
    if (combinations.some((candidate) => isValidMeld(candidate, okeyTile))) return true;
  }
  return false;
}

function hasLockedKonkanSet(melds: OkeyMeld[], okeyTile: OkeyTile): boolean {
  return melds.some(
    (meld) =>
      meld.locked &&
      meld.kind === "set" &&
      meld.tiles.length === OKEY_RULESET_V1.konkan.completionMeldMinimumSize &&
      getMeldScore(meld.tiles, okeyTile) !== null,
  );
}

export function canDeclareKonkanWin(hand: OkeyTile[], okeyTile: OkeyTile, lockedSets: OkeyMeld[] = []): boolean {
  const hasLockedSet = hasLockedKonkanSet(lockedSets, okeyTile);
  if (hand.length < (
    hasLockedSet
      ? OKEY_RULESET_V1.konkan.officialRunSize
      : OKEY_RULESET_V1.konkan.officialRunSize + OKEY_RULESET_V1.konkan.completionMeldMinimumSize
  )) return false;

  const indexedTiles = hand.map((tile, index) => ({ tile, index }));
  const runCandidates = getCombinations(indexedTiles, OKEY_RULESET_V1.konkan.officialRunSize);

  return runCandidates.some((candidate) => {
    const runTiles = candidate.map((entry) => entry.tile);
    if (!isOfficialKonkanRun(runTiles, okeyTile)) return false;

    const runIndexes = new Set(candidate.map((entry) => entry.index));
    const remainingTiles = hand.filter((_, index) => !runIndexes.has(index));
    return hasSmallKonkanMeld(remainingTiles, okeyTile) || hasLockedSet;
  });
}
export function canDeclareKonkanOpen(state: OkeyGameState, playerIndex: number): boolean {
  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) return false;
  const player = state.players[playerIndex];
  if (!player?.konkan || player.eliminated) return false;
  return canDeclareKonkanWin(
    player.hand,
    state.okeyTile,
    getLockedKonkanSetsForPlayer(state, player.id),
  );
}

export function declareKonkanOpen(state: OkeyGameState, playerIndex: number): OkeyGameState {
  if (!canDeclareKonkanOpen(state, playerIndex)) return state;
  const player = state.players[playerIndex];
  return {
    ...state,
    phase: "finished",
    winnerId: player.id,
    endReason: "win",
    turnMessage: { code: "winner", playerName: player.name },
  };
}
export function canDeclareBasicWin(hand: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (hand.length !== WINNING_HAND_SIZE) return false;
  return canPartitionIntoMelds(sortTiles(hand, okeyTile), okeyTile);
}

function getDiscardOwner(state: OkeyGameState): OkeyDiscardOwner {
  const player = state.players[state.currentPlayerIndex];
  return player ? { playerIndex: state.currentPlayerIndex, playerId: player.id } : null;
}

export function discardTile(state: OkeyGameState, tileId: string): OkeyGameState {
  if (state.phase !== "playing" || !state.hasDrawnThisTurn) return state;

  const player = state.players[state.currentPlayerIndex];
  if (player.eliminated) return state;
  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return state;

  const nextHand = withoutTile(player.hand, tileId);
  const entersKonkanFromPending = !!player.pendingKonkanFromDiscard && !player.opened && !player.konkan;
  const isKonkanFinish = player.konkan || entersKonkanFromPending;
  const canWin = isKonkanFinish
    ? canDeclareKonkanWin(nextHand, state.okeyTile, getLockedKonkanSetsForPlayer(state, player.id))
    : nextHand.length === 0 || canDeclareBasicWin(nextHand, state.okeyTile);
  const winnerId = canWin ? player.id : null;
  const nextPlayers = state.players.map((entry, index) =>
    index === state.currentPlayerIndex
      ? {
          ...entry,
          hand: sortTiles(nextHand, state.okeyTile),
          konkan: entry.konkan || entersKonkanFromPending,
          konkanEntryReason: entry.konkanEntryReason ?? (entersKonkanFromPending ? "discard-pick" : null),
          pendingKonkanFromDiscard: false,
        }
      : entry,
  );

  if (winnerId) {
    return {
      ...state,
      players: nextPlayers,
      discardPile: [...state.discardPile, tile],
      discardOwners: [...state.discardOwners, getDiscardOwner(state)],
      mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
      phase: "finished",
      winnerId,
      endReason: "win",
      turnMessage: { code: "winner", playerName: player.name },
    };
  }

  if (state.mustFinishAfterSecondKonkanDiscardPickPlayerId === player.id) {
    const eliminatedPlayers = nextPlayers.map((entry, index) =>
      index === state.currentPlayerIndex ? { ...entry, eliminated: true } : entry,
    );
    const burnedState = advanceTurn({
      ...state,
      players: eliminatedPlayers,
      discardPile: [...state.discardPile, tile],
      discardOwners: [...state.discardOwners, getDiscardOwner(state)],
      mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    });
    const burnedNextPlayer = burnedState.players[burnedState.currentPlayerIndex];
    return {
      ...burnedState,
      turnMessage: getTurnMessage(burnedNextPlayer.name, false),
    };
  }

  const nextState = advanceTurn({
    ...state,
    players: nextPlayers,
    discardPile: [...state.discardPile, tile],
    discardOwners: [...state.discardOwners, getDiscardOwner(state)],
  });
  const nextPlayer = nextState.players[nextState.currentPlayerIndex];

  return {
    ...nextState,
    turnMessage: getTurnMessage(nextPlayer.name, false),
  };
}

function getTileDiscardValue(tile: OkeyTile, okeyTile: OkeyTile) {
  if (tile.isFakeJoker) return getOkeyScoreValue(okeyTile.value);
  if (isOkeyWildcard(tile, okeyTile)) return tile.jokerOrigin === "stolen"
    ? OKEY_RULESET_V1.scoring.stolenJokerInHand
    : OKEY_RULESET_V1.scoring.naturalJokerInHand;
  return getOkeyScoreValue(tile.value);
}

export type OkeyRoundScoreDetail = {
  playerId: string;
  playerName: string;
  teamId: OkeyTeamId;
  opened: boolean;
  points: number;
  reason: "winner" | "winner-team" | "not-opened" | "remaining-hand" | "unfinished-hand";
};

function getHandScore(hand: OkeyTile[], okeyTile: OkeyTile) {
  return hand.reduce((sum, tile) => sum + getTileDiscardValue(tile, okeyTile), 0);
}

export function getRoundResultScoreDetails(state: OkeyGameState) {
  const scores: Record<OkeyTeamId, number> = { teamA: 0, teamB: 0 };
  const winner = state.players.find((player) => player.id === state.winnerId);
  const winnerUsedKonkan = !!winner?.konkan;
  const details: OkeyRoundScoreDetail[] = [];

  if (state.endReason === "win" && winner) {
    for (const player of state.players) {
      const isWinnerTeam = player.teamId === winner.teamId;
      const handScore = getHandScore(player.hand, state.okeyTile);
      const points = isWinnerTeam
        ? 0
        : winnerUsedKonkan
          ? player.opened
            ? OKEY_RULESET_V1.scoring.openedOpponentKonkanBonus + handScore
            : OKEY_RULESET_V1.scoring.unopenedOpponentKonkanPenalty
          : player.opened
            ? handScore
            : OKEY_RULESET_V1.scoring.unopenedOpponentPenalty;
      scores[player.teamId] += points;
      details.push({
        playerId: player.id,
        playerName: player.name,
        teamId: player.teamId,
        opened: player.opened,
        points,
        reason: player.id === winner.id ? "winner" : isWinnerTeam ? "winner-team" : player.opened ? "remaining-hand" : "not-opened",
      });
    }

    return { scores, details };
  }

  return { scores, details };
}

export function getRoundResultTeamScores(state: OkeyGameState) {
  return getRoundResultScoreDetails(state).scores;
}

export function getNextRoundDealerIndex(state: OkeyGameState) {
  return state.players.findIndex((player) => player.id === state.winnerId);
}

export function getMatchWinnerTeamId(scores: Record<OkeyTeamId, number>): OkeyTeamId | null {
  if (scores.teamA === scores.teamB) return null;
  const teamAWins = OKEY_RULESET_V1.scoring.lowerMatchScoreWins
    ? scores.teamA < scores.teamB
    : scores.teamA > scores.teamB;
  return teamAWins ? "teamA" : "teamB";
}
function getMeldKind(tiles: OkeyTile[], okeyTile: OkeyTile): OkeyMeld["kind"] {
  const regularTiles = tiles.filter((tile) => !isOkeyWildcard(tile, okeyTile));
  if (regularTiles.length > 1 && regularTiles.every((tile) => tile.value === regularTiles[0].value)) {
    return "set";
  }
  return "run";
}

function orderRunTiles(tiles: OkeyTile[], okeyTile: OkeyTile): OkeyTile[] | null {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumRunSize) return null;

  const wildcardTiles = tiles.filter((tile) => isOkeyWildcard(tile, okeyTile));
  const regularTiles = tiles.filter((tile) => !isOkeyWildcard(tile, okeyTile));
  const effectiveRegularTiles = regularTiles.map((tile) => ({
    tile,
    effective: getEffectiveTile(tile, okeyTile),
  }));

  if (effectiveRegularTiles.length > 0) {
    const color = effectiveRegularTiles[0].effective.color;
    if (!effectiveRegularTiles.every(({ effective }) => effective.color === color)) return null;
  }

  const runStarts = Array.from(
    { length: OKEY_RULESET_V1.tiles.maximumValue + 1 - tiles.length },
    (_, index) => index + OKEY_RULESET_V1.tiles.minimumValue,
  );
  runStarts.push(OKEY_RULESET_V1.tiles.maximumValue + 1 - tiles.length + 1);

  for (const start of runStarts) {
    const sequence = Array.from({ length: tiles.length }, (_, index) => start + index);
    const ordered: Array<OkeyTile | null> = Array.from({ length: tiles.length }, () => null);
    let valid = true;

    for (const { tile, effective } of effectiveRegularTiles) {
      const slotIndex = sequence.findIndex(
        (runSlot, index) => ordered[index] === null && valueMatchesRunSlot(effective.value, runSlot),
      );
      if (slotIndex < 0) {
        valid = false;
        break;
      }
      ordered[slotIndex] = tile;
    }

    if (!valid) continue;

    const missingIndexes = ordered
      .map((tile, index) => (tile === null ? index : -1))
      .filter((index) => index >= 0);
    if (missingIndexes.length !== wildcardTiles.length) continue;

    missingIndexes.forEach((slotIndex, wildcardIndex) => {
      ordered[slotIndex] = wildcardTiles[wildcardIndex];
    });

    return ordered as OkeyTile[];
  }

  return null;
}

function getCandidateMelds(tiles: OkeyTile[], okeyTile: OkeyTile, maxCandidateSize = 5) {
  const candidates: { mask: number; tiles: OkeyTile[]; score: number }[] = [];

  const visit = (startIndex: number, selected: number[], targetSize: number) => {
    if (selected.length === targetSize) {
      const meldTiles = selected.map((index) => tiles[index]);
      const score = getMeldScore(meldTiles, okeyTile);
      if (score !== null) {
        const kind = getMeldKind(meldTiles, okeyTile);
        const orderedTiles = kind === "run" ? orderRunTiles(meldTiles, okeyTile) : meldTiles;
        if (!orderedTiles) return;

        candidates.push({
          mask: selected.reduce((mask, index) => mask | (1 << index), 0),
          tiles: orderedTiles,
          score,
        });
      }
      return;
    }

    for (let index = startIndex; index < tiles.length; index += 1) {
      selected.push(index);
      visit(index + 1, selected, targetSize);
      selected.pop();
    }
  };

  for (let size = 3; size <= Math.min(maxCandidateSize, tiles.length); size += 1) {
    visit(0, [], size);
  }

  return candidates;
}

export function findBestMeldPlan(tiles: OkeyTile[], okeyTile: OkeyTile, minRemainingTiles = 0, maxCandidateSize = 5) {
  const candidates = getCandidateMelds(tiles, okeyTile, Math.min(5, maxCandidateSize)).map((candidate) => ({
    mask: candidate.mask,
    meld: {
      id: `pending-${candidate.mask}`,
      ownerId: "",
      kind: getMeldKind(candidate.tiles, okeyTile),
      tiles: candidate.tiles,
      score: candidate.score,
    },
  }));
  const plan = selectBestMeldPlan(candidates, tiles.length, minRemainingTiles);
  return { score: plan.score, melds: plan.melds, usedTileCount: plan.usedTileCount };
}
