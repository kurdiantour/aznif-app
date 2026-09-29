import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import type {
    OkeyColor,
    OkeyDiscardOwner,
    OkeyDrawSource,
    OkeyGameState,
    OkeyMeld,
    OkeyTeamId,
    OkeyTile,
} from "../types/okey.ts";
import { chooseOkeyEliminatedTurnDiscardTile, getOkeyRecyclableMeldsForCurrentRules, isActiveOkeyPlayer, isEliminatedOkeyPlayer, markOkeyPlayerEliminated } from "./okeyengine-eliminated.ts";
import { canDeclareKonkanOpen, eliminateKonkanPlayerMidTurn, getKonkanDiscardEntry, getKonkanDiscardOutcome, resolveKonkanDiscardPick } from "./okeyengine-konkan.ts";
import { canDeclareBasicWin, getOkeyScoreValue, getRemainingPlayerMeldSlots, getRequiredOpenScore, isOkeyWildcard, sortTiles, validateOpenPlayerMelds } from "./okeyengine-melds.ts";
import { advanceTurn, getTurnMessage, withJokerOrigin, withoutTile } from "./okeyengine-state-utils.ts";
export { canDeclareKonkanOpen, canDeclareKonkanWin, canLockKonkanSet, canSpendTileOnBestMeld, canSpendTileOnMeld, declareKonkanOpen, eliminateKonkanPlayerMidTurn, getLockedKonkanSetsForPlayer, hasLockedKonkanSet, hasPlayerExecutedKonkanSpend, hasSmallKonkanMeld, isOrderedOfficialKonkanRun, lockKonkanSet, resolveTableMeldAction, spendTileOnBestMeld, spendTileOnMeld } from "./okeyengine-konkan.ts";
export type { OkeyRunEnd, OkeyTableMeldAction } from "./okeyengine-konkan.ts";
export { canDeclareBasicWin, findBestMeldPlan, getMeldKind, getRemainingPlayerMeldSlots, getRequiredOpenScore, getTeamFirstOpenScore, isOkeyWildcard, isValidMeld, MAX_PLAYER_MELDS, normalizeOpenMelds, orderRunTiles, sortTiles } from "./okeyengine-melds.ts";
export { advanceTurn, getTurnMessage, withJokerOrigin, withoutTile } from "./okeyengine-state-utils.ts";

const COLORS: OkeyColor[] = [...OKEY_RULESET_V1.tiles.colors];
const PLAYER_COUNT = OKEY_RULESET_V1.table.playerCount;
const INITIAL_DEALER_HAND_SIZE = OKEY_RULESET_V1.hand.dealerInitialSize;
const INITIAL_HAND_SIZE = OKEY_RULESET_V1.hand.playerInitialSize;
const MAX_DRAW_PILE_RESHUFFLES = OKEY_RULESET_V1.drawPile.maximumReshuffles;
const COUNTER_CLOCKWISE_TURN_ORDER = OKEY_RULESET_V1.table.counterClockwiseTurnOrder;

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

function getOkeyTeamIdForPlayerIndex(playerIndex: number): OkeyTeamId {
  return OKEY_RULESET_V1.table.seatTeamIds[playerIndex] ?? "teamA";
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
    konkanSpendsExecuted: 0,
  }));

  const dealerTurnOrderIndex = COUNTER_CLOCKWISE_TURN_ORDER.findIndex(
    (playerIndex) => playerIndex === safeDealerIndex,
  );
  const dealOrder = Array.from({ length: PLAYER_COUNT }, (_, offset) =>
    COUNTER_CLOCKWISE_TURN_ORDER[
      (dealerTurnOrderIndex + offset) % PLAYER_COUNT
    ],
  );

  let dealRound = 0;
  while (players.some((player, index) =>
    player.hand.length < (index === safeDealerIndex ? INITIAL_DEALER_HAND_SIZE : INITIAL_HAND_SIZE)
  )) {
    for (const playerIndex of dealOrder) {
      const targetHandSize = playerIndex === safeDealerIndex
        ? INITIAL_DEALER_HAND_SIZE
        : INITIAL_HAND_SIZE;
      const remaining = targetHandSize - players[playerIndex].hand.length;
      if (remaining <= 0) continue;

      const requestedBatchSize = dealRound === 0 && playerIndex !== safeDealerIndex ? 2 : 3;
      players[playerIndex].hand.push(
        ...shuffledTiles.splice(0, Math.min(requestedBatchSize, remaining)),
      );
    }
    dealRound += 1;
  }

  const indicatorTileIndex = shuffledTiles.findIndex((tile) => !tile.isFakeJoker);
  const indicatorTile = shuffledTiles.splice(indicatorTileIndex, 1)[0];
  const okeyTile = getJokerTileFromIndicator(indicatorTile);
  const deck = shuffledTiles.map((tile) => withJokerOrigin(tile, okeyTile, "natural"));
  const playersWithInitialHands = players.map((player) => ({
    ...player,
    hand: player.hand.map((tile) => withJokerOrigin(tile, okeyTile, "natural")),
  }));

  return {
    players: playersWithInitialHands,
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
    turnMessage: getTurnMessage(playersWithInitialHands[safeDealerIndex].name, true),
    hasDrawnThisTurn: true,
  };
}

