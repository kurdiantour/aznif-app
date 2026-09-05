import BoardBoneyard from "@/components/game/BoardBoneyard";
import DominoBoard, { getDominoBoardPreviewTargets, getDominoBoardTileMetrics, getDominoBoardTileTarget } from "@/components/game/DominoBoard";
import { DominoTileData, GameState, KozelBranch, Player } from "@/domino/types/domino-game";
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
  StyleSheet,
  Text,
  View,
} from "react-native";

type Props = {
  board: GameState["board"];
  players: Player[];
  lastScoringEvent: GameState["lastScoringEvent"];
  lastPlayedTile?: DominoTileData | null;
  roundWinnerPlayerId?: string | null;
  selectedTile?: DominoTileData | null;
  selectableBranches?: KozelBranch[];
  onSelectBranch?: (branch: KozelBranch) => void;
  boneyardCount: number;
  shouldRenderPlayedBoardTiles?: boolean;
  finalTileAnimationTileId?: string | null;
  onFinalTileAnimationComplete?: () => void;
  hiddenTileId?: string | null;
};

const BOARD_BOUNDARY: {
  edgePadding: number;
  safeHorizontalPadding: number;
  safeVerticalPadding: number;
  outerHorizontalInset: number;
  outerVerticalInset: number;
} = {
  edgePadding: 12,
  safeHorizontalPadding: 28,
  safeVerticalPadding: 22,
  outerHorizontalInset: 40,
  outerVerticalInset: 10,
};

