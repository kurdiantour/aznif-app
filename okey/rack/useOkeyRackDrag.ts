import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";

import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import {
  DRAG_ACTIVATION_DISTANCE,
  GROUP_LONG_PRESS_MS,
  ROW_ORDER,
  ROW_SNAP_PADDING_RATIO,
  cloneSlots,
  getBestMeldIncludingSlot,
  getExternalDropTargetForPoint,
  getGroupInsertionTargetForPoint,
  getInitialRackSlots,
  getInsertionTargetForPoint,
  getRowTilesFromSlots,
  getRackRowTileTop,
  getTileOrigin,
  moveTileIntoSlot,
  moveTilesIntoSlot,
  type DragOrigin,
  type DraggingMeld,
  type ExternalDropPlacement,
  type RackRow,
  type RackRowLayout,
  type RackSlots,
} from "@/okey/rack/rack-layout";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";

type ViewportRect = { x: number; y: number; width: number; height: number };

function rackSlotsEqual(left: RackSlots, right: RackSlots) {
  return ROW_ORDER.every((row) =>
    left[row].every((tileId, index) => tileId === right[row][index]),
  );
}

type UseOkeyRackDragParams = {
  tiles: OkeyTile[];
  okeyTile: OkeyTile;
  stagedTileIdSet: Set<string>;
  rackInteractionLocked: boolean;

  rackTileWidth: number;
  rackTileHeight: number;
  rackTileStride: number;

  viewportOriginRef: MutableRefObject<ViewportRect>;
  rowLayoutsRef: MutableRefObject<Record<RackRow, RackRowLayout | null>>;

  onSelectTile: (tileId: string) => void;
  onTileDragStart?: (tileId: string) => void;
  onDropMeldGroup?: (meld: OkeyMeld, point: { x: number; y: number }) => boolean;
  onDropTile?: (tileId: string, point: { x: number; y: number }) => boolean;
  onTileDragPointChange?: (
    tileId: string | null,
    point: { x: number; y: number } | null,
  ) => void;

  externalDropPlacement?: ExternalDropPlacement | null;
  onExternalDropPlaced?: (tileId: string) => void;

};

/**
 * Local rack invariant:
 * - Internal rack reorder never writes back to parent/game state.
 * - Parent/game state owns tile membership (draw/discard/open), not visual ordering.
 * - Drag hover uses refs/transforms only; one local React commit happens on release.
 */
