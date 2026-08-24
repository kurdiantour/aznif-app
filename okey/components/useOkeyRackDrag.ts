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
  SLOT_TARGET_HYSTERESIS_RATIO,
  cloneSlots,
  configureRackReflowAnimation,
  getBestMeldIncludingSlot,
  getExternalDropTargetForPoint,
  getGroupInsertionTargetForPoint,
  getInsertionTargetForPoint,
  getInitialRackSlots,
  getRowTilesFromSlots,
  getTileOrigin,
  syncSlotsWithTiles,
  type DragOrigin,
  type DraggingMeld,
  type ExternalDropPlacement,
  type InsertionTarget,
  type RackRow,
  type RackRowLayout,
  type RackSlots,
} from "@/okey/rack/rack-layout";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";

type TileRect = { x: number; y: number; width: number; height: number };
type ViewportRect = { x: number; y: number; width: number; height: number };

type UseOkeyRackDragParams = {
  tiles: OkeyTile[];
  okeyTile: OkeyTile;
  stagedTileIdSet: Set<string>;
  fixedDrawTileId?: string | null;
  eliminated: boolean;

  rackTileWidth: number;
  rackTileHeight: number;
  rackTileStride: number;

  viewportOriginRef: MutableRefObject<ViewportRect>;
  rowLayoutsRef: MutableRefObject<Record<RackRow, RackRowLayout | null>>;
  tileRectsRef: MutableRefObject<Record<string, TileRect>>;

  onSelectTile: (tileId: string) => void;
  onMoveTile: (tileId: string, targetIndex: number) => void;
  onMoveTiles?: (tileIds: string[], targetIndex: number) => void;
  onDropMeldGroup?: (meld: OkeyMeld, point: { x: number; y: number }) => boolean;
  onDropTile?: (tileId: string, point: { x: number; y: number }) => boolean;
  onTileDragPointChange?: (
    tileId: string | null,
    point: { x: number; y: number } | null,
  ) => void;

  externalDropPlacement?: ExternalDropPlacement | null;
  onExternalDropPlaced?: (tileId: string, targetIndex: number) => void;
  externalHoverPoint?: { x: number; y: number } | null;

  clearEnteringTilesForDrag: () => void;
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
  fixedDrawTileId,
  eliminated,
  rackTileWidth,
  rackTileHeight,
  rackTileStride,
  viewportOriginRef,
  rowLayoutsRef,
  tileRectsRef,
  onSelectTile,
  onMoveTile,
  onMoveTiles,
  onDropMeldGroup,
  onDropTile,
  onTileDragPointChange,
  externalDropPlacement,
  onExternalDropPlaced,
  externalHoverPoint,
  clearEnteringTilesForDrag,
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
  const [insertionTarget, setInsertionTarget] =
    useState<InsertionTarget | null>(null);
  const [externalHoverTarget, setExternalHoverTarget] =
    useState<InsertionTarget | null>(null);

  const draggingMeldRef = useRef<DraggingMeld | null>(null);
  const dragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const draggedMeldScale = useRef(new Animated.Value(1)).current;
  const dragTouchOffsetRef = useRef({ x: 0, y: 0 });
  const latestDragPointRef = useRef({ x: 0, y: 0 });
  const insertionTargetRef = useRef<InsertionTarget | null>(null);
  const dragStartedRef = useRef(false);
  const dragStartSlotsRef = useRef<RackSlots | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wildcardLongPressHandledRef = useRef(false);
  const consumedExternalDropNonceRef = useRef<number | null>(null);
  const neighborShiftKeyRef = useRef<string | null>(null);
  const pendingNeighborResetAfterCommitRef = useRef(false);
  const tileShiftValuesRef = useRef<Record<string, Animated.ValueXY>>({});
  const tilePanHandlersRef = useRef<Record<string, any>>({});

  const rackSlotsRef = useRef(rackSlots);
  const committedRackSlotsRef = useRef(committedRackSlots);
  const tileByIdRef = useRef(new Map(tiles.map((tile) => [tile.id, tile])));
  const okeyTileRef = useRef(okeyTile);
  const stagedTileIdSetRef = useRef(stagedTileIdSet);

  const rackTileWidthRef = useRef(rackTileWidth);
  const rackTileHeightRef = useRef(rackTileHeight);
  const rackTileStrideRef = useRef(rackTileStride);

  const onSelectTileRef = useRef(onSelectTile);
  const onMoveTileRef = useRef(onMoveTile);
  const onMoveTilesRef = useRef(onMoveTiles);
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
    rackSlotsRef.current = rackSlots;
  }, [rackSlots]);

  useEffect(() => {
    committedRackSlotsRef.current = committedRackSlots;
  }, [committedRackSlots]);

  useEffect(() => {
    tileByIdRef.current = new Map(tiles.map((tile) => [tile.id, tile]));
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
    onMoveTileRef.current = onMoveTile;
    onMoveTilesRef.current = onMoveTiles;
    onDropMeldGroupRef.current = onDropMeldGroup;
    onDropTileRef.current = onDropTile;
    onTileDragPointChangeRef.current = onTileDragPointChange;
    onExternalDropPlacedRef.current = onExternalDropPlaced;
  }, [
    onDropMeldGroup,
    onDropTile,
    onExternalDropPlaced,
    onMoveTile,
    onMoveTiles,
    onSelectTile,
    onTileDragPointChange,
  ]);

  useEffect(() => {
    setCommittedRackSlots((current) =>
      syncSlotsWithTiles(current, tiles, fixedDrawTileId),
    );
  }, [fixedDrawTileId, tiles]);

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

  const setCurrentInsertionTarget = useCallback(
    (target: InsertionTarget | null) => {
      insertionTargetRef.current = target;
      setInsertionTarget(target);
    },
    [],
  );

  const getTileShiftValue = useCallback((tileId: string) => {
    const existing = tileShiftValuesRef.current[tileId];
    if (existing) return existing;

    const value = new Animated.ValueXY({ x: 0, y: 0 });
    tileShiftValuesRef.current[tileId] = value;
    return value;
  }, []);

  const resetNeighborShifts = useCallback(() => {
    neighborShiftKeyRef.current = null;

    for (const value of Object.values(tileShiftValuesRef.current)) {
      value.stopAnimation();
      value.setValue({ x: 0, y: 0 });
    }
  }, []);

  // Keep transformed neighbors in their final visual positions until the slot
  // state has committed. Resetting before commit creates the one-frame tick.
  useLayoutEffect(() => {
    if (!pendingNeighborResetAfterCommitRef.current) return;
    pendingNeighborResetAfterCommitRef.current = false;
    resetNeighborShifts();
  }, [committedRackSlots, resetNeighborShifts]);

  const updateNeighborShifts = useCallback(
    (target: InsertionTarget | null, draggedTileIds: string[]) => {
      const sourceSlots = dragStartSlotsRef.current;

      if (!target || !sourceSlots) {
        resetNeighborShifts();
        return;
      }

      const shiftKey = `${target.row}:${target.slotIndex}:${draggedTileIds.join(",")}`;
      if (neighborShiftKeyRef.current === shiftKey) return;
      neighborShiftKeyRef.current = shiftKey;

      const draggedSet = new Set(draggedTileIds);
      const nextPositions = new Map<
        string,
        { row: RackRow; slotIndex: number }
      >();

      for (const row of ROW_ORDER) {
        target.nextSlots[row].forEach((tileId, slotIndex) => {
          if (tileId) nextPositions.set(tileId, { row, slotIndex });
        });
      }

      for (const row of ROW_ORDER) {
        sourceSlots[row].forEach((tileId, slotIndex) => {
          if (!tileId) return;

          const value = getTileShiftValue(tileId);
          value.stopAnimation();

          if (draggedSet.has(tileId)) {
            value.setValue({ x: 0, y: 0 });
            return;
          }

          const next = nextPositions.get(tileId);
          if (!next) {
            value.setValue({ x: 0, y: 0 });
            return;
          }

          const sourceRowLayout = rowLayoutsRef.current[row];
          const targetRowLayout = rowLayoutsRef.current[next.row];

          value.setValue({
            x: (next.slotIndex - slotIndex) * rackTileStrideRef.current,
            y:
              sourceRowLayout && targetRowLayout
                ? targetRowLayout.y - sourceRowLayout.y
                : 0,
          });
        });
      }
    },
    [getTileShiftValue, resetNeighborShifts, rowLayoutsRef],
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
    _event: GestureResponderEvent,
    gesture: PanResponderGestureState,
    useStartPoint = false,
  ) => ({
    x: useStartPoint ? gesture.x0 : gesture.moveX,
    y: useStartPoint ? gesture.y0 : gesture.moveY,
  });

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

      dragPosition.stopAnimation();
      dragPosition.setValue({
        x: origin.slotIndex * rackTileStrideRef.current,
        y: rowLayout.y,
      });
      onDone();
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
        sourceSlots: sourceSlots ?? rackSlotsRef.current,
        viewport: viewportOriginRef.current,
        rowLayouts: rowLayoutsRef.current,
        rackTileWidth: rackTileWidthRef.current,
        rackTileHeight: rackTileHeightRef.current,
        rackTileStride: rackTileStrideRef.current,
        dragTouchOffsetX: dragTouchOffsetRef.current.x,
        activeTarget: insertionTargetRef.current,
        rowSnapPaddingRatio: ROW_SNAP_PADDING_RATIO,
        slotTargetHysteresisRatio: SLOT_TARGET_HYSTERESIS_RATIO,
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
        sourceSlots: sourceSlots ?? rackSlotsRef.current,
        viewport: viewportOriginRef.current,
        rowLayouts: rowLayoutsRef.current,
        rackTileWidth: rackTileWidthRef.current,
        rackTileHeight: rackTileHeightRef.current,
        rackTileStride: rackTileStrideRef.current,
        touchedTileIndex:
          draggingMeldRef.current?.touchedTileIndex ?? 0,
        activeTarget: insertionTargetRef.current,
        rowSnapPaddingRatio: ROW_SNAP_PADDING_RATIO,
        slotTargetHysteresisRatio: SLOT_TARGET_HYSTERESIS_RATIO,
      }),
    [rowLayoutsRef, viewportOriginRef],
  );

  const getExternalDropTarget = useCallback(
    (tileId: string, point: { x: number; y: number }) =>
      getExternalDropTargetForPoint({
        tileId,
        point,
        committedSlots: committedRackSlotsRef.current,
        viewport: viewportOriginRef.current,
        rowLayouts: rowLayoutsRef.current,
        rackTileWidth: rackTileWidthRef.current,
        rackTileHeight: rackTileHeightRef.current,
        rackTileStride: rackTileStrideRef.current,
        rowSnapPaddingRatio: ROW_SNAP_PADDING_RATIO,
      }),
    [rowLayoutsRef, viewportOriginRef],
  );

  useEffect(() => {
    if (
      !externalDropPlacement ||
      consumedExternalDropNonceRef.current === externalDropPlacement.nonce
    ) {
      return;
    }
    if (!tileByIdRef.current.has(externalDropPlacement.tileId)) return;

    const target = getExternalDropTarget(
      externalDropPlacement.tileId,
      externalDropPlacement.point,
    );
    if (!target) return;

    consumedExternalDropNonceRef.current = externalDropPlacement.nonce;
    setCommittedRackSlots(target.nextSlots);
    onExternalDropPlacedRef.current?.(
      externalDropPlacement.tileId,
      target.flatIndex,
    );
  }, [externalDropPlacement, getExternalDropTarget]);

  useEffect(() => {
    if (!externalHoverPoint || externalDropPlacement) {
      setExternalHoverTarget(null);
      return;
    }

    setExternalHoverTarget(
      getExternalDropTarget(
        "__external_discard_preview__",
        externalHoverPoint,
      ),
    );
  }, [
    externalDropPlacement,
    externalHoverPoint,
    getExternalDropTarget,
  ]);

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

        const origin = getTileOrigin(rackSlotsRef.current, tileId);
        if (!origin) return;

        const rowTiles = getRowTilesFromSlots(
          rackSlotsRef.current[origin.row],
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
        setCurrentInsertionTarget(null);
      }, GROUP_LONG_PRESS_MS);
    },
    [
      clearLongPressTimer,
      setCurrentInsertionTarget,
      setDragPositionFromTouch,
    ],
  );

  const clearDragState = useCallback(
    (preserveNeighborShifts = false) => {
      draggingMeldRef.current = null;
      setDraggingTileId(null);
      setDraggingMeld(null);
      setCurrentInsertionTarget(null);
      dragStartedRef.current = false;
      dragStartSlotsRef.current = null;

      if (!preserveNeighborShifts) {
        resetNeighborShifts();
      }

      cancelScheduledDragPointChange();
      onTileDragPointChangeRef.current?.(null, null);
    },
    [
      cancelScheduledDragPointChange,
      resetNeighborShifts,
      setCurrentInsertionTarget,
    ],
  );

  const getTilePanHandlers = useCallback(
    (tileId: string) => {
      if (tilePanHandlersRef.current[tileId]) {
        return tilePanHandlersRef.current[tileId];
      }

      const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.hypot(gesture.dx, gesture.dy) >=
          DRAG_ACTIVATION_DISTANCE,
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderTerminationRequest: () =>
          !dragStartedRef.current && !draggingMeldRef.current,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (event, gesture) => {
          dragStartedRef.current = false;
          wildcardLongPressHandledRef.current = false;
          draggingMeldRef.current = null;
          setDraggingTileId(null);
          setDraggingMeld(null);
          setCurrentInsertionTarget(null);
          resetNeighborShifts();

          dragStartSlotsRef.current = cloneSlots(
            committedRackSlotsRef.current,
          );

          const startPoint = getTouchPoint(event, gesture, true);
          latestDragPointRef.current = startPoint;
          dragTouchOffsetRef.current = {
            x: rackTileWidthRef.current / 2,
            y: rackTileHeightRef.current / 2,
          };

          const cachedRect = tileRectsRef.current[tileId];
          if (cachedRect) {
            dragTouchOffsetRef.current = {
              x: Math.max(
                0,
                Math.min(
                  cachedRect.width,
                  startPoint.x - cachedRect.x,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  cachedRect.height,
                  startPoint.y - cachedRect.y,
                ),
              ),
            };
          }

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
            clearEnteringTilesForDrag();
            clearReturningJokerForTile(tileId);

            if (!draggingMeldRef.current) {
              setDraggingTileId(tileId);
            }
          }

          const point = getTouchPoint(event, gesture);
          setDragPositionFromTouch(point.x, point.y);

          const currentDraggingMeld = draggingMeldRef.current;
          const sourceSlots =
            dragStartSlotsRef.current ??
            committedRackSlotsRef.current;

          const target = currentDraggingMeld
            ? getGroupInsertionTarget(
                currentDraggingMeld.tileIds,
                { moveX: point.x, moveY: point.y },
                sourceSlots,
              )
            : getInsertionTarget(
                tileId,
                { moveX: point.x, moveY: point.y },
                sourceSlots,
              );

          // Ref only: no React state update on every move frame.
          insertionTargetRef.current = target;
          updateNeighborShifts(
            target,
            currentDraggingMeld?.tileIds ?? [tileId],
          );

          if (target) {
            scheduleDragPointChange(null, null);
          } else if (!currentDraggingMeld) {
            scheduleDragPointChange(tileId, point);
          }
        },

        onPanResponderRelease: (event, gesture) => {
          clearLongPressTimer();

          const moved = dragStartedRef.current;
          const currentDraggingMeld = draggingMeldRef.current;
          const point = getTouchPoint(event, gesture);
          const sourceSlots =
            dragStartSlotsRef.current ?? rackSlotsRef.current;

          const target = currentDraggingMeld
            ? getGroupInsertionTarget(
                currentDraggingMeld.tileIds,
                { moveX: point.x, moveY: point.y },
                sourceSlots,
              )
            : getInsertionTarget(
                tileId,
                { moveX: point.x, moveY: point.y },
                sourceSlots,
              );

          const originalSlots = dragStartSlotsRef.current;

          if (currentDraggingMeld && moved) {
            if (target) {
              // LOCAL RACK REORDER:
              // Group movement inside the rack stays entirely inside the rack.
              pendingNeighborResetAfterCommitRef.current = true;
              setCommittedRackSlots(target.nextSlots);
              clearDragState(true);
              return;
            }

            const dropped =
              onDropMeldGroupRef.current?.(
                currentDraggingMeld,
                point,
              ) ?? false;

            if (!dropped && originalSlots) {
              snapDragBack(
                currentDraggingMeld.tileIds,
                originalSlots,
                () => {
                  configureRackReflowAnimation();
                  clearDragState();
                },
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

          if (!target) {
            const dropped =
              onDropTileRef.current?.(tileId, point) ?? false;

            if (!dropped && originalSlots) {
              snapDragBack([tileId], originalSlots, () => {
                configureRackReflowAnimation();
                clearDragState();
              });
              return;
            }

            clearDragState();
            return;
          }

          // No landing animation. Commit while neighbors keep their final
          // transforms; useLayoutEffect removes those transforms atomically.
          // LOCAL RACK REORDER:
          // Reordering tiles inside the player's own rack is purely cosmetic UI state.
          // Do not notify the parent/game state here; that feedback loop can cause
          // extra renders and makes the rack feel less physical.
          pendingNeighborResetAfterCommitRef.current = true;
          setCommittedRackSlots(target.nextSlots);
          clearDragState(true);
        },

        onPanResponderTerminate: () => {
          clearLongPressTimer();
          draggingMeldRef.current = null;
          dragStartedRef.current = false;
          setDraggingTileId(null);
          setDraggingMeld(null);
          setCurrentInsertionTarget(null);
          dragStartSlotsRef.current = null;
          resetNeighborShifts();
          cancelScheduledDragPointChange();
          onTileDragPointChangeRef.current?.(null, null);
        },
      }).panHandlers;

      tilePanHandlersRef.current[tileId] = panHandlers;
      return panHandlers;
    },
    [
      cancelScheduledDragPointChange,
      clearDragState,
      clearEnteringTilesForDrag,
      clearLongPressTimer,
      clearReturningJokerForTile,
      getGroupInsertionTarget,
      getInsertionTarget,
      resetNeighborShifts,
      scheduleDragPointChange,
      setCurrentInsertionTarget,
      setDragPositionFromTouch,
      snapDragBack,
      startMeldLongPressTimer,
      tileRectsRef,
      updateNeighborShifts,
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
    insertionTarget,
    externalHoverTarget,
    getTileShiftValue,
    getTilePanHandlers,
    dragStartedRef,
  };
}