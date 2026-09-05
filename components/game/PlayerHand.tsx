import { DominoTileData } from "@/domino/types/domino-game";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  PanResponder,
  type PanResponderInstance,
  StyleSheet,
  View,
} from "react-native";
import DominoTile from "./DominoTile";

type Props = {
  tiles: DominoTileData[];
  onPlayTile: (
    tile: DominoTileData,
    dropPoint: { x: number; y: number },
    sourceRect?: { x: number; y: number; width: number; height: number },
  ) => void;
  onSelectTile?: (tile: DominoTileData, sourceRect?: { x: number; y: number; width: number; height: number }) => void;
  disabled?: boolean;
  selectedTileId?: string | null;
  playableTileIds?: string[];
  scale?: number;
  trayWidth?: number;
  dealOrigin?: { x: number; y: number } | null;
  dealToken?: number;
  dealOrder?: number;
  dealPlayerCount?: number;
  hiddenTileId?: string | null;
};

const TILE_WIDTH = 28;
const TILE_HEIGHT = 70;
const TILE_GAP = 3;
const SLOT_WIDTH = TILE_WIDTH + TILE_GAP;

const HAND_WIDTH = 450;
const HAND_HEIGHT = 88;

const TILE_TOP = 30;
const DROP_TO_BOARD_DISTANCE = -10;
const DEAL_STAGGER_MS = 95;
const DEAL_DURATION_MS = 620;
const HIDDEN_DEAL_TILE: DominoTileData = {
  id: "hidden-deal-0-0",
  left: 0,
  right: 0,
  imageKey: "0-0",
};
export default function PlayerHand({
  tiles,
  onPlayTile,
  onSelectTile,
  disabled = false,
  selectedTileId = null,
  playableTileIds = [],
  scale = 1,
  trayWidth,
  dealOrigin = null,
  dealToken = 0,
  dealOrder = 0,
  dealPlayerCount = 1,
  hiddenTileId = null,
}: Props) {
  const [localTiles, setLocalTiles] = useState(tiles);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [trayWindowOrigin, setTrayWindowOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [visibleDealToken, setVisibleDealToken] = useState<number | null>(null);

  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dealProgressRef = useRef(new Map<string, Animated.Value>());
  const previousHandIdsRef = useRef<Set<string> | null>(null);
  const animatedHandSignatureRef = useRef("");
  const animatedDealTokenRef = useRef(0);
  const dealAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const disabledRef = useRef(disabled);
  const tilesRef = useRef(tiles);
  const localTilesRef = useRef(localTiles);
  const playableTileIdsRef = useRef(new Set(playableTileIds));

  const draggingIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const lastGestureRef = useRef({ dx: 0, dy: 0 });
  const handTrayRef = useRef<View | null>(null);
  const containerOffsetRef = useRef({ x: 0, y: 0 });
  const touchOffsetRef = useRef({ x: 0, y: 0 });
  const initialTilePositionRef = useRef({ x: 0, y: 0 });

  const respondersRef = useRef<(PanResponderInstance | null)[]>([]);

  const resetDrag = useCallback(() => {
    Animated.timing(drag, {
      toValue: { x: 0, y: 0 },
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setDraggingIndex(null);
      draggingIndexRef.current = null;
      hoverIndexRef.current = null;
      lastGestureRef.current = { dx: 0, dy: 0 };
      drag.setValue({ x: 0, y: 0 });
    });
  }, [drag]);

  const getLeftForIndex = useCallback(
    (index: number) => {
      const tileWidth = TILE_WIDTH * scale;
      const tileGap = TILE_GAP * scale;
      const slotWidth = tileWidth + tileGap;
      const handWidth = trayWidth ?? HAND_WIDTH;
      const totalTilesWidth =
        tiles.length * tileWidth + Math.max(0, tiles.length - 1) * tileGap;

      const startX = Math.max(0, (handWidth - totalTilesWidth) / 2);

      return startX + index * slotWidth;
    },
    [tiles.length, scale, trayWidth],
  );

  const clampIndex = useCallback(
    (index: number) =>
      Math.max(0, Math.min(localTilesRef.current.length - 1, index)),
    [],
  );

  const updateContainerOffset = useCallback(() => {
    if (!handTrayRef.current) return;

    handTrayRef.current.measureInWindow((x, y, _width, _height) => {
      containerOffsetRef.current = { x, y };
      setTrayWindowOrigin({ x, y });
    });
  }, []);

  const startDrag = useCallback(
    (index: number, evt: any) => {
      if (disabledRef.current) return;

      const tile = localTilesRef.current[index];
      if (!tile || !playableTileIdsRef.current.has(tile.id)) return;

      const left = getLeftForIndex(index);
      onSelectTile?.(tile, trayWindowOrigin ? { x: trayWindowOrigin.x + left, y: trayWindowOrigin.y + TILE_TOP * scale, width: TILE_WIDTH * scale, height: TILE_HEIGHT * scale } : undefined);

      updateContainerOffset();

      setDraggingIndex(index);

      draggingIndexRef.current = index;
      hoverIndexRef.current = index;

      touchOffsetRef.current = {
        x: evt.nativeEvent.locationX,
        y: evt.nativeEvent.locationY,
      };

      initialTilePositionRef.current = {
        x: getLeftForIndex(index),
        y: TILE_TOP * scale,
      };

      lastGestureRef.current = { dx: 0, dy: 0 };
      drag.setValue({ x: 0, y: 0 });
    },
    [drag, getLeftForIndex, onSelectTile, scale, trayWindowOrigin, updateContainerOffset],
  );

  const finishDrag = useCallback((gesture: { moveX?: number; moveY?: number }) => {
    if (disabledRef.current) {
      resetDrag();
      return;
    }

    const from = draggingIndexRef.current;

    if (from === null) {
      resetDrag();
      return;
    }

    const draggedLocalTile = localTilesRef.current[from];
    const shouldDropToBoard =
      lastGestureRef.current.dy <= DROP_TO_BOARD_DISTANCE;

    if (shouldDropToBoard && draggedLocalTile) {
      const realTile = tilesRef.current.find(
        (tile) => tile.id === draggedLocalTile.id,
      );

      const x = gesture.moveX;
      const y = gesture.moveY;

      if (realTile && typeof x === "number" && typeof y === "number") {
        const left = getLeftForIndex(from);
        onPlayTile(realTile, { x, y }, trayWindowOrigin ? { x: trayWindowOrigin.x + left, y: trayWindowOrigin.y + TILE_TOP * scale, width: TILE_WIDTH * scale, height: TILE_HEIGHT * scale } : undefined);
      }

      resetDrag();
      return;
    }

    resetDrag();
  }, [getLeftForIndex, onPlayTile, resetDrag, scale, trayWindowOrigin]);

  const createResponder = useCallback(
    (index: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => {
          const tile = localTilesRef.current[index];
          return (
            !!tile &&
            !disabledRef.current &&
            playableTileIdsRef.current.has(tile.id)
          );
        },

        onMoveShouldSetPanResponder: (_, gesture) =>
          !!localTilesRef.current[index] &&
          playableTileIdsRef.current.has(localTilesRef.current[index].id) &&
          !disabledRef.current &&
          (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),

        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => startDrag(index, evt),

        onPanResponderMove: (evt, gesture) => {
          if (disabledRef.current) return;
          if (draggingIndexRef.current === null) return;

          lastGestureRef.current = {
            dx: gesture.dx,
            dy: gesture.dy,
          };

          const containerOffset = containerOffsetRef.current;
          const absoluteX = gesture.moveX ?? evt.nativeEvent.pageX;
          const absoluteY = gesture.moveY ?? evt.nativeEvent.pageY;

          const relativeX =
            absoluteX - containerOffset.x - touchOffsetRef.current.x;
          const relativeY =
            absoluteY - containerOffset.y - touchOffsetRef.current.y;

          drag.setValue({
            x: relativeX - initialTilePositionRef.current.x,
            y: relativeY - initialTilePositionRef.current.y,
          });

          const fromIndex = draggingIndexRef.current;
          const rawTarget =
            fromIndex +
            Math.floor(
              (gesture.dx + (SLOT_WIDTH * scale) / 2) / (SLOT_WIDTH * scale),
            );

          const nextHover = clampIndex(rawTarget);

          if (nextHover !== hoverIndexRef.current) {
            hoverIndexRef.current = nextHover;
          }
        },

        onPanResponderRelease: (_evt, gesture) => finishDrag(gesture),
        onPanResponderTerminate: (_evt, gesture) => finishDrag(gesture),
        onShouldBlockNativeResponder: () => true,
      }),
    [clampIndex, drag, finishDrag, scale, startDrag],
  );

  useEffect(() => {
    disabledRef.current = disabled;

    if (disabled) {
      resetDrag();
    }
  }, [disabled, resetDrag]);

  useEffect(() => {
    tilesRef.current = tiles;
    setLocalTiles(tiles);
  }, [tiles]);

  useEffect(() => {
    playableTileIdsRef.current = new Set(playableTileIds);
  }, [playableTileIds]);

  useEffect(() => {
    localTilesRef.current = localTiles;
    respondersRef.current = localTiles.map((tile, index) =>
      playableTileIdsRef.current.has(tile.id) ? createResponder(index) : null,
    );
  }, [localTiles, disabled, playableTileIds, createResponder]);

  const previewTiles = tiles;
  const handSignature = previewTiles.map((tile) => tile.id).join("|");
  const previousHandIds = previousHandIdsRef.current;
  const sharedTileCount = previousHandIds
    ? previewTiles.reduce(
        (count, tile) => count + (previousHandIds.has(tile.id) ? 1 : 0),
        0,
      )
    : 0;
  const isNewHand =
    previewTiles.length >= 7 &&
    (previousHandIds === null ||
      previousHandIds.size === 0 ||
      sharedTileCount <=
        Math.floor(Math.min(previousHandIds.size, previewTiles.length) * 0.35));
  const shouldStartDeal =
    !!dealOrigin &&
    !!trayWindowOrigin &&
    ((dealToken > 0 && animatedDealTokenRef.current !== dealToken) ||
      (isNewHand && animatedHandSignatureRef.current !== handSignature));
  const isWaitingForNewDeal =
    isNewHand &&
    !shouldStartDeal &&
    animatedDealTokenRef.current === dealToken;

  previewTiles.forEach((tile) => {
    if (!dealProgressRef.current.has(tile.id)) {
      dealProgressRef.current.set(
        tile.id,
        new Animated.Value(shouldStartDeal ? 0 : 1),
      );
    } else if (shouldStartDeal) {
      dealProgressRef.current.get(tile.id)?.setValue(0);
    }
  });

  if (shouldStartDeal) {
    animatedHandSignatureRef.current = handSignature;
    animatedDealTokenRef.current = dealToken;
  }

  useLayoutEffect(() => {
    previousHandIdsRef.current = new Set(tiles.map((tile) => tile.id));

    if (!shouldStartDeal) return;

    dealAnimationRef.current?.stop();
    setVisibleDealToken(dealToken);

    const animations = tiles.map((tile) =>
      Animated.timing(dealProgressRef.current.get(tile.id)!, {
        toValue: 1,
        duration: DEAL_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    );

    // Deal one tile to each seat before beginning the next pass around the table.
    const dealAnimation = Animated.sequence([
      Animated.delay(dealOrder * DEAL_STAGGER_MS),
      Animated.stagger(DEAL_STAGGER_MS * dealPlayerCount, animations),
    ]);
    dealAnimationRef.current = dealAnimation;
    dealAnimation.start(({ finished }) => {
      if (finished && dealAnimationRef.current === dealAnimation) {
        dealAnimationRef.current = null;
      }
    });
  }, [dealOrder, dealPlayerCount, dealToken, handSignature, shouldStartDeal, tiles]);

  useEffect(() => {
    return () => dealAnimationRef.current?.stop();
  }, []);

  const draggingTileId =
    draggingIndex !== null ? (tiles[draggingIndex]?.id ?? null) : null;
  const scaledTileWidth = TILE_WIDTH * scale;
  const scaledTileHeight = TILE_HEIGHT * scale;

  return (
    <View
      ref={handTrayRef}
      onLayout={updateContainerOffset}
      style={[
        styles.handTray,
        {
          width: trayWidth ?? HAND_WIDTH,
          height: HAND_HEIGHT * scale,
        },
      ]}
      pointerEvents={disabled ? "none" : "auto"}
    >
      {previewTiles.map((tile, visualIndex) => {
        const isDragging = tile.id === draggingTileId;
        const isPlayable = !disabled && playableTileIds.includes(tile.id);
        const isSelected = isPlayable && tile.id === selectedTileId;

        const responder = isPlayable
          ? isDragging
            ? respondersRef.current[draggingIndex ?? visualIndex]
            : respondersRef.current[visualIndex]
          : null;
        const panHandlers = responder?.panHandlers ?? {};
        const dealProgress = dealProgressRef.current.get(tile.id)!;
        const finalLeft = getLeftForIndex(visualIndex);
        const centerOriginTranslateX =
          dealOrigin && trayWindowOrigin
            ? dealOrigin.x -
              (trayWindowOrigin.x + finalLeft + scaledTileWidth / 2)
            : 0;
        const centerOriginTranslateY =
          dealOrigin && trayWindowOrigin
            ? dealOrigin.y -
              (trayWindowOrigin.y + TILE_TOP * scale + scaledTileHeight / 2)
            : 0;
        const dealTranslateX = dealProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [centerOriginTranslateX, 0],
        });
        const dealTranslateY = dealProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [centerOriginTranslateY, 0],
        });
        const dealScale = dealProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1.35, 1],
        });
        const dealOpacity = dealProgress.interpolate({
          inputRange: [0, 0.08, 1],
          outputRange: [0, 1, 1],
        });
        const tileBackOpacity = dealProgress.interpolate({
          inputRange: [0, 0.84, 0.94, 1],
          outputRange: [1, 1, 0, 0],
        });
        const tileFaceOpacity = dealProgress.interpolate({
          inputRange: [0, 0.84, 0.94, 1],
          outputRange: [0, 0, 1, 1],
        });

        return (
          <Animated.View
            key={tile.id}
            style={[
              styles.tile,
              {
                left: finalLeft,
                top: TILE_TOP * scale,
                width: scaledTileWidth,
                height: scaledTileHeight,
                zIndex: isDragging || isSelected ? 100 : isPlayable ? 50 : 1,
                opacity: tile.id === hiddenTileId ? 0 :
                  visibleDealToken === dealToken && !isWaitingForNewDeal
                    ? Animated.multiply(
                        dealOpacity,
                        disabled ? 0.45 : isPlayable ? 1 : 0.5,
                      )
                    : 0,

                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 0 },
                elevation: 2,

                transform: isDragging
                  ? [
                      { translateX: dealTranslateX },
                      { translateY: dealTranslateY },
                      { scale: dealScale },
                      { translateX: drag.x },
                      { translateY: drag.y },
                      { scale: 1.08 },
                    ]
                  : [
                      { translateX: dealTranslateX },
                      { translateY: dealTranslateY },
                      { scale: dealScale },
                      { translateX: 0 },
                      {
                        translateY: 0,
                      },
                      { scale: 1 },
                    ],
              },
            ]}
            {...panHandlers}
          >
            <Animated.View style={[styles.tileFace, { opacity: tileFaceOpacity }]}>
              <DominoTile
                tile={tile}
                width={scaledTileWidth}
                height={scaledTileHeight}
              />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.tileBack,
                {
                  width: scaledTileWidth,
                  height: scaledTileHeight,
                  opacity: tileBackOpacity,
                },
              ]}
            >
              <DominoTile
                tile={HIDDEN_DEAL_TILE}
                width={scaledTileWidth}
                height={scaledTileHeight}
              />
            </Animated.View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  handTray: {
    position: "relative",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
  },

  tile: {
    position: "absolute",
  },

  tileFace: {
    ...StyleSheet.absoluteFill,
  },

  tileBack: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