export function useOkeyRackDrag({
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
}: UseOkeyRackDragParams) {
  const [committedRackSlots, setCommittedRackSlots] = useState<RackSlots>(() =>
    getInitialRackSlots(tiles),
  );

  // Important: there is intentionally no previewRackSlots state here.
  // During hover the real tile tree stays stable. Only neighbor transforms move.
  const rackSlots = committedRackSlots;

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
  const dragStartedRef = useRef(false);
  const dragStartSlotsRef = useRef<RackSlots | null>(null);
  const previewTargetRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wildcardLongPressHandledRef = useRef(false);
  const consumedExternalDropNonceRef = useRef<number | null>(null);
  const tileShiftValuesRef = useRef<Record<string, Animated.ValueXY>>({});
  const lastPreviewRef = useRef<RackSlots | null>(null);
  const tilePanHandlersRef = useRef<Record<string, any>>({});
  const rackInteractionLockedRef = useRef(rackInteractionLocked);

  const committedRackSlotsRef = useRef(committedRackSlots);
  const tileByIdRef = useRef(new Map(tiles.map((tile) => [tile.id, tile])));
  const okeyTileRef = useRef(okeyTile);
  const stagedTileIdSetRef = useRef(stagedTileIdSet);

  const rackTileWidthRef = useRef(rackTileWidth);
  const rackTileHeightRef = useRef(rackTileHeight);
  const rackTileStrideRef = useRef(rackTileStride);

  const onSelectTileRef = useRef(onSelectTile);
  const onTileDragStartRef = useRef(onTileDragStart);
  const onDropMeldGroupRef = useRef(onDropMeldGroup);
  const onDropTileRef = useRef(onDropTile);
  const onTileDragPointChangeRef = useRef(onTileDragPointChange);
  const onExternalDropPlacedRef = useRef(onExternalDropPlaced);

  const dragPointFrameRef = useRef<number | null>(null);
  const externalHoverActiveRef = useRef(false);
  const pendingDragPointRef = useRef<{
    tileId: string | null;
    point: { x: number; y: number } | null;
  } | null>(null);

  useEffect(() => {
    committedRackSlotsRef.current = committedRackSlots;
  }, [committedRackSlots]);

  const commitRackSlots = useCallback((nextSlots: RackSlots) => {
    if (rackSlotsEqual(committedRackSlotsRef.current, nextSlots)) return;
    committedRackSlotsRef.current = nextSlots;
    setCommittedRackSlots(nextSlots);
  }, []);

  useEffect(() => {
    rackInteractionLockedRef.current = rackInteractionLocked;
  }, [rackInteractionLocked]);

  useEffect(() => {
    tileByIdRef.current = new Map(tiles.map((tile) => [tile.id, tile]));

    const activeTileIds = new Set(tiles.map((tile) => tile.id));
    for (const tileId of Object.keys(tilePanHandlersRef.current)) {
      if (!activeTileIds.has(tileId)) {
        delete tilePanHandlersRef.current[tileId];
      }
    }
    for (const tileId of Object.keys(tileShiftValuesRef.current)) {
      if (!activeTileIds.has(tileId)) {
        tileShiftValuesRef.current[tileId].stopAnimation();
        delete tileShiftValuesRef.current[tileId];
      }
    }
  }, [tiles]);

  useEffect(() => {
    okeyTileRef.current = okeyTile;
  }, [okeyTile]);

  useEffect(() => {
    stagedTileIdSetRef.current = stagedTileIdSet;
  }, [stagedTileIdSet]);

  useEffect(() => {
    rackTileWidthRef.current = rackTileWidth;
    rackTileHeightRef.current = rackTileHeight;
    rackTileStrideRef.current = rackTileStride;
  }, [rackTileHeight, rackTileStride, rackTileWidth]);

  useEffect(() => {
    onSelectTileRef.current = onSelectTile;
    onTileDragStartRef.current = onTileDragStart;
    onDropMeldGroupRef.current = onDropMeldGroup;
    onDropTileRef.current = onDropTile;
    onTileDragPointChangeRef.current = onTileDragPointChange;
    onExternalDropPlacedRef.current = onExternalDropPlaced;
  }, [
    onDropMeldGroup,
    onDropTile,
    onExternalDropPlaced,
    onSelectTile,
    onTileDragStart,
    onTileDragPointChange,
  ]);

  useEffect(() => {
    draggedMeldScale.stopAnimation();

    if (!draggingMeld) {
      draggedMeldScale.setValue(1);
      return;
    }

    // Tiny "picked up" feedback for a grabbed set/group.
    // No bounce: just a very fast lift, then hold that scale while dragging.
    draggedMeldScale.setValue(1);
    Animated.timing(draggedMeldScale, {
      toValue: 1.06,
      duration: 60,
      useNativeDriver: true,
    }).start();
  }, [draggedMeldScale, draggingMeld]);

  const getTileShiftValue = useCallback((tileId: string) => {
    const existing = tileShiftValuesRef.current[tileId];
    if (existing) return existing;

    // Preview transforms preserve the stable tile tree until release.
    const value = new Animated.ValueXY({ x: 0, y: 0 });
    tileShiftValuesRef.current[tileId] = value;
    return value;
  }, []);

  const resetNeighborShifts = useCallback(() => {
    if (!lastPreviewRef.current) return;
    lastPreviewRef.current = null;
    for (const value of Object.values(tileShiftValuesRef.current)) {
      value.stopAnimation();
      value.setValue({ x: 0, y: 0 });
    }
  }, []);

  const applyRackPreview = useCallback(
    (originalSlots: RackSlots, previewSlots: RackSlots, draggedTileIds: Set<string>) => {
      if (lastPreviewRef.current && rackSlotsEqual(lastPreviewRef.current, previewSlots)) return;
      lastPreviewRef.current = previewSlots;
      for (const row of ROW_ORDER) {
        for (let slotIndex = 0; slotIndex < originalSlots[row].length; slotIndex += 1) {
          const tileId = originalSlots[row][slotIndex];
          if (!tileId || draggedTileIds.has(tileId)) continue;

          const previewOrigin = getTileOrigin(previewSlots, tileId);
          if (!previewOrigin) continue;

          const fromLayout = rowLayoutsRef.current[row];
          const toLayout = rowLayoutsRef.current[previewOrigin.row];
          if (!fromLayout || !toLayout) continue;

          const fromTop =
            getRackRowTileTop(fromLayout, rackTileHeightRef.current);
          const toTop =
            getRackRowTileTop(toLayout, rackTileHeightRef.current);

          const value = getTileShiftValue(tileId);
          value.stopAnimation();
          value.setValue({
            x: (previewOrigin.slotIndex - slotIndex) * rackTileStrideRef.current,
            y: toTop - fromTop,
          });
        }
      }
    },
    [getTileShiftValue, rowLayoutsRef],
  );

  const scheduleDragPointChange = useCallback(
    (tileId: string | null, point: { x: number; y: number } | null) => {
      if (!tileId && !externalHoverActiveRef.current) return;
      externalHoverActiveRef.current = tileId !== null;
      pendingDragPointRef.current = { tileId, point };

      if (dragPointFrameRef.current !== null) return;

      dragPointFrameRef.current = requestAnimationFrame(() => {
        dragPointFrameRef.current = null;
        const pending = pendingDragPointRef.current;
        pendingDragPointRef.current = null;
        if (!pending) return;
        onTileDragPointChangeRef.current?.(pending.tileId, pending.point);
      });
    },
    [],
  );

  const cancelScheduledDragPointChange = useCallback(() => {
    if (dragPointFrameRef.current !== null) {
      cancelAnimationFrame(dragPointFrameRef.current);
      dragPointFrameRef.current = null;
    }
    pendingDragPointRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelScheduledDragPointChange();
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    },
    [cancelScheduledDragPointChange],
  );

  const getTouchPoint = (
    event: GestureResponderEvent,
    gesture: PanResponderGestureState,
    useStartPoint = false,
  ) => {
    if (useStartPoint) {
      return { x: gesture.x0, y: gesture.y0 };
    }

    const { pageX, pageY } = event.nativeEvent;
    return {
      x: Number.isFinite(pageX) ? pageX : gesture.moveX,
      y: Number.isFinite(pageY) ? pageY : gesture.moveY,
    };
  };

  const setDragPositionFromTouch = useCallback(
    (moveX: number, moveY: number) => {
      const viewport = viewportOriginRef.current;
      const touchedTileIndex = draggingMeldRef.current?.touchedTileIndex ?? 0;

      latestDragPointRef.current = { x: moveX, y: moveY };

      dragPosition.setValue({
        x:
          moveX -
          viewport.x -
          dragTouchOffsetRef.current.x -
          touchedTileIndex * rackTileStrideRef.current,
        y: moveY - viewport.y - dragTouchOffsetRef.current.y,
      });
    },
    [dragPosition, viewportOriginRef],
  );

  const snapDragBack = useCallback(
    (tileIds: string[], originalSlots: RackSlots, onDone: () => void) => {
      const firstTileId = tileIds[0];
      let origin: DragOrigin | null = null;

      for (const row of ROW_ORDER) {
        const slotIndex = originalSlots[row].indexOf(firstTileId);
        if (slotIndex >= 0) {
          origin = { row, slotIndex };
          break;
        }
      }

      const rowLayout = origin ? rowLayoutsRef.current[origin.row] : null;
      if (!origin || !rowLayout) {
        onDone();
        return;
      }

      const targetPosition = {
        x: origin.slotIndex * rackTileStrideRef.current,
        y: getRackRowTileTop(rowLayout, rackTileHeightRef.current),
      };

      dragPosition.stopAnimation();
      Animated.timing(dragPosition, {
        toValue: targetPosition,
        duration: 90,
        useNativeDriver: true,
      }).start(() => {
        onDone();
      });
    },
    [dragPosition, rowLayoutsRef],
  );

  const getInsertionTarget = useCallback(
    (
      tileId: string,
      gesture: { moveX: number; moveY: number },
      sourceSlots?: RackSlots,
    ) =>
      getInsertionTargetForPoint({
        tileId,
        moveX: gesture.moveX,
        moveY: gesture.moveY,
        sourceSlots: sourceSlots ?? committedRackSlotsRef.current,
        viewport: viewportOriginRef.current,
        rowLayouts: rowLayoutsRef.current,
        rackTileWidth: rackTileWidthRef.current,
        rackTileHeight: rackTileHeightRef.current,
        rackTileStride: rackTileStrideRef.current,
        dragTouchOffsetX: dragTouchOffsetRef.current.x,
        rowSnapPaddingRatio: ROW_SNAP_PADDING_RATIO,
      }),
    [rowLayoutsRef, viewportOriginRef],
  );

  const getGroupInsertionTarget = useCallback(
    (
      tileIds: string[],
      gesture: { moveX: number; moveY: number },
      sourceSlots?: RackSlots,
    ) =>
      getGroupInsertionTargetForPoint({
        tileIds,
        moveX: gesture.moveX,
        moveY: gesture.moveY,
        sourceSlots: sourceSlots ?? committedRackSlotsRef.current,
        viewport: viewportOriginRef.current,
        rowLayouts: rowLayoutsRef.current,
        rackTileWidth: rackTileWidthRef.current,
        rackTileHeight: rackTileHeightRef.current,
        rackTileStride: rackTileStrideRef.current,
        touchedTileIndex:
          draggingMeldRef.current?.touchedTileIndex ?? 0,
        rowSnapPaddingRatio: ROW_SNAP_PADDING_RATIO,
      }),
    [rowLayoutsRef, viewportOriginRef],
  );

  const getExternalDropTarget = useCallback(
    (tileId: string, point: { x: number; y: number }, committedSlots: RackSlots) =>
      getExternalDropTargetForPoint({
        tileId,
        point,
        committedSlots,
        viewport: viewportOriginRef.current,
        rowLayouts: rowLayoutsRef.current,
        rackTileWidth: rackTileWidthRef.current,
        rackTileHeight: rackTileHeightRef.current,
        rackTileStride: rackTileStrideRef.current,
        rowSnapPaddingRatio: ROW_SNAP_PADDING_RATIO,
      }),
    [rowLayoutsRef, viewportOriginRef],
  );

  useLayoutEffect(() => {
    if (dragStartedRef.current || dragStartSlotsRef.current) return;

    const pendingExternalPlacement =
      externalDropPlacement &&
      consumedExternalDropNonceRef.current !== externalDropPlacement.nonce &&
      tiles.some((tile) => tile.id === externalDropPlacement.tileId);

    if (pendingExternalPlacement) return;

    const tileIds = new Set(tiles.map((tile) => tile.id));
    const synchronizedSlots = cloneSlots(committedRackSlotsRef.current);
    const slottedTileIds = new Set<string>();

    for (const row of ROW_ORDER) {
      for (let index = 0; index < synchronizedSlots[row].length; index += 1) {
        const tileId = synchronizedSlots[row][index];
        if (tileId && tileIds.has(tileId)) {
          slottedTileIds.add(tileId);
        } else if (tileId) {
          synchronizedSlots[row][index] = null;
        }
      }
    }

    // New rack membership uses the same top-first empty-slot rule as
    // OkeyPlayerRack's draw landing target, so Flight and final render agree.
    for (const tile of tiles) {
      if (slottedTileIds.has(tile.id)) continue;

      const topSlotIndex = synchronizedSlots.top.findIndex((tileId) => tileId === null);
      const bottomSlotIndex = synchronizedSlots.bottom.findIndex((tileId) => tileId === null);
      if (topSlotIndex >= 0) {
        synchronizedSlots.top[topSlotIndex] = tile.id;
      } else if (bottomSlotIndex >= 0) {
        synchronizedSlots.bottom[bottomSlotIndex] = tile.id;
      }
      slottedTileIds.add(tile.id);
    }

    if (!rackSlotsEqual(synchronizedSlots, committedRackSlotsRef.current)) {
      commitRackSlots(synchronizedSlots);
    }
  }, [commitRackSlots, externalDropPlacement, tiles]);

  useLayoutEffect(() => {
    if (!externalDropPlacement) return;
    if (dragStartedRef.current || dragStartSlotsRef.current) return;
    if (consumedExternalDropNonceRef.current === externalDropPlacement.nonce) return;
    if (!tiles.some((tile) => tile.id === externalDropPlacement.tileId)) return;

    const target = getExternalDropTarget(
      externalDropPlacement.tileId,
      externalDropPlacement.point,
      committedRackSlotsRef.current,
    );
    if (!target) return;

    const placement = moveTileIntoSlot(
      committedRackSlotsRef.current,
      externalDropPlacement.tileId,
      target.row,
      target.slotIndex,
    );
    if (!placement) return;

    consumedExternalDropNonceRef.current = externalDropPlacement.nonce;
    commitRackSlots(placement.slots);
    onExternalDropPlacedRef.current?.(
      externalDropPlacement.tileId,
    );
  }, [commitRackSlots, externalDropPlacement, getExternalDropTarget, tiles]);

  const clearLongPressTimer = useCallback(() => {
    if (!longPressTimerRef.current) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const startMeldLongPressTimer = useCallback(
    (tileId: string) => {
      clearLongPressTimer();

      longPressTimerRef.current = setTimeout(() => {
        const tile = tileByIdRef.current.get(tileId);
        if (!tile) return;

        if (isOkeyWildcard(tile, okeyTileRef.current)) {
          wildcardLongPressHandledRef.current = true;
          setFlippedTileIds((current) => {
            const next = new Set(current);
            if (next.has(tileId)) next.delete(tileId);
            else next.add(tileId);
            return next;
          });
          return;
        }

        const origin = getTileOrigin(committedRackSlotsRef.current, tileId);
        if (!origin) return;

        const rowTiles = getRowTilesFromSlots(
          committedRackSlotsRef.current[origin.row],
          tileByIdRef.current,
          stagedTileIdSetRef.current,
        );

        const meld = getBestMeldIncludingSlot(
          rowTiles,
          origin.row,
          origin.slotIndex,
          okeyTileRef.current,
        );
        if (!meld) return;

        draggingMeldRef.current = meld;
        setDragPositionFromTouch(
          latestDragPointRef.current.x,
          latestDragPointRef.current.y,
        );
        setDraggingMeld(meld);
        setDraggingTileId(null);
      }, GROUP_LONG_PRESS_MS);
    },
    [
      clearLongPressTimer,
      setDragPositionFromTouch,
    ],
  );

  const clearDragState = useCallback(() => {
      draggingMeldRef.current = null;
      setDraggingTileId(null);
      setDraggingMeld(null);
      dragStartedRef.current = false;
      dragStartSlotsRef.current = null;
      previewTargetRef.current = null;

      resetNeighborShifts();

      cancelScheduledDragPointChange();
      externalHoverActiveRef.current = false;
      onTileDragPointChangeRef.current?.(null, null);
    },
    [
      cancelScheduledDragPointChange,
      resetNeighborShifts,
    ],
  );

  const getTilePanHandlers = useCallback(
    (tileId: string) => {
      if (tilePanHandlersRef.current[tileId]) {
        return tilePanHandlersRef.current[tileId];
      }

      const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () =>
          !rackInteractionLockedRef.current,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !rackInteractionLockedRef.current &&
          Math.hypot(gesture.dx, gesture.dy) >=
          DRAG_ACTIVATION_DISTANCE,
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderTerminationRequest: () =>
          !dragStartedRef.current && !draggingMeldRef.current,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (event, gesture) => {
          if (rackInteractionLockedRef.current) return;
          dragStartedRef.current = false;
          wildcardLongPressHandledRef.current = false;
          draggingMeldRef.current = null;
          setDraggingTileId(null);
          setDraggingMeld(null);
          resetNeighborShifts();

          dragStartSlotsRef.current = cloneSlots(
            committedRackSlotsRef.current,
          );
          previewTargetRef.current = null;

          const startPoint = getTouchPoint(event, gesture, true);
          latestDragPointRef.current = startPoint;
          dragTouchOffsetRef.current = {
            x: rackTileWidthRef.current / 2,
            y: rackTileHeightRef.current / 2,
          };

          setDragPositionFromTouch(startPoint.x, startPoint.y);
          startMeldLongPressTimer(tileId);
        },

        onPanResponderMove: (event, gesture) => {
          if (
            Math.hypot(gesture.dx, gesture.dy) <
            DRAG_ACTIVATION_DISTANCE
          ) {
            return;
          }

          if (!dragStartedRef.current) {
            clearLongPressTimer();
            dragStartedRef.current = true;
            onTileDragStartRef.current?.(tileId);

            if (!draggingMeldRef.current) {
              setDraggingTileId(tileId);
            }
          }

          const point = getTouchPoint(event, gesture);
          setDragPositionFromTouch(point.x, point.y);

          const originalSlots =
            dragStartSlotsRef.current ?? committedRackSlotsRef.current;

          if (draggingMeldRef.current) {
            const currentDraggingMeld = draggingMeldRef.current;
            const target = getGroupInsertionTarget(
              currentDraggingMeld.tileIds,
              { moveX: point.x, moveY: point.y },
              originalSlots,
            );
            const targetKey = target ? `group:${target.row}:${target.slotIndex}` : null;
            scheduleDragPointChange(null, null);
            if (previewTargetRef.current === targetKey) return;
            previewTargetRef.current = targetKey;
            const placement = target
              ? moveTilesIntoSlot(
                  originalSlots,
                  currentDraggingMeld.tileIds,
                  target.row,
                  target.slotIndex,
                )
              : null;

            if (placement) {
              applyRackPreview(
                originalSlots,
                placement.slots,
                new Set(currentDraggingMeld.tileIds),
              );
            } else {
              resetNeighborShifts();
            }
          } else {
            const target = getInsertionTarget(
              tileId,
              { moveX: point.x, moveY: point.y },
              originalSlots,
            );
            const targetKey = target ? `tile:${target.row}:${target.slotIndex}` : null;
            scheduleDragPointChange(target ? null : tileId, target ? null : point);
            if (previewTargetRef.current === targetKey) return;
            previewTargetRef.current = targetKey;
            const placement = target
              ? moveTileIntoSlot(
                  originalSlots,
                  tileId,
                  target.row,
                  target.slotIndex,
                )
              : null;

            if (placement) {
              applyRackPreview(originalSlots, placement.slots, new Set([tileId]));
            } else {
              resetNeighborShifts();
            }
          }

        },

        onPanResponderRelease: (event, gesture) => {
          clearLongPressTimer();

          const moved = dragStartedRef.current;
          const currentDraggingMeld = draggingMeldRef.current;
          const point = getTouchPoint(event, gesture);
          const originalSlots =
            dragStartSlotsRef.current ?? committedRackSlotsRef.current;

          if (currentDraggingMeld && moved) {
            const target = getGroupInsertionTarget(
              currentDraggingMeld.tileIds,
              { moveX: point.x, moveY: point.y },
              originalSlots,
            );
            const placement = target
                ? moveTilesIntoSlot(
                    originalSlots,
                    currentDraggingMeld.tileIds,
                    target.row,
                    target.slotIndex,
                  )
                : null;

            if (placement) {
              commitRackSlots(placement.slots);
              clearDragState();
              return;
            }

            const dropped =
              onDropMeldGroupRef.current?.(
                currentDraggingMeld,
                point,
              ) ?? false;

            if (!dropped) {
              snapDragBack(
                currentDraggingMeld.tileIds,
                originalSlots,
                clearDragState,
              );
              return;
            }

            clearDragState();
            return;
          }

          if (!moved) {
            const wasWildcardLongPress =
              wildcardLongPressHandledRef.current;
            clearDragState();
            wildcardLongPressHandledRef.current = false;

            if (!wasWildcardLongPress) {
              onSelectTileRef.current(tileId);
            }
            return;
          }

          const target = getInsertionTarget(
            tileId,
            { moveX: point.x, moveY: point.y },
            originalSlots,
          );
          const placement = target
              ? moveTileIntoSlot(
                  originalSlots,
                  tileId,
                  target.row,
                  target.slotIndex,
                )
              : null;

          if (placement) {
            commitRackSlots(placement.slots);
            clearDragState();
            return;
          }

          cancelScheduledDragPointChange();
          onTileDragPointChangeRef.current?.(tileId, point);
          const dropped =
            onDropTileRef.current?.(tileId, point) ?? false;

          if (!dropped) {
            snapDragBack([tileId], originalSlots, clearDragState);
            return;
          }

          clearDragState();
        },

        onPanResponderTerminate: () => {
          clearLongPressTimer();
          clearDragState();
        },
      }).panHandlers;

      tilePanHandlersRef.current[tileId] = panHandlers;
      return panHandlers;
    },
    [
      applyRackPreview,
      cancelScheduledDragPointChange,
      clearDragState,
      clearLongPressTimer,
      commitRackSlots,
      resetNeighborShifts,
      scheduleDragPointChange,
      setDragPositionFromTouch,
      snapDragBack,
      startMeldLongPressTimer,
      getInsertionTarget,
      getGroupInsertionTarget,
    ],
  );

  const moveRackTile = useCallback((tileId: string, targetIndex: number) => {
    if (rackInteractionLockedRef.current || dragStartSlotsRef.current) return;
    const slots = committedRackSlotsRef.current;
    const targetId = ROW_ORDER.flatMap((row) => slots[row]).filter((id) => id !== null)[targetIndex];
    if (!targetId) return;
    const target = getTileOrigin(slots, targetId);
    if (!target) return;
    const placement = moveTileIntoSlot(slots, tileId, target.row, target.slotIndex);
    if (placement) commitRackSlots(placement.slots);
  }, [commitRackSlots]);

  return {
    committedRackSlots,
    rackSlots,
    flippedTileIds,
    draggingTileId,
    draggingMeld,
    dragPosition,
    draggedMeldScale,
    getTileShiftValue,
    getTilePanHandlers,
    moveRackTile,
    dragStartedRef,
  };
}
