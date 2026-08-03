import type { OkeyMeld, OkeyTile } from "../types/okey.ts";
import { getOrderedMeldScore, selectBestMeldPlan } from "./okey-melds.ts";

type RackOpenLayout = {
  melds: OkeyMeld[];
  score: number;
};

function isWildcard(tile: OkeyTile, okeyTile: OkeyTile) {
  return !tile.isFakeJoker &&
    tile.color === okeyTile.color &&
    tile.value === okeyTile.value;
}

function getMeldKind(tiles: OkeyTile[], okeyTile: OkeyTile): OkeyMeld["kind"] {
  const regularTiles = tiles.filter((tile) => !isWildcard(tile, okeyTile));
  return regularTiles.length > 1 &&
    regularTiles.every((tile) => tile.value === regularTiles[0].value)
    ? "set"
    : "run";
}

function partitionCompleteGroup(
  tiles: OkeyTile[],
  okeyTile: OkeyTile,
  groupIndex: number,
): RackOpenLayout | null {
  const memo = new Map<number, RackOpenLayout | null>();

  const solve = (startIndex: number): RackOpenLayout | null => {
    if (startIndex === tiles.length) return { melds: [], score: 0 };
    if (memo.has(startIndex)) return memo.get(startIndex) ?? null;

    for (
      let endIndex = Math.min(tiles.length, startIndex + 5);
      endIndex >= startIndex + 3;
      endIndex -= 1
    ) {
      const meldTiles = tiles.slice(startIndex, endIndex);
      const meldScore = getOrderedMeldScore(meldTiles, okeyTile);
      if (meldScore === null) continue;

      const remainder = solve(endIndex);
      if (!remainder) continue;

      const meld: OkeyMeld = {
        id: `human-pending-${groupIndex}-${startIndex}-${endIndex}`,
        ownerId: "human",
        kind: getMeldKind(meldTiles, okeyTile),
        tiles: meldTiles,
        score: meldScore,
      };
      const result = {
        melds: [meld, ...remainder.melds],
        score: meldScore + remainder.score,
      };
      memo.set(startIndex, result);
      return result;
    }

    memo.set(startIndex, null);
    return null;
  };

  return solve(0);
}

function getRackMeldPlan(contiguousGroups: OkeyTile[][], okeyTile: OkeyTile): RackOpenLayout {
  const groupOffsets = contiguousGroups.reduce<number[]>((offsets, group, groupIndex) => {
    offsets[groupIndex] = groupIndex === 0 ? 0 : offsets[groupIndex - 1] + contiguousGroups[groupIndex - 1].length;
    return offsets;
  }, []);
  const totalTileCount = contiguousGroups.reduce((total, group) => total + group.length, 0);
  const candidates: { mask: number; meld: OkeyMeld }[] = [];

  contiguousGroups.forEach((group, groupIndex) => {
    for (let startIndex = 0; startIndex < group.length; startIndex += 1) {
      for (let endIndex = startIndex + 3; endIndex <= Math.min(group.length, startIndex + 5); endIndex += 1) {
        const meldTiles = group.slice(startIndex, endIndex);
        const meldScore = getOrderedMeldScore(meldTiles, okeyTile);
        if (meldScore === null) continue;
        let mask = 0;
        for (let index = startIndex; index < endIndex; index += 1) {
          mask |= 1 << (groupOffsets[groupIndex] + index);
        }
        candidates.push({
          mask,
          meld: {
            id: `human-pending-${groupIndex}-${startIndex}-${endIndex}`,
            ownerId: "human",
            kind: getMeldKind(meldTiles, okeyTile),
            tiles: meldTiles,
            score: meldScore,
          },
        });
      }
    }
  });

  const plan = selectBestMeldPlan(candidates, totalTileCount);
  return { melds: plan.melds, score: plan.score };
}

export function getOpenableRackLayout(
  contiguousGroups: OkeyTile[][],
  okeyTile: OkeyTile,
): RackOpenLayout {
  return getRackMeldPlan(contiguousGroups, okeyTile);
}

export function getRackDisplayScore(
  contiguousGroups: OkeyTile[][],
  okeyTile: OkeyTile,
): number {
  return getRackMeldPlan(contiguousGroups, okeyTile).score;
}
