import BoardBoneyard from "@/components/game/BoardBoneyard";
import BoardPathRenderer from "@/components/game/BoardPathRenderer";
import DominoTile from "@/components/game/DominoTile";
import {
  BOARD_EDGE_PADDING,
  calculateBoardTileBounds,
  estimateHorizontalWidth,
  estimateVerticalHeight,
  getBoardTilesZoomScale,
} from "@/components/game/boardPathLayout";
import { GameState, KozelBranch, Player } from "@/types/game";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Props = {
  board: GameState["board"];
  players: Player[];
  lastScoringEvent: GameState["lastScoringEvent"];
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

function getCenterTileRotation(
  tile: GameState["board"]["centerTile"],
): 0 | 90 | 270 {
  if (!tile || tile.left === tile.right) return 0;

  // Domino artwork is stored low-pip first (top-to-bottom). Rotate it so the
  // board state's logical `left` value is always visibly on the left.
  return tile.left < tile.right ? 270 : 90;
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
        branch === "up" && styles.dropZoneUp,
        branch === "right" && styles.dropZoneRight,
        branch === "down" && styles.dropZoneDown,
        branch === "left" && styles.dropZoneLeft,
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
    players,
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
  const [surfaceSize, setSurfaceSize] = useState({ width: 1200, height: 700 });
  const animOpacity = useRef(new Animated.Value(1)).current;
  const animScale = useRef(new Animated.Value(1)).current;
  const animTranslateX = useRef(new Animated.Value(0)).current;
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const finalTileScale = useRef(new Animated.Value(1)).current;
  const finalTileTranslateX = useRef(new Animated.Value(0)).current;
  const finalTileTranslateY = useRef(new Animated.Value(0)).current;
  const finalTileEmphasisOpacity = useRef(new Animated.Value(1)).current;
  const boardShake = useRef(new Animated.Value(0)).current;
  const lastCompletedFinalTileIdRef = useRef<string | null>(null);
  const [animSprite, setAnimSprite] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
  }>(null);

  const isCenterFinalTile = board.centerTile?.id === finalTileAnimationTileId;
  const centerTileRotation = getCenterTileRotation(board.centerTile);
  const scoreBadgePosition = useMemo(() => {
    const scoringPlayer = players.find(
      (player) => player.id === lastScoringEvent?.playerId,
    );

    switch (scoringPlayer?.seat) {
      case "bottom":
        return styles.scoreBadgeBottom;
      case "left":
        return styles.scoreBadgeLeft;
      case "right":
        return styles.scoreBadgeRight;
      case "top":
      default:
        return styles.scoreBadgeTop;
    }
  }, [lastScoringEvent?.playerId, players]);

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
    const rawScale = Math.min(
      Math.max(120, boardWidth / 2 - BASE_TILE_HEIGHT) /
        Math.max(horizontalNeed, 1),
      Math.max(90, boardHeight / 2 - BASE_TILE_HEIGHT) /
        Math.max(verticalNeed, 1),
    );
    const scale =
      rawScale < 0.72
        ? BOARD_SCALE_SMALL
        : rawScale < 0.9
          ? BOARD_SCALE_MEDIUM
          : BOARD_SCALE_FULL;
    const tileWidth = Math.round(BASE_TILE_WIDTH * scale);
    const tileHeight = Math.round(BASE_TILE_HEIGHT * scale);
    // Non-double center tiles render rotated horizontally, so branches must
    // start outside their visual footprint rather than the unrotated slot.
    const centerIsDouble = board.centerTile?.left === board.centerTile?.right;

    return {
      tileWidth,
      tileHeight,
      centerWidth: centerIsDouble ? tileWidth : tileHeight,
      centerHeight: centerIsDouble ? tileHeight : tileWidth,
    };
  }, [board, surfaceSize]);

  const boardTilesScale = useMemo(
    () =>
      getBoardTilesZoomScale(
        calculateBoardTileBounds(
          board,
          layout.tileWidth,
          layout.tileHeight,
          layout.centerWidth,
          layout.centerHeight,
          surfaceSize.width,
          surfaceSize.height,
        ),
        surfaceSize.width,
        surfaceSize.height,
      ),
    [board, layout, surfaceSize],
  );

  useImperativeHandle(ref, () => ({
    animateDraw: () =>
      new Promise<void>((resolve) => {
        const count = boneyardCount;
        if (count <= 0 || surfaceSize.height <= 0) return resolve();
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
        const startTopForIndex =
          startTop + Math.max(0, count - 1) * (displayHeight + spacing);
        animOpacity.setValue(1);
        animScale.setValue(1);
        animTranslateX.setValue(0);
        animTranslateY.setValue(0);
        setAnimSprite({
          left: -displayWidth - 12,
          top: startTopForIndex,
          width: displayWidth,
          height: displayHeight,
        });
        Animated.parallel([
          Animated.timing(animTranslateX, {
            toValue: displayWidth + 60,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(animTranslateY, {
            toValue: Math.round(surfaceSize.height / 2) - startTopForIndex + 40,
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
      }),
  }));

  useEffect(() => {
    if (!finalTileAnimationTileId) {
      lastCompletedFinalTileIdRef.current = null;
      return;
    }
    if (lastCompletedFinalTileIdRef.current === finalTileAnimationTileId)
      return;
    lastCompletedFinalTileIdRef.current = finalTileAnimationTileId;
    finalTileScale.setValue(2.45);
    finalTileTranslateX.setValue(0);
    finalTileTranslateY.setValue(-92);
    finalTileEmphasisOpacity.setValue(1);
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
    ]).start(() => onFinalTileAnimationComplete?.());
  }, [
    boardShake,
    finalTileAnimationTileId,
    finalTileEmphasisOpacity,
    finalTileScale,
    finalTileTranslateX,
    finalTileTranslateY,
    onFinalTileAnimationComplete,
  ]);

  const boardShakeTranslateX = boardShake.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-3, 0, 3],
  });
  const finalTileTransform = [
    { translateX: finalTileTranslateX },
    { translateY: finalTileTranslateY },
    { scale: finalTileScale },
  ];

  return (
    <View style={styles.container}>
      {shouldRenderPlayedBoardTiles && lastScoringEvent && (
        <View style={[styles.scoreBadge, scoreBadgePosition]}>
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
        onLayout={(e) => setSurfaceSize(e.nativeEvent.layout)}
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
                    opacity: isCenterFinalTile ? 0 : 1,
                  },
                ]}
              >
                {board.centerTile && (
                  <DominoTile
                    tile={board.centerTile}
                    width={layout.tileWidth}
                    height={layout.tileHeight}
                    rotation={centerTileRotation}
                  />
                )}
              </View>
              {isCenterFinalTile && board.centerTile && (
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
                      transform: finalTileTransform,
                    },
                  ]}
                >
                  <DominoTile
                    tile={board.centerTile}
                    width={layout.tileWidth}
                    height={layout.tileHeight}
                    rotation={centerTileRotation}
                  />
                </Animated.View>
              )}
              <BoardPathRenderer
                board={board}
                selectedTile={null}
                selectableBranches={[]}
                tileWidth={layout.tileWidth}
                tileHeight={layout.tileHeight}
                centerWidth={layout.centerWidth}
                centerHeight={layout.centerHeight}
                boardWidth={surfaceSize.width}
                boardHeight={surfaceSize.height}
                winningTileId={
                  isCenterFinalTile ? null : finalTileAnimationTileId
                }
                winningTranslateY={finalTileTranslateY}
                winningScale={finalTileScale}
                winningEmphasisOpacity={finalTileEmphasisOpacity}
              />
            </Animated.View>
            {(["up", "right", "down", "left"] as KozelBranch[]).map(
              (branch) => (
                <BranchDropZone
                  key={branch}
                  branch={branch}
                  active={selectableBranches.includes(branch)}
                  onPress={onSelectBranch}
                />
              ),
            )}
          </>
        )}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  boardSurface: {
    flex: 1,
    width: "100%",
    height: "100%",
    overflow: "visible",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  boardTilesLayer: {
    ...StyleSheet.absoluteFillObject,
    transformOrigin: "center",
  },
  centerTileWrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
  },
  dropZone: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: "#facc15",
    backgroundColor: "rgba(250, 204, 21, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 80,
  },
  dropZoneUp: { top: "22%", alignSelf: "center" },
  dropZoneRight: { right: "28%", top: "50%", transform: [{ translateY: -22 }] },
  dropZoneDown: { bottom: "22%", alignSelf: "center" },
  dropZoneLeft: { left: "28%", top: "50%", transform: [{ translateY: -22 }] },
  dropZoneText: {
    color: "#facc15",
    fontSize: 24,
    fontFamily: "SpedaBold",
    lineHeight: 26,
  },
  scoreBadge: {
    position: "absolute",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#facc15",
    zIndex: 90,
  },
  scoreBadgeTop: { top: 4, alignSelf: "center" },
  scoreBadgeBottom: { bottom: 4, alignSelf: "center" },
  scoreBadgeLeft: { left: 4, top: "50%", transform: [{ translateY: -14 }] },
  scoreBadgeRight: { right: 4, top: "50%", transform: [{ translateY: -14 }] },
  scoreBadgeText: { fontFamily: "SpedaBold", color: "#111827" },
});
