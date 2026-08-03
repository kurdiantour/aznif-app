import type { OkeyMeld, OkeyTile } from "../types/okey.ts";
import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
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


function isOkeyWildcard(tile: OkeyTile, okeyTile: OkeyTile): boolean {
  if (tile.isFakeJoker) return false;
  return tile.color === okeyTile.color && tile.value === okeyTile.value;
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

function effectiveTile(tile: OkeyTile, okeyTile: OkeyTile): OkeyTile {
  if (!tile.isFakeJoker) return tile;
  return { ...tile, color: okeyTile.color, value: okeyTile.value };
}

function scoreSet(tiles: OkeyTile[], okeyTile: OkeyTile): number | null {
  if (tiles.length < OKEY_RULESET_V1.meld.minimumSize || tiles.length > OKEY_RULESET_V1.meld.maximumSetSize) return null;
  if (hasForbiddenThreeTileDoubleJoker(tiles, okeyTile)) return null;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => effectiveTile(tile, okeyTile));
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
    .map((tile) => effectiveTile(tile, okeyTile));
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
    .map((tile) => effectiveTile(tile, okeyTile));
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

      const effective = effectiveTile(tile, okeyTile);
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




