import type { OkeyMeld, OkeyTile } from "../types/okey.ts";
import { getMeldKind, getOrderedMeldScore, selectBestMeldPlan } from "./okeyengine-melds.ts";
import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import { isOrderedOfficialKonkanRun } from "./okeyengine-konkan.ts";

type RackOpenLayout = {
  melds: OkeyMeld[];
  score: number;
};

function getRackMeldPlan(contiguousGroups: OkeyTile[][], okeyTile: OkeyTile): RackOpenLayout {
  const groupOffsets = contiguousGroups.reduce<number[]>((offsets, _group, groupIndex) => {
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

export function getOrderedKonkanRunCandidates(contiguousGroups: OkeyTile[][]): string[][] {
  const size = OKEY_RULESET_V1.konkan.officialRunSize;
  return contiguousGroups.flatMap((group) =>
    Array.from({ length: Math.max(0, group.length - size + 1) }, (_, start) =>
      group.slice(start, start + size).map((tile) => tile.id),
    ),
  );
}

export type KonkanRackLayoutCandidate = {
  orderedRunTileIds: string[];
  completionMeldTileIds: string[];
  discardTileId: string;
};

export function findKonkanRackLayoutCandidates(
  contiguousGroups: OkeyTile[][],
  okeyTile: OkeyTile,
  hasLockedSet: boolean,
): KonkanRackLayoutCandidate[] {
  const allTiles = contiguousGroups.flat();
  if (allTiles.length < OKEY_RULESET_V1.konkan.officialRunSize + OKEY_RULESET_V1.konkan.completionMeldMinimumSize + 1) {
    return [];
  }

  const allowedMeldSizes = hasLockedSet
    ? [OKEY_RULESET_V1.konkan.completionMeldMinimumSize, OKEY_RULESET_V1.konkan.completionMeldMaximumSize]
    : [OKEY_RULESET_V1.konkan.completionMeldMaximumSize];

  const runSize = OKEY_RULESET_V1.konkan.officialRunSize;
  const candidates: KonkanRackLayoutCandidate[] = [];
  const seen = new Set<string>();

  for (let runGroupIndex = 0; runGroupIndex < contiguousGroups.length; runGroupIndex += 1) {
    const runGroup = contiguousGroups[runGroupIndex];
    if (runGroup.length < runSize) continue;

    for (let rStart = 0; rStart <= runGroup.length - runSize; rStart += 1) {
      const rEnd = rStart + runSize;
      const runTiles = runGroup.slice(rStart, rEnd);
      if (!isOrderedOfficialKonkanRun(runTiles, okeyTile)) continue;

      const runTileIds = runTiles.map((t) => t.id);
      const runIdSet = new Set(runTileIds);

      for (let meldGroupIndex = 0; meldGroupIndex < contiguousGroups.length; meldGroupIndex += 1) {
        const meldGroup = contiguousGroups[meldGroupIndex];

        for (const mSize of allowedMeldSizes) {
          if (meldGroup.length < mSize) continue;

          for (let mStart = 0; mStart <= meldGroup.length - mSize; mStart += 1) {
            const mEnd = mStart + mSize;

            if (meldGroupIndex === runGroupIndex) {
              if (mStart < rEnd && mEnd > rStart) {
                continue;
              }
            }

            const meldTiles = meldGroup.slice(mStart, mEnd);
            if (getOrderedMeldScore(meldTiles, okeyTile) === null) {
              continue;
            }

            const meldTileIds = meldTiles.map((t) => t.id);
            const meldIdSet = new Set(meldTileIds);

            const remainingTiles = allTiles.filter(
              (t) => !runIdSet.has(t.id) && !meldIdSet.has(t.id),
            );

            if (remainingTiles.length === 1) {
              const discardTileId = remainingTiles[0].id;
              const key = `${runTileIds.join(",")}|${meldTileIds.join(",")}|${discardTileId}`;
              if (!seen.has(key)) {
                seen.add(key);
                candidates.push({
                  orderedRunTileIds: runTileIds,
                  completionMeldTileIds: meldTileIds,
                  discardTileId,
                });
              }
            }
          }
        }
      }
    }
  }

  return candidates;
}
