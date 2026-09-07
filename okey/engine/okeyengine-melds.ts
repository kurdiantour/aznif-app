import type { OkeyColor, OkeyGameState, OkeyMeld, OkeyTeamId, OkeyTile } from "../types/okey.ts";
import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import { isOkeyWildcard } from "./okeyengine-core.ts";
export { isOkeyWildcard } from "./okeyengine-core.ts";
const COLORS: OkeyColor[] = [...OKEY_RULESET_V1.tiles.colors];
const WINNING_HAND_SIZE = OKEY_RULESET_V1.hand.basicWinningSize;
const INITIAL_OPEN_SCORE = OKEY_RULESET_V1.opening.initialMinimumScore;
const TEAMMATE_OPEN_SCORE = OKEY_RULESET_V1.opening.teammateMinimumScore;
export const MAX_PLAYER_MELDS = OKEY_RULESET_V1.meld.maximumPlayerMelds;

export type OkeyMeldCandidate = { mask: number; meld: OkeyMeld };
type OkeyMeldPlan = { score: number; melds: OkeyMeld[]; usedTileCount: number; signature: string };

function countMaskBits(mask: number) {
  let count = 0;
  let remainingMask = mask;
  while (remainingMask > 0) { count += remainingMask & 1; remainingMask >>>= 1; }
  return count;
}
function getPlanSignature(melds: OkeyMeld[]) {
  return melds.map((meld) => `${meld.tiles.length}:${meld.tiles.map((tile) => tile.id).join(",")}`).join("|");
}
function isBetterPlan(candidate: OkeyMeldPlan, current: OkeyMeldPlan) {
  if (candidate.score !== current.score) return candidate.score > current.score;
  if (candidate.usedTileCount !== current.usedTileCount) return candidate.usedTileCount > current.usedTileCount;
  return candidate.signature < current.signature;
}
export function selectBestMeldPlan(candidates: OkeyMeldCandidate[], totalTileCount: number, minRemainingTiles = 0) {
  const orderedCandidates = [...candidates].sort((left, right) => {
    const sizeDelta = left.meld.tiles.length - right.meld.tiles.length;
    return sizeDelta !== 0 ? sizeDelta : getPlanSignature([left.meld]).localeCompare(getPlanSignature([right.meld]));
  });
  const memo = new Map<number, OkeyMeldPlan>();
  const solve = (usedMask: number): OkeyMeldPlan => {
    const cached = memo.get(usedMask);
    if (cached) return cached;
    const usedTileCount = countMaskBits(usedMask);
    if (totalTileCount - usedTileCount < minRemainingTiles) return { score: Number.NEGATIVE_INFINITY, melds: [], usedTileCount, signature: "" };
    let best: OkeyMeldPlan = { score: 0, melds: [], usedTileCount, signature: "" };
    for (const candidate of orderedCandidates) {
      if ((usedMask & candidate.mask) !== 0) continue;
      const next = solve(usedMask | candidate.mask);
      if (next.score === Number.NEGATIVE_INFINITY) continue;
      const melds = [candidate.meld, ...next.melds];
      const plan = { score: candidate.meld.score + next.score, melds, usedTileCount: next.usedTileCount, signature: getPlanSignature(melds) };
      if (isBetterPlan(plan, best)) best = plan;
    }
    memo.set(usedMask, best);
    return best;
  };
  const best = solve(0);
  return best.score === Number.NEGATIVE_INFINITY ? { score: 0, melds: [] as OkeyMeld[], usedTileCount: 0 } : { score: best.score, melds: best.melds, usedTileCount: best.usedTileCount };
}


export function hasForbiddenThreeTileDoubleJoker(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  return OKEY_RULESET_V1.meld.forbidTwoWildcardsInThreeTileMeld
    && tiles.length === OKEY_RULESET_V1.meld.minimumSize
    && tiles.filter((tile) => isOkeyWildcard(tile, okeyTile)).length >= 2;
}

export function getOkeyScoreValue(value: number) {
  return value === OKEY_RULESET_V1.tiles.minimumValue
    || value >= OKEY_RULESET_V1.scoring.cappedTileMinimumValue
    ? OKEY_RULESET_V1.scoring.cappedTileScore
    : value;
}

function scoreSet(tiles: OkeyTile[], okeyTile: OkeyTile): number | null {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumSetSize) return null;
  if (hasForbiddenThreeTileDoubleJoker(tiles, okeyTile)) return null;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  const wildcardCount = tiles.length - regularTiles.length;
  if (!regularTiles.length) return null;

  const value = regularTiles[0].value;
  if (!regularTiles.every((tile) => tile.value === value)) return null;

  const colors = new Set(regularTiles.map((tile) => tile.color));
  if (colors.size !== regularTiles.length) return null;
  if (regularTiles.length + wildcardCount > OKEY_RULESET_V1.meld.maximumSetSize) return null;

  return tiles.length * getOkeyScoreValue(value);
}

