import {
  canDeclareKonkanOpen,
  canLockKonkanSet,
  declareKonkanOpen,
  discardTile,
  drawTile,
  findKonkanDeclarationForPlayer,
  findBestMeldPlan,
  getRequiredOpenScore,
  isOkeyWildcard,
  lockKonkanSet,
  openPlayerMelds,
  playEliminatedTurn,
  resolveTableMeldAction,
  spendTileOnBestMeld,
} from "./okey-engine.ts";
import { getOkeyScoreValue } from "./okey-melds.ts";
import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import type {
  OkeyDrawSource,
  OkeyGameState,
  OkeyTile,
} from "../types/okey.ts";

import {
  getOkeyBotDifficulty,
  getOkeyBotProfile,
  isOkeyBotControlled,
  type OkeyBotDifficulty,
  type OkeyBotProfile,
} from "./okey-bot-policy.ts";

export type OkeyBotOptions = { difficulty?: OkeyBotDifficulty; random?: () => number };

export type OkeyBotDecision = {
  drawSource: OkeyDrawSource | null;
  discardTileId: string | null;
  opened: boolean;
  spentTileIds: string[];
  declaredKonkan: boolean;
  konkanRunTileIds: string[];
};

export type PreparedBotTurn = {
  state: OkeyGameState;
  discardTileId: string | null;
  decision: OkeyBotDecision;
};

type HandEvaluation = {
  meldScore: number;
  meldTileCount: number;
  potential: number;
  penalty: number;
};

function effectiveTile(tile: OkeyTile, okeyTile: OkeyTile) {
  return tile.isFakeJoker ? { color: okeyTile.color, value: okeyTile.value } : tile;
}

function tilePenalty(tile: OkeyTile, okeyTile: OkeyTile) {
  if (isOkeyWildcard(tile, okeyTile)) return 40;
  return getOkeyScoreValue(effectiveTile(tile, okeyTile).value);
}

function countPartialPotential(hand: OkeyTile[], okeyTile: OkeyTile) {
  let potential = 0;
  for (let leftIndex = 0; leftIndex < hand.length; leftIndex += 1) {
    const left = hand[leftIndex];
    if (isOkeyWildcard(left, okeyTile)) continue;
    const effectiveLeft = effectiveTile(left, okeyTile);
    for (let rightIndex = leftIndex + 1; rightIndex < hand.length; rightIndex += 1) {
      const right = hand[rightIndex];
      if (isOkeyWildcard(right, okeyTile)) continue;
      const effectiveRight = effectiveTile(right, okeyTile);
      if (effectiveLeft.value === effectiveRight.value && effectiveLeft.color !== effectiveRight.color) potential += 5;
      if (effectiveLeft.color === effectiveRight.color) {
        const distance = Math.abs(effectiveLeft.value - effectiveRight.value);
        if (distance === 1 || (Math.max(effectiveLeft.value, effectiveRight.value) === 13 && Math.min(effectiveLeft.value, effectiveRight.value) === 1)) potential += 6;
        else if (distance === 2) potential += 3;
      }
    }
  }
  return potential;
}

function evaluateHand(hand: OkeyTile[], okeyTile: OkeyTile, minRemainingTiles = 0): HandEvaluation {
  const plan = findBestMeldPlan(hand, okeyTile, minRemainingTiles);
  const meldTileIds = new Set(plan.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)));
  return {
    meldScore: plan.score,
    meldTileCount: meldTileIds.size,
    potential: countPartialPotential(hand.filter((tile) => !meldTileIds.has(tile.id)), okeyTile),
    penalty: hand.reduce((total, tile) => total + (meldTileIds.has(tile.id) ? 0 : tilePenalty(tile, okeyTile)), 0),
  };
}

function evaluationValue(evaluation: HandEvaluation) {
  return evaluation.meldTileCount * 24 + evaluation.meldScore * 1.4 + evaluation.potential - evaluation.penalty;
}

function bestPostDiscardValue(hand: OkeyTile[], okeyTile: OkeyTile) {
  if (hand.length <= 1) return evaluationValue(evaluateHand(hand, okeyTile));
  return Math.max(...hand.map((discard) => evaluationValue(
    evaluateHand(hand.filter((tile) => tile.id !== discard.id), okeyTile),
  )));
}

