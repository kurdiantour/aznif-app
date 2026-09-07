import { RACK_ROW_CAPACITY, RACK_TILE_GAP } from "@/okey/components/okeyStyles";
import { getMeldKind, getOrderedMeldScore } from "@/okey/engine/okeyengine-melds";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";
export type RackRow = "top" | "bottom";
export type RackSlot = string | null;
export type RackSlots = Record<RackRow, RackSlot[]>;
export type RackRowLayout = { x: number; y: number; width: number; height: number };
export type DragOrigin = { row: RackRow; slotIndex: number };
export type InsertionTarget = {
  row: RackRow;
  slotIndex: number;
  flatIndex: number;
};
export type DraggingMeld = OkeyMeld & { tileIds: string[]; touchedTileIndex: number };
export type ExternalDropPlacement = { tileId: string; point: { x: number; y: number }; nonce: number };

export const ROW_ORDER: RackRow[] = ["bottom", "top"];
export const GROUP_LONG_PRESS_MS = 150;
// Allow normal finger jitter while the user holds a tile to activate group drag.
// The drag activation threshold still handles intentional early movement.
export const GROUP_LONG_PRESS_MOVE_TOLERANCE = 24;
export const DRAG_ACTIVATION_DISTANCE = 2;
export const ROW_SNAP_PADDING_RATIO = 0.45;
export const RACK_TILE_ENTER_MS = 620;
export const RACK_DEAL_BATCH_STAGGER_MS = 420;
export const INITIAL_BOTTOM_TILE_COUNT = RACK_ROW_CAPACITY;
export function getRowTilesFromSlots(rowSlots: RackSlot[], tileById: Map<string, OkeyTile>, stagedTileIds: Set<string>) {
  return rowSlots.map((tileId) => {
    if (!tileId || stagedTileIds.has(tileId)) return null;
    return tileById.get(tileId) ?? null;
  });
}

export function getBestMeldIncludingSlot(
  rowTiles: (OkeyTile | null)[],
  row: RackRow,
  slotIndex: number,
  okeyTile: OkeyTile,
): DraggingMeld | null {
  const touchedTile = rowTiles[slotIndex];
  if (!touchedTile) return null;

  let start = slotIndex;
  while (start > 0 && rowTiles[start - 1]) start -= 1;

  let end = slotIndex;
  while (end < rowTiles.length - 1 && rowTiles[end + 1]) end += 1;

  let best: { tiles: OkeyTile[]; score: number; from: number; to: number } | null = null;
  for (let from = start; from <= slotIndex; from += 1) {
    for (let to = slotIndex; to <= Math.min(end, from + 4); to += 1) {
      const tiles = rowTiles.slice(from, to + 1).filter((tile): tile is OkeyTile => !!tile);
      if (tiles.length !== to - from + 1 || tiles.length < 3) continue;

      const score = getOrderedMeldScore(tiles, okeyTile);
      if (score === null) continue;
      if (!best || score > best.score || (score === best.score && tiles.length > best.tiles.length)) {
        best = { tiles, score, from, to };
      }
    }
  }

  if (!best) return null;
  return {
    id: `human-drag-${row}-${best.from}-${best.to}`,
    ownerId: "human",
    kind: getMeldKind(best.tiles, okeyTile),
    tiles: best.tiles,
    score: best.score,
    tileIds: best.tiles.map((tile) => tile.id),
    touchedTileIndex: slotIndex - best.from,
  };
}
export function createEmptySlots(): RackSlots {
  return {
    top: Array.from<RackSlot>({ length: RACK_ROW_CAPACITY }).fill(null),
    bottom: Array.from<RackSlot>({ length: RACK_ROW_CAPACITY }).fill(null),
  };
}

export function cloneSlots(slots: RackSlots): RackSlots {
  return {
    top: [...slots.top],
    bottom: [...slots.bottom],
  };
}

export function getDefaultSlotForTileIndex(index: number): DragOrigin | null {
  if (index < 0 || index >= RACK_ROW_CAPACITY * 2) return null;
  if (index < INITIAL_BOTTOM_TILE_COUNT) return { row: "bottom", slotIndex: index };
  return { row: "top", slotIndex: index - INITIAL_BOTTOM_TILE_COUNT };
}

export function getFirstDefaultEmptySlot(slots: RackSlots): DragOrigin | null {
  // Match the initial rack order: fill the bottom row first, then the top.
  for (const row of ROW_ORDER) {
    for (let slotIndex = 0; slotIndex < RACK_ROW_CAPACITY; slotIndex += 1) {
      if (slots[row][slotIndex] === null) {
        return { row, slotIndex };
      }
    }
  }

  return null;
}

