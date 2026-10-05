
import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useOkeyCosmetics } from "@/okey/hooks/useOkeyCosmetics";
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
import { useOkeyRackSnapshot } from "@/okey/rack/useOkeyRackSnapshot";
import {
  ROW_ORDER,
  RACK_DEAL_BATCH_STAGGER_MS,
  RACK_TILE_ENTER_MS,
  getRackRowTileTop,
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
import { useOkeyRackDrag } from "@/okey/rack/useOkeyRackDrag";

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

function OkeyTurnWarningToast({ visible, message = "نۆرەی تۆیە" }: { visible: boolean; message?: string }) {
  if (!visible) return null;
  return (
    <View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={rackOnlyStyles.warning}>
      <Text style={rackOnlyStyles.warningText}>{message}</Text>
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
    ...StyleSheet.absoluteFill, zIndex: 10000, elevation: 10000,
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
  onTileDragStart,
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
  turnWarningToastMessage,
  showTurnTimer = true,
  turnDeadlineAt,
  serverClockOffsetMs,
  turnDurationSeconds,
  turnTimerPhase = "throw",
  dealResetKey,
  isDealer = false,
  dealOrigin,
  externalDropPlacement,
  onExternalDropPlaced,
  eliminated = false,
  playerId,
}: {
  tiles: OkeyTile[];
  selectedTileId: string | null;
  okeyTile: OkeyTile;
  onSelectTile: (tileId: string) => void;
  onTileDragStart?: (tileId: string) => void;
  onMoveTile: (tileId: string, targetIndex: number) => void;
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
  turnWarningToastMessage?: string;
  showTurnTimer?: boolean;
  turnDeadlineAt: string | null;
  serverClockOffsetMs: number;
  turnDurationSeconds: number | null;
  turnTimerPhase?: "draw" | "throw";
  dealResetKey?: string;
  isDealer?: boolean;
  dealOrigin?: { x: number; y: number } | null;
  externalDropPlacement?: ExternalDropPlacement | null;
  onExternalDropPlaced?: (
    tileId: string,
  ) => void;
  eliminated?: boolean;
  playerId?: string;
}) {
  const layout = useOkeyResponsiveLayout();
  const { getPlayerAssets } = useOkeyCosmetics();


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

  const enterAnimationTimeoutsRef =
    useRef<ReturnType<typeof setTimeout>[]>([]);
  const [enteringTileIds, setEnteringTileIds] = useState<Set<string>>(
    () => new Set(tiles.map((tile) => tile.id)),
  );
  const rackInteractionLocked = enteringTileIds.size > 0;
  const [flippingJokerTileIds, setFlippingJokerTileIds] =
    useState<Set<string>>(() => new Set());

  const effectiveViewportWidth =
    rackViewportWidth > 0
      ? rackViewportWidth
      : typeof layout.playerRack.width === "number"
      ? layout.playerRack.width * 0.94
      : 540;

  const availableRackTileWidth = Math.max(
    0,
    effectiveViewportWidth - RACK_TILE_SIDE_PADDING * 2,
  );

  const rackTileWidth = Math.min(
    RACK_TILE_WIDTH,
    (availableRackTileWidth -
      RACK_TILE_GAP * (RACK_ROW_CAPACITY - 1)) /
      RACK_ROW_CAPACITY,
  );
  const rackTileHeight =
    rackTileWidth * RACK_TILE_ASPECT_RATIO;
  const rackTileStride = rackTileWidth + RACK_TILE_GAP;


  const handleJokerFlipAnimationActiveChange = useCallback(
    (tileId: string, active: boolean) => {
      setFlippingJokerTileIds((current) => {
        const next = new Set(current);
        if (active) next.add(tileId);
        else next.delete(tileId);
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
    getTileShiftValue,
    getTilePanHandlers,
  } = useOkeyRackDrag({
  tiles,
  okeyTile,
  stagedTileIdSet,
  rackInteractionLocked,
  rackTileWidth,
  rackTileHeight,
  rackTileStride,
  viewportOriginRef,
  rowLayoutsRef,
  onSelectTile,
  onTileDragStart,
  onDropMeldGroup,
  onDropTile,
  onTileDragPointChange,
  externalDropPlacement,
  onExternalDropPlaced,
});

  const getRowTileTop = useCallback(
    (row: RackRow) => {
      const rowLayout = rowLayouts[row];
      if (!rowLayout) return 0;
      return getRackRowTileTop(rowLayout, rackTileHeight);
    },
    [rowLayouts, rackTileHeight],
  );

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

    onDrawLandingRectChange?.({
      x: viewport.x + target.slotIndex * rackTileStride,
      y: viewport.y + getRowTileTop(target.row),
      width: rackTileWidth,
      height: rackTileHeight,
    });
  }, [
    committedRackSlots,
    getRowTileTop,
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

  useEffect(() => {
    const viewport = viewportOriginRef.current;
    if (viewport.width <= 0 || viewport.height <= 0) return;

    for (const row of ROW_ORDER) {
      const rowLayout = rowLayouts[row];
      if (!rowLayout) continue;

      const rowTop = getRowTileTop(row);
      rackSlots[row].forEach((tileId, slotIndex) => {
        if (!tileId) return;

        const rect = {
          x: viewport.x + slotIndex * rackTileStride,
          y: viewport.y + rowTop,
          width: rackTileWidth,
          height: rackTileHeight,
        };
        onTileMeasured?.(tileId, rect);
      });
    }

  }, [
    getRowTileTop,
    onTileMeasured,
    rackSlots,
    rackTileHeight,
    rackTileStride,
    rackTileWidth,
    rackViewportWidth,
    rowLayouts,
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
    }, RACK_TILE_ENTER_MS + 4 * 4 * 180 + 50);

    enterAnimationTimeoutsRef.current.push(timeout);

    return () => {
      clearTimeout(timeout);
      enterAnimationTimeoutsRef.current =
        enterAnimationTimeoutsRef.current.filter(
          (entry) => entry !== timeout,
        );
    };
  }, [dealResetKey]);

  useEffect(
    () => () => {
      enterAnimationTimeoutsRef.current.forEach((timeout) =>
        clearTimeout(timeout),
      );
      enterAnimationTimeoutsRef.current = [];
    },
    [],
  );

  useOkeyRackSnapshot(
    committedRackSlots, tileById, stagedTileIdSet, okeyTile, onOpenableMeldsChange,
  );

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
        onFlipAnimationActiveChange={(active) =>
          handleJokerFlipAnimationActiveChange(tile.id, active)
        }
        onPress={() => onSelectTile(tile.id)}
        panHandlers={getTilePanHandlers(tile.id)}
        width={rackTileWidth}
        height={rackTileHeight}
      />
    );

    const neighborShift = getTileShiftValue(tile.id);
    const isFlippingJoker = flippingJokerTileIds.has(tile.id);

    return (
      <Animated.View
        key={tile.id}
        style={{
          position: "absolute",
          left: slotIndex * rackTileStride,
          top: getRowTileTop(row),
          width: rackTileWidth,
          height: rackTileHeight,
          zIndex: isFlippingJoker ? 6000 : undefined,
          elevation: isFlippingJoker ? 6000 : undefined,
          transform: neighborShift.getTranslateTransform(),
        }}
      >
        <View
          style={
            shouldHideTile
              ? styles.hiddenRackTile
              : undefined
          }
        >
          {enteringTileIds.has(tile.id) &&
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
delay={
  Math.floor(
    (row === "bottom"
      ? slotIndex
      : RACK_ROW_CAPACITY + slotIndex) / 3
  ) *
  4 *
  180
}
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
    </View>
  );

  const renderRackRow = (row: RackRow) => (
    <View
      style={styles.rackRail}
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
        <OkeyTurnWarningToast visible={turnWarningToastVisible} message={turnWarningToastMessage} />
        <OkeyTurnTimerBar
          active={turnTimerActive}
          visible={showTurnTimer}
          deadlineAt={turnDeadlineAt}
          serverClockOffsetMs={serverClockOffsetMs}
          durationSeconds={turnDurationSeconds}
          phase={turnTimerPhase}
          style={styles.rackTurnTimer}
        />

        <Image
          pointerEvents="none"
          source={getPlayerAssets(playerId).playerRack}
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
            flippingJokerTileIds.size > 0 &&
              styles.flippingJokerRackViewport,
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

