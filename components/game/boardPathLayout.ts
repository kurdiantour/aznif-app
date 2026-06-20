import { DominoTileDirection } from '@/components/game/DominoTile';
import { GameState, KozelBranch } from '@/types/game';

export const BOARD_EDGE_PADDING = 12;
export const TILE_GAP = 2;

export type BoardTile = GameState['board']['branches'][KozelBranch]['tiles'][number];

function isHorizontalDirection(direction: DominoTileDirection) {
  return direction === 'left' || direction === 'right';
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
      sum + getPathFootprint(tile, 'right', tileWidth, tileHeight) + TILE_GAP,
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
      sum + getPathFootprint(tile, 'down', tileWidth, tileHeight) + TILE_GAP,
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
