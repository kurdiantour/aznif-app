import { Image } from "expo-image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, View, type GestureResponderEvent, type LayoutChangeEvent, type PanResponderGestureState } from "react-native";
import { EliminatedPlayerOverlay } from "./EliminatedPlayerOverlay";

import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import { getOpenableRackLayout, getRackDisplayScore } from "@/okey/engine/okey-rack-layout";
import {
  DRAG_ACTIVATION_DISTANCE,
  GROUP_LONG_PRESS_MOVE_TOLERANCE,
  GROUP_LONG_PRESS_MS,
  ROW_ORDER,
  ROW_SNAP_PADDING_RATIO,
  SLOT_TARGET_HYSTERESIS_RATIO,
  cloneSlots,
  configureRackReflowAnimation,
  getBestMeldIncludingSlot,
  getFlatIndexForSlot,
  getInitialRackSlots,
  getPreviewSlotsForDrag,
  getRowTilesFromSlots,
  getSlotEnterDelay,
  getTileOrigin,
  moveTileIntoSlot,
  moveTilesIntoSlot,
  syncSlotsWithTiles,
  type DragOrigin,
  type DraggingMeld,
  type ExternalDropPlacement,
  type InsertionTarget,
  type RackRow,
  type RackRowLayout,
  type RackSlots
} from "@/okey/rack/rack-layout";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";
import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import { OkeyMeldView, getOkeyMeldWidth } from "./OkeyMeldView";
import { EnteringRackTile, RACK_DEAL_BATCH_STAGGER_MS, RACK_TILE_ENTER_MS, ReturningJokerTile } from "./OkeyRackTileAnimations";
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

