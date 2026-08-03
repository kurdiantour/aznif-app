import {
  canDeclareKonkanOpen,
  canLockKonkanSet,
  declareKonkanOpen,
  discardTile,
  drawTile,
  findBestMeldPlan,
  getRequiredOpenScore,
  isOkeyWildcard,
  lockKonkanSet,
  openPlayerMelds,
  playEliminatedTurn,
  spendTileOnBestMeld,
} from "@/okey/engine/okey-engine";
import { getOkeyScoreValue } from "@/okey/engine/okey-melds";
import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import type { OkeyDrawSource, OkeyGameState, OkeyTile } from "@/okey/types/okey";

import {
  getOkeyBotDifficulty,
  getOkeyBotProfile,
  isOkeyBotControlled,
  type OkeyBotDifficulty,
  type OkeyBotProfile,
} from "@/okey/engine/okey-bot-policy";

export type OkeyBotOptions = { difficulty?: OkeyBotDifficulty; random?: () => number };

export type OkeyBotDecision = {
  drawSource: OkeyDrawSource | null;
  discardTileId: string | null;
  opened: boolean;
  spentTileIds: string[];
  declaredKonkan: boolean;
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
  const before = evaluationValue(evaluateHand(player.hand, state.okeyTile));
  const afterHand = [...player.hand, discard];
  const directGain = evaluationValue(evaluateHand(afterHand, state.okeyTile, 1)) - before;
  const openingPlan = findBestMeldPlan(afterHand, state.okeyTile, 1);
  const completesOpening = !player.opened &&
    openingPlan.score >= getRequiredOpenScore(state, state.currentPlayerIndex) &&
    openingPlan.melds.some((meld) => meld.tiles.some((tile) => tile.id === discard.id));
  if (!player.opened && !player.konkan) {
    return completesOpening ? "discard" : "deck";
  }
  return directGain >= profile.minimumDiscardGain ? "discard" : "deck";
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
        return lockKonkanSet(state, playerIndex, tile.id, targetPlayer.id, meld.id);
      }
    }
  }

  return state;
}
function spendUsefulTiles(state: OkeyGameState, profile: OkeyBotProfile) {
  const playerIndex = state.currentPlayerIndex;
  const spentTileIds: string[] = [];
  let current = state;
  const seenHands = new Set<string>();
  for (let action = 0; action < profile.maximumSpendActions; action += 1) {
    const player = current.players[playerIndex];
    if (!player || player.hand.length <= 1 || current.phase !== "playing") break;
    // Bots avoid entering KonKan by stealing a joker before their normal Open.
    // Human players keep that legal option in the shared engine.
    if (!player.opened) break;
    const signature = player.hand.map((tile) => tile.id).sort().join("|");
    if (seenHands.has(signature)) break;
    seenHands.add(signature);
    let best: { state: OkeyGameState; tileId: string; value: number } | null = null;
    const baseline = evaluationValue(evaluateHand(player.hand, current.okeyTile, 1));
    for (const tile of player.hand) {
      const candidate = spendTileOnBestMeld(current, playerIndex, tile.id);
      if (candidate === current) continue;
      const nextPlayer = candidate.players[playerIndex];
      if (!nextPlayer || nextPlayer.hand.length < 1) continue;
      const handGain = evaluationValue(evaluateHand(nextPlayer.hand, current.okeyTile, 1)) - baseline;
      const value = handGain + tilePenalty(tile, current.okeyTile);
      if (!best || value > best.value || (value === best.value && tile.id < best.tileId)) best = { state: candidate, tileId: tile.id, value };
    }
    if (!best) break;
    current = best.state;
    spentTileIds.push(best.tileId);
  }
  return { state: current, spentTileIds };
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
  const candidates: { tile: OkeyTile; value: number }[] = [];
  for (const tile of player.hand) {
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

export function prepareBotTurn(state: OkeyGameState, options: OkeyBotOptions = {}): PreparedBotTurn {
  const emptyDecision: OkeyBotDecision = { drawSource: null, discardTileId: null, opened: false, spentTileIds: [], declaredKonkan: false };
  if (state.phase !== "playing") return { state, discardTileId: null, decision: emptyDecision };
  const player = state.players[state.currentPlayerIndex];
  if (!player) return { state, discardTileId: null, decision: emptyDecision };
  if (player.eliminated) return { state: playEliminatedTurn(state), discardTileId: null, decision: emptyDecision };
  if (!isOkeyBotControlled(player)) return { state, discardTileId: null, decision: emptyDecision };

  const difficulty = options.difficulty ?? getOkeyBotDifficulty(player);
  const profile = getOkeyBotProfile(difficulty);

  const drawSource = state.hasDrawnThisTurn ? null : chooseBotDrawSource(state, { ...options, difficulty });
  let current = drawSource ? drawTile(state, drawSource) : state;
  if (current.phase !== "playing" || !current.hasDrawnThisTurn) {
    return { state: current, discardTileId: null, decision: { ...emptyDecision, drawSource } };
  }
  if (canDeclareKonkanOpen(current, current.currentPlayerIndex)) {
    current = declareKonkanOpen(current, current.currentPlayerIndex);
    return { state: current, discardTileId: null, decision: { ...emptyDecision, drawSource, declaredKonkan: true } };
  }
  const beforeOpen = current.players[current.currentPlayerIndex]?.opened ?? false;
  current = tryOpen(current);
  const opened = !beforeOpen && !!current.players[current.currentPlayerIndex]?.opened;
  const spent = spendUsefulTiles(current, profile);
  current = spent.state;
  current = tryLockUsefulKonkanSet(current);
  if (canDeclareKonkanOpen(current, current.currentPlayerIndex)) {
    current = declareKonkanOpen(current, current.currentPlayerIndex);
    return { state: current, discardTileId: null, decision: { ...emptyDecision, drawSource, opened, spentTileIds: spent.spentTileIds, declaredKonkan: true } };
  }
  const discard = chooseBotDiscardTile(current, { ...options, difficulty });
  const decision = { drawSource, discardTileId: discard?.id ?? null, opened, spentTileIds: spent.spentTileIds, declaredKonkan: false };
  return { state: current, discardTileId: discard?.id ?? null, decision };
}

export function playBotTurn(state: OkeyGameState, options: OkeyBotOptions = {}): OkeyGameState {
  const prepared = prepareBotTurn(state, options);
  return prepared.discardTileId ? discardTile(prepared.state, prepared.discardTileId) : prepared.state;
}