export function movePlayerHandTile(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetIndex: number,
): OkeyGameState {
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return state;

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

export type OkeyOpenAction =
  | {
      allowed: true;
      mode: "open-melds";
      melds: OkeyMeld[];
      score: number;
      requiredScore: number;
      remainingSlots: number;
    }
  | {
      allowed: true;
      mode: "declare-konkan";
      orderedRunTileIds: string[];
      completionMeldTileIds: string[];
      discardTileId: string;
      requiredScore: number;
      remainingSlots: number;
    }
  | {
      allowed: false;
      mode: null;
      requiredScore: number;
      remainingSlots: number;
    };

export function getOkeyOpenAction(
  state: OkeyGameState,
  playerIndex: number,
  melds: OkeyMeld[],
  orderedKonkanCandidates: { orderedRunTileIds: string[]; completionMeldTileIds: string[]; discardTileId: string }[],
): OkeyOpenAction {
  const player = state.players[playerIndex];
  const requiredScore = player?.opened ? 0 : getRequiredOpenScore(state, playerIndex);
  const remainingSlots = getRemainingPlayerMeldSlots(state, playerIndex);
  if (player?.konkan) {
    for (const candidate of orderedKonkanCandidates) {
      if (canDeclareKonkanOpen(
        state,
        playerIndex,
        candidate.orderedRunTileIds,
        candidate.completionMeldTileIds,
        candidate.discardTileId,
      )) {
        return {
          allowed: true,
          mode: "declare-konkan",
          orderedRunTileIds: candidate.orderedRunTileIds,
          completionMeldTileIds: candidate.completionMeldTileIds,
          discardTileId: candidate.discardTileId,
          requiredScore,
          remainingSlots,
        };
      }
    }
    const validation = validateOpenPlayerMelds(state, playerIndex, melds);
    if (validation) {
      return {
        allowed: true,
        mode: "open-melds",
        melds: validation.melds,
        score: validation.score,
        requiredScore,
        remainingSlots,
      };
    }
    return { allowed: false, mode: null, requiredScore, remainingSlots };
  }

  const validation = validateOpenPlayerMelds(state, playerIndex, melds);
  return validation
    ? {
        allowed: true,
        mode: "open-melds",
        melds,
        score: melds.reduce((total, meld) => total + meld.score, 0),
        requiredScore,
        remainingSlots,
      }
    : { allowed: false, mode: null, requiredScore, remainingSlots };
}

export type OkeyRackDiscardAction =
  | { type: "discard"; tileId: string }
  | { type: "open-and-discard"; tileId: string; melds: OkeyMeld[]; score: number };

export function getOkeyRackDiscardAction(
  state: OkeyGameState,
  playerIndex: number,
  melds: OkeyMeld[],
  discardTileId: string,
): OkeyRackDiscardAction {
  if (state.players[playerIndex]?.opened) return { type: "discard", tileId: discardTileId };
  const candidateMelds = melds.filter(
    (meld) => meld.tiles.every((tile) => tile.id !== discardTileId),
  );
  const validation = validateOpenPlayerMelds(state, playerIndex, candidateMelds, {
    enforceRequiredScore: false,
  });
  return validation
    ? {
        type: "open-and-discard",
        tileId: discardTileId,
        melds: validation.melds,
        score: validation.score,
      }
    : { type: "discard", tileId: discardTileId };
}

export function openPlayerMelds(
  state: OkeyGameState,
  playerIndex: number,
  melds: OkeyMeld[],
  score: number,
  options: { finalDiscard?: boolean } = {},
): OkeyGameState {
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return state;
  const validation = validateOpenPlayerMelds(state, playerIndex, melds, {
    enforceRequiredScore: !options.finalDiscard,
  });
  if (!validation) return state;

  if (options.finalDiscard && !player.opened && validation.score < getRequiredOpenScore(state, playerIndex)) {
    return eliminateKonkanPlayerMidTurn(state, playerIndex, "normal-meld");
  }

  if (player.konkan) {
    return eliminateKonkanPlayerMidTurn(state, playerIndex, "normal-meld");
  }

  melds = validation.melds;
  score = validation.score;
  const openedTileIds = validation.openedTileIds;
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

function finishTileCycleLimit(state: OkeyGameState): OkeyGameState {
  return {
    ...state,
    phase: "finished",
    winnerId: null,
    endReason: "tile-cycle-limit",
    turnMessage: { code: "tile-cycle-limit" },
  };
}

function isCompleteFourColorSet(meld: OkeyMeld) {
  if (meld.kind !== "set" || meld.tiles.length !== OKEY_RULESET_V1.meld.maximumSetSize) return false;
  if (meld.tiles.some((tile) => tile.isFakeJoker)) return false;

  const value = meld.tiles[0]?.value;
  return value !== undefined
    && meld.tiles.every((tile) => tile.value === value)
    && new Set(meld.tiles.map((tile) => tile.color)).size === COLORS.length;
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
      return !owner || !isEliminatedOkeyPlayer(state.players[owner.playerIndex]);
    });
  const completedSetTiles = state.players.flatMap((player) =>
    getOkeyRecyclableMeldsForCurrentRules(player)
          .filter((meld) => isCompleteFourColorSet(meld))
          .flatMap((meld) => meld.tiles),
  );
  const rebuildPool = [...discardPool, ...completedSetTiles];
  if (rebuildPool.length === 0) return finishTileCycleLimit(state);

  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      melds: !isEliminatedOkeyPlayer(player)
        ? player.melds.filter((meld) => !isCompleteFourColorSet(meld))
        : player.melds,
    })),
    deck: shuffle(rebuildPool),
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
  if (isEliminatedOkeyPlayer(player)) return preparedState;
  const fromDiscard = source === "discard";
  const drawnTile = fromDiscard ? preparedState.discardPile[preparedState.discardPile.length - 1] : preparedState.deck[0];
  if (!drawnTile) return preparedState;

  const discardOwner = fromDiscard ? preparedState.discardOwners[preparedState.discardOwners.length - 1] ?? null : null;
  const konkanPick = resolveKonkanDiscardPick(
    preparedState,
    preparedState.currentPlayerIndex,
    fromDiscard && discardOwner ? discardOwner.playerIndex : null,
  );
  if (fromDiscard && !konkanPick.allowed) return preparedState;
  const nextDrawnTile = withJokerOrigin(drawnTile, preparedState.okeyTile, "natural");

  const nextPlayers = preparedState.players.map((entry, index) =>
    index === preparedState.currentPlayerIndex
      ? {
          ...entry,
          hand: sortTiles([...player.hand, nextDrawnTile], preparedState.okeyTile),
          ...getKonkanDiscardEntry(entry, fromDiscard),
        }
      : entry,
  );

  return {
    ...preparedState,
    players: nextPlayers,
    deck: fromDiscard ? preparedState.deck : preparedState.deck.slice(1),
    discardPile: fromDiscard ? preparedState.discardPile.slice(0, -1) : preparedState.discardPile,
    discardOwners: fromDiscard ? preparedState.discardOwners.slice(0, -1) : preparedState.discardOwners,
    konkanDiscardPickCounts: konkanPick.restricted
      ? { ...preparedState.konkanDiscardPickCounts, [player.id]: konkanPick.count }
      : preparedState.konkanDiscardPickCounts,
    mustFinishAfterSecondKonkanDiscardPickPlayerId: konkanPick.mustFinishPlayerId,
    hasDrawnThisTurn: true,
    turnMessage: getTurnMessage(player.name, true),
  };
}