function tileSupportsStructure(hand: OkeyTile[], candidate: OkeyTile, okeyTile: OkeyTile) {
  if (isOkeyWildcard(candidate, okeyTile)) return true;
  const effectiveCandidate = effectiveTile(candidate, okeyTile);
  return hand.some((tile) => {
    if (isOkeyWildcard(tile, okeyTile)) return true;
    const effective = effectiveTile(tile, okeyTile);
    if (effective.value === effectiveCandidate.value && effective.color !== effectiveCandidate.color) return true;
    if (effective.color !== effectiveCandidate.color) return false;
    const distance = Math.abs(effective.value - effectiveCandidate.value);
    return distance <= 2 || (Math.max(effective.value, effectiveCandidate.value) === 13 && Math.min(effective.value, effectiveCandidate.value) === 1);
  });
}
function canLegallyDrawDiscard(state: OkeyGameState) {
  if (state.discardPile.length === 0) return false;
  const topIndex = state.discardPile.length - 1;
  const owner = state.discardOwners[topIndex];
  const player = state.players[state.currentPlayerIndex];
  const ownerPlayer = owner ? state.players[owner.playerIndex] : null;
  if (!player || ownerPlayer?.eliminated) return false;
  const restricted = !!ownerPlayer?.konkan && ownerPlayer.id !== player.id && !(player.konkan && ownerPlayer.konkan);
  return !restricted || (state.konkanDiscardPickCounts[player.id] ?? 0) < 2;
}

export function chooseBotDrawSource(state: OkeyGameState, options: OkeyBotOptions = {}): OkeyDrawSource {
  const player = state.players[state.currentPlayerIndex];
  const profile = getOkeyBotProfile(options.difficulty ?? (player ? getOkeyBotDifficulty(player) : "normal"));
  const discard = state.discardPile[state.discardPile.length - 1];
  if (!player || !discard || !canLegallyDrawDiscard(state)) return "deck";
  const afterHand = [...player.hand, discard];
  const directGain = bestPostDiscardValue(afterHand, state.okeyTile) -
    bestPostDiscardValue(player.hand, state.okeyTile);
  const openingPlan = findBestMeldPlan(afterHand, state.okeyTile, 1);
  const completesOpening = !player.opened &&
    openingPlan.score >= getRequiredOpenScore(state, state.currentPlayerIndex) &&
    openingPlan.melds.some((meld) => meld.tiles.some((tile) => tile.id === discard.id));
  if (!player.opened && !player.konkan) {
    return completesOpening ? "discard" : "deck";
  }
  const structurallyUseful = tileSupportsStructure(player.hand, discard, state.okeyTile);
  return structurallyUseful && directGain >= profile.minimumDiscardGain ? "discard" : "deck";
}

function tryOpen(state: OkeyGameState) {
  const playerIndex = state.currentPlayerIndex;
  const player = state.players[playerIndex];
  if (!player || player.opened || player.konkan) return state;
  const plan = findBestMeldPlan(player.hand, state.okeyTile, 1);
  if (plan.score < getRequiredOpenScore(state, playerIndex)) return state;
  return openPlayerMelds(state, playerIndex, plan.melds, plan.score);
}

function tryLockUsefulKonkanSet(state: OkeyGameState) {
  const playerIndex = state.currentPlayerIndex;
  const player = state.players[playerIndex];
  if (!player?.konkan || player.eliminated) return state;

  const hand = [...player.hand].sort((left, right) => left.id.localeCompare(right.id));
  for (const tile of hand) {
    for (const targetPlayer of state.players) {
      for (const meld of targetPlayer.melds) {
        if (!canLockKonkanSet(state, playerIndex, tile.id, targetPlayer.id, meld.id)) continue;
        for (const runEnd of [undefined, "start", "end"] as const) {
          const locked = lockKonkanSet(state, playerIndex, tile.id, targetPlayer.id, meld.id, runEnd);
          if (locked !== state) return locked;
        }
      }
    }
  }

  return state;
}
function spendOneUsefulTile(state: OkeyGameState) {
  const playerIndex = state.currentPlayerIndex;
  const player = state.players[playerIndex];

  if (
    !player ||
    player.hand.length <= 1 ||
    state.phase !== "playing"
  ) {
    return {
      state,
      spentTileId: null as string | null,
    };
  }

  let best: {
    state: OkeyGameState;
    tileId: string;
    value: number;
  } | null = null;

  const baseline = evaluationValue(
    evaluateHand(player.hand, state.okeyTile, 1),
  );

  for (const tile of player.hand) {
    for (const runEnd of [undefined, "start", "end"] as const) {
      const candidate = spendTileOnBestMeld(
        state,
        playerIndex,
        tile.id,
        runEnd,
      );

      if (candidate === state) continue;

    const nextPlayer = candidate.players[playerIndex];

      if (!nextPlayer || nextPlayer.hand.length < 1) continue;

    const releasedJoker = nextPlayer.hand.some((entry) =>
      entry.jokerOrigin === "stolen" && !player.hand.some((before) => before.id === entry.id),
    );
    // Bot policy: unlike the authoritative Human rule, a closed Bot may not
    // replace a table joker. Once opened, it may steal and reuse it normally.
      if (!player.opened && releasedJoker) continue;

    const handGain =
      evaluationValue(
        evaluateHand(
          nextPlayer.hand,
          state.okeyTile,
          1,
        ),
      ) - baseline;

    const value = handGain + tilePenalty(tile, state.okeyTile) + (releasedJoker ? 80 : 0);

      if (
        !best ||
        value > best.value ||
        (
          value === best.value &&
          tile.id < best.tileId
        )
      ) {
        best = {
          state: candidate,
          tileId: tile.id,
          value,
        };
      }
    }
  }

  return best
    ? {
        state: best.state,
        spentTileId: best.tileId,
      }
    : {
        state,
        spentTileId: null,
      };
}

