import DominoTile, { DominoTileDirection } from '@/components/game/DominoTile';
import {
  BOARD_EDGE_PADDING,
  BoardTile,
  TILE_GAP,
  getSnapValue,
  getStraightSegmentCount,
  getTileSlotSize,
} from '@/components/game/boardPathLayout';
import { createPlacedTile, isDouble } from '@/lib/game/kozel-engine';
import { DominoTileData, GameState, KozelBranch } from '@/types/game';
import { createContext, useContext, useEffect } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

type WinningTileAnimationContextValue = {
  tileId: string | null;
  translateY: Animated.Value;
  scale: Animated.Value;
  emphasisOpacity: Animated.Value;
};

const WinningTileAnimationContext =
  createContext<WinningTileAnimationContextValue | null>(null);

function BranchTile({
  tile,
  x,
  y,
  tileWidth,
  tileHeight,
  direction,
  zIndex = 20,
}: {
  tile: BoardTile;
  x: number;
  y: number;
  tileWidth: number;
  tileHeight: number;
  direction: DominoTileDirection;
  zIndex?: number;
}) {
  const winningAnimation = useContext(WinningTileAnimationContext);
  const isPlacementPreview = '__placementPreview' in tile;
  const previewBranch = (tile as BoardTile & {
    __previewBranch?: KozelBranch;
    __onPreviewPress?: (branch: KozelBranch) => void;
  }).__previewBranch;
  const { slotWidth, slotHeight } = getTileSlotSize(
    tile,
    direction,
    tileWidth,
    tileHeight,
  );

  useEffect(() => {
    if (winningAnimation?.tileId === tile.id) {
      console.log('[winning tile beat] board tile found', { tileId: tile.id });
    }
  }, [tile.id, winningAnimation?.tileId]);

  return (
    <Pressable
      pointerEvents={isPlacementPreview ? 'auto' : 'none'}
      onPress={
        isPlacementPreview && previewBranch
          ? () => (tile as any).__onPreviewPress?.(previewBranch)
          : undefined
      }
      style={[
        styles.pathTileSlot,
        isPlacementPreview && styles.placementPreview,
        {
          width: slotWidth,
          height: slotHeight,
          left: '50%',
          top: '50%',
          marginLeft: x - slotWidth / 2,
          marginTop: y - slotHeight / 2,
          zIndex,
        },
      ]}
    >
      <DominoTile
        tile={tile}
        width={tileWidth}
        height={tileHeight}
        direction={direction}
      />
      {winningAnimation?.tileId === tile.id && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.winningTileOverlay,
            {
              width: slotWidth,
              height: slotHeight,
              opacity: winningAnimation.emphasisOpacity,
              transform: [
                { translateY: winningAnimation.translateY },
                { scale: winningAnimation.scale },
              ],
            },
          ]}
        >
          <DominoTile
            tile={tile}
            width={tileWidth}
            height={tileHeight}
            direction={direction}
          />
        </Animated.View>
      )}
    </Pressable>
  );
}

function buildBranchPlacementPreview(
  branch: KozelBranch,
  tile: DominoTileData,
  board: GameState['board'],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  centerHeight: number,
  boardWidth: number,
  boardHeight: number,
  onPress?: (branch: KozelBranch) => void,
) {
const openValue = board.branches[branch].openValue;

if (openValue === null) {
  return null;
}

const previewTile = {
  ...createPlacedTile(
    tile,
    branch,
    openValue,
    board.branches[branch].tiles.length,
  ),
  __placementPreview: true,
  __previewBranch: branch,
  __onPreviewPress: onPress,
} as unknown as BoardTile;
  const previewTiles = [...board.branches[branch].tiles, previewTile];
  const path = branch === 'left' || branch === 'right'
    ? buildHorizontalBranchPath(
        branch,
        previewTiles,
        tileWidth,
        tileHeight,
        centerWidth,
        boardWidth,
        boardHeight,
      )
    : buildVerticalBranchPath(
        branch,
        previewTiles,
        tileWidth,
        tileHeight,
        centerHeight,
        boardWidth,
        boardHeight,
      );

  return Array.isArray(path) ? path[path.length - 1] : null;
}

