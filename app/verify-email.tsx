import BoardBoneyard from '@/components/game/BoardBoneyard';
import BoardPathRenderer from '@/components/game/BoardPathRenderer';
import DominoTile from '@/components/game/DominoTile';
import {
  BOARD_EDGE_PADDING,
  estimateHorizontalWidth,
  estimateVerticalHeight,
} from '@/components/game/boardPathLayout';
import { DominoTileData, GameState, KozelBranch } from '@/types/game';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Text, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

type Props = {
  board: GameState['board'];
  lastScoringEvent: GameState['lastScoringEvent'];
  roundWinnerPlayerId?: string | null;
  selectedTile?: DominoTileData | null;
  selectableBranches?: KozelBranch[];
  onSelectBranch?: (branch: KozelBranch) => void;
  boneyardCount: number;
  shouldRenderPlayedBoardTiles?: boolean;
  showScoreBadge?: boolean;
  winningTileId?: string | null;
  winningTileAnimationKey?: string | null;
  onWinningTileAnimationComplete?: (animationKey: string) => void;
};

const BASE_TILE_WIDTH = 46;
const BASE_TILE_HEIGHT = 75;

const BOARD_SCALE_FULL = 1.2;
const BOARD_SCALE_MEDIUM = 0.78;
const BOARD_SCALE_SMALL = 0.58;
const TABLET_TOP_SAFE_INSET = 64;

export default forwardRef(function BoardArea(
  {
    board,
    lastScoringEvent,
    selectedTile = null,
    selectableBranches = [],
    onSelectBranch,
    boneyardCount,
    shouldRenderPlayedBoardTiles = true,
    showScoreBadge = true,
    winningTileId = null,
    winningTileAnimationKey = null,
    onWinningTileAnimationComplete,
  }: Props,
  ref,
) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const topSafeInset =
    Math.min(windowWidth, windowHeight) >= 600
      ? TABLET_TOP_SAFE_INSET
      : 0;
  const [surfaceSize, setSurfaceSize] = useState({
    width: 1200,
    height: 700,
  });

  const animOpacity = useRef(new Animated.Value(1)).current;
  const animScale = useRef(new Animated.Value(1)).current;
  const animTranslateX = useRef(new Animated.Value(0)).current;
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const winningTranslateY = useRef(new Animated.Value(0)).current;
  const winningScale = useRef(new Animated.Value(1)).current;
  const winningEmphasisOpacity = useRef(new Animated.Value(0)).current;
  const winningAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const animatedWinningTileIdRef = useRef<string | null>(null);

  const [animSprite, setAnimSprite] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
  }>(null);

  useEffect(() => {
    if (
      !winningTileId ||
      !winningTileAnimationKey ||
      animatedWinningTileIdRef.current === winningTileAnimationKey
    ) return;

    animatedWinningTileIdRef.current = winningTileAnimationKey;
    console.log('[winning tile beat] animation starts', {
      tileId: winningTileId,
      animationKey: winningTileAnimationKey,
    });
    winningAnimationRef.current?.stop();
    winningTranslateY.setValue(-28);
    winningScale.setValue(1.12);
    winningEmphasisOpacity.setValue(1);

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(winningTranslateY, {
          toValue: 4,
          duration: 300,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(winningScale, {
          toValue: 0.96,
          duration: 300,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(winningTranslateY, {
          toValue: 0,
          duration: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(winningScale, {
          toValue: 1,
          duration: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(winningEmphasisOpacity, {
        toValue: 0,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    winningAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (winningAnimationRef.current === animation) {
        winningAnimationRef.current = null;
      }
      if (finished) {
        console.log('[winning tile beat] animation completes', {
          tileId: winningTileId,
          animationKey: winningTileAnimationKey,
        });
        onWinningTileAnimationComplete?.(winningTileAnimationKey);
      }
    });

    return () => animation.stop();
  }, [
    onWinningTileAnimationComplete,
    winningEmphasisOpacity,
    winningScale,
    winningTileAnimationKey,
    winningTileId,
    winningTranslateY,
  ]);


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

const centerIsDouble =
  board.centerTile?.left === board.centerTile?.right;

const centerWidth = board.centerTile
  ? centerIsDouble
    ? tileWidth
    : tileHeight
  : tileWidth;

const centerHeight = board.centerTile
  ? centerIsDouble
    ? tileHeight
    : tileWidth
  : tileHeight;

return {
  tileWidth,
  tileHeight,
  centerWidth,
  centerHeight,
};

  }, [board, surfaceSize]);

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

  return (
    <View style={styles.container}>
      {showScoreBadge && shouldRenderPlayedBoardTiles && lastScoringEvent && (
        <View style={styles.scoreBadge}>
          <Text style={styles.scoreBadgeText}>+{lastScoringEvent.points}</Text>
        </View>
      )}

      {shouldRenderPlayedBoardTiles && (
        <BoardBoneyard
          count={boneyardCount}
          boardWidth={surfaceSize.width}
          boardHeight={surfaceSize.height}
          tileWidth={layout.tileWidth}
          tileHeight={layout.tileHeight}
          animatedSprite={animSprite}
          animOpacity={animOpacity}
          animScale={animScale}
          animTranslateX={animTranslateX}
          animTranslateY={animTranslateY}
        />
      )}

      <Animated.View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSurfaceSize({ width, height });
        }}
        style={styles.boardSurface}
      >
        {shouldRenderPlayedBoardTiles && (
          <Animated.View
            style={[
              styles.boardTilesLayer,
              topSafeInset > 0 && { top: topSafeInset },
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
                },
              ]}
            >
              {board.centerTile && (
                <DominoTile
                  tile={board.centerTile}
                  width={layout.tileWidth}
                  height={layout.tileHeight}
                  rotation={
  board.centerTile.left === board.centerTile.right
    ? 0
    : board.centerTile.left <= board.centerTile.right
      ? 270
      : 90
}
                />
              )}
            </View>

            <BoardPathRenderer
              board={board}
              selectedTile={selectedTile}
              selectableBranches={selectableBranches}
              onSelectBranch={onSelectBranch}
              tileWidth={layout.tileWidth}
              tileHeight={layout.tileHeight}
              centerWidth={layout.centerWidth}
              centerHeight={layout.centerHeight}
              boardWidth={surfaceSize.width}
              boardHeight={Math.max(0, surfaceSize.height - topSafeInset)}
              winningTileId={winningTileId}
              winningTranslateY={winningTranslateY}
              winningScale={winningScale}
              winningEmphasisOpacity={winningEmphasisOpacity}
            />
          </Animated.View>
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
  minWidth: 54,
  height: 24,
  paddingHorizontal: 12,
  borderRadius: 8,
  backgroundColor: 'rgba(4, 18, 31, 0.96)',
  borderWidth: 1,
  borderColor: 'rgba(20, 241, 193, 0.35)',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 300,
  elevation: 300,
},

scoreBadgeText: {
  color: '#14f1c1',
  fontFamily: 'Speda-Bold',
},

});

