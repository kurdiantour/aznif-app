import { DominoTileDirection } from "@/components/game/DominoTile";
import { GameState, KozelBranch } from "@/types/game";

export const BOARD_EDGE_PADDING = 12;
export const TILE_GAP = 1;
const BOARD_SAFE_HORIZONTAL_PADDING = 28;
const BOARD_SAFE_VERTICAL_PADDING = 22;
const BOARD_ZOOM_LEVELS = [1, 0.92, 0.84, 0.76, 0.68] as const;

export type BoardTile =
  GameState["board"]["branches"][KozelBranch]["tiles"][number];
export type BoardTileBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function isHorizontalDirection(direction: DominoTileDirection) {
  return direction === "left" || direction === "right";
}

export function getTileSlotSize(
  tile: BoardTile,
  direction: DominoTileDirection,
  tileWidth: number,
  tileHeight: number,
) {
  const isDouble = tile.left === tile.right;
  const isHorizontal = isHorizontalDirection(direction);

  if (isHorizontal) {
    return {
      slotWidth: isDouble ? tileWidth : tileHeight,
      slotHeight: isDouble ? tileHeight : tileWidth,
    };
  }

  return {
    slotWidth: isDouble ? tileHeight : tileWidth,
    slotHeight: isDouble ? tileWidth : tileHeight,
  };
}

export function getPathFootprint(
  tile: BoardTile,
  direction: DominoTileDirection,
  tileWidth: number,
  tileHeight: number,
) {
  const size = getTileSlotSize(tile, direction, tileWidth, tileHeight);
  return isHorizontalDirection(direction) ? size.slotWidth : size.slotHeight;
}

export function estimateHorizontalWidth(
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
) {
  return tiles.reduce(
    (sum, tile) =>
      sum + getPathFootprint(tile, "right", tileWidth, tileHeight) + TILE_GAP,
    0,
  );
}

export function estimateVerticalHeight(
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
) {
  return tiles.reduce(
    (sum, tile) =>
      sum + getPathFootprint(tile, "down", tileWidth, tileHeight) + TILE_GAP,
    0,
  );
}

export function getSnapValue(value: number) {
  return Math.round(value);
}

export function getStraightSegmentCount(
  tiles: BoardTile[],
  availableSpace: number,
  tileWidth: number,
  tileHeight: number,
  direction: DominoTileDirection,
) {
  if (!tiles.length) return 0;
  if (availableSpace <= 0) return 1;

  let used = 0;
  let count = 0;

  for (const tile of tiles) {
    const footprint = getPathFootprint(tile, direction, tileWidth, tileHeight);

    if (count > 0 && used + footprint > availableSpace) break;
    if (count === 0 && footprint > availableSpace) return 1;

    used += footprint + TILE_GAP;
    count += 1;
  }

  return Math.max(1, count);
}

function includeTileBounds(
  bounds: BoardTileBounds | null,
  x: number,
  y: number,
  slotWidth: number,
  slotHeight: number,
): BoardTileBounds {
  const next = {
    minX: x - slotWidth / 2,
    maxX: x + slotWidth / 2,
    minY: y - slotHeight / 2,
    maxY: y + slotHeight / 2,
  };
  if (!bounds) return next;
  return {
    minX: Math.min(bounds.minX, next.minX),
    maxX: Math.max(bounds.maxX, next.maxX),
    minY: Math.min(bounds.minY, next.minY),
    maxY: Math.max(bounds.maxY, next.maxY),
  };
}

function collectHorizontalBounds(
  bounds: BoardTileBounds | null,
  branch: "left" | "right",
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  boardWidth: number,
  boardHeight: number,
) {
  if (!tiles.length) return bounds;
  const direction: DominoTileDirection = branch;
  const branchDirection = branch === "right" ? 1 : -1;
  const bendDirection: DominoTileDirection = branch === "right" ? "down" : "up";
  const straightCount = getStraightSegmentCount(
    tiles,
    Math.max(0, boardWidth / 2 - centerWidth / 2 - BOARD_EDGE_PADDING),
    tileWidth,
    tileHeight,
    direction,
  );
  let result = bounds;
  let offset = 0;
  for (const tile of tiles.slice(0, straightCount)) {
    const size = getTileSlotSize(tile, direction, tileWidth, tileHeight);
    const x = getSnapValue(
      branchDirection *
        (centerWidth / 2 + TILE_GAP + offset + size.slotWidth / 2),
    );
    result = includeTileBounds(result, x, 0, size.slotWidth, size.slotHeight);
    offset += size.slotWidth + TILE_GAP;
  }
  const bent = tiles.slice(straightCount);
  if (!bent.length) return result;
  const connectionX = getSnapValue(
    branchDirection * (centerWidth / 2 + offset),
  );
  const bendCount = getStraightSegmentCount(
    bent,
    Math.max(0, boardHeight / 2 - BOARD_EDGE_PADDING),
    tileWidth,
    tileHeight,
    bendDirection,
  );
  let secondary = 0;
  for (const tile of bent.slice(0, bendCount)) {
    const size = getTileSlotSize(tile, bendDirection, tileWidth, tileHeight);
    const y = getSnapValue(
      branchDirection * (TILE_GAP + secondary + size.slotHeight / 2),
    );
    result = includeTileBounds(
      result,
      connectionX,
      y,
      size.slotWidth,
      size.slotHeight,
    );
    secondary += size.slotHeight + TILE_GAP;
  }
  const returns = bent.slice(bendCount);
  if (!returns.length) return result;
  const returnDirection: DominoTileDirection =
    branch === "right" ? "left" : "right";
  const firstSize = getTileSlotSize(
    returns[0],
    returnDirection,
    tileWidth,
    tileHeight,
  );
  const returnY = getSnapValue(
    branchDirection * (secondary - firstSize.slotHeight / 2 + TILE_GAP),
  );
  let returnOffset = 0;
  const columnWidth = bendCount
    ? getTileSlotSize(bent[bendCount - 1], bendDirection, tileWidth, tileHeight)
        .slotWidth
    : tileWidth;
  for (const tile of returns) {
    const size = getTileSlotSize(tile, returnDirection, tileWidth, tileHeight);
    const x = getSnapValue(
      connectionX +
        (branch === "right" ? -1 : 1) *
          (columnWidth / 2 + TILE_GAP + returnOffset + size.slotWidth / 2),
    );
    result = includeTileBounds(
      result,
      x,
      returnY,
      size.slotWidth,
      size.slotHeight,
    );
    returnOffset += size.slotWidth + TILE_GAP;
  }
  return result;
}