function runSequences(length: number) {
  const ascendingSequences: number[][] = [];
  for (
    let start = OKEY_RULESET_V1.tiles.minimumValue;
    start <= OKEY_RULESET_V1.tiles.maximumValue + 1 - length;
    start += 1
  ) {
    ascendingSequences.push(Array.from({ length }, (_, index) => start + index));
  }

  if (length >= OKEY_RULESET_V1.meld.minimumSize) {
    ascendingSequences.push(Array.from(
      { length },
      (_, index) => OKEY_RULESET_V1.tiles.maximumValue + 1 - length + 1 + index,
    ));
  }

  return [
    ...ascendingSequences,
    ...ascendingSequences.map((sequence) => [...sequence].reverse()),
  ];
}

function tileMatchesSequenceValue(tileValue: number, sequenceValue: number) {
  return tileValue === sequenceValue || (
    tileValue === OKEY_RULESET_V1.tiles.minimumValue
    && sequenceValue === OKEY_RULESET_V1.tiles.maximumValue + 1
  );
}

function sequenceScoreValue(sequenceValue: number) {
  return sequenceValue === OKEY_RULESET_V1.tiles.maximumValue + 1
    ? OKEY_RULESET_V1.scoring.cappedTileScore
    : getOkeyScoreValue(sequenceValue);
}

function scoreRun(tiles: OkeyTile[], okeyTile: OkeyTile): number | null {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumRunSize) return null;
  if (hasForbiddenThreeTileDoubleJoker(tiles, okeyTile)) return null;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  const wildcardCount = tiles.length - regularTiles.length;
  if (!regularTiles.length) return null;

  const color = regularTiles[0].color;
  if (!regularTiles.every((tile) => tile.color === color)) return null;

  const values = regularTiles.map((tile) => tile.value);
  if (new Set(values).size !== values.length) return null;

  for (const sequence of runSequences(tiles.length)) {
    if (!values.every((value) => sequence.some((sequenceValue) => tileMatchesSequenceValue(value, sequenceValue)))) continue;
    const missingCount = sequence.filter((sequenceValue) => !values.some((value) => tileMatchesSequenceValue(value, sequenceValue))).length;
    if (missingCount === wildcardCount) {
      return sequence.reduce((total, value) => total + sequenceScoreValue(value), 0);
    }
  }

  return null;
}

function scoreOrderedRun(tiles: OkeyTile[], okeyTile: OkeyTile): number | null {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumRunSize) return null;
  if (hasForbiddenThreeTileDoubleJoker(tiles, okeyTile)) return null;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  if (!regularTiles.length) return null;

  const color = regularTiles[0].color;
  if (!regularTiles.every((tile) => tile.color === color)) return null;

  for (const sequence of runSequences(tiles.length)) {
    let matches = true;
    const usedRegularValues = new Set<number>();

    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      const sequenceValue = sequence[index];
      if (isOkeyWildcard(tile, okeyTile)) continue;

      const effective = getEffectiveTile(tile, okeyTile);
      if (usedRegularValues.has(effective.value) || !tileMatchesSequenceValue(effective.value, sequenceValue)) {
        matches = false;
        break;
      }
      usedRegularValues.add(effective.value);
    }

    if (matches) return sequence.reduce((total, value) => total + sequenceScoreValue(value), 0);
  }

  return null;
}

export function getOrderedRunWildcardValue(
  tiles: OkeyTile[],
  wildcardIndex: number,
  okeyTile: OkeyTile,
): number | null {
  if (!isOkeyWildcard(tiles[wildcardIndex], okeyTile)) return null;
  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  if (!regularTiles.length || !regularTiles.every((tile) => tile.color === regularTiles[0].color)) return null;

  for (const sequence of runSequences(tiles.length)) {
    const usedRegularValues = new Set<number>();
    const matches = tiles.every((tile, index) => {
      if (isOkeyWildcard(tile, okeyTile)) return true;
      const effective = getEffectiveTile(tile, okeyTile);
      if (usedRegularValues.has(effective.value) || !tileMatchesSequenceValue(effective.value, sequence[index])) return false;
      usedRegularValues.add(effective.value);
      return true;
    });
    if (matches) {
      return sequence[wildcardIndex] === OKEY_RULESET_V1.tiles.maximumValue + 1
        ? OKEY_RULESET_V1.tiles.minimumValue
        : sequence[wildcardIndex];
    }
  }
  return null;
}

