import DominoTile, { DominoTileDirection } from '@/components/game/DominoTile';
import { DominoTileData, GameState, KozelBranch } from '@/types/game';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  board: GameState['board'];
  lastScoringEvent: GameState['lastScoringEvent'];
  roundWinnerPlayerId?: string | null;
  selectableBranches?: KozelBranch[];
  onSelectBranch?: (branch: KozelBranch) => void;
  boneyardCount: number;
  shouldRenderPlayedBoardTiles?: boolean;
  finalTileAnimationTileId?: string | null;
  onFinalTileAnimationComplete?: () => void;
};

const BASE_TILE_WIDTH = 46;
const BASE_TILE_HEIGHT = 80;

const BOARD_SCALE_FULL = 1.2;
const BOARD_SCALE_MEDIUM = 0.78;
const BOARD_SCALE_SMALL = 0.58;

const BOARD_EDGE_PADDING = 12;
const BOARD_SAFE_HORIZONTAL_PADDING = 28;
const BOARD_SAFE_VERTICAL_PADDING = 22;
const BOARD_ZOOM_LEVELS = [1, 0.92, 0.84, 0.76, 0.68] as const;
const TILE_GAP = 1;

type BoardTile = GameState['board']['branches'][KozelBranch]['tiles'][number];
type BoardTileBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function isHorizontalDirection(direction: DominoTileDirection) {
  return direction === 'left' || direction === 'right';
}

