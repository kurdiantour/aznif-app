import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import {
  getOpenableRackLayout,
  getRackDisplayScore,
} from "@/okey/engine/okey-rack-layout";
import {
  ROW_ORDER,
  RACK_DEAL_BATCH_STAGGER_MS,
  RACK_TILE_ENTER_MS,
  getFlatIndexForSlot,
  getSlotEnterDelay,
  type ExternalDropPlacement,
  type RackRow,
  type RackRowLayout,
} from "@/okey/rack/rack-layout";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";
import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import {
  OkeyMeldView,
  getOkeyMeldWidth,
} from "./OkeyMeldView";
import {
  RACK_ROW_CAPACITY,
  RACK_TILE_ASPECT_RATIO,
  RACK_TILE_GAP,
  RACK_TILE_SIDE_PADDING,
  RACK_TILE_WIDTH,
  styles,
} from "./okeyStyles";
import { OkeyTileFace } from "./OkeyTileFace";
import { OkeyTurnTimerBar } from "./OkeyTurnTimerBar";
import { useOkeyRackDrag } from "./useOkeyRackDrag";

type TileRect = { x: number; y: number; width: number; height: number };

function EnteringRackTile({ children, height, fromX = 0, fromY, delay = 0 }: {
  children: ReactNode;
  height: number;
  fromX?: number;
  fromY?: number;
  delay?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: RACK_TILE_ENTER_MS,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, progress]);
  return (
    <Animated.View style={{
      opacity: progress.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 1, 1] }),
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY ?? -height * 4.2, 0] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}

function ReturningJokerTile({ children, height }: { children: ReactNode; height: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 760,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);
  return (
    <Animated.View style={{
      opacity: progress,
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 0.58, 1], outputRange: [52, -8, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [-height * 3.8, height * 0.12, 0] }) },
        { rotate: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: ["-18deg", "5deg", "0deg"] }) },
        { scale: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0.72, 1.08, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}

function OkeyTurnWarningToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={rackOnlyStyles.warning}>
      <Text style={rackOnlyStyles.warningText}>نۆرەی تۆیە</Text>
    </View>
  );
}

function EliminatedPlayerOverlay() {
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel="دەستەکەت سووتا. تا کۆتایی ئەم ڕاوندە دەرکراویت." style={rackOnlyStyles.eliminated}>
      <MaterialCommunityIcons name="alert" size={32} color="#ff3131" />
      <Text style={rackOnlyStyles.eliminatedTitle}>دەستەکەت سووتا</Text>
      <Text style={rackOnlyStyles.eliminatedMessage}>تا کۆتایی ئەم ڕاوندە دەرکراویت.</Text>
    </View>
  );
}

const rackOnlyStyles = StyleSheet.create({
  warning: {
    position: "absolute", top: -10, alignSelf: "center", zIndex: 950, elevation: 12,
    flexDirection: "row", alignItems: "center", gap: 9, minHeight: 44,
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 22,
    shadowColor: "#000", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.24, shadowRadius: 10,
  },
  warningText: {
    color: "#FFF8E7", fontSize: 16, fontWeight: "700", fontFamily: "SpedaRegular", writingDirection: "rtl",
  },
  eliminated: {
    ...StyleSheet.absoluteFillObject, zIndex: 10000, elevation: 10000,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 22,
    borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,49,49,0.42)", backgroundColor: "rgba(0,0,0,0.92)",
  },
  eliminatedTitle: {
    marginTop: 8, color: "#ff3131", fontSize: 18, fontWeight: "900", textAlign: "center",
  },
  eliminatedMessage: {
    marginTop: 8, color: "#ffffff", fontSize: 13, fontWeight: "700", textAlign: "center",
  },
});