export function getInitialRackSlots(tiles: OkeyTile[]): RackSlots {
  const slots = createEmptySlots();

  tiles.slice(0, RACK_ROW_CAPACITY * 2).forEach((tile, index) => {
    const slot = getDefaultSlotForTileIndex(index);
    if (slot) slots[slot.row][slot.slotIndex] = tile.id;
  });

  return slots;
}

export function syncSlotsWithTiles(current: RackSlots, tiles: OkeyTile[]): RackSlots {
  const availableIds = new Set(tiles.map((tile) => tile.id));
  const knownIds = new Set<string>();
  const next = createEmptySlots();

  for (const row of ROW_ORDER) {
    current[row].forEach((tileId, slotIndex) => {
      if (!tileId || !availableIds.has(tileId) || knownIds.has(tileId)) return;
      next[row][slotIndex] = tileId;
      knownIds.add(tileId);
    });
  }

  for (const tile of tiles) {
    if (knownIds.has(tile.id)) continue;

    const emptySlot = getFirstDefaultEmptySlot(next);
    if (!emptySlot) break;

    next[emptySlot.row][emptySlot.slotIndex] = tile.id;
    knownIds.add(tile.id);
  }

  return next;
}


export type RackViewport = { x: number; y: number; width: number; height: number };

export function getDropRowForY(
  localY: number,
  rowLayouts: Record<RackRow, RackRowLayout | null>,
  rackTileHeight: number,
  rowSnapPaddingRatio: number,
): RackRow | null {
  const topLayout = rowLayouts.top;
  const bottomLayout = rowLayouts.bottom;
  if (!topLayout || !bottomLayout) return null;

  if (localY >= topLayout.y && localY <= topLayout.y + topLayout.height) return "top";
  if (localY >= bottomLayout.y && localY <= bottomLayout.y + bottomLayout.height) return "bottom";

  const snapPadding = rackTileHeight * rowSnapPaddingRatio;
  const candidates = (["top", "bottom"] as RackRow[])
    .map((row) => {
      const rowLayout = rowLayouts[row]!;
      return {
        row,
        inside:
          localY >= rowLayout.y - snapPadding &&
          localY <= rowLayout.y + rowLayout.height + snapPadding,
        distance: Math.abs(localY - (rowLayout.y + rowLayout.height / 2)),
      };
    })
    .filter((candidate) => candidate.inside)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0]?.row ?? null;
}

export function getInsertionTargetForPoint(args: {
  tileId: string;
  moveX: number;
  moveY: number;
  sourceSlots: RackSlots;
  viewport: RackViewport;
  rowLayouts: Record<RackRow, RackRowLayout | null>;
  rackTileWidth: number;
  rackTileHeight: number;
  rackTileStride: number;
  dragTouchOffsetX: number;
  rowSnapPaddingRatio: number;
}): InsertionTarget | null {
  const {
    tileId,
    moveX,
    moveY,
    sourceSlots,
    viewport,
    rowLayouts,
    rackTileWidth,
    rackTileHeight,
    rackTileStride,
    dragTouchOffsetX,
    rowSnapPaddingRatio,
  } = args;

  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const localX = moveX - viewport.x;
  const localY = moveY - viewport.y;
  const draggedTileCenterX =
    localX - dragTouchOffsetX + rackTileWidth / 2;

  const targetRow = getDropRowForY(
    localY,
    rowLayouts,
    rackTileHeight,
    rowSnapPaddingRatio,
  );
  if (!targetRow) return null;

  const firstSlotCenterX = rackTileWidth / 2;
  const lastSlotCenterX =
    firstSlotCenterX + (RACK_ROW_CAPACITY - 1) * rackTileStride;

  if (
    draggedTileCenterX < firstSlotCenterX - rackTileWidth / 2 ||
    draggedTileCenterX > lastSlotCenterX + rackTileWidth / 2
  ) {
    return null;
  }

  const rawSlotIndex = Math.round(
    (draggedTileCenterX - firstSlotCenterX) / rackTileStride,
  );
  const slotIndex = Math.max(
    0,
    Math.min(RACK_ROW_CAPACITY - 1, rawSlotIndex),
  );


  if (!getTileOrigin(sourceSlots, tileId)) return null;

  return {
    row: targetRow,
    slotIndex,
    flatIndex: getFlatIndexForSlot(sourceSlots, targetRow, slotIndex),
  };
}