function getTileSlotSize(
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

function getPathFootprint(
  tile: BoardTile,
  direction: DominoTileDirection,
  tileWidth: number,
  tileHeight: number,
) {
  const size = getTileSlotSize(tile, direction, tileWidth, tileHeight);
  return isHorizontalDirection(direction) ? size.slotWidth : size.slotHeight;
}

function estimateHorizontalWidth(
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

function estimateVerticalHeight(
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

function BranchTile({
  tile,
  x,
  y,
  tileWidth,
  tileHeight,
  direction,
  zIndex = 20,
  hidden = false,
  animatedStyle,
}: {
  tile: BoardTile;
  x: number;
  y: number;
  tileWidth: number;
  tileHeight: number;
  direction: DominoTileDirection;
  zIndex?: number;
  hidden?: boolean;
  animatedStyle?: any;
}) {
  const { slotWidth, slotHeight } = getTileSlotSize(
    tile,
    direction,
    tileWidth,
    tileHeight,
  );

  const SlotView: any = animatedStyle ? Animated.View : View;

  return (
    <SlotView
      pointerEvents="none"
      style={[
        styles.pathTileSlot,
        {
          width: slotWidth,
          height: slotHeight,
          left: '50%',
          top: '50%',
          marginLeft: x - slotWidth / 2,
          marginTop: y - slotHeight / 2,
          zIndex,
          opacity: hidden ? 0 : 1,
        },
        animatedStyle,
      ]}
    >
      <DominoTile
        tile={tile}
        width={tileWidth}
        height={tileHeight}
        direction={direction}
      />
    </SlotView>
  );
}

function getSnapValue(value: number) {
  return Math.round(value);
}

function includeTileBounds(
  bounds: BoardTileBounds | null,
  x: number,
  y: number,
  slotWidth: number,
  slotHeight: number,
): BoardTileBounds {
  const nextBounds = {
    minX: x - slotWidth / 2,
    maxX: x + slotWidth / 2,
    minY: y - slotHeight / 2,
    maxY: y + slotHeight / 2,
  };

  if (!bounds) return nextBounds;

  return {
    minX: Math.min(bounds.minX, nextBounds.minX),
    maxX: Math.max(bounds.maxX, nextBounds.maxX),
    minY: Math.min(bounds.minY, nextBounds.minY),
    maxY: Math.max(bounds.maxY, nextBounds.maxY),
  };
}

function collectHorizontalBranchBounds(
  bounds: BoardTileBounds | null,
  branch: 'left' | 'right',
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  boardWidth: number,
  boardHeight: number,
) {
  if (!tiles.length) return bounds;

  const primaryDirection: DominoTileDirection = branch;
  const branchDirection = branch === 'right' ? 1 : -1;
  const turnDirection = branch === 'right' ? 1 : -1;
  const verticalBendDirection: DominoTileDirection =
    turnDirection === 1 ? 'down' : 'up';

  const availableHorizontalSpace = Math.max(
    0,
    boardWidth / 2 - centerWidth / 2 - BOARD_EDGE_PADDING,
  );

  const straightCount = getStraightSegmentCount(
    tiles,
    availableHorizontalSpace,
    tileWidth,
    tileHeight,
    primaryDirection,
  );

  const straightTiles = tiles.slice(0, straightCount);
  const bentTiles = tiles.slice(straightCount);

  let nextBounds = bounds;
  let primaryOffset = 0;
  const primaryStart = centerWidth / 2 + TILE_GAP;

  straightTiles.forEach((tile) => {
    const { slotWidth, slotHeight } = getTileSlotSize(
      tile,
      primaryDirection,
      tileWidth,
      tileHeight,
    );

    const x = getSnapValue(
      branchDirection * (primaryStart + primaryOffset + slotWidth / 2),
    );

    nextBounds = includeTileBounds(nextBounds, x, 0, slotWidth, slotHeight);
    primaryOffset += slotWidth + TILE_GAP;
  });

  if (!bentTiles.length) return nextBounds;

  const connectionX = getSnapValue(
    branchDirection * (primaryStart + primaryOffset - TILE_GAP),
  );

  const availableVerticalBendSpace = Math.max(
    0,
    boardHeight / 2 - BOARD_EDGE_PADDING,
  );

  const verticalBendCount = getStraightSegmentCount(
    bentTiles,
    availableVerticalBendSpace,
    tileWidth,
    tileHeight,
    verticalBendDirection,
  );

  const verticalBentTiles = bentTiles.slice(0, verticalBendCount);
  const returnTiles = bentTiles.slice(verticalBendCount);

  let secondaryOffset = 0;

  verticalBentTiles.forEach((tile) => {
    const { slotWidth, slotHeight } = getTileSlotSize(
      tile,
      verticalBendDirection,
      tileWidth,
      tileHeight,
    );

    const y = getSnapValue(
      turnDirection * (TILE_GAP + secondaryOffset + slotHeight / 2),
    );

    nextBounds = includeTileBounds(
      nextBounds,
      connectionX,
      y,
      slotWidth,
      slotHeight,
    );

    secondaryOffset += slotHeight + TILE_GAP;
  });

  if (!returnTiles.length) return nextBounds;

  const returnDirection = branch === 'right' ? -1 : 1;
  const returnTileDirection: DominoTileDirection =
    returnDirection === 1 ? 'right' : 'left';

  const firstReturnTile = returnTiles[0];
  const returnSlotHeight = getTileSlotSize(
    firstReturnTile,
    returnTileDirection,
    tileWidth,
    tileHeight,
  ).slotHeight;

  const returnY = getSnapValue(
    turnDirection * (secondaryOffset - returnSlotHeight / 2 + TILE_GAP),
  );

  let returnOffset = 0;

  returnTiles.forEach((tile) => {
    const { slotWidth, slotHeight } = getTileSlotSize(
      tile,
      returnTileDirection,
      tileWidth,
      tileHeight,
    );

    const verticalColumnSlotWidth =
      verticalBentTiles.length > 0
        ? getTileSlotSize(
            verticalBentTiles[verticalBentTiles.length - 1],
            verticalBendDirection,
            tileWidth,
            tileHeight,
          ).slotWidth
        : tileWidth;

    const x = getSnapValue(
      connectionX +
        returnDirection *
          (verticalColumnSlotWidth / 2 +
            TILE_GAP +
            returnOffset +
            slotWidth / 2),
    );

    nextBounds = includeTileBounds(nextBounds, x, returnY, slotWidth, slotHeight);
    returnOffset += slotWidth + TILE_GAP;
  });

  return nextBounds;
}

function collectVerticalBranchBounds(
  bounds: BoardTileBounds | null,
  branch: 'up' | 'down',
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerHeight: number,
  boardHeight: number,
) {
  if (!tiles.length) return bounds;

  const primaryDirection: DominoTileDirection = branch;
  const branchDirection = branch === 'down' ? 1 : -1;
  const turnDirection = branch === 'up' ? 1 : -1;
  const horizontalBendDirection: DominoTileDirection =
    turnDirection === 1 ? 'right' : 'left';

  const availableSpace = Math.max(
    0,
    boardHeight / 2 - centerHeight / 2 - BOARD_EDGE_PADDING,
  );

  const straightCount = getStraightSegmentCount(
    tiles,
    availableSpace,
    tileWidth,
    tileHeight,
    primaryDirection,
  );

  const verticalTiles = tiles.slice(0, straightCount);
  const bentTiles = tiles.slice(straightCount);

  let nextBounds = bounds;
  let primaryOffset = 0;
  const primaryStart = centerHeight / 2 + TILE_GAP;

  verticalTiles.forEach((tile) => {
    const { slotWidth, slotHeight } = getTileSlotSize(
      tile,
      primaryDirection,
      tileWidth,
      tileHeight,
    );

    const y = getSnapValue(
      branchDirection * (primaryStart + primaryOffset + slotHeight / 2),
    );

    nextBounds = includeTileBounds(nextBounds, 0, y, slotWidth, slotHeight);
    primaryOffset += slotHeight + TILE_GAP;
  });

  if (!bentTiles.length) return nextBounds;

  const connectionY = getSnapValue(
    branchDirection * (primaryStart + primaryOffset - TILE_GAP),
  );

  let secondaryOffset = 0;

  bentTiles.forEach((tile) => {
    const { slotWidth, slotHeight } = getTileSlotSize(
      tile,
      horizontalBendDirection,
      tileWidth,
      tileHeight,
    );

    const x = getSnapValue(
      turnDirection * (TILE_GAP + secondaryOffset + slotWidth / 2),
    );

    nextBounds = includeTileBounds(nextBounds, x, connectionY, slotWidth, slotHeight);
    secondaryOffset += slotWidth + TILE_GAP;
  });

  return nextBounds;
}

function calculateBoardTileBounds(
  board: GameState['board'],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  centerHeight: number,
  boardWidth: number,
  boardHeight: number,
) {
  let bounds: BoardTileBounds | null = null;

  if (board.centerTile) {
    const centerRotation =
      board.centerTile.left === board.centerTile.right ? 'down' : 'right';
    const { slotWidth, slotHeight } = getTileSlotSize(
      board.centerTile as BoardTile,
      centerRotation,
      tileWidth,
      tileHeight,
    );

    bounds = includeTileBounds(bounds, 0, 0, slotWidth, slotHeight);
  }

  bounds = collectHorizontalBranchBounds(
    bounds,
    'left',
    board.branches.left.tiles,
    tileWidth,
    tileHeight,
    centerWidth,
    boardWidth,
    boardHeight,
  );

  bounds = collectHorizontalBranchBounds(
    bounds,
    'right',
    board.branches.right.tiles,
    tileWidth,
    tileHeight,
    centerWidth,
    boardWidth,
    boardHeight,
  );

  bounds = collectVerticalBranchBounds(
    bounds,
    'up',
    board.branches.up.tiles,
    tileWidth,
    tileHeight,
    centerHeight,
    boardHeight,
  );

  bounds = collectVerticalBranchBounds(
    bounds,
    'down',
    board.branches.down.tiles,
    tileWidth,
    tileHeight,
    centerHeight,
    boardHeight,
  );

  return bounds;
}

function getBoardTilesZoomScale(
  bounds: BoardTileBounds | null,
  boardWidth: number,
  boardHeight: number,
) {
  if (!bounds || boardWidth <= 0 || boardHeight <= 0) return 1;

  const safeHalfWidth = Math.max(0, boardWidth / 2 - BOARD_SAFE_HORIZONTAL_PADDING);
  const safeHalfHeight = Math.max(0, boardHeight / 2 - BOARD_SAFE_VERTICAL_PADDING);

  for (const scale of BOARD_ZOOM_LEVELS) {
    if (
      bounds.minX * scale >= -safeHalfWidth &&
      bounds.maxX * scale <= safeHalfWidth &&
      bounds.minY * scale >= -safeHalfHeight &&
      bounds.maxY * scale <= safeHalfHeight
    ) {
      return scale;
    }
  }

  return BOARD_ZOOM_LEVELS[BOARD_ZOOM_LEVELS.length - 1];
}

const HIDDEN_BONEYARD_TILE: DominoTileData = {
  id: 'hidden-boneyard-0-0',
  left: 0,
  right: 0,
  imageKey: '0-0',
};

function renderBoneyardStack(
  count: number,
  boardWidth: number,
  boardHeight: number,
  tileWidth: number,
  tileHeight: number,
) {
  if (count <= 0 || boardHeight <= 0) return null;

  const availableVerticalSpace = boardHeight - BOARD_EDGE_PADDING * 2;

  const displayHeight = Math.max(18, Math.round(tileHeight * 0.72));
  const displayWidth = Math.max(36, Math.round(displayHeight * 0.75));

  const spacing = Math.max(
    0,
    Math.min(
      8,
      Math.floor(
        (availableVerticalSpace - count * displayHeight) /
          Math.max(count + 1, 1),
      ),
    ),
  );

  const stackHeight = count * displayHeight + Math.max(0, count - 1) * spacing;

  const startTop =
    stackHeight <= availableVerticalSpace
      ? Math.max(BOARD_EDGE_PADDING, Math.round((boardHeight - stackHeight) / 2))
      : BOARD_EDGE_PADDING;

  const leftOffset = -displayWidth - 12;

  return (
    <View pointerEvents="none" style={styles.boneyardStackWrap}>
      {Array.from({ length: count }).map((_, index) => {
        const top = startTop + index * 24;

        return (
          <View
            key={`boneyard-${index}`}
            style={[
              styles.boneyardTileSlot,
              {
                width: displayWidth,
                height: displayHeight,
                left: leftOffset,
                top,
                zIndex: 10 + index,
              },
            ]}
          >
            <DominoTile
              tile={HIDDEN_BONEYARD_TILE}
              width={displayHeight}
              height={displayWidth}
              rotation={90}
            />
          </View>
        );
      })}
    </View>
  );
}

function getStraightSegmentCount(
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

function buildHorizontalBranchPath(
  branch: 'left' | 'right',
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  boardWidth: number,
  boardHeight: number,
  hiddenTileId?: string | null,
  animatedTileId?: string | null,
  animatedStyle?: any,
) {
  if (!tiles.length) return null;

  const primaryDirection: DominoTileDirection = branch;
  const branchDirection = branch === 'right' ? 1 : -1;
  const turnDirection = branch === 'right' ? 1 : -1;
  const verticalBendDirection: DominoTileDirection =
    turnDirection === 1 ? 'down' : 'up';

  const availableHorizontalSpace = Math.max(
    0,
    boardWidth / 2 - centerWidth / 2 - BOARD_EDGE_PADDING,
  );

  const straightCount = getStraightSegmentCount(
    tiles,
    availableHorizontalSpace,
    tileWidth,
    tileHeight,
    primaryDirection,
  );

  const straightTiles = tiles.slice(0, straightCount);
  const bentTiles = tiles.slice(straightCount);

  const positions: React.ReactNode[] = [];
  let primaryOffset = 0;
  const primaryStart = centerWidth / 2 + TILE_GAP;

  straightTiles.forEach((tile, index) => {
    const { slotWidth } = getTileSlotSize(
      tile,
      primaryDirection,
      tileWidth,
      tileHeight,
    );

    const x = getSnapValue(
      branchDirection * (primaryStart + primaryOffset + slotWidth / 2),
    );

    positions.push(
      <BranchTile
        key={`${branch}-straight-${tile.order}-${tile.id}`}
        tile={tile}
        x={x}
        y={0}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={primaryDirection}
        zIndex={20 + index}
        hidden={tile.id === hiddenTileId}
        animatedStyle={tile.id === animatedTileId ? animatedStyle : undefined}
      />,
    );

    primaryOffset += slotWidth + TILE_GAP;
  });

  if (!bentTiles.length) {
    return positions;
  }

  const connectionX = getSnapValue(
    branchDirection * (primaryStart + primaryOffset - TILE_GAP),
  );

  const availableVerticalBendSpace = Math.max(
    0,
    boardHeight / 2 - BOARD_EDGE_PADDING,
  );

  const verticalBendCount = getStraightSegmentCount(
    bentTiles,
    availableVerticalBendSpace,
    tileWidth,
    tileHeight,
    verticalBendDirection,
  );

  const verticalBentTiles = bentTiles.slice(0, verticalBendCount);
  const returnTiles = bentTiles.slice(verticalBendCount);

  let secondaryOffset = 0;

  verticalBentTiles.forEach((tile, index) => {
    const { slotHeight } = getTileSlotSize(
      tile,
      verticalBendDirection,
      tileWidth,
      tileHeight,
    );

    const x = connectionX;
    const y = getSnapValue(
      turnDirection * (TILE_GAP + secondaryOffset + slotHeight / 2),
    );

    positions.push(
      <BranchTile
        key={`${branch}-bend-${tile.order}-${tile.id}`}
        tile={tile}
        x={x}
        y={y}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={verticalBendDirection}
        zIndex={20 + straightTiles.length + index}
        hidden={tile.id === hiddenTileId}
        animatedStyle={tile.id === animatedTileId ? animatedStyle : undefined}
      />,
    );

    secondaryOffset += slotHeight + TILE_GAP;
  });

  if (!returnTiles.length) {
    return positions;
  }

  const returnDirection = branch === 'right' ? -1 : 1;
  const returnTileDirection: DominoTileDirection =
    returnDirection === 1 ? 'right' : 'left';

  const firstReturnTile = returnTiles[0];

  const returnSlotHeight = getTileSlotSize(
    firstReturnTile,
    returnTileDirection,
    tileWidth,
    tileHeight,
  ).slotHeight;

  const returnY = getSnapValue(
    turnDirection * (secondaryOffset - returnSlotHeight / 2 + TILE_GAP),
  );

  let returnOffset = 0;

  returnTiles.forEach((tile, index) => {
    const { slotWidth } = getTileSlotSize(
      tile,
      returnTileDirection,
      tileWidth,
      tileHeight,
    );

    const verticalColumnSlotWidth =
      verticalBentTiles.length > 0
        ? getTileSlotSize(
            verticalBentTiles[verticalBentTiles.length - 1],
            verticalBendDirection,
            tileWidth,
            tileHeight,
          ).slotWidth
        : tileWidth;

    const x = getSnapValue(
      connectionX +
        returnDirection *
          (verticalColumnSlotWidth / 2 +
            TILE_GAP +
            returnOffset +
            slotWidth / 2),
    );

    positions.push(
      <BranchTile
        key={`${branch}-return-${tile.order}-${tile.id}`}
        tile={tile}
        x={x}
        y={returnY}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={returnTileDirection}
        zIndex={
          20 + straightTiles.length + verticalBentTiles.length + index
        }
        hidden={tile.id === hiddenTileId}
        animatedStyle={tile.id === animatedTileId ? animatedStyle : undefined}
      />,
    );

    returnOffset += slotWidth + TILE_GAP;
  });

  return positions;
}

function buildVerticalBranchPath(
  branch: 'up' | 'down',
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerHeight: number,
  boardHeight: number,
  hiddenTileId?: string | null,
  animatedTileId?: string | null,
  animatedStyle?: any,
) {
  if (!tiles.length) return null;

  const primaryDirection: DominoTileDirection = branch;
  const branchDirection = branch === 'down' ? 1 : -1;
  const turnDirection = branch === 'up' ? 1 : -1;
  const horizontalBendDirection: DominoTileDirection =
    turnDirection === 1 ? 'right' : 'left';

  const availableSpace = Math.max(
    0,
    boardHeight / 2 - centerHeight / 2 - BOARD_EDGE_PADDING,
  );

  const straightCount = getStraightSegmentCount(
    tiles,
    availableSpace,
    tileWidth,
    tileHeight,
    primaryDirection,
  );

  const verticalTiles = tiles.slice(0, straightCount);
  const bentTiles = tiles.slice(straightCount);

  const positions: React.ReactNode[] = [];
  let primaryOffset = 0;
  const primaryStart = centerHeight / 2 + TILE_GAP;

  verticalTiles.forEach((tile, index) => {
    const { slotHeight } = getTileSlotSize(
      tile,
      primaryDirection,
      tileWidth,
      tileHeight,
    );

    const y = getSnapValue(
      branchDirection * (primaryStart + primaryOffset + slotHeight / 2),
    );

    positions.push(
      <BranchTile
        key={`${branch}-straight-${tile.order}-${tile.id}`}
        tile={tile}
        x={0}
        y={y}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={primaryDirection}
        zIndex={20 + index}
        hidden={tile.id === hiddenTileId}
        animatedStyle={tile.id === animatedTileId ? animatedStyle : undefined}
      />,
    );

    primaryOffset += slotHeight + TILE_GAP;
  });

  if (!bentTiles.length) {
    return positions;
  }

  const connectionY = getSnapValue(
    branchDirection * (primaryStart + primaryOffset - TILE_GAP),
  );

  let secondaryOffset = 0;

  bentTiles.forEach((tile, index) => {
    const { slotWidth } = getTileSlotSize(
      tile,
      horizontalBendDirection,
      tileWidth,
      tileHeight,
    );

    const x = getSnapValue(
      turnDirection * (TILE_GAP + secondaryOffset + slotWidth / 2),
    );

    positions.push(
      <BranchTile
        key={`${branch}-bend-${tile.order}-${tile.id}`}
        tile={tile}
        x={x}
        y={connectionY}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={horizontalBendDirection}
        zIndex={20 + verticalTiles.length + index}
        hidden={tile.id === hiddenTileId}
        animatedStyle={tile.id === animatedTileId ? animatedStyle : undefined}
      />,
    );

    secondaryOffset += slotWidth + TILE_GAP;
  });

  return positions;
}

function BentHorizontalPathBranch({
  branch,
  tiles,
  tileWidth,
  tileHeight,
  centerWidth,
  boardWidth,
  boardHeight,
  hiddenTileId,
  animatedTileId,
  animatedStyle,
}: {
  branch: 'left' | 'right';
  tiles: BoardTile[];
  tileWidth: number;
  tileHeight: number;
  centerWidth: number;
  boardWidth: number;
  boardHeight: number;
  hiddenTileId?: string | null;
  animatedTileId?: string | null;
  animatedStyle?: any;
}) {
  return (
    <>
      {buildHorizontalBranchPath(
        branch,
        tiles,
        tileWidth,
        tileHeight,
        centerWidth,
        boardWidth,
        boardHeight,
        hiddenTileId,
        animatedTileId,
        animatedStyle,
      )}
    </>
  );
}

function BentVerticalPathBranch({
  branch,
  tiles,
  tileWidth,
  tileHeight,
  centerHeight,
  boardHeight,
  hiddenTileId,
  animatedTileId,
  animatedStyle,
}: {
  branch: 'up' | 'down';
  tiles: BoardTile[];
  tileWidth: number;
  tileHeight: number;
  centerHeight: number;
  boardHeight: number;
  hiddenTileId?: string | null;
  animatedTileId?: string | null;
  animatedStyle?: any;
}) {
  return (
    <>
      {buildVerticalBranchPath(
        branch,
        tiles,
        tileWidth,
        tileHeight,
        centerHeight,
        boardHeight,
        hiddenTileId,
        animatedTileId,
        animatedStyle,
      )}
    </>
  );
}

function BranchDropZone({
  branch,
  active,
  onPress,
}: {
  branch: KozelBranch;
  active: boolean;
  onPress?: (branch: KozelBranch) => void;
}) {
  if (!active) return null;

  return (
    <Pressable
      style={[
        styles.dropZone,
        branch === 'up' && styles.dropZoneUp,
        branch === 'right' && styles.dropZoneRight,
        branch === 'down' && styles.dropZoneDown,
        branch === 'left' && styles.dropZoneLeft,
      ]}
      onPress={() => onPress?.(branch)}
    >
      <Text style={styles.dropZoneText}>+</Text>
    </Pressable>
  );
}

export default forwardRef(function BoardArea(
  {
    board,
    lastScoringEvent,
    selectableBranches = [],
    onSelectBranch,
    boneyardCount,
    shouldRenderPlayedBoardTiles = true,
    finalTileAnimationTileId = null,
    onFinalTileAnimationComplete,
  }: Props,
  ref,
) {
  const [surfaceSize, setSurfaceSize] = useState({
    width: 1200,
    height: 700,
  });

  const animOpacity = useRef(new Animated.Value(1)).current;
  const animScale = useRef(new Animated.Value(1)).current;
  const animTranslateX = useRef(new Animated.Value(0)).current;
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const finalTileScale = useRef(new Animated.Value(1)).current;
  const finalTileTranslateX = useRef(new Animated.Value(0)).current;
  const finalTileTranslateY = useRef(new Animated.Value(0)).current;
  const boardShake = useRef(new Animated.Value(0)).current;
  const lastCompletedFinalTileIdRef = useRef<string | null>(null);

  const [animSprite, setAnimSprite] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
  }>(null);

  const finalTileInfo = useMemo(() => {
    if (!finalTileAnimationTileId) return null;

    if (board.centerTile?.id === finalTileAnimationTileId) {
      return {
        tile: board.centerTile,
        direction: undefined as DominoTileDirection | undefined,
        isCenter: true,
      };
    }

    const branches: KozelBranch[] = ['left', 'right', 'up', 'down'];

    for (const branch of branches) {
      const found = board.branches[branch].tiles.find(
        (tile) => tile.id === finalTileAnimationTileId,
      );

      if (found) {
        return {
          tile: found,
          direction: branch as DominoTileDirection,
          isCenter: false,
        };
      }
    }

    return null;
  }, [board, finalTileAnimationTileId]);

  const layout = useMemo(() => {
    const boardWidth = surfaceSize.width || 1;
    const boardHeight = surfaceSize.height || 1;

    const leftNeed = estimateHorizontalWidth(
      board.branches.left.tiles,
      BASE_TILE_WIDTH,
      BASE_TILE_HEIGHT,
    );

    const rightNeed = estimateHorizontalWidth(
      board.branches.right.tiles,
      BASE_TILE_WIDTH,
      BASE_TILE_HEIGHT,
    );

    const upNeed = estimateVerticalHeight(
      board.branches.up.tiles,
      BASE_TILE_WIDTH,
      BASE_TILE_HEIGHT,
    );

    const downNeed = estimateVerticalHeight(
      board.branches.down.tiles,
      BASE_TILE_WIDTH,
      BASE_TILE_HEIGHT,
    );

    const horizontalNeed = Math.max(
      BASE_TILE_HEIGHT * 4,
      Math.min(leftNeed, BASE_TILE_HEIGHT * 6),
      Math.min(rightNeed, BASE_TILE_HEIGHT * 6),
    );

    const verticalNeed = Math.max(
      BASE_TILE_HEIGHT * 2,
      Math.min(upNeed, BASE_TILE_HEIGHT * 5),
      Math.min(downNeed, BASE_TILE_HEIGHT * 5),
    );

    const horizontalSafe = Math.max(120, boardWidth / 2 - BASE_TILE_HEIGHT);
    const verticalSafe = Math.max(90, boardHeight / 2 - BASE_TILE_HEIGHT);

    const horizontalScale = horizontalSafe / Math.max(horizontalNeed, 1);
    const verticalScale = verticalSafe / Math.max(verticalNeed, 1);

    const rawScale = Math.min(horizontalScale, verticalScale);

    let scale = BOARD_SCALE_FULL;

    if (rawScale < 0.72) {
      scale = BOARD_SCALE_SMALL;
    } else if (rawScale < 0.9) {
      scale = BOARD_SCALE_MEDIUM;
    }

    const tileWidth = Math.round(BASE_TILE_WIDTH * scale);
    const tileHeight = Math.round(BASE_TILE_HEIGHT * scale);

    return {
      tileWidth,
      tileHeight,
      centerWidth: tileWidth,
      centerHeight: tileHeight,
    };
  }, [board, surfaceSize]);

  const boardTilesScale = useMemo(() => {
    const bounds = calculateBoardTileBounds(
      board,
      layout.tileWidth,
      layout.tileHeight,
      layout.centerWidth,
      layout.centerHeight,
      surfaceSize.width,
      surfaceSize.height,
    );

    return getBoardTilesZoomScale(bounds, surfaceSize.width, surfaceSize.height);
  }, [board, layout, surfaceSize]);

  useImperativeHandle(ref, () => ({
    animateDraw: () => {
      return new Promise<void>((resolve) => {
        const count = boneyardCount;

        if (count <= 0 || surfaceSize.height <= 0) {
          resolve();
          return;
        }

        const availableVerticalSpace =
          surfaceSize.height - BOARD_EDGE_PADDING * 2;

        const displayHeight = Math.max(
          18,
          Math.round((layout.tileHeight || 34) * 0.72),
        );

        const displayWidth = Math.max(28, Math.round(displayHeight * 1.75));

        const spacing = Math.max(
          4,
          Math.min(
            8,
            Math.floor(
              (availableVerticalSpace - count * displayHeight) /
                Math.max(count + 1, 1),
            ),
          ),
        );

        const stackHeight =
          count * displayHeight + Math.max(0, count - 1) * spacing;

        const startTop =
          stackHeight <= availableVerticalSpace
            ? Math.max(
                BOARD_EDGE_PADDING,
                Math.round((surfaceSize.height - stackHeight) / 2),
              )
            : BOARD_EDGE_PADDING;

        const leftOffset = -displayWidth - 12;
        const index = Math.max(0, count - 1);

        const startLeft = leftOffset;
        const startTopForIndex = startTop + index * (displayHeight + spacing);

        animOpacity.setValue(1);
        animScale.setValue(1);
        animTranslateX.setValue(0);
        animTranslateY.setValue(0);

        setAnimSprite({
          left: startLeft,
          top: startTopForIndex,
          width: displayWidth,
          height: displayHeight,
        });

        const targetTranslateX = displayWidth + 60;
        const targetTranslateY =
          Math.round(surfaceSize.height / 2) - startTopForIndex + 40;

        Animated.parallel([
          Animated.timing(animTranslateX, {
            toValue: targetTranslateX,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animTranslateY, {
            toValue: targetTranslateY,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animOpacity, {
            toValue: 0,
            duration: 220,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(animScale, {
            toValue: 0.9,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          setAnimSprite(null);
          resolve();
        });
      });
    },
  }));

  useEffect(() => {
    if (!finalTileAnimationTileId) {
      lastCompletedFinalTileIdRef.current = null;
      return;
    }

    if (!finalTileInfo) {
      onFinalTileAnimationComplete?.();
      return;
    }

    if (lastCompletedFinalTileIdRef.current === finalTileAnimationTileId) {
      return;
    }

    lastCompletedFinalTileIdRef.current = finalTileAnimationTileId;

    finalTileScale.setValue(2.45);
    finalTileTranslateX.setValue(0);
    finalTileTranslateY.setValue(-92);
    boardShake.setValue(0);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(finalTileScale, {
          toValue: 2.15,
          duration: 90,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(finalTileTranslateY, {
          toValue: -112,
          duration: 90,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(finalTileScale, {
          toValue: 1,
          duration: 190,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(finalTileTranslateY, {
          toValue: 0,
          duration: 190,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(finalTileScale, {
            toValue: 0.92,
            duration: 48,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.spring(finalTileScale, {
            toValue: 1,
            friction: 4,
            tension: 180,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(boardShake, {
            toValue: 1,
            duration: 28,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(boardShake, {
            toValue: -1,
            duration: 44,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(boardShake, {
            toValue: 0,
            duration: 48,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start(() => {
      onFinalTileAnimationComplete?.();
    });
  }, [
    boardShake,
    finalTileAnimationTileId,
    finalTileInfo,
    finalTileScale,
    finalTileTranslateX,
    finalTileTranslateY,
    onFinalTileAnimationComplete,
  ]);

  const boardShakeTranslateX = boardShake.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-3, 0, 3],
  });

  return (
    <View style={styles.container}>
      {shouldRenderPlayedBoardTiles && lastScoringEvent && (
        <View style={styles.scoreBadge}>
          <Text style={styles.scoreBadgeText}>+{lastScoringEvent.points}</Text>
        </View>
      )}

      {shouldRenderPlayedBoardTiles && renderBoneyardStack(
        boneyardCount,
        surfaceSize.width,
        surfaceSize.height,
        layout.tileWidth,
        layout.tileHeight,
      )}

      {shouldRenderPlayedBoardTiles && animSprite && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.boneyardTileSlot,
            {
              position: 'absolute',
              left: animSprite.left,
              top: animSprite.top,
              width: animSprite.width,
              height: animSprite.height,
              zIndex: 200,
              transform: [
                { translateX: animTranslateX },
                { translateY: animTranslateY },
                { scale: animScale },
              ],
              opacity: animOpacity,
            },
          ]}
        >
          <DominoTile
            tile={HIDDEN_BONEYARD_TILE}
            width={animSprite.height}
            height={animSprite.width}
            rotation={90}
          />
        </Animated.View>
      )}

      <Animated.View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSurfaceSize({ width, height });
        }}
        style={[
          styles.boardSurface,
          { transform: [{ translateX: boardShakeTranslateX }] },
        ]}
      >
        {shouldRenderPlayedBoardTiles && (
          <>
            <Animated.View
              style={[
                styles.boardTilesLayer,
                { transform: [{ scale: boardTilesScale }] },
              ]}
            >
              <View
                pointerEvents="none"
                style={[
                  styles.centerTileWrap,
                  {
                    width: layout.centerWidth,
                    height: layout.centerHeight,
                    marginLeft: -layout.centerWidth / 2,
                    marginTop: -layout.centerHeight / 2,
                    opacity: finalTileInfo?.isCenter ? 0 : 1,
                  },
                ]}
              >
                {board.centerTile && (
                  <DominoTile
                    tile={board.centerTile}
                    width={layout.tileWidth}
                    height={layout.tileHeight}
                    rotation={board.centerTile.left === board.centerTile.right ? 0 : 90}
                  />
                )}
              </View>

              {finalTileInfo?.isCenter && board.centerTile && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.centerTileWrap,
                    {
                      width: layout.centerWidth,
                      height: layout.centerHeight,
                      marginLeft: -layout.centerWidth / 2,
                      marginTop: -layout.centerHeight / 2,
                      zIndex: 220,
                      transform: [
                        { translateX: finalTileTranslateX },
                        { translateY: finalTileTranslateY },
                        { scale: finalTileScale },
                      ],
                    },
                  ]}
                >
                  <DominoTile
                    tile={board.centerTile}
                    width={layout.tileWidth}
                    height={layout.tileHeight}
                    rotation={board.centerTile.left === board.centerTile.right ? 0 : 90}
                  />
                </Animated.View>
              )}

              <BentHorizontalPathBranch
                branch="left"
                tiles={board.branches.left.tiles}
                tileWidth={layout.tileWidth}
                tileHeight={layout.tileHeight}
                centerWidth={layout.centerWidth}
                boardWidth={surfaceSize.width}
                boardHeight={surfaceSize.height}
                hiddenTileId={finalTileAnimationTileId}
                animatedTileId={finalTileAnimationTileId}
                animatedStyle={{
                  zIndex: 220,
                  opacity: 1,
                  transform: [
                    { translateX: finalTileTranslateX },
                    { translateY: finalTileTranslateY },
                    { scale: finalTileScale },
                  ],
                }}
              />

              <BentHorizontalPathBranch
                branch="right"
                tiles={board.branches.right.tiles}
                tileWidth={layout.tileWidth}
                tileHeight={layout.tileHeight}
                centerWidth={layout.centerWidth}
                boardWidth={surfaceSize.width}
                boardHeight={surfaceSize.height}
                hiddenTileId={finalTileAnimationTileId}
                animatedTileId={finalTileAnimationTileId}
                animatedStyle={{
                  zIndex: 220,
                  opacity: 1,
                  transform: [
                    { translateX: finalTileTranslateX },
                    { translateY: finalTileTranslateY },
                    { scale: finalTileScale },
                  ],
                }}
              />

              <BentVerticalPathBranch
                branch="up"
                tiles={board.branches.up.tiles}
                tileWidth={layout.tileWidth}
                tileHeight={layout.tileHeight}
                centerHeight={layout.centerHeight}
                boardHeight={surfaceSize.height}
                hiddenTileId={finalTileAnimationTileId}
                animatedTileId={finalTileAnimationTileId}
                animatedStyle={{
                  zIndex: 220,
                  opacity: 1,
                  transform: [
                    { translateX: finalTileTranslateX },
                    { translateY: finalTileTranslateY },
                    { scale: finalTileScale },
                  ],
                }}
              />

              <BentVerticalPathBranch
                branch="down"
                tiles={board.branches.down.tiles}
                tileWidth={layout.tileWidth}
                tileHeight={layout.tileHeight}
                centerHeight={layout.centerHeight}
                boardHeight={surfaceSize.height}
                hiddenTileId={finalTileAnimationTileId}
                animatedTileId={finalTileAnimationTileId}
                animatedStyle={{
                  zIndex: 220,
                  opacity: 1,
                  transform: [
                    { translateX: finalTileTranslateX },
                    { translateY: finalTileTranslateY },
                    { scale: finalTileScale },
                  ],
                }}
              />
            </Animated.View>

            <BranchDropZone
              branch="up"
              active={selectableBranches.includes('up')}
              onPress={onSelectBranch}
            />

            <BranchDropZone
              branch="right"
              active={selectableBranches.includes('right')}
              onPress={onSelectBranch}
            />

            <BranchDropZone
              branch="down"
              active={selectableBranches.includes('down')}
              onPress={onSelectBranch}
            />

            <BranchDropZone
              branch="left"
              active={selectableBranches.includes('left')}
              onPress={onSelectBranch}
            />
          </>
        )}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  boardSurface: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'visible',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },

  boardTilesLayer: {
    ...StyleSheet.absoluteFillObject,
    transformOrigin: 'center',
  },

  centerTileWrap: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },

  pathTileSlot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  dropZone: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#facc15',
    backgroundColor: 'rgba(250, 204, 21, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 80,
  },

  dropZoneUp: {
    top: '22%',
    alignSelf: 'center',
  },

  dropZoneRight: {
    right: '28%',
    top: '50%',
    transform: [{ translateY: -22 }],
  },

  dropZoneDown: {
    bottom: '22%',
    alignSelf: 'center',
  },

  dropZoneLeft: {
    left: '28%',
    top: '50%',
    transform: [{ translateY: -22 }],
  },

  dropZoneText: {
    color: '#facc15',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 26,
  },

  boneyardStackWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 10,
  },

  boneyardTileSlot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  boneyardTile: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: '#0f1f13',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },

  scoreBadge: {
    position: 'absolute',
    top: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#facc15',
    zIndex: 90,
  },

  scoreBadgeText: {
    fontWeight: '800',
    color: '#111827',
  },
});