export function playEliminatedTurn(state: OkeyGameState): OkeyGameState {
  if (state.phase !== "playing" || state.hasDrawnThisTurn) return state;
  const player = state.players[state.currentPlayerIndex];
  if (!isEliminatedOkeyPlayer(player)) return state;

  const preparedState = rebuildDrawPileFromDiscardPool(state);
  if (preparedState.phase !== "playing") return preparedState;
  const drawnTile = preparedState.deck[0];
  if (!drawnTile) return preparedState;

  const discardedTile = chooseOkeyEliminatedTurnDiscardTile(player, drawnTile);
  const nextHand = [...player.hand, drawnTile].filter((tile) => tile.id !== discardedTile.id);

  const nextState = advanceTurn({
    ...preparedState,
    players: preparedState.players.map((entry, index) =>
      index === preparedState.currentPlayerIndex ? { ...entry, hand: nextHand } : entry,
    ),
    deck: preparedState.deck.slice(1),
    discardPile: [...preparedState.discardPile, discardedTile],
    discardOwners: [...preparedState.discardOwners, {
      playerIndex: preparedState.currentPlayerIndex,
      playerId: player.id,
    }],
  });
  const nextPlayer = nextState.players[nextState.currentPlayerIndex];
  return { ...nextState, turnMessage: getTurnMessage(nextPlayer.name, false) };
}