function buildHorizontalBranchPath(
  branch: 'left' | 'right',
  tiles: BoardTile[],
  tileWidth: number,
  tileHeight: number,
  centerWidth: number,
  boardWidth: number,
  boardHeight: number,
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
        x={isDouble(tile) ? x - tileWidth / 4 : x}
        y={y}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={verticalBendDirection}
        zIndex={20 + straightTiles.length + index}
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
  boardWidth: number,
  boardHeight: number,
) {
  if (!tiles.length) return null;

  const primaryDirection: DominoTileDirection = branch;
  const branchDirection = branch === 'down' ? 1 : -1;
  const turnDirection = branch === 'down' ? -1 : 1;
  const horizontalBendDirection: DominoTileDirection =
    turnDirection === 1 ? 'right' : 'left';

  const verticalSafetySpace = tileWidth + TILE_GAP * 2;

  const availableSpace = Math.max(
    0,
    boardHeight / 2 -
      centerHeight / 2 -
      BOARD_EDGE_PADDING -
      verticalSafetySpace,
  );

  const measuredStraightCount = getStraightSegmentCount(
    tiles,
    availableSpace,
    tileWidth,
    tileHeight,
    primaryDirection,
  );

  let straightCount = Math.min(measuredStraightCount, 1);

  for (let index = straightCount; index < measuredStraightCount; index += 1) {
    if (!isDouble(tiles[index])) break;
    straightCount += 1;
  }

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

  const verticalColumnSlotWidth =
    verticalTiles.length > 0
      ? getTileSlotSize(
          verticalTiles[verticalTiles.length - 1],
          primaryDirection,
          tileWidth,
          tileHeight,
        ).slotWidth
      : tileWidth;

  const maxHorizontalSpace = Math.max(
    0,
    boardWidth / 2 - BOARD_EDGE_PADDING - verticalColumnSlotWidth / 2,
  );
  let lastX: number | null = null;
  let lastY: number | null = null;
  let lastSlotWidth = 0;
  let horizontalOffset = 0;

  bentTiles.forEach((tile, index) => {
    const tileIsDouble = isDouble(tile);

    const renderDirection: DominoTileDirection = tileIsDouble
      ? primaryDirection
      : horizontalBendDirection;

    const { slotWidth, slotHeight } = getTileSlotSize(
      tile,
      renderDirection,
      tileWidth,
      tileHeight,
    );

    let x: number;
    let y: number;

    if (index === 0 && tileIsDouble) {
      x = 0;

      y = getSnapValue(
        connectionY +
          branchDirection * (slotHeight / 2 + TILE_GAP),
      );
    } else if (lastX !== null && lastY !== null) {
      const nextOffset = horizontalOffset + lastSlotWidth / 2 + TILE_GAP + slotWidth / 2;
      x = getSnapValue(
        nextOffset <= maxHorizontalSpace
          ? lastX + turnDirection * (lastSlotWidth / 2 + TILE_GAP + slotWidth / 2)
          : lastX,
      );

      y =
        nextOffset <= maxHorizontalSpace
          ? lastY
          : getSnapValue(lastY + branchDirection * (tileHeight + TILE_GAP));
      horizontalOffset = nextOffset <= maxHorizontalSpace ? nextOffset : 0;
    } else {
horizontalOffset = slotWidth / 2 - TILE_GAP * 6;

x = getSnapValue(
  turnDirection * horizontalOffset,
);

y = getSnapValue(
  connectionY + branchDirection * (slotHeight / 2),
);
    }

    positions.push(
      <BranchTile
        key={`${branch}-bend-${tile.order}-${tile.id}`}
        tile={tile}
        x={x}
        y={y}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        direction={renderDirection}
        zIndex={20 + verticalTiles.length + index}
      />,
    );

    lastX = x;
    lastY = y;
    lastSlotWidth = slotWidth;
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
}: {
  branch: 'left' | 'right';
  tiles: BoardTile[];
  tileWidth: number;
  tileHeight: number;
  centerWidth: number;
  boardWidth: number;
  boardHeight: number;
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
  boardWidth,
  boardHeight,
}: {
  branch: 'up' | 'down';
  tiles: BoardTile[];
  tileWidth: number;
  tileHeight: number;
  centerHeight: number;
  boardWidth: number;
  boardHeight: number;
}) {
  return (
    <>
      {buildVerticalBranchPath(
        branch,
        tiles,
        tileWidth,
        tileHeight,
        centerHeight,
        boardWidth,
        boardHeight,
      )}
    </>
  );
}

type Props = {
  board: GameState['board'];
  selectedTile: DominoTileData | null;
  selectableBranches: KozelBranch[];
  onSelectBranch?: (branch: KozelBranch) => void;
  tileWidth: number;
  tileHeight: number;
  centerWidth: number;
  centerHeight: number;
  boardWidth: number;
  boardHeight: number;
  winningTileId: string | null;
  winningTranslateY: Animated.Value;
  winningScale: Animated.Value;
  winningEmphasisOpacity: Animated.Value;
};

export default function BoardPathRenderer({
  board,
  selectedTile,
  selectableBranches,
  onSelectBranch,
  tileWidth,
  tileHeight,
  centerWidth,
  centerHeight,
  boardWidth,
  boardHeight,
  winningTileId,
  winningTranslateY,
  winningScale,
  winningEmphasisOpacity,
}: Props) {
  return (
    <WinningTileAnimationContext.Provider
      value={{
        tileId: winningTileId,
        translateY: winningTranslateY,
        scale: winningScale,
        emphasisOpacity: winningEmphasisOpacity,
      }}
    >
      <BentHorizontalPathBranch
        branch="left"
        tiles={board.branches.left.tiles}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        centerWidth={centerWidth}
        boardWidth={boardWidth}
        boardHeight={boardHeight}
      />

      <BentHorizontalPathBranch
        branch="right"
        tiles={board.branches.right.tiles}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        centerWidth={centerWidth}
        boardWidth={boardWidth}
        boardHeight={boardHeight}
      />

      <BentVerticalPathBranch
        branch="up"
        tiles={board.branches.up.tiles}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        centerHeight={centerHeight}
        boardWidth={boardWidth}
        boardHeight={boardHeight}
      />

      <BentVerticalPathBranch
        branch="down"
        tiles={board.branches.down.tiles}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        centerHeight={centerHeight}
        boardWidth={boardWidth}
        boardHeight={boardHeight}
      />

      {selectedTile && selectableBranches.map((branch) =>
          buildBranchPlacementPreview(
            branch,
            selectedTile,
            board,
            tileWidth,
            tileHeight,
            centerWidth,
            centerHeight,
            boardWidth,
            boardHeight,
            onSelectBranch,
          ),
      )}
    </WinningTileAnimationContext.Provider>
  );
}

const styles = StyleSheet.create({
  pathTileSlot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placementPreview: {
    opacity: 0.5,
    zIndex: 80,
  },
  winningTileOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    elevation: 14,
    borderWidth: 3,
    borderColor: '#f6c945',
    borderRadius: 7,
    backgroundColor: 'rgba(246,201,69,0.18)',
    shadowColor: '#f6c945',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