export function getOrderedMeldScore(tiles: OkeyTile[], okeyTile: OkeyTile): number | null {
  return scoreSet(tiles, okeyTile) ?? scoreOrderedRun(tiles, okeyTile);
}
export function getMeldScore(tiles: OkeyTile[], okeyTile: OkeyTile): number | null {
  return scoreSet(tiles, okeyTile) ?? scoreRun(tiles, okeyTile);
}

export function isValidScoringMeld(meld: OkeyMeld, okeyTile: OkeyTile) {
  return getMeldScore(meld.tiles, okeyTile) !== null;
}

export function getOkeyPlayerSetScore(melds: OkeyMeld[], okeyTile: OkeyTile) {
  return melds.reduce((total, meld) => {
    const score = getMeldScore(meld.tiles, okeyTile);
    return score === null ? total : total + score;
  }, 0);
}

export function getBestRackSetScore(rows: OkeyTile[][], okeyTile: OkeyTile) {
  return rows.reduce((total, rowTiles) => {
    let rowTotal = 0;
    let index = 0;

    while (index < rowTiles.length) {
      let bestScore = 0;
      let bestEndIndex = index;

      for (let endIndex = index + 3; endIndex <= rowTiles.length; endIndex += 1) {
        const score = getMeldScore(rowTiles.slice(index, endIndex), okeyTile);
        if (score !== null && score > bestScore) {
          bestScore = score;
          bestEndIndex = endIndex;
        }
      }

      if (bestScore > 0) {
        rowTotal += bestScore;
        index = bestEndIndex;
      } else {
        index += 1;
      }
    }

    return total + rowTotal;
  }, 0);
}

export function getEffectiveTile(tile: OkeyTile, okeyTile: OkeyTile): OkeyTile {
  if (!tile.isFakeJoker) return tile;
  return { ...tile, color: okeyTile.color, value: okeyTile.value };
}

export function sortTiles(tiles: OkeyTile[], okeyTile?: OkeyTile): OkeyTile[] {
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
export function normalizeOpenMelds(melds: OkeyMeld[], okeyTile: OkeyTile): { melds: OkeyMeld[]; score: number } | null {
  const normalized: OkeyMeld[] = [];
  for (const source of melds) {
    if (source.kind !== "run" && source.kind !== "set") return null;
    // Short runs (≤5 tiles): keep player-submitted order — validated via scoreOrderedRun
    // which rejects mis-ordered sequences (e.g. 5-3-4 is invalid, 3-4-5 is valid).
    // Long runs (>5 tiles): auto-sort first, then split into legal 3-5 tile sub-melds below.
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

export function getRemainingPlayerMeldSlots(
  state: OkeyGameState,
  playerIndex: number,
): number {
  return Math.max(0, MAX_PLAYER_MELDS - (state.players[playerIndex]?.melds.length ?? MAX_PLAYER_MELDS));
}

export function validateOpenPlayerMelds(
  state: OkeyGameState,
  playerIndex: number,
  melds: OkeyMeld[],
): { melds: OkeyMeld[]; score: number; openedTileIds: Set<string> } | null {
  if (
    state.phase !== "playing" ||
    state.currentPlayerIndex !== playerIndex ||
    !state.hasDrawnThisTurn
  ) return null;
  const player = state.players[playerIndex];
  if (!player || player.eliminated || melds.length === 0) return null;

  const normalized = normalizeOpenMelds(melds, state.okeyTile);
  if (!normalized || normalized.melds.length === 0) return null;
  if (normalized.melds.length > getRemainingPlayerMeldSlots(state, playerIndex)) return null;

  const handTileIds = new Set(player.hand.map((tile) => tile.id));
  const openedTileIdList = normalized.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id));
  const openedTileIds = new Set(openedTileIdList);
  if (openedTileIds.size !== openedTileIdList.length || openedTileIdList.some((id) => !handTileIds.has(id))) return null;

  const requiredOpenScore = player.opened ? 0 : getRequiredOpenScore(state, playerIndex);
  return normalized.score >= requiredOpenScore
    ? { ...normalized, openedTileIds }
    : null;
}

export function getCombinations<T>(items: T[], size: number): T[][] {
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

export function isValidMeld(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
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

export function canDeclareBasicWin(hand: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (hand.length !== WINNING_HAND_SIZE) return false;
  return canPartitionIntoMelds(sortTiles(hand, okeyTile), okeyTile);
}

export function getMeldKind(tiles: OkeyTile[], okeyTile: OkeyTile): OkeyMeld["kind"] {
  const regularTiles = tiles.filter((tile) => !isOkeyWildcard(tile, okeyTile));
  if (regularTiles.length > 1 && regularTiles.every((tile) => tile.value === regularTiles[0].value)) {
    return "set";
  }
  return "run";
}

export function orderRunTiles(tiles: OkeyTile[], okeyTile: OkeyTile): OkeyTile[] | null {
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