function collectVerticalBounds(
  bounds: BoardTileBounds | null,
  branch: "up" | "down",
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerHeight: number,
  boardHeight: number,
) {
  if (!tiles.length) return bounds;
  const direction: DominoTileDirection = branch;
  const branchDirection = branch === "down" ? 1 : -1;
  const bendDirection: DominoTileDirection = branch === "up" ? "right" : "left";
  const straightCount = getStraightSegmentCount(
    tiles,
    Math.max(0, boardHeight / 2 - centerHeight / 2 - BOARD_EDGE_PADDING),
    tileWidth,
    tileHeight,
    direction,
  );
  let result = bounds;
  let offset = 0;
  for (const tile of tiles.slice(0, straightCount)) {
    const size = getTileSlotSize(tile, direction, tileWidth, tileHeight);
    const y = getSnapValue(
      branchDirection *
        (centerHeight / 2 + TILE_GAP + offset + size.slotHeight / 2),
    );
    result = includeTileBounds(result, 0, y, size.slotWidth, size.slotHeight);
    offset += size.slotHeight + TILE_GAP;
  }
  const connectionY = getSnapValue(
    branchDirection * (centerHeight / 2 + offset),
  );
  let secondary = 0;
  for (const tile of tiles.slice(straightCount)) {
    const size = getTileSlotSize(tile, bendDirection, tileWidth, tileHeight);
    const x = getSnapValue(
      (branch === "up" ? 1 : -1) * (TILE_GAP + secondary + size.slotWidth / 2),
    );
    result = includeTileBounds(
      result,
      x,
      connectionY,
      size.slotWidth,
      size.slotHeight,
    );
    secondary += size.slotWidth + TILE_GAP;
  }
  return result;
}

export function calculateBoardTileBounds(
  board: GameState["board"],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  centerHeight: number,
  boardWidth: number,
  boardHeight: number,
) {
  let bounds: BoardTileBounds | null = null;
  if (board.centerTile) {
    const size = getTileSlotSize(
      board.centerTile as BoardTile,
      board.centerTile.left === board.centerTile.right ? "down" : "right",
      tileWidth,
      tileHeight,
    );
    bounds = includeTileBounds(bounds, 0, 0, size.slotWidth, size.slotHeight);
  }
  bounds = collectHorizontalBounds(
    bounds,
    "left",
    board.branches.left.tiles,
    tileWidth,
    tileHeight,
    centerWidth,
    boardWidth,
    boardHeight,
  );
  bounds = collectHorizontalBounds(
    bounds,
    "right",
    board.branches.right.tiles,
    tileWidth,
    tileHeight,
    centerWidth,
    boardWidth,
    boardHeight,
  );
  bounds = collectVerticalBounds(
    bounds,
    "up",
    board.branches.up.tiles,
    tileWidth,
    tileHeight,
    centerHeight,
    boardHeight,
  );
  return collectVerticalBounds(
    bounds,
    "down",
    board.branches.down.tiles,
    tileWidth,
    tileHeight,
    centerHeight,
    boardHeight,
  );
}

export function getBoardTilesZoomScale(
  bounds: BoardTileBounds | null,
  boardWidth: number,
  boardHeight: number,
) {
  if (!bounds || boardWidth <= 0 || boardHeight <= 0) return 1;
  const safeHalfWidth = Math.max(
    0,
    boardWidth / 2 - BOARD_SAFE_HORIZONTAL_PADDING,
  );
  const safeHalfHeight = Math.max(
    0,
    boardHeight / 2 - BOARD_SAFE_VERTICAL_PADDING,
  );
  return (
    BOARD_ZOOM_LEVELS.find(
      (scale) =>
        bounds.minX * scale >= -safeHalfWidth &&
        bounds.maxX * scale <= safeHalfWidth &&
        bounds.minY * scale >= -safeHalfHeight &&
        bounds.maxY * scale <= safeHalfHeight,
    ) ?? BOARD_ZOOM_LEVELS[BOARD_ZOOM_LEVELS.length - 1]
  );
}
