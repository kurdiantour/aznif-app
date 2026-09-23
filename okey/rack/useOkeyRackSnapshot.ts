import { useEffect, useRef } from "react";

import { getOpenableRackLayout } from "@/okey/engine/okey-rack-layout";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";
import { ROW_ORDER, type RackSlots } from "./rack-layout";

export type OkeyRackSnapshot = {
  melds: OkeyMeld[];
  score: number;
  contiguousGroups: OkeyTile[][];
};

// Explicit field order makes equivalent server objects compare equally.
const tileKey = (tile: OkeyTile) => [
  tile.id, tile.color, tile.value, tile.copy, tile.isFakeJoker ?? false,
  tile.jokerOrigin ?? null, tile.spentByPlayerId ?? null,
];

/** Publishes analysis of committed local groups, never transient drag positions. */
export function useOkeyRackSnapshot(
  slots: RackSlots,
  tileById: Map<string, OkeyTile>,
  stagedTileIds: Set<string>,
  okeyTile: OkeyTile,
  publish?: (snapshot: OkeyRackSnapshot) => void,
) {
  const previousInput = useRef<string | null>(null);
  const previousOutput = useRef<string | null>(null);

  useEffect(() => {
    if (!publish) return;
    const contiguousGroups = ROW_ORDER.flatMap((row) => {
      const groups: OkeyTile[][] = [];
      let group: OkeyTile[] = [];
      for (const id of slots[row]) {
        const tile = id && !stagedTileIds.has(id) ? tileById.get(id) : undefined;
        if (tile) group.push(tile);
        else if (group.length) { groups.push(group); group = []; }
      }
      if (group.length) groups.push(group);
      return groups;
    });
    const groupsKey = contiguousGroups.map((group) => group.map(tileKey));
    const inputKey = JSON.stringify([groupsKey, tileKey(okeyTile)]);
    if (previousInput.current === inputKey) return;

    const plan = getOpenableRackLayout(contiguousGroups, okeyTile);
    const outputKey = JSON.stringify([
      groupsKey, plan.score,
      plan.melds.map((meld) => [meld.id, meld.ownerId, meld.kind, meld.score, meld.tiles.map(tileKey)]),
    ]);
    previousInput.current = inputKey;
    if (previousOutput.current === outputKey) return;
    previousOutput.current = outputKey;
    publish({ ...plan, contiguousGroups });
  }, [slots, tileById, stagedTileIds, okeyTile, publish]);
}