export function OkeyPlayerRack({
  tiles,
  selectedTileId,
  okeyTile,
  onSelectTile,
  onMoveTile,
  onMoveTiles,
  onRackScoreChange,
  onOpenableMeldsChange,
  stagedTileIds = [],
  onDropMeldGroup,
  onDropTile,
  onTileDragPointChange,
  hiddenTileIds = [],
  skipEnterAnimationTileIds = [],
  fixedDrawTileId,
  onTileMeasured,
  onRackMeasured,
  turnTimerActive = false,
  turnTimerResetKey,
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
  onMoveTiles?: (tileIds: string[], targetIndex: number) => void;
  onRackScoreChange?: (score: number) => void;
  onOpenableMeldsChange?: (payload: { melds: OkeyMeld[]; score: number }) => void;
  stagedTileIds?: string[];
  onDropMeldGroup?: (meld: OkeyMeld, point: { x: number; y: number }) => boolean;
  onDropTile?: (tileId: string, point: { x: number; y: number }) => boolean;
  onTileDragPointChange?: (tileId: string | null, point: { x: number; y: number } | null) => void;
  hiddenTileIds?: string[];
  skipEnterAnimationTileIds?: string[];
  fixedDrawTileId?: string | null;
  onTileMeasured?: (tileId: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onRackMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  turnTimerActive?: boolean;
  turnTimerResetKey?: string;
  dealResetKey?: string;
  isDealer?: boolean;
  dealOrigin?: { x: number; y: number } | null;
  externalDropPlacement?: ExternalDropPlacement | null;
  onExternalDropPlaced?: (tileId: string, targetIndex: number) => void;
  externalHoverPoint?: { x: number; y: number } | null;
  eliminated?: boolean;
}) {
const [rackSlots, setRackSlots] = useState<RackSlots>(() => getInitialRackSlots(tiles));

const [flippedTileIds, setFlippedTileIds] = useState<Set<string>>(
  () => new Set<string>(),
);

const [draggingTileId, setDraggingTileId] = useState<string | null>(null);
const [draggingMeld, setDraggingMeld] = useState<DraggingMeld | null>(null);
  const draggingMeldRef = useRef<DraggingMeld | null>(null);
  const dragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const draggedMeldScale = useRef(new Animated.Value(1)).current;
  const dragTouchOffsetRef = useRef({ x: 0, y: 0 });
  const latestDragPointRef = useRef({ x: 0, y: 0 });
  const [insertionTarget, setInsertionTarget] = useState<InsertionTarget | null>(null);
  const insertionTargetRef = useRef<InsertionTarget | null>(null);
  const [externalHoverTarget, setExternalHoverTarget] = useState<InsertionTarget | null>(null);
  const [rackViewportWidth, setRackViewportWidth] = useState(0);
  const dragStartedRef = useRef(false);
  const dragStartSlotsRef = useRef<RackSlots | null>(null);
const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const wildcardLongPressHandledRef = useRef(false);
const rackRef = useRef<View | null>(null);
  const viewportRef = useRef<View | null>(null);
  const viewportOriginRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const rowLayoutsRef = useRef<Record<RackRow, RackRowLayout | null>>({ top: null, bottom: null });
  const tileRefs = useRef<Record<string, View | null>>({});
  const initialTileIdsRef = useRef(tiles.map((tile) => tile.id));
  const enterAnimationTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const consumedExternalDropNonceRef = useRef<number | null>(null);
  const livePreviewKeyRef = useRef<string | null>(null);
  const [enteringTileIds, setEnteringTileIds] = useState<Set<string>>(() => new Set(initialTileIdsRef.current));
const [returningJokerTileIds, setReturningJokerTileIds] = useState<Set<string>>(() => new Set());
const previousTileIdsRef = useRef(new Set(tiles.map((tile) => tile.id)));
  useEffect(() => {
    draggedMeldScale.stopAnimation();
    if (!draggingMeld) {
      draggedMeldScale.setValue(1);
      return;
    }

    draggedMeldScale.setValue(1);
    Animated.sequence([
      Animated.spring(draggedMeldScale, {
        toValue: 1.07,
        stiffness: 420,
        damping: 20,
        mass: 0.55,
        useNativeDriver: true,
      }),
      Animated.spring(draggedMeldScale, {
        toValue: 1.04,
        stiffness: 360,
        damping: 24,
        mass: 0.6,
        useNativeDriver: true,
      }),
    ]).start();
  }, [draggedMeldScale, draggingMeld]);
  const layout = useOkeyResponsiveLayout();
  const tileById = useMemo(() => new Map(tiles.map((tile) => [tile.id, tile])), [tiles]);
  const stagedTileIdSet = useMemo(() => new Set<string>(stagedTileIds), [stagedTileIds]);
  const hiddenTileIdSet = useMemo(() => new Set<string>(hiddenTileIds), [hiddenTileIds]);
  const skipEnterAnimationTileIdSet = useMemo(() => new Set<string>(skipEnterAnimationTileIds), [skipEnterAnimationTileIds]);

  const rackSlotsRef = useRef(rackSlots);
  useEffect(() => {
    rackSlotsRef.current = rackSlots;
  }, [rackSlots]);

  const tileByIdRef = useRef(tileById);
  useEffect(() => {
    tileByIdRef.current = tileById;
  }, [tileById]);

  const okeyTileRef = useRef(okeyTile);
  useEffect(() => {
    okeyTileRef.current = okeyTile;
  }, [okeyTile]);

  const setCurrentInsertionTarget = useCallback((target: InsertionTarget | null) => {
    insertionTargetRef.current = target;
    setInsertionTarget(target);
  }, []);

  const applyLiveInsertionTarget = useCallback(
    (target: InsertionTarget | null, draggedTileIds: string[]) => {
      const previewKey = target
        ? `${target.row}:${target.slotIndex}`
        : null;

      if (livePreviewKeyRef.current === previewKey) return;

      livePreviewKeyRef.current = previewKey;
      setCurrentInsertionTarget(target);
      configureRackReflowAnimation();

      setRackSlots(
        target
          ? getPreviewSlotsForDrag(
              target.nextSlots,
              dragStartSlotsRef.current,
              draggedTileIds,
            )
          : dragStartSlotsRef.current ?? rackSlotsRef.current,
      );
    },
    [setCurrentInsertionTarget],
  );

  const onSelectTileRef = useRef(onSelectTile);
  const onMoveTileRef = useRef(onMoveTile);
  const onMoveTilesRef = useRef(onMoveTiles);
  const onDropMeldGroupRef = useRef(onDropMeldGroup);
  const onDropTileRef = useRef(onDropTile);
  const onTileDragPointChangeRef = useRef(onTileDragPointChange);
  const onExternalDropPlacedRef = useRef(onExternalDropPlaced);
  const tileRectsRef = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const tilePanHandlersRef = useRef<Record<string, any>>({});

  useEffect(() => {
    onSelectTileRef.current = onSelectTile;
    onMoveTileRef.current = onMoveTile;
    onMoveTilesRef.current = onMoveTiles;
    onDropMeldGroupRef.current = onDropMeldGroup;
    onDropTileRef.current = onDropTile;
    onTileDragPointChangeRef.current = onTileDragPointChange;
    onExternalDropPlacedRef.current = onExternalDropPlaced;
  }, [onSelectTile, onMoveTile, onMoveTiles, onDropMeldGroup, onDropTile, onTileDragPointChange, onExternalDropPlaced]);

  useEffect(() => {
    if (initialTileIdsRef.current.length === 0) return;
    const timeout = setTimeout(() => {
      setEnteringTileIds((current) => {
        const next = new Set(current);
        initialTileIdsRef.current.forEach((tileId) => next.delete(tileId));
        return next;
      });
    }, RACK_TILE_ENTER_MS + RACK_DEAL_BATCH_STAGGER_MS * 6 + 120);
    enterAnimationTimeoutsRef.current.push(timeout);
  }, []);

  useEffect(() => {
    setRackSlots((current) => syncSlotsWithTiles(current, tiles, fixedDrawTileId));
  }, [fixedDrawTileId, tiles]);

useEffect(() => {
  // dealResetKey may change because of server updates.
  // Do not restart the enter animation for tiles already on the rack.
  if (!dealResetKey) return;

  const currentTileIds = new Set(tiles.map((tile) => tile.id));

  setEnteringTileIds((current) => {
    const next = new Set<string>();

    for (const tileId of current) {
      if (currentTileIds.has(tileId)) {
        next.add(tileId);
      }
    }

    return next;
  });
}, [dealResetKey, tiles]);

  useEffect(() => {
    const previousTileIds = previousTileIdsRef.current;
    const returningIds = tiles
      .filter((tile) => tile.jokerOrigin === "stolen" && !previousTileIds.has(tile.id))
      .map((tile) => tile.id);
    previousTileIdsRef.current = new Set(tiles.map((tile) => tile.id));
    if (returningIds.length === 0) return;

    setReturningJokerTileIds((current) => new Set([...current, ...returningIds]));
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

  useEffect(() => () => {
    enterAnimationTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    enterAnimationTimeoutsRef.current = [];
  }, []);
  useEffect(() => {
    const scoringSlots = rackSlots;
    const rows = ROW_ORDER.map((row) => {
      const rowSets: OkeyTile[][] = [];
      let currentSet: OkeyTile[] = [];

      for (const tileId of scoringSlots[row]) {
        const tile = tileId && !stagedTileIdSet.has(tileId) ? tileById.get(tileId) : null;
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
    onOpenableMeldsChange?.(openableMelds);
  }, [okeyTile, onOpenableMeldsChange, onRackScoreChange, rackSlots, stagedTileIdSet, tileById]);

  const availableRackTileWidth =
    rackViewportWidth > 0
      ? Math.max(0, rackViewportWidth - RACK_TILE_SIDE_PADDING * 2)
      : RACK_ROW_CAPACITY * RACK_TILE_WIDTH + (RACK_ROW_CAPACITY - 1) * RACK_TILE_GAP;
  const rackTileWidth = Math.min(
    RACK_TILE_WIDTH,
    (availableRackTileWidth - RACK_TILE_GAP * (RACK_ROW_CAPACITY - 1)) / RACK_ROW_CAPACITY,
  );
  const rackTileHeight = rackTileWidth * RACK_TILE_ASPECT_RATIO;
  const rackTileStride = rackTileWidth + RACK_TILE_GAP;

  const rackTileWidthRef = useRef(rackTileWidth);
  const rackTileHeightRef = useRef(rackTileHeight);
  const rackTileStrideRef = useRef(rackTileStride);
  useEffect(() => {
    rackTileWidthRef.current = rackTileWidth;
    rackTileHeightRef.current = rackTileHeight;
    rackTileStrideRef.current = rackTileStride;
  }, [rackTileWidth, rackTileHeight, rackTileStride]);

  const measureRackTile = useCallback((tileId: string) => {
    tileRefs.current[tileId]?.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };
      tileRectsRef.current[tileId] = rect;
      onTileMeasured?.(tileId, rect);
    });
  }, [onTileMeasured]);

useEffect(() => {
  if (dragStartedRef.current) return;

  for (const row of ROW_ORDER) {
    for (const tileId of rackSlots[row]) {
      if (tileId) measureRackTile(tileId);
    }
  }
}, [measureRackTile, rackSlots, rackTileHeight, rackTileWidth]);
const getTouchPoint = (
  _event: GestureResponderEvent,
  gesture: PanResponderGestureState,
  useStartPoint = false,
) => ({
  x: useStartPoint ? gesture.x0 : gesture.moveX,
  y: useStartPoint ? gesture.y0 : gesture.moveY,
});
const setDragPositionFromTouch = useCallback((moveX: number, moveY: number) => {
  const viewport = viewportOriginRef.current;
  const touchedTileIndex = draggingMeldRef.current?.touchedTileIndex ?? 0;
  latestDragPointRef.current = { x: moveX, y: moveY };
  dragPosition.setValue({
    x: moveX - viewport.x - dragTouchOffsetRef.current.x - touchedTileIndex * rackTileStride,
    y: moveY - viewport.y - dragTouchOffsetRef.current.y,
  });
}, [dragPosition, rackTileStride]);

  const animateDragBack = useCallback((tileIds: string[], originalSlots: RackSlots, onDone: () => void) => {
    const firstTileId = tileIds[0];
    let origin: DragOrigin | null = null;
    for (const row of ROW_ORDER) {
      const slotIndex = originalSlots[row].indexOf(firstTileId);
      if (slotIndex >= 0) { origin = { row, slotIndex }; break; }
    }
    const rowLayout = origin ? rowLayoutsRef.current[origin.row] : null;
    if (!origin || !rowLayout) { onDone(); return; }
    Animated.spring(dragPosition, {
      toValue: { x: origin.slotIndex * rackTileStride, y: rowLayout.y },
      stiffness: 260,
      damping: 28,
      mass: 0.8,
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) onDone(); });
  }, [dragPosition, rackTileStride]);

  const measureViewport = useCallback((onMeasured?: () => void) => {
    if (!viewportRef.current) {
      onMeasured?.();
      return;
    }

    rackRef.current?.measureInWindow((x, y, width, height) => {
      onRackMeasured?.({ x, y, width, height });
    });
    viewportRef.current.measureInWindow((x, y, width, height) => {
      viewportOriginRef.current = { x, y, width, height };
      setRackViewportWidth(width);
      onMeasured?.();
    });
  }, [onRackMeasured]);

  const updateRowLayout = (row: RackRow, event: LayoutChangeEvent) => {
    rowLayoutsRef.current[row] = event.nativeEvent.layout;
  };

  const getDropRow = useCallback((localY: number): RackRow | null => {
    const topLayout = rowLayoutsRef.current.top;
    const bottomLayout = rowLayoutsRef.current.bottom;
    if (!topLayout || !bottomLayout) return null;
    if (localY >= topLayout.y && localY <= topLayout.y + topLayout.height) return "top";
    if (localY >= bottomLayout.y && localY <= bottomLayout.y + bottomLayout.height) return "bottom";
    const snapPadding = rackTileHeight * ROW_SNAP_PADDING_RATIO;
    const candidates = (["top", "bottom"] as RackRow[])
      .map((row) => {
        const layout = rowLayoutsRef.current[row]!;
        const insideSnapBand = localY >= layout.y - snapPadding && localY <= layout.y + layout.height + snapPadding;
        return { row, insideSnapBand, distance: Math.abs(localY - (layout.y + layout.height / 2)) };
      })
      .filter((candidate) => candidate.insideSnapBand)
      .sort((left, right) => left.distance - right.distance);
    return candidates[0]?.row ?? null;
  }, [rackTileHeight]);

  const getInsertionTarget = useCallback(
    (tileId: string, gesture: { moveX: number; moveY: number }, sourceSlots?: RackSlots) => {
      const actualSourceSlots = sourceSlots ?? rackSlotsRef.current;
      const viewport = viewportOriginRef.current;
      if (viewport.width <= 0 || viewport.height <= 0) return null;

      const localX = gesture.moveX - viewport.x;
      const localY = gesture.moveY - viewport.y;
      const targetRow = getDropRow(localY);
      if (!targetRow) return null;

      const rowStartX = 0;
      const rowEndX = rowStartX + (RACK_ROW_CAPACITY - 1) * rackTileStride + rackTileWidth;
      if (localX < rowStartX - rackTileWidth / 2 || localX > rowEndX + rackTileWidth / 2) {
        return null;
      }

      const insertionX = localX - rowStartX;
      const rawSlotIndex = Math.floor((insertionX + rackTileWidth / 2) / rackTileStride);
      let slotIndex = Math.max(0, Math.min(RACK_ROW_CAPACITY - 1, rawSlotIndex));
      const activeTarget = insertionTargetRef.current;
      if (activeTarget?.row === targetRow) {
        const activeCenterX = activeTarget.slotIndex * rackTileStride + rackTileWidth / 2;
        if (Math.abs(localX - activeCenterX) <= rackTileStride * SLOT_TARGET_HYSTERESIS_RATIO) {
          slotIndex = activeTarget.slotIndex;
        }
      }
      const moveTarget = moveTileIntoSlot(actualSourceSlots, tileId, targetRow, slotIndex);
      if (!moveTarget) return null;

      const flatIndex = getFlatIndexForSlot(moveTarget.slots, moveTarget.row, moveTarget.slotIndex);

      return { row: moveTarget.row, slotIndex: moveTarget.slotIndex, flatIndex, nextSlots: moveTarget.slots };
    },
    [getDropRow, rackTileStride, rackTileWidth],
  );

  const getExternalDropTarget = useCallback((tileId: string, point: { x: number; y: number }) => {
    const viewport = viewportOriginRef.current;
    if (viewport.width <= 0 || viewport.height <= 0) return null;

    const localX = point.x - viewport.x;
    const localY = point.y - viewport.y;
    const targetRow = getDropRow(localY);
    if (!targetRow) return null;

    const rowEndX = (RACK_ROW_CAPACITY - 1) * rackTileStride + rackTileWidth;
    if (localX < -rackTileWidth / 2 || localX > rowEndX + rackTileWidth / 2) return null;

    const rawSlotIndex = Math.floor((localX + rackTileWidth / 2) / rackTileStride);
    const desiredSlotIndex = Math.max(0, Math.min(RACK_ROW_CAPACITY - 1, rawSlotIndex));
    const nextSlots = cloneSlots(rackSlotsRef.current);
    for (const row of ROW_ORDER) {
      const originIndex = nextSlots[row].findIndex((entry) => entry === tileId);
      if (originIndex >= 0) nextSlots[row][originIndex] = null;
    }

    const rowSlots = nextSlots[targetRow];
    let slotIndex = desiredSlotIndex;
    if (rowSlots[slotIndex] !== null) {
      let right = slotIndex + 1;
      while (right < RACK_ROW_CAPACITY && rowSlots[right] !== null) right += 1;
      let left = slotIndex - 1;
      while (left >= 0 && rowSlots[left] !== null) left -= 1;
      if (right < RACK_ROW_CAPACITY && (left < 0 || right - slotIndex <= slotIndex - left)) {
        for (let index = right; index > slotIndex; index -= 1) rowSlots[index] = rowSlots[index - 1];
      } else if (left >= 0) {
        for (let index = left; index < slotIndex; index += 1) rowSlots[index] = rowSlots[index + 1];
      } else {
        return null;
      }
    }

    rowSlots[slotIndex] = tileId;
    const flatIndex = getFlatIndexForSlot(nextSlots, targetRow, slotIndex);
    return { row: targetRow, slotIndex, flatIndex, nextSlots };
  }, [rackTileStride, rackTileWidth, getDropRow]);

  useEffect(() => {
    if (!externalDropPlacement || consumedExternalDropNonceRef.current === externalDropPlacement.nonce) return;
    if (!tileById.has(externalDropPlacement.tileId)) return;

    const target = getExternalDropTarget(externalDropPlacement.tileId, externalDropPlacement.point);
    if (!target) return;

    consumedExternalDropNonceRef.current = externalDropPlacement.nonce;
    setEnteringTileIds((current) => {
      const next = new Set(current);
      next.delete(externalDropPlacement.tileId);
      return next;
    });
    setRackSlots(target.nextSlots);
    onExternalDropPlaced?.(externalDropPlacement.tileId, target.flatIndex);
  }, [externalDropPlacement, getExternalDropTarget, onExternalDropPlaced, tileById]);
  const getGroupInsertionTarget = useCallback(
    (tileIds: string[], gesture: { moveX: number; moveY: number }, sourceSlots?: RackSlots) => {
      const actualSourceSlots = sourceSlots ?? rackSlotsRef.current;
      const viewport = viewportOriginRef.current;
      if (viewport.width <= 0 || viewport.height <= 0 || tileIds.length === 0) return null;

      const localX = gesture.moveX - viewport.x;
      const localY = gesture.moveY - viewport.y;
      const targetRow = getDropRow(localY);
      if (!targetRow) return null;

      const groupWidth = tileIds.length * rackTileStride - RACK_TILE_GAP;
      const rowStartX = 0;
      const rowEndX = rowStartX + (RACK_ROW_CAPACITY - 1) * rackTileStride + rackTileWidth;
      if (localX < rowStartX - groupWidth / 2 || localX > rowEndX + groupWidth / 2) return null;

      const touchedTileOffset = (draggingMeldRef.current?.touchedTileIndex ?? 0) * rackTileStride;
      const insertionX = localX - rowStartX - touchedTileOffset;
      const rawSlotIndex = Math.floor((insertionX + rackTileWidth / 2) / rackTileStride);
      let slotIndex = Math.max(0, Math.min(RACK_ROW_CAPACITY - tileIds.length, rawSlotIndex));
      const activeTarget = insertionTargetRef.current;
      if (activeTarget?.row === targetRow) {
        const activeTouchedCenterX =
          (activeTarget.slotIndex + (draggingMeldRef.current?.touchedTileIndex ?? 0)) * rackTileStride
          + rackTileWidth / 2;
        if (Math.abs(localX - activeTouchedCenterX) <= rackTileStride * SLOT_TARGET_HYSTERESIS_RATIO) {
          slotIndex = activeTarget.slotIndex;
        }
      }
      const moveTarget = moveTilesIntoSlot(actualSourceSlots, tileIds, targetRow, slotIndex);
      if (!moveTarget) return null;

      const flatIndex = getFlatIndexForSlot(moveTarget.slots, moveTarget.row, moveTarget.slotIndex);
      return { row: moveTarget.row, slotIndex: moveTarget.slotIndex, flatIndex, nextSlots: moveTarget.slots };
    },
    [getDropRow, rackTileStride, rackTileWidth],
  );

  useEffect(() => {
    if (!externalHoverPoint || externalDropPlacement) {
      setExternalHoverTarget(null);
      return;
    }

    const previewTileId = "__external_discard_preview__";
    setExternalHoverTarget(getExternalDropTarget(previewTileId, externalHoverPoint));
  }, [externalDropPlacement, externalHoverPoint, getExternalDropTarget]);

  const renderInsertionIndicator = (row: RackRow, slotIndex: number) => {
    const activeTarget = insertionTarget ?? externalHoverTarget;
    if (!activeTarget || activeTarget.row !== row || activeTarget.slotIndex !== slotIndex) {
      return null;
    }
    return <View pointerEvents="none" style={[styles.rackSlotIndicator, { width: rackTileWidth, height: rackTileHeight }]} />;
  };

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startMeldLongPressTimer = useCallback((tileId: string) => {
    clearLongPressTimer();

    longPressTimerRef.current = setTimeout(() => {
      const tile = tileByIdRef.current.get(tileId);
      if (!tile) return;

      if (isOkeyWildcard(tile, okeyTileRef.current)) {
        wildcardLongPressHandledRef.current = true;

        setFlippedTileIds((current) => {
          const next = new Set(current);

          if (next.has(tileId)) {
            next.delete(tileId);
          } else {
            next.add(tileId);
          }

          return next;
        });

        return;
      }

      const origin = getTileOrigin(rackSlotsRef.current, tileId);
      if (!origin) return;

      const rowTiles = getRowTilesFromSlots(
        rackSlotsRef.current[origin.row],
        tileByIdRef.current,
        stagedTileIdSet,
      );

      const meld = getBestMeldIncludingSlot(
        rowTiles,
        origin.row,
        origin.slotIndex,
        okeyTileRef.current,
      );

      if (!meld) return;

      draggingMeldRef.current = meld;
      setDragPositionFromTouch(latestDragPointRef.current.x, latestDragPointRef.current.y);
      setDraggingMeld(meld);
      setDraggingTileId(null);
      setCurrentInsertionTarget(null);
    }, GROUP_LONG_PRESS_MS);
  }, [clearLongPressTimer, setCurrentInsertionTarget, setDragPositionFromTouch, stagedTileIdSet]);

  const getTilePanHandlers = useCallback((tileId: string) => {
    if (tilePanHandlersRef.current[tileId]) return tilePanHandlersRef.current[tileId];

    const panHandlers = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => Math.hypot(gesture.dx, gesture.dy) >= DRAG_ACTIVATION_DISTANCE,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event, gesture) => {
        dragStartedRef.current = false;
        wildcardLongPressHandledRef.current = false;
        draggingMeldRef.current = null;
        setDraggingTileId(null);
        setDraggingMeld(null);
        setCurrentInsertionTarget(null);
        livePreviewKeyRef.current = null;
        dragStartSlotsRef.current = cloneSlots(rackSlotsRef.current);
        const startPoint = getTouchPoint(event, gesture, true);
        latestDragPointRef.current = startPoint;
        dragTouchOffsetRef.current = { x: rackTileWidthRef.current / 2, y: rackTileHeightRef.current / 2 };
        measureViewport(() => {
          const cachedRect = tileRectsRef.current[tileId];
          if (cachedRect) {
            dragTouchOffsetRef.current = {
              x: Math.max(0, Math.min(cachedRect.width, startPoint.x - cachedRect.x)),
              y: Math.max(0, Math.min(cachedRect.height, startPoint.y - cachedRect.y)),
            };
            setDragPositionFromTouch(startPoint.x, startPoint.y);
            return;
          }

          tileRefs.current[tileId]?.measureInWindow((x, y, width, height) => {
            dragTouchOffsetRef.current = {
              x: Math.max(0, Math.min(width, startPoint.x - x)),
              y: Math.max(0, Math.min(height, startPoint.y - y)),
            };
            setDragPositionFromTouch(startPoint.x, startPoint.y);
          });
        });
        startMeldLongPressTimer(tileId);
      },
      onPanResponderMove: (event, gesture) => {
        if (Math.abs(gesture.dx) > GROUP_LONG_PRESS_MOVE_TOLERANCE || Math.abs(gesture.dy) > GROUP_LONG_PRESS_MOVE_TOLERANCE) clearLongPressTimer();
        if (Math.hypot(gesture.dx, gesture.dy) < DRAG_ACTIVATION_DISTANCE) return;

        if (!dragStartedRef.current) {
          dragStartedRef.current = true;

          if (!draggingMeldRef.current) {
            setDraggingTileId(tileId);
          }
        }
        const point = getTouchPoint(event, gesture);
        setDragPositionFromTouch(point.x, point.y);

        const currentDraggingMeld = draggingMeldRef.current;
        onTileDragPointChangeRef.current?.(currentDraggingMeld ? null : tileId, currentDraggingMeld ? null : point);
        const sourceSlots = dragStartSlotsRef.current ?? rackSlotsRef.current;
        const target = currentDraggingMeld
          ? getGroupInsertionTarget(currentDraggingMeld.tileIds, { moveX: point.x, moveY: point.y }, sourceSlots)
          : getInsertionTarget(tileId, { moveX: point.x, moveY: point.y }, sourceSlots);
        applyLiveInsertionTarget(target, currentDraggingMeld?.tileIds ?? [tileId]);
      },
      onPanResponderRelease: (event, gesture) => {
        clearLongPressTimer();
        const moved = dragStartedRef.current;
        const currentDraggingMeld = draggingMeldRef.current;
        const point = getTouchPoint(event, gesture);
        const sourceSlots = dragStartSlotsRef.current ?? rackSlotsRef.current;
        const target = insertionTargetRef.current ?? (currentDraggingMeld
          ? getGroupInsertionTarget(currentDraggingMeld.tileIds, { moveX: point.x, moveY: point.y }, sourceSlots)
          : getInsertionTarget(tileId, { moveX: point.x, moveY: point.y }, sourceSlots));
        const originalSlots = dragStartSlotsRef.current;
        const clearDragState = () => {
          draggingMeldRef.current = null;
          setDraggingTileId(null);
          setDraggingMeld(null);
          setCurrentInsertionTarget(null);
          dragStartedRef.current = false;
          dragStartSlotsRef.current = null;
          livePreviewKeyRef.current = null;
          onTileDragPointChangeRef.current?.(null, null);
        };

        if (currentDraggingMeld && moved) {
          if (target) {
            clearDragState();
            setRackSlots(target.nextSlots);
            onMoveTilesRef.current?.(currentDraggingMeld.tileIds, target.flatIndex);
            return;
          }
          const dropped = onDropMeldGroupRef.current?.(currentDraggingMeld, point) ?? false;
          if (!dropped && originalSlots) {
            animateDragBack(currentDraggingMeld.tileIds, originalSlots, () => {
              configureRackReflowAnimation();
              setRackSlots(originalSlots);
              clearDragState();
            });
            return;
          }
          clearDragState();
          return;
        }

        if (!moved) {
          const wasWildcardLongPress = wildcardLongPressHandledRef.current;

          clearDragState();
          wildcardLongPressHandledRef.current = false;

          if (wasWildcardLongPress) {
            return;
          }

          onSelectTileRef.current(tileId);
          return;
        }

        if (!target) {
          const dropped = onDropTileRef.current?.(tileId, point) ?? false;
          if (!dropped && originalSlots) {
            animateDragBack([tileId], originalSlots, () => {
              configureRackReflowAnimation();
              setRackSlots(originalSlots);
              clearDragState();
            });
            return;
          }
          clearDragState();
          return;
        }

        clearDragState();
        setRackSlots(target.nextSlots);
        onMoveTileRef.current(tileId, target.flatIndex);
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer();
        const originalSlots = dragStartSlotsRef.current;
        draggingMeldRef.current = null;
        dragStartedRef.current = false;
        setDraggingTileId(null);
        setDraggingMeld(null);
        setCurrentInsertionTarget(null);
        if (originalSlots) {
          configureRackReflowAnimation();
          setRackSlots(originalSlots);
        }
        dragStartSlotsRef.current = null;
        livePreviewKeyRef.current = null;
        onTileDragPointChangeRef.current?.(null, null);
      },
    }).panHandlers;

    tilePanHandlersRef.current[tileId] = panHandlers;
    return panHandlers;
  }, [applyLiveInsertionTarget, animateDragBack, clearLongPressTimer, getGroupInsertionTarget, getInsertionTarget, measureViewport, setCurrentInsertionTarget, setDragPositionFromTouch, startMeldLongPressTimer]);

    const renderRackTile = (tileId: string, row: RackRow, slotIndex: number) => {
    const tile = tileById.get(tileId);
    if (!tile) return null;

    const isStaged = stagedTileIdSet.has(tile.id);
    const isGroupSelected = draggingMeld?.tileIds.includes(tile.id) ?? false;
    const isAnimationHidden = hiddenTileIdSet.has(tile.id);
    const shouldHideTile = draggingTileId === tile.id || isStaged || isGroupSelected || isAnimationHidden;
    const accessibilityIndex = getFlatIndexForSlot(rackSlots, row, slotIndex);
    const moveForAccessibility = (targetIndex: number) => {
      if (eliminated || isStaged) return;
      onMoveTile(tile.id, targetIndex);
      onSelectTile(tile.id);
    };

    const tileFace = (
<OkeyTileFace
  tile={tile}
  selected={selectedTileId === tile.id || isGroupSelected}
  isWildcard={isOkeyWildcard(tile, okeyTile)}
  flipped={isOkeyWildcard(tile, okeyTile) && flippedTileIds.has(tile.id)}
  onPress={() => onSelectTile(tile.id)}
  onAccessibilityMovePrevious={accessibilityIndex > 0 ? () => moveForAccessibility(accessibilityIndex - 1) : undefined}
  onAccessibilityMoveNext={accessibilityIndex < tiles.length - 1 ? () => moveForAccessibility(accessibilityIndex + 1) : undefined}
  panHandlers={getTilePanHandlers(tile.id)}
  width={rackTileWidth}
  height={rackTileHeight}
/>
    );

    return (
      <View
        ref={(node) => { tileRefs.current[tile.id] = node; }}
        collapsable={false}
        onLayout={() => {
          // Avoid expensive measurements while an active drag is in progress.
          // Measurements are still performed outside of drag via the measureRackTile
          // effect to keep tile rects up-to-date for flights and drops.
          if (dragStartedRef.current) return;
          tileRefs.current[tile.id]?.measureInWindow((x, y, width, height) => {
            const rect = { x, y, width, height };
            tileRectsRef.current[tile.id] = rect;
            onTileMeasured?.(tile.id, rect);
          });
        }}
        style={shouldHideTile ? styles.hiddenRackTile : undefined}
      >
        {returningJokerTileIds.has(tile.id) && !shouldHideTile ? (
          <ReturningJokerTile height={rackTileHeight}>{tileFace}</ReturningJokerTile>
        ) : enteringTileIds.has(tile.id) && !shouldHideTile && !skipEnterAnimationTileIdSet.has(tile.id) ? (
          <EnteringRackTile
            height={rackTileHeight}
            fromX={
              dealOrigin
                ? dealOrigin.x - (viewportOriginRef.current.x + (slotIndex + 0.5) * rackTileStride)
                : rackViewportWidth / 2 - (slotIndex + 0.5) * rackTileStride
            }
            fromY={
              dealOrigin
                ? dealOrigin.y - (viewportOriginRef.current.y + (row === "top" ? rackTileHeight * 0.5 : rackTileHeight * 1.5))
                : undefined
            }
            delay={getSlotEnterDelay(row, slotIndex, isDealer)}
          >
            {tileFace}
          </EnteringRackTile>
        ) : tileFace}
      </View>
    );
  };

  const renderRackSlot = (row: RackRow, slotIndex: number) => {
    const tileId = rackSlots[row][slotIndex];
    return (
      <View
        key={`${row}-${slotIndex}`}
        style={[styles.rackSlot, { width: rackTileWidth, height: rackTileHeight }]}
      >
        {renderInsertionIndicator(row, slotIndex)}
        {tileId ? renderRackTile(tileId, row, slotIndex) : null}
      </View>
    );
  };