export function OkeyPlayerRack({
  tiles,
  selectedTileId,
  okeyTile,
  onSelectTile,
  onMoveTile,
  onRackScoreChange,
  onOpenableMeldsChange,
  stagedTileIds = [],
  onDropMeldGroup,
  onDropTile,
  onTileDragPointChange,
  hiddenTileIds = [],
  skipEnterAnimationTileIds = [],
  onTileMeasured,
  onRackMeasured,
  onDrawLandingRectChange,
  turnTimerActive = false,
  turnWarningToastVisible = false,
  showTurnTimer = true,
  turnTimeLeft,
  turnDurationSeconds,
  dealResetKey,
  isDealer = false,
  dealOrigin,
  externalDropPlacement,
  onExternalDropPlaced,
  externalHoverPoint,
  eliminated = false,
}: {
  tiles: OkeyTile[];
  selectedTileId: string | null;
  okeyTile: OkeyTile;
  onSelectTile: (tileId: string) => void;
  onMoveTile: (tileId: string, targetIndex: number) => void;
  onRackScoreChange?: (score: number) => void;
  onOpenableMeldsChange?: (payload: {
    melds: OkeyMeld[];
    score: number;
    contiguousGroups: OkeyTile[][];
  }) => void;
  stagedTileIds?: string[];
  onDropMeldGroup?: (
    meld: OkeyMeld,
    point: { x: number; y: number },
  ) => boolean;
  onDropTile?: (
    tileId: string,
    point: { x: number; y: number },
  ) => boolean;
  onTileDragPointChange?: (
    tileId: string | null,
    point: { x: number; y: number } | null,
  ) => void;
  hiddenTileIds?: string[];
  skipEnterAnimationTileIds?: string[];
  onTileMeasured?: (tileId: string, rect: TileRect) => void;
  onRackMeasured?: (rect: TileRect) => void;
  onDrawLandingRectChange?: (rect: TileRect | null) => void;
  turnTimerActive?: boolean;
  turnWarningToastVisible?: boolean;
  showTurnTimer?: boolean;
  turnTimeLeft: number;
  turnDurationSeconds: number | null;
  dealResetKey?: string;
  isDealer?: boolean;
  dealOrigin?: { x: number; y: number } | null;
  externalDropPlacement?: ExternalDropPlacement | null;
  onExternalDropPlaced?: (
    tileId: string,
    targetIndex: number,
  ) => void;
  externalHoverPoint?: { x: number; y: number } | null;
  eliminated?: boolean;
}) {
  const layout = useOkeyResponsiveLayout();

  const tileById = useMemo(
    () => new Map(tiles.map((tile) => [tile.id, tile])),
    [tiles],
  );
  const stagedTileIdSet = useMemo(
    () => new Set<string>(stagedTileIds),
    [stagedTileIds],
  );
  const hiddenTileIdSet = useMemo(
    () => new Set<string>(hiddenTileIds),
    [hiddenTileIds],
  );
  const skipEnterAnimationTileIdSet = useMemo(
    () => new Set<string>(skipEnterAnimationTileIds),
    [skipEnterAnimationTileIds],
  );

  const [rackViewportWidth, setRackViewportWidth] = useState(0);
  const rackRef = useRef<View | null>(null);
  const viewportRef = useRef<View | null>(null);
  const viewportOriginRef = useRef({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const rowLayoutsRef = useRef<
    Record<RackRow, RackRowLayout | null>
  >({
    top: null,
    bottom: null,
  });
  const [rowLayouts, setRowLayouts] = useState<
    Record<RackRow, RackRowLayout | null>
  >({
    top: null,
    bottom: null,
  });
  const tileRefs = useRef<Record<string, View | null>>({});
  const tileRectsRef = useRef<Record<string, TileRect>>({});

  const enterAnimationTimeoutsRef =
    useRef<ReturnType<typeof setTimeout>[]>([]);
  const [enteringTileIds, setEnteringTileIds] = useState<Set<string>>(
    () => new Set(tiles.map((tile) => tile.id)),
  );
  const [returningJokerTileIds, setReturningJokerTileIds] =
    useState<Set<string>>(() => new Set());
  const previousTileIdsRef = useRef(
    new Set(tiles.map((tile) => tile.id)),
  );

  const availableRackTileWidth =
    rackViewportWidth > 0
      ? Math.max(
          0,
          rackViewportWidth - RACK_TILE_SIDE_PADDING * 2,
        )
      : RACK_ROW_CAPACITY * RACK_TILE_WIDTH +
        (RACK_ROW_CAPACITY - 1) * RACK_TILE_GAP;

  const rackTileWidth = Math.min(
    RACK_TILE_WIDTH,
    (availableRackTileWidth -
      RACK_TILE_GAP * (RACK_ROW_CAPACITY - 1)) /
      RACK_ROW_CAPACITY,
  );
  const rackTileHeight =
    rackTileWidth * RACK_TILE_ASPECT_RATIO;
  const rackTileStride = rackTileWidth + RACK_TILE_GAP;

  const clearEnteringTilesForDrag = useCallback(() => {
    setEnteringTileIds(new Set());
  }, []);

  const clearReturningJokerForTile = useCallback(
    (tileId: string) => {
      setReturningJokerTileIds((current) => {
        if (!current.has(tileId)) return current;
        const next = new Set(current);
        next.delete(tileId);
        return next;
      });
    },
    [],
  );

  const {
    committedRackSlots,
    rackSlots,
    flippedTileIds,
    draggingTileId,
    draggingMeld,
    dragPosition,
    draggedMeldScale,
    externalHoverTarget,
    getTileShiftValue,
    getTilePanHandlers,
    dragStartedRef,
  } = useOkeyRackDrag({
    tiles,
    okeyTile,
    stagedTileIdSet,
      rackTileWidth,
    rackTileHeight,
    rackTileStride,
    viewportOriginRef,
    rowLayoutsRef,
    tileRectsRef,
    onSelectTile,
    onDropMeldGroup,
    onDropTile,
    onTileDragPointChange,
    externalDropPlacement,
    onExternalDropPlaced,
    externalHoverPoint,
    clearEnteringTilesForDrag,
    clearReturningJokerForTile,
  });

  useEffect(() => {
    const topSlotIndex = committedRackSlots.top.findIndex((tileId) => tileId === null);
    const bottomSlotIndex = committedRackSlots.bottom.findIndex((tileId) => tileId === null);
    const target = topSlotIndex >= 0
      ? { row: "top" as const, slotIndex: topSlotIndex }
      : bottomSlotIndex >= 0
        ? { row: "bottom" as const, slotIndex: bottomSlotIndex }
        : null;
    const viewport = viewportOriginRef.current;
    const rowLayout = target ? rowLayouts[target.row] : null;

    if (!target || !rowLayout || viewport.width <= 0 || viewport.height <= 0) {
      onDrawLandingRectChange?.(null);
      return;
    }

    const bottomInset = target.row === "bottom" ? rackTileHeight * 0.44 : 0;
    onDrawLandingRectChange?.({
      x: viewport.x + target.slotIndex * rackTileStride,
      y: viewport.y + rowLayout.y + rowLayout.height - rackTileHeight - bottomInset,
      width: rackTileWidth,
      height: rackTileHeight,
    });
  }, [
    committedRackSlots,
    onDrawLandingRectChange,
    rackTileHeight,
    rackTileStride,
    rackTileWidth,
    rackViewportWidth,
    rowLayouts,
  ]);

  const measureViewport = useCallback(() => {
    rackRef.current?.measureInWindow((x, y, width, height) => {
      onRackMeasured?.({ x, y, width, height });
    });

    viewportRef.current?.measureInWindow(
      (x, y, width, height) => {
        viewportOriginRef.current = { x, y, width, height };
        setRackViewportWidth(width);
      },
    );
  }, [onRackMeasured]);

  const updateRowLayout = (
    row: RackRow,
    event: LayoutChangeEvent,
  ) => {
    const nextLayout = event.nativeEvent.layout;
    rowLayoutsRef.current[row] = nextLayout;

    setRowLayouts((current) => {
      const previous = current[row];
      if (
        previous &&
        previous.x === nextLayout.x &&
        previous.y === nextLayout.y &&
        previous.width === nextLayout.width &&
        previous.height === nextLayout.height
      ) {
        return current;
      }

      return {
        ...current,
        [row]: nextLayout,
      };
    });
  };

  const measureRackTile = useCallback(
    (tileId: string) => {
      tileRefs.current[tileId]?.measureInWindow(
        (x, y, width, height) => {
          const rect = { x, y, width, height };
          tileRectsRef.current[tileId] = rect;
          onTileMeasured?.(tileId, rect);
        },
      );
    },
    [onTileMeasured],
  );

  useEffect(() => {
    if (dragStartedRef.current) return;

    for (const row of ROW_ORDER) {
      for (const tileId of rackSlots[row]) {
        if (tileId) measureRackTile(tileId);
      }
    }
  }, [
    dragStartedRef,
    measureRackTile,
    rackSlots,
    rackTileHeight,
    rackTileWidth,
  ]);

  useEffect(() => {
    if (!dealResetKey) return;

    enterAnimationTimeoutsRef.current.forEach(clearTimeout);
    enterAnimationTimeoutsRef.current = [];

    const dealTileIds = tiles.map((tile) => tile.id);
    setEnteringTileIds(new Set(dealTileIds));

    if (dealTileIds.length === 0) return;

    const timeout = setTimeout(() => {
      setEnteringTileIds((current) => {
        const next = new Set(current);
        dealTileIds.forEach((tileId) => next.delete(tileId));
        return next;
      });
    }, RACK_TILE_ENTER_MS + RACK_DEAL_BATCH_STAGGER_MS * 6 + 120);

    enterAnimationTimeoutsRef.current.push(timeout);

    return () => {
      clearTimeout(timeout);
      enterAnimationTimeoutsRef.current =
        enterAnimationTimeoutsRef.current.filter(
          (entry) => entry !== timeout,
        );
    };
  }, [dealResetKey]);

  useEffect(() => {
    const previousTileIds = previousTileIdsRef.current;
    const returningIds = tiles
      .filter(
        (tile) =>
          tile.jokerOrigin === "stolen" &&
          !previousTileIds.has(tile.id),
      )
      .map((tile) => tile.id);

    previousTileIdsRef.current = new Set(
      tiles.map((tile) => tile.id),
    );
    if (returningIds.length === 0) return;

    setReturningJokerTileIds(
      (current) => new Set([...current, ...returningIds]),
    );

    const timeout = setTimeout(() => {
      setReturningJokerTileIds((current) => {
        const next = new Set(current);
        returningIds.forEach((tileId) => next.delete(tileId));
        return next;
      });
    }, 900);

    enterAnimationTimeoutsRef.current.push(timeout);
    return () => clearTimeout(timeout);
  }, [tiles]);

  useEffect(
    () => () => {
      enterAnimationTimeoutsRef.current.forEach((timeout) =>
        clearTimeout(timeout),
      );
      enterAnimationTimeoutsRef.current = [];
    },
    [],
  );

  useEffect(() => {
    const rows = ROW_ORDER.map((row) => {
      const rowSets: OkeyTile[][] = [];
      let currentSet: OkeyTile[] = [];

      for (const tileId of committedRackSlots[row]) {
        const tile =
          tileId && !stagedTileIdSet.has(tileId)
            ? tileById.get(tileId)
            : null;

        if (tile) {
          currentSet.push(tile);
        } else if (currentSet.length > 0) {
          rowSets.push(currentSet);
          currentSet = [];
        }
      }

      if (currentSet.length > 0) rowSets.push(currentSet);
      return rowSets;
    }).flat();

    const displayScore = getRackDisplayScore(rows, okeyTile);
    const openableMelds = getOpenableRackLayout(rows, okeyTile);

    onRackScoreChange?.(displayScore);
    onOpenableMeldsChange?.({
      ...openableMelds,
      contiguousGroups: rows,
    });
  }, [
    committedRackSlots,
    okeyTile,
    onOpenableMeldsChange,
    onRackScoreChange,
    stagedTileIdSet,
    tileById,
  ]);

  const renderInsertionIndicator = (
    row: RackRow,
    slotIndex: number,
  ) => {
    const activeTarget = externalHoverTarget;

    if (
      !activeTarget ||
      activeTarget.row !== row ||
      activeTarget.slotIndex !== slotIndex
    ) {
      return null;
    }

    return (
      <View
        pointerEvents="none"
        style={[
          styles.rackSlotIndicator,
          {
            width: rackTileWidth,
            height: rackTileHeight,
          },
        ]}
      />
    );
  };

  const renderRackTile = (
    tileId: string,
    row: RackRow,
    slotIndex: number,
  ) => {
    const tile = tileById.get(tileId);
    if (!tile) return null;

    const isStaged = stagedTileIdSet.has(tile.id);
    const isGroupSelected =
      draggingMeld?.tileIds.includes(tile.id) ?? false;
    const isAnimationHidden = hiddenTileIdSet.has(tile.id);
    const shouldHideTile =
      draggingTileId === tile.id ||
      isStaged ||
      isGroupSelected ||
      isAnimationHidden;

    const accessibilityIndex = getFlatIndexForSlot(
      rackSlots,
      row,
      slotIndex,
    );

    const moveForAccessibility = (targetIndex: number) => {
      if (eliminated || isStaged) return;
      onMoveTile(tile.id, targetIndex);
      onSelectTile(tile.id);
    };

    const tileFace = (
      <OkeyTileFace
        tile={tile}
        selected={
          selectedTileId === tile.id || isGroupSelected
        }
        isWildcard={isOkeyWildcard(tile, okeyTile)}
        flipped={
          isOkeyWildcard(tile, okeyTile) &&
          flippedTileIds.has(tile.id)
        }
        onPress={() => onSelectTile(tile.id)}
        onAccessibilityMovePrevious={
          accessibilityIndex > 0
            ? () =>
                moveForAccessibility(accessibilityIndex - 1)
            : undefined
        }
        onAccessibilityMoveNext={
          accessibilityIndex < tiles.length - 1
            ? () =>
                moveForAccessibility(accessibilityIndex + 1)
            : undefined
        }
        panHandlers={getTilePanHandlers(tile.id)}
        width={rackTileWidth}
        height={rackTileHeight}
      />
    );

    const neighborShift = getTileShiftValue(tile.id);

    return (
      <Animated.View
        key={tile.id}
        style={{
          position: "absolute",
          left: slotIndex * rackTileStride,
          top: (() => {
            const rowLayout = rowLayouts[row];
            if (!rowLayout) return 0;

            const bottomInset =
              row === "bottom" ? rackTileHeight * 0.44 : 0;

            return (
              rowLayout.y +
              rowLayout.height -
              rackTileHeight -
              bottomInset
            );
          })(),
          width: rackTileWidth,
          height: rackTileHeight,
          transform: neighborShift.getTranslateTransform(),
        }}
      >
        <View
          ref={(node) => {
            tileRefs.current[tile.id] = node;
          }}
          collapsable={false}
          style={
            shouldHideTile
              ? styles.hiddenRackTile
              : undefined
          }
        >
          {returningJokerTileIds.has(tile.id) &&
          !shouldHideTile ? (
            <ReturningJokerTile height={rackTileHeight}>
              {tileFace}
            </ReturningJokerTile>
          ) : enteringTileIds.has(tile.id) &&
            !shouldHideTile &&
            !skipEnterAnimationTileIdSet.has(tile.id) ? (
            <EnteringRackTile
              height={rackTileHeight}
              fromX={
                dealOrigin
                  ? dealOrigin.x -
                    (viewportOriginRef.current.x +
                      (slotIndex + 0.5) *
                        rackTileStride)
                  : rackViewportWidth / 2 -
                    (slotIndex + 0.5) * rackTileStride
              }
              fromY={
                dealOrigin
                  ? dealOrigin.y -
                    (viewportOriginRef.current.y +
                      (row === "top"
                        ? rackTileHeight * 0.5
                        : rackTileHeight * 1.5))
                  : undefined
              }
              delay={getSlotEnterDelay(
                row,
                slotIndex,
                isDealer,
              )}
            >
              {tileFace}
            </EnteringRackTile>
          ) : (
            tileFace
          )}
        </View>
      </Animated.View>
    );
  };

  const renderRackSlot = (
    row: RackRow,
    slotIndex: number,
  ) => (
    <View
      key={`${row}-${slotIndex}`}
      style={[
        styles.rackSlot,
        {
          width: rackTileWidth,
          height: rackTileHeight,
        },
      ]}
    >
      {renderInsertionIndicator(row, slotIndex)}
    </View>
  );

  const renderRackRow = (row: RackRow) => {
    const bottomInset =
      row === "bottom" ? rackTileHeight * 0.44 : 0;

    return (
      <View
        style={[
          styles.rackRail,
          row === "bottom" && {
            paddingBottom: bottomInset,
          },
        ]}
        onLayout={(event) => updateRowLayout(row, event)}
      >
        <View
          style={[
            styles.rackRow,
            { position: "relative" },
          ]}
        >
          {Array.from({
            length: RACK_ROW_CAPACITY,
          }).map((_, slotIndex) =>
            renderRackSlot(row, slotIndex),
          )}
        </View>
      </View>
    );
  };

  // Konkan-style visual continuity:
  // every rack tile from BOTH rows lives under this one permanent parent.
  // A cross-row move changes coordinates only; it never changes React parent,
  // so the tile image cannot unmount/remount and flash.
  const stableRackTiles = ROW_ORDER.flatMap((row) =>
    committedRackSlots[row]
      .map((tileId, slotIndex) => ({
        tileId,
        slotIndex,
        row,
      }))
      .filter(
        (
          entry,
        ): entry is {
          tileId: string;
          slotIndex: number;
          row: RackRow;
        } => Boolean(entry.tileId),
      ),
  );

  const renderStableRackTiles = () => (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      }}
    >
      {stableRackTiles.map(
        ({ tileId, slotIndex, row }) =>
          renderRackTile(tileId, row, slotIndex),
      )}
    </View>
  );

  const draggingTile = draggingTileId
    ? tileById.get(draggingTileId)
    : null;
  const meldStackReveal = rackTileWidth / 6;
  const overlayWidth = draggingMeld
    ? getOkeyMeldWidth(
        draggingMeld,
        rackTileWidth,
        meldStackReveal,
      )
    : rackTileWidth;

  return (
    <View
      style={[
        styles.rackWrap,
        layout.rackWrap,
        (draggingTile || draggingMeld) &&
          styles.activeRackDragLayer,
      ]}
    >
      <View
        ref={rackRef}
        onLayout={measureViewport}
        style={[styles.playerRack, layout.playerRack]}
      >
        <OkeyTurnWarningToast visible={turnWarningToastVisible} />
        <OkeyTurnTimerBar
          active={turnTimerActive}
          visible={showTurnTimer}
          remainingSeconds={turnTimeLeft}
          durationSeconds={turnDurationSeconds}
          style={styles.rackTurnTimer}
        />

        <Image
          pointerEvents="none"
          source={require("@/assets/images/okey/player-rack-clean.png")}
          style={styles.rackImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />

        <View
          ref={viewportRef}
          onLayout={measureViewport}
          style={[
            styles.rackTileViewport,
            styles.rackScroll,
            (draggingTile || draggingMeld) &&
              styles.activeRackDragViewport,
          ]}
        >
          <View
            style={[
              styles.rackRows,
              { position: "relative" },
            ]}
          >
            {renderRackRow("top")}
            {renderRackRow("bottom")}
            {renderStableRackTiles()}
          </View>

          {draggingTile || draggingMeld ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.draggedTileOverlay,
                {
                  width: overlayWidth,
                  height: rackTileHeight,
                  transform:
                    dragPosition.getTranslateTransform(),
                },
              ]}
            >
              {draggingMeld ? (
                <Animated.View
                  style={{
                    transform: [
                      { scale: draggedMeldScale },
                    ],
                  }}
                >
                  <OkeyMeldView
                    meld={draggingMeld}
                    okeyTile={okeyTile}
                    tileWidth={rackTileWidth}
                    tileHeight={rackTileHeight}
                    stackReveal={meldStackReveal}
                  />
                </Animated.View>
              ) : draggingTile ? (
                <OkeyTileFace
                  tile={draggingTile}
                  isWildcard={isOkeyWildcard(
                    draggingTile,
                    okeyTile,
                  )}
                  width={rackTileWidth}
                  height={rackTileHeight}
                />
              ) : null}
            </Animated.View>
          ) : null}
        </View>

        {eliminated ? <EliminatedPlayerOverlay /> : null}
      </View>
    </View>
  );
}

export const MemoizedOkeyPlayerRack =
  memo(OkeyPlayerRack);
