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
  GROUP_LONG_PRESS_MOVE_TOLERANCE,
  GROUP_LONG_PRESS_MS,
  ROW_ORDER,
  ROW_SNAP_PADDING_RATIO,
  cloneSlots,
  getBestMeldIncludingSlot,
  getExternalDropTargetForPoint,
  getFlatIndexForSlot,
  getGroupInsertionTargetForPoint,
  getInitialRackSlots,
  getInsertionTargetForPoint,
  getRowTilesFromSlots,
  getTileOrigin,
  moveTileIntoSlot,
  moveTilesIntoSlot,
  syncSlotsWithTiles,
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
  onDropMeldGroup?: (meld: OkeyMeld, point: { x: number; y: number }) => boolean;
  onDropTile?: (tileId: string, point: { x: number; y: number }) => boolean;
  onTileDragPointChange?: (
    tileId: string | null,
    point: { x: number; y: number } | null,
  ) => void;

  externalDropPlacement?: ExternalDropPlacement | null;
  onExternalDropPlaced?: (tileId: string, targetIndex: number) => void;

  clearReturningJokerForTile: (tileId: string) => void;
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
  onDropMeldGroup,
  onDropTile,
  onTileDragPointChange,
  externalDropPlacement,
  onExternalDropPlaced,
  clearReturningJokerForTile,
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
  const dragPreviewSlotsRef = useRef<RackSlots | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wildcardLongPressHandledRef = useRef(false);
  const consumedExternalDropNonceRef = useRef<number | null>(null);
  const tileShiftValuesRef = useRef<Record<string, Animated.ValueXY>>({});
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
  const onDropMeldGroupRef = useRef(onDropMeldGroup);
  const onDropTileRef = useRef(onDropTile);
  const onTileDragPointChangeRef = useRef(onTileDragPointChange);
  const onExternalDropPlacedRef = useRef(onExternalDropPlaced);

  const dragPointFrameRef = useRef<number | null>(null);
  const pendingDragPointRef = useRef<{
    tileId: string | null;
    point: { x: number; y: number } | null;
  } | null>(null);

  useEffect(() => {
    committedRackSlotsRef.current = committedRackSlots;
  }, [committedRackSlots]);

  const commitRackSlots = useCallback((nextSlots: RackSlots) => {
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
    onDropMeldGroupRef.current = onDropMeldGroup;
    onDropTileRef.current = onDropTile;
    onTileDragPointChangeRef.current = onTileDragPointChange;
    onExternalDropPlacedRef.current = onExternalDropPlaced;
  }, [
    onDropMeldGroup,
    onDropTile,
    onExternalDropPlaced,
    onSelectTile,
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

    // Rack ordering is committed only on drop. Stable rack tiles do not move
    // during hover, so this transform intentionally stays at zero.
    const value = new Animated.ValueXY({ x: 0, y: 0 });
    tileShiftValuesRef.current[tileId] = value;
    return value;
  }, []);

  const resetNeighborShifts = useCallback(() => {
    for (const value of Object.values(tileShiftValuesRef.current)) {
      value.stopAnimation();
      value.setValue({ x: 0, y: 0 });
    }
  }, []);

  const applyRackPreview = useCallback(
    (originalSlots: RackSlots, previewSlots: RackSlots, draggedTileIds: Set<string>) => {
      for (const row of ROW_ORDER) {
        for (let slotIndex = 0; slotIndex < originalSlots[row].length; slotIndex += 1) {
          const tileId = originalSlots[row][slotIndex];
          if (!tileId || draggedTileIds.has(tileId)) continue;

          const previewOrigin = getTileOrigin(previewSlots, tileId);
          if (!previewOrigin) continue;

          const fromLayout = rowLayoutsRef.current[row];
          const toLayout = rowLayoutsRef.current[previewOrigin.row];
          if (!fromLayout || !toLayout) continue;

          const fromBottomInset = row === "bottom" ? rackTileHeightRef.current * 0.44 : 0;
          const toBottomInset = previewOrigin.row === "bottom" ? rackTileHeightRef.current * 0.44 : 0;
          const fromTop =
            fromLayout.y + fromLayout.height - rackTileHeightRef.current - fromBottomInset;
          const toTop =
            toLayout.y + toLayout.height - rackTileHeightRef.current - toBottomInset;

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

      const bottomInset =
        origin.row === "bottom" ? rackTileHeightRef.current * 0.44 : 0;
      const targetPosition = {
        x: origin.slotIndex * rackTileStrideRef.current,
        y:
          rowLayout.y +
          rowLayout.height -
          rackTileHeightRef.current -
          bottomInset,
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

    const synchronizedSlots = syncSlotsWithTiles(
      committedRackSlotsRef.current,
      tiles,
    );

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
      getFlatIndexForSlot(placement.slots, placement.row, placement.slotIndex),
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
      dragPreviewSlotsRef.current = null;

      resetNeighborShifts();

      cancelScheduledDragPointChange();
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
          dragPreviewSlotsRef.current = null;

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
            Math.abs(gesture.dx) >
              GROUP_LONG_PRESS_MOVE_TOLERANCE ||
            Math.abs(gesture.dy) >
              GROUP_LONG_PRESS_MOVE_TOLERANCE
          ) {
            clearLongPressTimer();
          }

          if (
            Math.hypot(gesture.dx, gesture.dy) <
            DRAG_ACTIVATION_DISTANCE
          ) {
            return;
          }

          if (!dragStartedRef.current) {
            dragStartedRef.current = true;
            clearReturningJokerForTile(tileId);

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
            const placement = target
              ? moveTilesIntoSlot(
                  originalSlots,
                  currentDraggingMeld.tileIds,
                  target.row,
                  target.slotIndex,
                )
              : null;

            dragPreviewSlotsRef.current = placement?.slots ?? null;
            if (placement) {
              applyRackPreview(
                originalSlots,
                placement.slots,
                new Set(currentDraggingMeld.tileIds),
              );
            } else {
              resetNeighborShifts();
            }
            scheduleDragPointChange(null, null);
          } else {
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

            dragPreviewSlotsRef.current = placement?.slots ?? null;
            if (placement) {
              applyRackPreview(originalSlots, placement.slots, new Set([tileId]));
            } else {
              resetNeighborShifts();
            }
            scheduleDragPointChange(tileId, point);
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
            const placement = dragPreviewSlotsRef.current
              ? {
                  slots: dragPreviewSlotsRef.current,
                  row: target?.row ?? getTileOrigin(
                    dragPreviewSlotsRef.current,
                    currentDraggingMeld.tileIds[0],
                  )?.row ?? "bottom",
                  slotIndex: target?.slotIndex ?? 0,
                }
              : target
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
          const placement = dragPreviewSlotsRef.current
            ? {
                slots: dragPreviewSlotsRef.current,
                row: target?.row ?? getTileOrigin(dragPreviewSlotsRef.current, tileId)?.row ?? "bottom",
                slotIndex: target?.slotIndex ?? getTileOrigin(dragPreviewSlotsRef.current, tileId)?.slotIndex ?? 0,
              }
            : target
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
      clearDragState,
      clearLongPressTimer,
      commitRackSlots,
      clearReturningJokerForTile,
      resetNeighborShifts,
      scheduleDragPointChange,
      setDragPositionFromTouch,
      snapDragBack,
      startMeldLongPressTimer,
      getInsertionTarget,
      getGroupInsertionTarget,
    ],
  );

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
    dragStartedRef,
  };
}