export default forwardRef(function BoardArea(
  {
    board,
    players,
    lastScoringEvent,
    lastPlayedTile = null,
    selectedTile = null,
    selectableBranches = [],
    onSelectBranch,
    boneyardCount,
    shouldRenderPlayedBoardTiles = true,
    finalTileAnimationTileId = null,
    onFinalTileAnimationComplete,
    hiddenTileId = null,
  }: Props,
  ref,
) {
  const [surfaceSize, setSurfaceSize] = useState({ width: 1200, height: 700 });
  const boardSurfaceRef = useRef<View | null>(null);
  const animOpacity = useRef(new Animated.Value(1)).current;
  const animScale = useRef(new Animated.Value(1)).current;
  const animTranslateX = useRef(new Animated.Value(0)).current;
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const finalTileScale = useRef(new Animated.Value(1)).current;
  const finalTileTranslateX = useRef(new Animated.Value(0)).current;
  const finalTileTranslateY = useRef(new Animated.Value(0)).current;
  const finalTileCenterProgress = useRef(new Animated.Value(0)).current;
  const finalTileRotation = useRef(new Animated.Value(0)).current;
  const finalTileEmphasisOpacity = useRef(new Animated.Value(1)).current;
  const aznifOpacity = useRef(new Animated.Value(0)).current;
  const aznifScale = useRef(new Animated.Value(0.35)).current;
  const boardShake = useRef(new Animated.Value(0)).current;
  const lastCompletedFinalTileIdRef = useRef<string | null>(null);
  const [animSprite, setAnimSprite] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
  }>(null);
  const [visibleScoreEventKey, setVisibleScoreEventKey] = useState<string | null>(
    null,
  );

  // A room snapshot can be received more than once (for example from both the
  // action response and Realtime).  Treat the score badge as a brief UI event,
  // keyed by the tile that earned it, instead of permanently rendering it from
  // the latest snapshot.
  const scoreEventKey = lastScoringEvent
    ? `${lastScoringEvent.playerId}:${lastScoringEvent.points}:${lastPlayedTile?.id ?? ""}`
    : null;

  useEffect(() => {
    if (!scoreEventKey) {
      setVisibleScoreEventKey(null);
      return;
    }

    setVisibleScoreEventKey(scoreEventKey);
    const timer = setTimeout(() => setVisibleScoreEventKey(null), 1600);
    return () => clearTimeout(timer);
  }, [scoreEventKey]);

  const isCenterFinalTile = board.centerTile?.id === finalTileAnimationTileId;
  const shouldShowAznif = !!finalTileAnimationTileId;

  useEffect(() => {
    aznifOpacity.stopAnimation();
    aznifScale.stopAnimation();
    aznifOpacity.setValue(0);
    aznifScale.setValue(0.35);
    if (!shouldShowAznif) return;

    const animation = Animated.sequence([
      Animated.delay(280),
      Animated.parallel([
        Animated.timing(aznifOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(aznifScale, {
          toValue: 1,
          speed: 14,
          bounciness: 10,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(3000),
      Animated.timing(aznifOpacity, {
        toValue: 0,
        duration: 320,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [aznifOpacity, aznifScale, shouldShowAznif]);

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
  const tileMetrics = useMemo(
    () => getDominoBoardTileMetrics(board, surfaceSize.width, surfaceSize.height),
    [board, surfaceSize],
  );
  useImperativeHandle(ref, () => ({
    getDealOrigin: () =>
      new Promise<{ x: number; y: number } | null>((resolve) => {
        if (!boardSurfaceRef.current) return resolve(null);
        boardSurfaceRef.current.measureInWindow((x, y, width, height) => {
          resolve({ x: x + width / 2, y: y + height / 2 });
        });
      }),
    getPreviewRect: (tile: DominoTileData, branch: KozelBranch) =>
      new Promise<{ x: number; y: number; width: number; height: number; rotation?: number } | null>((resolve) => {
        if (!boardSurfaceRef.current) return resolve(null);
        const target = !board.centerTile
          ? { x: 0, y: 0, width: tileMetrics.centerWidth, height: tileMetrics.centerHeight, scale: 1, rotation: tile.left === tile.right ? 0 : tile.left < tile.right ? 270 : 90 }
          : getDominoBoardPreviewTargets(board, tile, [branch], surfaceSize.width, surfaceSize.height, BOARD_BOUNDARY)[0];
        if (!target) return resolve(null);
        boardSurfaceRef.current.measureInWindow((surfaceX, surfaceY) => resolve({
          x: surfaceX + surfaceSize.width / 2 + (target.x - target.width / 2) * target.scale,
          y: surfaceY + surfaceSize.height / 2 + (target.y - target.height / 2) * target.scale,
          width: target.width * target.scale,
          height: target.height * target.scale,
          rotation: target.rotation,
        }));
      }),
    getTileRect: (tileId: string) =>
      new Promise<{ x: number; y: number; width: number; height: number; rotation?: number } | null>((resolve) => {
        if (!boardSurfaceRef.current) return resolve(null);
        const target = getDominoBoardTileTarget(board, tileId, surfaceSize.width, surfaceSize.height, BOARD_BOUNDARY);
        if (!target) return resolve(null);
        boardSurfaceRef.current.measureInWindow((surfaceX, surfaceY) => resolve({
          x: surfaceX + surfaceSize.width / 2 + (target.x - target.width / 2) * target.scale,
          y: surfaceY + surfaceSize.height / 2 + (target.y - target.height / 2) * target.scale,
          width: target.width * target.scale,
          height: target.height * target.scale,
          rotation: target.rotation,
        }));
      }),
    findDropBranch: (
      tile: DominoTileData,
      branches: KozelBranch[],
      point: { x: number; y: number },
    ) =>
      new Promise<KozelBranch | null>((resolve) => {
        // Before the opening tile exists there is no branch tip to target.
        // Any drop on the board starts the chain from the center.
        if (!board.centerTile) {
          if (!boardSurfaceRef.current) return resolve(null);
          boardSurfaceRef.current.measureInWindow((surfaceX, surfaceY, width, height) => {
            const isOnBoard =
              point.x >= surfaceX &&
              point.x <= surfaceX + width &&
              point.y >= surfaceY &&
              point.y <= surfaceY + height;
            resolve(isOnBoard ? (branches[0] ?? null) : null);
          });
          return;
        }

        const targets = getDominoBoardPreviewTargets(
          board,
          tile,
          branches,
          surfaceSize.width,
          surfaceSize.height,
          BOARD_BOUNDARY,
        );
        if (!boardSurfaceRef.current || !targets.length) return resolve(null);
        boardSurfaceRef.current.measureInWindow((surfaceX, surfaceY, width, height) => {
          const isInsideBoard =
            point.x >= surfaceX &&
            point.x <= surfaceX + width &&
            point.y >= surfaceY &&
            point.y <= surfaceY + height;

          if (!isInsideBoard) {
            resolve(null);
            return;
          }

          const rankedTargets = targets
            .map((target) => {
              const centerX = surfaceX + surfaceSize.width / 2 + target.x * target.scale;
              const centerY = surfaceY + surfaceSize.height / 2 + target.y * target.scale;
              // Dropping with a finger is naturally less precise than tapping.
              // Keep the target comfortably larger than the rendered domino.
              const halfWidth = Math.max(44, (target.width * target.scale) / 2 + 18);
              const halfHeight = Math.max(44, (target.height * target.scale) / 2 + 18);
              return {
                branch: target.branch,
                inside: Math.abs(point.x - centerX) <= halfWidth && Math.abs(point.y - centerY) <= halfHeight,
                distance: Math.hypot(point.x - centerX, point.y - centerY),
              };
            })
            .sort((a, b) => {
              // Prefer a directly hit branch. When the user releases elsewhere
              // on the board, fall back to the nearest valid branch.
              if (a.inside !== b.inside) return a.inside ? -1 : 1;
              return a.distance - b.distance;
            });

          resolve(rankedTargets[0]?.branch ?? null);
        });
      }),
    animateDraw: () =>
      new Promise<void>((resolve) => {
        const count = boneyardCount;
        if (count <= 0 || surfaceSize.height <= 0) return resolve();
        const availableVerticalSpace =
          surfaceSize.height - BOARD_BOUNDARY.edgePadding * 2;
        const displayHeight = Math.max(
          18,
          Math.round((tileMetrics.tileHeight || 34) * 0.72),
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
                BOARD_BOUNDARY.edgePadding,
                Math.round((surfaceSize.height - stackHeight) / 2),
              )
            : BOARD_BOUNDARY.edgePadding;
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
    finalTileScale.setValue(1);
    finalTileTranslateX.setValue(0);
    finalTileTranslateY.setValue(0);
    finalTileCenterProgress.setValue(0);
    finalTileRotation.setValue(0);
    finalTileEmphasisOpacity.setValue(1);
    boardShake.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(finalTileScale, { toValue: 1.65, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(finalTileTranslateY, { toValue: -96, duration: 780, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(finalTileRotation, { toValue: 1080, duration: 780, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(finalTileScale, { toValue: 2.05, duration: 780, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(finalTileTranslateY, { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(finalTileScale, { toValue: 1.5, duration: 240, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(190),
          Animated.timing(boardShake, { toValue: 1, duration: 20, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(boardShake, { toValue: -1, duration: 35, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(boardShake, { toValue: 0, duration: 35, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    ]).start(() => onFinalTileAnimationComplete?.());
  }, [
    boardShake,
    finalTileCenterProgress,
    finalTileAnimationTileId,
    finalTileEmphasisOpacity,
    finalTileRotation,
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
    { rotate: finalTileRotation.interpolate({ inputRange: [0, 1080], outputRange: ["0deg", "1080deg"] }) },
    { scale: finalTileScale },
  ];

  return (
    <View style={styles.container}>
      {shouldShowAznif && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.aznifBanner,
            { opacity: aznifOpacity, transform: [{ scale: aznifScale }] },
          ]}
        >
          <Text style={styles.aznifText}>ئەزنیف!</Text>
        </Animated.View>
      )}
      {shouldRenderPlayedBoardTiles &&
        lastScoringEvent &&
        visibleScoreEventKey === scoreEventKey && (
        <View style={[styles.scoreBadge, scoreBadgePosition]}>
          <Text style={styles.scoreBadgeText}>+{lastScoringEvent.points}</Text>
        </View>
      )}
      <Animated.View
        ref={boardSurfaceRef}
        onLayout={(e) => setSurfaceSize(e.nativeEvent.layout)}
        style={[
          styles.boardSurface,
          { transform: [{ translateX: boardShakeTranslateX }] },
        ]}
      >
        {shouldRenderPlayedBoardTiles && (
          <BoardBoneyard
            count={boneyardCount}
            boardWidth={surfaceSize.width}
            boardHeight={surfaceSize.height}
            tileWidth={tileMetrics.tileWidth}
            tileHeight={tileMetrics.tileHeight}
            edgePadding={BOARD_BOUNDARY.edgePadding}
            animatedSprite={animSprite}
            animOpacity={animOpacity}
            animScale={animScale}
            animTranslateX={animTranslateX}
            animTranslateY={animTranslateY}
          />
        )}
        {shouldRenderPlayedBoardTiles && (
          <>
            <DominoBoard
              board={board}
              selectedTile={selectedTile}
              selectableBranches={selectableBranches}
              onSelectBranch={onSelectBranch}
              boardWidth={surfaceSize.width}
              boardHeight={surfaceSize.height}
              boundary={BOARD_BOUNDARY}
              hiddenTileId={hiddenTileId}
              winningTileId={isCenterFinalTile ? null : finalTileAnimationTileId}
              winningTranslateY={finalTileTranslateY}
              winningScale={finalTileScale}
              winningEmphasisOpacity={finalTileEmphasisOpacity}
              winningCenterProgress={finalTileCenterProgress}
              winningRotation={finalTileRotation}
              isCenterFinalTile={isCenterFinalTile}
              centerFinalTransform={finalTileTransform}
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
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    paddingHorizontal: BOARD_BOUNDARY.outerHorizontalInset,
    paddingVertical: BOARD_BOUNDARY.outerVerticalInset,
  },
  boardSurface: {
    flex: 1,
    width: "100%",
    height: "100%",
    overflow: "visible",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  boardTilesLayer: {
    ...StyleSheet.absoluteFill,
    transformOrigin: "center",
  },
  aznifBanner: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -46,
    zIndex: 250,
  },
  aznifText: {
    color: "#facc15",
    fontSize: 64,
    fontFamily: "SpedaBold",
    textAlign: "center",
    textShadowColor: "rgba(250, 204, 21, 0.9)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 16,
  },
  centerTileWrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
  },
  scoreBadge: {
    position: "absolute",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#facc15",
    zIndex: 90,
  },
scoreBadgeTop: {
  top: BOARD_BOUNDARY.outerVerticalInset + 12,
  alignSelf: "center",
},

scoreBadgeBottom: {
  bottom: BOARD_BOUNDARY.outerVerticalInset + 12,
  alignSelf: "center",
},

scoreBadgeLeft: {
  left: BOARD_BOUNDARY.outerHorizontalInset + 12,
  top: "50%",
  transform: [{ translateY: -14 }],
},

scoreBadgeRight: {
  right: BOARD_BOUNDARY.outerHorizontalInset + 12,
  top: "50%",
  transform: [{ translateY: -14 }],
},
  scoreBadgeText: { fontFamily: "RobotoMedium", color: "#111827" },
});