function getDiscardOwner(state: OkeyGameState): OkeyDiscardOwner {
  const player = state.players[state.currentPlayerIndex];
  return player ? { playerIndex: state.currentPlayerIndex, playerId: player.id } : null;
}

export function discardTile(
  state: OkeyGameState,
  tileId: string,
): OkeyGameState {
  if (state.phase !== "playing" || !state.hasDrawnThisTurn) return state;

  const player = state.players[state.currentPlayerIndex];
  if (isEliminatedOkeyPlayer(player)) return state;
  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return state;

  const nextHand = withoutTile(player.hand, tileId);
  const konkanOutcome = getKonkanDiscardOutcome(player);
  const canWin = konkanOutcome.isKonkanFinish
    ? false
    : nextHand.length === 0 || canDeclareBasicWin(nextHand, state.okeyTile);
  const winnerId = canWin ? player.id : null;
  const nextPlayers = state.players.map((entry, index) =>
    index === state.currentPlayerIndex
      ? {
          ...entry,
          hand: nextHand,
          ...konkanOutcome,
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
    const eliminatedPlayers = markOkeyPlayerEliminated({ ...state, players: nextPlayers }, state.currentPlayerIndex).players;
    const burnedDiscardState = {
      ...state,
      players: eliminatedPlayers,
      discardPile: [...state.discardPile, tile],
      discardOwners: [...state.discardOwners, getDiscardOwner(state)],
      mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    };
    const burnedState = advanceTurn(burnedDiscardState);
    const burnedNextPlayer = burnedState.players[burnedState.currentPlayerIndex];
    return {
      ...burnedState,
      turnMessage: getTurnMessage(burnedNextPlayer.name, false),
    };
  }

  const discardedState = {
    ...state,
    players: nextPlayers,
    discardPile: [...state.discardPile, tile],
    discardOwners: [...state.discardOwners, getDiscardOwner(state)],
  };
  const nextState = advanceTurn(discardedState);
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
      const handScore = isEliminatedOkeyPlayer(player)
        ? 0
        : getHandScore(player.hand, state.okeyTile);
      const points = isWinnerTeam
        ? 0
        : isEliminatedOkeyPlayer(player)
          ? 100 + (winnerUsedKonkan ? OKEY_RULESET_V1.scoring.openedOpponentKonkanBonus : 0)
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

export type PreparedTimeoutTurn = {
  state: OkeyGameState;
  drawnTileId: string | null;
};

export function prepareTimeoutTurn(state: OkeyGameState, playerIndex: number): PreparedTimeoutTurn {
  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) {
    return { state, drawnTileId: null };
  }

  if (state.hasDrawnThisTurn) {
    return { state, drawnTileId: null };
  }

  const drawnTileId = state.deck[0]?.id ?? null;
  if (!drawnTileId) return { state, drawnTileId: null };

  return {
    state: drawTile(state, "deck"),
    drawnTileId,
  };
}

export function resolveTimeoutTurn(state: OkeyGameState, playerIndex: number): OkeyGameState {
  const prepared = prepareTimeoutTurn(state, playerIndex);
  if (prepared.drawnTileId) {
    return discardTile(prepared.state, prepared.drawnTileId);
  }

  if (state.phase !== "playing" || state.currentPlayerIndex !== playerIndex) return state;
  if (!state.hasDrawnThisTurn) return prepared.state;

  const player = state.players[playerIndex];
  const discardTileId = player?.hand[player.hand.length - 1]?.id;
  if (!discardTileId || !player?.hand.some((tile) => tile.id === discardTileId)) return state;

  return discardTile(state, discardTileId);
}