function spendUsefulTiles(state: OkeyGameState, profile: OkeyBotProfile) {
  let current = state;
  const spentTileIds: string[] = [];
  const seenHands = new Set<string>();
  for (let action = 0; action < profile.maximumSpendActions; action += 1) {
    const player = current.players[current.currentPlayerIndex];
    if (!player || current.phase !== "playing" || player.hand.length <= 1) break;
    // A closed bot must not enter Konkan by adding a tile to a table meld.
    // Existing Konkan bots may still use the table according to Konkan rules.
    if (!player.opened && !player.konkan) break;
    const signature = player.hand.map((tile) => tile.id).sort().join("|");
    if (seenHands.has(signature)) break;
    seenHands.add(signature);
    const spent = spendOneUsefulTile(current);
    if (spent.state === current || !spent.spentTileId) break;
    current = spent.state;
    spentTileIds.push(spent.spentTileId);
  }
  return { state: current, spentTileIds };
}
/**
 * Closed bots cannot use table melds yet, but they must preserve any tile that
 * will become a legal table action after opening:
 * - a tile that can replace/steal a table Joker
 * - a tile that can be spent on an existing table meld
 *
 * We deliberately ask the authoritative table-action resolver instead of
 * duplicating meld/Joker rules in the bot policy.  A temporary opened=true
 * projection is used only for evaluation; the real game state is untouched.
 */
function getBotTableFutureProtectedTileIds(state: OkeyGameState): Set<string> {
  const playerIndex = state.currentPlayerIndex;
  const player = state.players[playerIndex];
  if (!player || player.eliminated || player.opened || player.konkan) return new Set();

  const evaluationState: OkeyGameState = {
    ...state,
    players: state.players.map((entry, index) =>
      index === playerIndex ? { ...entry, opened: true } : entry,
    ),
  };

  const protectedTileIds = new Set<string>();
  for (const tile of player.hand) {
    let usefulOnTable = false;

    for (const targetPlayer of evaluationState.players) {
      if (usefulOnTable) break;
      if (!targetPlayer.opened || targetPlayer.eliminated) continue;

      for (const meld of targetPlayer.melds) {
        const action = resolveTableMeldAction(
          evaluationState,
          playerIndex,
          tile.id,
          targetPlayer.id,
          meld.id,
        );

        if (action?.type === "spend") {
          usefulOnTable = true;
          break;
        }
      }
    }

    if (usefulOnTable) protectedTileIds.add(tile.id);
  }

  return protectedTileIds;
}

function discardDanger(state: OkeyGameState, tile: OkeyTile) {
  const order: readonly number[] = OKEY_RULESET_V1.table.counterClockwiseTurnOrder;
  const nextPlayerIndex = order[(order.indexOf(state.currentPlayerIndex) + 1) % order.length];
  const nextPlayer = state.players[nextPlayerIndex];
  if (!nextPlayer || nextPlayer.eliminated) return 0;
  const effective = effectiveTile(tile, state.okeyTile);
  let danger = nextPlayer.opened ? getOkeyScoreValue(effective.value) * 0.35 : 0;
  if (nextPlayer.hand.length <= 4) danger += 9;
  if (isOkeyWildcard(tile, state.okeyTile)) danger += 100;
  return danger;
}