export function getGroupInsertionTargetForPoint(args: {
  tileIds: string[];
  moveX: number;
  moveY: number;
  sourceSlots: RackSlots;
  viewport: RackViewport;
  rowLayouts: Record<RackRow, RackRowLayout | null>;
  rackTileWidth: number;
  rackTileHeight: number;
  rackTileStride: number;
  touchedTileIndex: number;
  rowSnapPaddingRatio: number;
}): InsertionTarget | null {
  const {
    tileIds,
    moveX,
    moveY,
    sourceSlots,
    viewport,
    rowLayouts,
    rackTileWidth,
    rackTileHeight,
    rackTileStride,
    touchedTileIndex,
    rowSnapPaddingRatio,
  } = args;

  if (viewport.width <= 0 || viewport.height <= 0 || tileIds.length === 0) {
    return null;
  }

  const localX = moveX - viewport.x;
  const localY = moveY - viewport.y;
  const targetRow = getDropRowForY(
    localY,
    rowLayouts,
    rackTileHeight,
    rowSnapPaddingRatio,
  );
  if (!targetRow) return null;

  const groupWidth = tileIds.length * rackTileStride - RACK_TILE_GAP;
  const rowEndX =
    (RACK_ROW_CAPACITY - 1) * rackTileStride + rackTileWidth;

  if (localX < -groupWidth / 2 || localX > rowEndX + groupWidth / 2) {
    return null;
  }

  const insertionX = localX - touchedTileIndex * rackTileStride;
  const rawSlotIndex = Math.floor(
    (insertionX + rackTileWidth / 2) / rackTileStride,
  );

  const slotIndex = Math.max(
    0,
    Math.min(RACK_ROW_CAPACITY - tileIds.length, rawSlotIndex),
  );


  if (tileIds.some((tileId) => !getTileOrigin(sourceSlots, tileId))) return null;

  return {
    row: targetRow,
    slotIndex,
    flatIndex: getFlatIndexForSlot(sourceSlots, targetRow, slotIndex),
  };
}

export function getExternalDropTargetForPoint(args: {
  tileId: string;
  point: { x: number; y: number };
  committedSlots: RackSlots;
  viewport: RackViewport;
  rowLayouts: Record<RackRow, RackRowLayout | null>;
  rackTileWidth: number;
  rackTileHeight: number;
  rackTileStride: number;
  rowSnapPaddingRatio: number;
}): InsertionTarget | null {
  const {
    point,
    committedSlots,
    viewport,
    rowLayouts,
    rackTileWidth,
    rackTileHeight,
    rackTileStride,
    rowSnapPaddingRatio,
  } = args;

  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const localX = point.x - viewport.x;
  const localY = point.y - viewport.y;
  const snappedRow = getDropRowForY(
    localY,
    rowLayouts,
    rackTileHeight,
    rowSnapPaddingRatio,
  );
  const measuredRows = ROW_ORDER.filter((row) => rowLayouts[row] !== null);
  const targetRow =
    snappedRow ??
    measuredRows.sort((left, right) => {
      const leftLayout = rowLayouts[left]!;
      const rightLayout = rowLayouts[right]!;
      return (
        Math.abs(localY - (leftLayout.y + leftLayout.height / 2)) -
        Math.abs(localY - (rightLayout.y + rightLayout.height / 2))
      );
    })[0];
  if (!targetRow) return null;

  const slotIndex = Math.max(
    0,
    Math.min(
      RACK_ROW_CAPACITY - 1,
      Math.floor((localX + rackTileWidth / 2) / rackTileStride),
    ),
  );

  return {
    row: targetRow,
    slotIndex,
    flatIndex: getFlatIndexForSlot(committedSlots, targetRow, slotIndex),
  };
}

export function getTileOrigin(slots: RackSlots, tileId: string): DragOrigin | null {
  for (const row of ROW_ORDER) {
    const slotIndex = slots[row].findIndex((entry) => entry === tileId);
    if (slotIndex >= 0) return { row, slotIndex };
  }
  return null;
}

export function getFlatIndexForSlot(slots: RackSlots, row: RackRow, slotIndex: number) {
  let flatIndex = 0;
  for (const currentRow of ROW_ORDER) {
    for (let index = 0; index < RACK_ROW_CAPACITY; index += 1) {
      if (currentRow === row && index === slotIndex) return flatIndex;
      if (slots[currentRow][index]) flatIndex += 1;
    }
  }
  return flatIndex;
}