const renderRackRow = (row: RackRow) => {
  const bottomInset = row === "bottom" ? rackTileHeight * 0.38 : 0;

  return (
    <View
      style={[
        styles.rackRail,
        row === "bottom" && { paddingBottom: bottomInset },
      ]}
      onLayout={(event) => updateRowLayout(row, event)}
    >
      <View style={styles.rackRow}>
        {Array.from({ length: RACK_ROW_CAPACITY }).map((_, slotIndex) =>
          renderRackSlot(row, slotIndex),
        )}
      </View>
    </View>
  );
};

  const draggingTile = draggingTileId ? tileById.get(draggingTileId) : null;
  const meldStackReveal = rackTileWidth / 6;
  const overlayWidth = draggingMeld ? getOkeyMeldWidth(draggingMeld, rackTileWidth, meldStackReveal) : rackTileWidth;

  return (
    <View
  style={[
    styles.rackWrap,
    layout.rackWrap,
    (draggingTile || draggingMeld) &&
      styles.activeRackDragLayer,
  ]}
>
      <View ref={rackRef} onLayout={() => measureViewport()} style={[styles.playerRack, layout.playerRack]}>
        <OkeyTurnTimerBar active={turnTimerActive} resetKey={turnTimerResetKey} style={styles.rackTurnTimer} />
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
          onLayout={() => measureViewport()}
          style={[
            styles.rackTileViewport,
            styles.rackScroll,
            (draggingTile || draggingMeld) && styles.activeRackDragViewport,
          ]}
        >
          <View style={styles.rackRows}>{renderRackRow("top")}{renderRackRow("bottom")}</View>
{draggingTile || draggingMeld ? (
  <Animated.View
    pointerEvents="none"
    style={[
      styles.draggedTileOverlay,
      {
        width: overlayWidth,
        height: rackTileHeight,
        transform: dragPosition.getTranslateTransform(),
      },
    ]}
  >
    
              {draggingMeld ? (
                <Animated.View
                  style={{ transform: [{ scale: draggedMeldScale }] }}
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
                  isWildcard={isOkeyWildcard(draggingTile, okeyTile)}
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

export const MemoizedOkeyPlayerRack = memo(OkeyPlayerRack);