export function chooseBotDiscardTile(state: OkeyGameState, options: OkeyBotOptions = {}): OkeyTile | null {
  const player = state.players[state.currentPlayerIndex];
  if (!player?.hand.length) return null;
  const profile = getOkeyBotProfile(options.difficulty ?? getOkeyBotDifficulty(player));

  const protectedTileIds = getBotTableFutureProtectedTileIds(state);
  const unprotectedTiles = player.hand.filter((tile) => !protectedTileIds.has(tile.id));

  // Hard protection: if at least one ordinary discard exists, never throw a
  // future table Spend/Joker-replacement tile. If every tile is protected,
  // fall back to the whole hand so the bot can still finish its turn.
  const discardPool = unprotectedTiles.length > 0 ? unprotectedTiles : player.hand;

  const candidates: { tile: OkeyTile; value: number }[] = [];
  for (const tile of discardPool) {
    const remaining = player.hand.filter((entry) => entry.id !== tile.id);
    const value = evaluationValue(evaluateHand(remaining, state.okeyTile)) +
      tilePenalty(tile, state.okeyTile) * 0.8 - discardDanger(state, tile) * profile.discardRiskWeight;
    candidates.push({ tile, value });
  }
  candidates.sort((left, right) => right.value - left.value || left.tile.id.localeCompare(right.tile.id));
  const window = candidates.slice(0, profile.candidateWindow);
  const selectedIndex = options.random ? Math.min(window.length - 1, Math.floor(options.random() * window.length)) : 0;
  return window[selectedIndex]?.tile ?? null;
}

export function prepareBotTurn(
  state: OkeyGameState,
  options: OkeyBotOptions = {},
): PreparedBotTurn {
  const emptyDecision: OkeyBotDecision = {
    drawSource: null,
    discardTileId: null,
    opened: false,
    spentTileIds: [],
    declaredKonkan: false,
    konkanRunTileIds: [],
  };
  if (state.phase !== "playing") return { state, discardTileId: null, decision: emptyDecision };
  const player = state.players[state.currentPlayerIndex];
  if (!player) return { state, discardTileId: null, decision: emptyDecision };
  if (player.eliminated) return { state: playEliminatedTurn(state), discardTileId: null, decision: emptyDecision };
  if (!isOkeyBotControlled(player)) return { state, discardTileId: null, decision: emptyDecision };

  const difficulty = options.difficulty ?? getOkeyBotDifficulty(player);
  const profile = getOkeyBotProfile(difficulty);
  const drawSource = state.hasDrawnThisTurn
    ? null
    : chooseBotDrawSource(state, { ...options, difficulty });
  let current = drawSource ? drawTile(state, drawSource) : state;
  if (current.phase !== "playing" || !current.hasDrawnThisTurn) {
    return { state: current, discardTileId: null, decision: { ...emptyDecision, drawSource } };
  }

  let declaredKonkan = false;
  let konkanRunTileIds: string[] = [];
  const openingKonkanRun = findKonkanDeclarationForPlayer(current, current.currentPlayerIndex);
  if (openingKonkanRun && canDeclareKonkanOpen(current, current.currentPlayerIndex, openingKonkanRun)) {
    current = declareKonkanOpen(current, current.currentPlayerIndex, openingKonkanRun);
    declaredKonkan = true;
    konkanRunTileIds = openingKonkanRun;
  }
  if (current.phase !== "playing") {
    return { state: current, discardTileId: null, decision: { ...emptyDecision, drawSource, declaredKonkan, konkanRunTileIds } };
  }

  const beforeOpen = current.players[current.currentPlayerIndex]?.opened ?? false;
  current = tryOpen(current);
  const opened = !beforeOpen && !!current.players[current.currentPlayerIndex]?.opened;

  const spent = spendUsefulTiles(current, profile);
  current = spent.state;
  current = tryLockUsefulKonkanSet(current);

  const finishingKonkanRun = findKonkanDeclarationForPlayer(current, current.currentPlayerIndex);
  if (finishingKonkanRun && canDeclareKonkanOpen(current, current.currentPlayerIndex, finishingKonkanRun)) {
    current = declareKonkanOpen(current, current.currentPlayerIndex, finishingKonkanRun);
    declaredKonkan = true;
    konkanRunTileIds = finishingKonkanRun;
  }
  if (current.phase !== "playing") {
    return {
      state: current,
      discardTileId: null,
      decision: { ...emptyDecision, drawSource, opened, spentTileIds: spent.spentTileIds, declaredKonkan, konkanRunTileIds },
    };
  }

  const discard = chooseBotDiscardTile(current, { ...options, difficulty });
  const discardTileId = discard?.id ?? null;
  return {
    state: current,
    discardTileId,
    decision: { drawSource, discardTileId, opened, spentTileIds: spent.spentTileIds, declaredKonkan, konkanRunTileIds },
  };
}

export function playBotTurn(
  state: OkeyGameState,
  options: OkeyBotOptions = {},
): OkeyGameState {
  const prepared = prepareBotTurn(
    state,
    options,
  );

  return prepared.discardTileId
    ? discardTile(
        prepared.state,
        prepared.discardTileId,
      )
    : prepared.state;
}