export function openRackGap(rowSlots: RackSlot[], slotIndex: number) {
  if (rowSlots[slotIndex] === null) return true;

  let right = slotIndex + 1;
  while (right < RACK_ROW_CAPACITY && rowSlots[right] !== null) right += 1;
  let left = slotIndex - 1;
  while (left >= 0 && rowSlots[left] !== null) left -= 1;

  if (right < RACK_ROW_CAPACITY && (left < 0 || right - slotIndex <= slotIndex - left)) {
    for (let index = right; index > slotIndex; index -= 1) rowSlots[index] = rowSlots[index - 1];
    return true;
  }

  if (left >= 0) {
    for (let index = left; index < slotIndex; index += 1) rowSlots[index] = rowSlots[index + 1];
    return true;
  }

  return false;
}

export function moveTileIntoSlot(
  slots: RackSlots,
  tileId: string,
  targetRow: RackRow,
  slotIndex: number,
): { slots: RackSlots; row: RackRow; slotIndex: number } | null {
  if (slotIndex < 0 || slotIndex >= RACK_ROW_CAPACITY) return null;

  const nextSlots = cloneSlots(slots);
  const origin = getTileOrigin(nextSlots, tileId);

  if (origin?.row === targetRow) {
    const rowSlots = nextSlots[targetRow];
    const fromIndex = origin.slotIndex;

    if (fromIndex === slotIndex) {
      return { slots: nextSlots, row: targetRow, slotIndex };
    }

    rowSlots[fromIndex] = null;

    if (rowSlots[slotIndex] === null) {
      rowSlots[slotIndex] = tileId;
      return { slots: nextSlots, row: targetRow, slotIndex };
    }

    if (fromIndex < slotIndex) {
      for (let index = fromIndex; index < slotIndex; index += 1) {
        rowSlots[index] = rowSlots[index + 1];
      }
    } else {
      for (let index = fromIndex; index > slotIndex; index -= 1) {
        rowSlots[index] = rowSlots[index - 1];
      }
    }

    rowSlots[slotIndex] = tileId;
    return { slots: nextSlots, row: targetRow, slotIndex };
  }

  if (origin) {
    nextSlots[origin.row][origin.slotIndex] = null;
  }

  const rowSlots = nextSlots[targetRow];
  if (!openRackGap(rowSlots, slotIndex)) return null;

  rowSlots[slotIndex] = tileId;
  return { slots: nextSlots, row: targetRow, slotIndex };
}

export function moveTilesIntoSlot(slots: RackSlots, tileIds: string[], targetRow: RackRow, slotIndex: number): { slots: RackSlots; row: RackRow; slotIndex: number } | null {
  if (tileIds.length === 0 || tileIds.length > RACK_ROW_CAPACITY) return null;
  if (slotIndex < 0 || slotIndex + tileIds.length > RACK_ROW_CAPACITY) return null;

  const tileIdSet = new Set(tileIds);
  const nextSlots = cloneSlots(slots);

  for (const row of ROW_ORDER) {
    for (let index = 0; index < RACK_ROW_CAPACITY; index += 1) {
      const tileId = nextSlots[row][index];
      if (tileId && tileIdSet.has(tileId)) {
        nextSlots[row][index] = null;
      }
    }
  }

  const rowSlots = nextSlots[targetRow];
  const targetIndexes = Array.from({ length: tileIds.length }, (_, index) => slotIndex + index);
  const targetHasRoom = targetIndexes.every((index) => rowSlots[index] === null);
  if (!targetHasRoom) {
    for (let index = tileIds.length - 1; index >= 0; index -= 1) {
      if (!openRackGap(rowSlots, slotIndex)) return null;
    }
  }

  tileIds.forEach((tileId, index) => {
    rowSlots[slotIndex + index] = tileId;
  });

  return { slots: nextSlots, row: targetRow, slotIndex };
}


export function getSlotEnterDelay(row: RackRow, slotIndex: number, isDealer: boolean) {
  const visualIndex = row === "bottom" ? slotIndex : INITIAL_BOTTOM_TILE_COUNT + slotIndex;
  const batchIndex = isDealer
    ? Math.floor(visualIndex / 3)
    : visualIndex < 2
      ? 0
      : 1 + Math.floor((visualIndex - 2) / 3);
  return batchIndex * RACK_DEAL_BATCH_STAGGER_MS;
}