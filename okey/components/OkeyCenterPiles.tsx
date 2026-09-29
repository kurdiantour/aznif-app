import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";

import { getOkeyTileAccessibilityLabel, OKEY_ACCESSIBILITY } from "@/okey/accessibility/okey-accessibility";
import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import type { OkeyTile } from "@/okey/types/okey";
import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import { CENTER_JOKER_REL_X, CENTER_JOKER_REL_Y, CENTER_JOKER_SIZE_PCT } from "../layout/uiPositions";
import { styles } from "./okeyStyles";
import { OkeyTileBack, OkeyTileFace } from "./OkeyTileFace";

type OkeyCenterPilesProps = {
  deckCount: number;
  topDiscard: OkeyTile | null;
  discardUnderlayTile?: OkeyTile | null;
  discardCount?: number;
  canDraw: boolean;
  canDrawDiscard?: boolean;
  indicatorTile: OkeyTile;
  okeyTile: OkeyTile;
  onDrawDeck: () => void;
  onDrawDiscard: () => void;
  onViewDiscards?: () => void;
  onDiscardDroppedOnRack?: (point: { x: number; y: number }) => void;
  onDeckDroppedOnRack?: (point: { x: number; y: number }) => void;
  onDiscardDragActiveChange?: (active: boolean) => void;
  onDeckMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onDiscardMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  hideTopDeckTile?: boolean;
  hideTopDiscardTile?: boolean;
  discardPresentationFallback?: OkeyTile | null;
};

export function OkeyCenterPiles({
  deckCount,
  topDiscard,
  discardUnderlayTile = null,
  discardCount = topDiscard ? 1 : 0,
  canDraw,
  canDrawDiscard = canDraw,
  indicatorTile,
  okeyTile,
  onDrawDeck,
  onDrawDiscard,
  onViewDiscards,
  onDiscardDroppedOnRack,
  onDeckDroppedOnRack,
  onDiscardDragActiveChange,
  onDeckMeasured,
  onDiscardMeasured,
  hideTopDeckTile,
  hideTopDiscardTile,
  discardPresentationFallback,
}: OkeyCenterPilesProps) {
  const layout = useOkeyResponsiveLayout();
  const rootRef = useRef<View | null>(null);
  const rootOriginRef = useRef({ x: 0, y: 0 });
  const deckRootRef = useRef<View | null>(null);
  const deckOriginRef = useRef({ x: 0, y: 0 });
  const deckTopRef = useRef<View | null>(null);
  const discardTopRef = useRef<View | null>(null);
  const discardDragStartedRef = useRef(false);
  const deckDragStartedRef = useRef(false);
  const discardDragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [discardDragActive, setDiscardDragActive] = useState(false);
  const [discardDragSnapshot, setDiscardDragSnapshot] = useState<{
    tile: OkeyTile;
    underlay: OkeyTile | null;
  } | null>(null);
  const deckDragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [deckDragActive, setDeckDragActive] = useState(false);
  const [discardTileSize, setDiscardTileSize] = useState({ width: 38, height: 54 });
  const displayedTopDiscard = hideTopDiscardTile
    ? discardPresentationFallback ?? null
    : topDiscard;
  const stationaryDiscardTile = discardDragActive
    ? discardDragSnapshot?.underlay ?? null
    : displayedTopDiscard;
  useEffect(() => {
    onDiscardDragActiveChange?.(discardDragActive);
  }, [discardDragActive, onDiscardDragActiveChange]);
  const measureRoot = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      rootOriginRef.current = { x, y };
    });
  }, []);
  const measureDeckTop = useCallback(() => {
    deckTopRef.current?.measureInWindow((x, y, width, height) => onDeckMeasured?.({ x, y, width, height }));
  }, [onDeckMeasured]);
  const measureDeckRoot = useCallback(() => {
    deckRootRef.current?.measureInWindow((x, y) => {
      deckOriginRef.current = { x, y };
    });
  }, []);
  const measureDiscardTop = useCallback(() => {
    discardTopRef.current?.measureInWindow((x, y, width, height) => {
      setDiscardTileSize({ width, height });
      onDiscardMeasured?.({ x, y, width, height });
    });
  }, [onDiscardMeasured]);
  const setDiscardDragPositionFromGesture = useCallback((gesture: { moveX: number; moveY: number }) => {
    discardDragPosition.setValue({
      x: gesture.moveX - rootOriginRef.current.x - discardTileSize.width / 2,
      y: gesture.moveY - rootOriginRef.current.y - discardTileSize.height / 2,
    });
  }, [discardDragPosition, discardTileSize.height, discardTileSize.width]);
  const clearDiscardDrag = useCallback(() => {
    discardDragStartedRef.current = false;
    setDiscardDragActive(false);
  }, []);
  const clearDeckDrag = useCallback(() => {
    setDeckDragActive(false);
  }, []);
  const deckDragHandlers = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => canDraw,
      onMoveShouldSetPanResponder: (_, gesture) =>
        canDraw && Math.hypot(gesture.dx, gesture.dy) > 3,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        deckDragStartedRef.current = false;
        measureDeckRoot();
        deckDragPosition.setValue({ x: 0, y: 0 });
        setDeckDragActive(false);
      },
      onPanResponderMove: (_, gesture) => {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (distance >= 8 && !deckDragStartedRef.current) {
          deckDragStartedRef.current = true;
          setDeckDragActive(true);
        }
        if (!deckDragStartedRef.current) return;
        deckDragPosition.setValue({
          x: gesture.moveX - deckOriginRef.current.x - 21,
          y: gesture.moveY - deckOriginRef.current.y - 29,
        });
      },
      onPanResponderRelease: (_, gesture) => {
        const wasDragging = deckDragStartedRef.current;
        deckDragStartedRef.current = false;

        if (!canDraw) {
          clearDeckDrag();
          return;
        }
        if (wasDragging) {
          onDeckDroppedOnRack?.({ x: gesture.moveX, y: gesture.moveY });
          clearDeckDrag();
          return;
        }
        clearDeckDrag();
        onDrawDeck();
      },
      onPanResponderTerminate: () => {
        deckDragStartedRef.current = false;
        clearDeckDrag();
      },
    }),
    [canDraw, clearDeckDrag, deckCount, deckDragPosition, measureDeckRoot, onDeckDroppedOnRack, onDrawDeck],
  );
  const discardDragHandlers = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => !!displayedTopDiscard,
      onMoveShouldSetPanResponder: (_, gesture) => !!displayedTopDiscard && Math.hypot(gesture.dx, gesture.dy) > 3,
      onPanResponderGrant: () => {
        measureRoot();
        measureDiscardTop();
        discardDragStartedRef.current = false;
        discardDragPosition.setValue({ x: 0, y: 0 });
        setDiscardDragActive(false);
      },
      onPanResponderMove: (_, gesture) => {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (canDrawDiscard && !!displayedTopDiscard && distance > 8 && !discardDragStartedRef.current) {
          discardDragStartedRef.current = true;
          setDiscardDragSnapshot({ tile: displayedTopDiscard, underlay: discardUnderlayTile });
          setDiscardDragActive(true);
        }
        if (discardDragStartedRef.current) {
          setDiscardDragPositionFromGesture(gesture);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (!displayedTopDiscard) return;
        if (distance < 8) {
          onViewDiscards?.();
          clearDiscardDrag();
          return;
        }
        if (!canDrawDiscard || !discardDragStartedRef.current) {
          clearDiscardDrag();
          return;
        }
        onDiscardDroppedOnRack?.({ x: gesture.moveX, y: gesture.moveY });
        clearDiscardDrag();
      },
      onPanResponderTerminate: () => {
        clearDiscardDrag();
      },
    }),
    [canDrawDiscard, clearDiscardDrag, discardUnderlayTile, discardDragPosition, measureDiscardTop, measureRoot, onDiscardDroppedOnRack, onViewDiscards, setDiscardDragPositionFromGesture, displayedTopDiscard],
  );
  return (
    <View style={[styles.centerPiles, layout.centerPiles, (discardDragActive || deckDragActive) && styles.activeDiscardDragLayer]}>
      <View testID="okey-discard-pile" ref={rootRef} onLayout={measureRoot} style={[styles.discardPileNatural, !displayedTopDiscard && styles.disabled]}>
        <View style={[styles.discardUnderTile, styles.discardUnderLeft]}>
          <OkeyTileBack />
        </View>
        <View style={[styles.discardUnderTile, styles.discardUnderRight]}>
          <OkeyTileBack />
        </View>
        <View style={[styles.discardUnderTile, styles.discardUnderBottom]}>
          <OkeyTileBack />
        </View>
        {stationaryDiscardTile ? (
          <View
            testID="okey-top-discard"
            ref={discardTopRef}
            accessible
            accessibilityRole="button"
            accessibilityLabel={OKEY_ACCESSIBILITY.discardLabel(stationaryDiscardTile, discardCount, isOkeyWildcard(stationaryDiscardTile, okeyTile))}
            accessibilityHint={OKEY_ACCESSIBILITY.discardHint}
            accessibilityState={{ disabled: !canDrawDiscard }}
            accessibilityActions={[
              ...(canDrawDiscard ? [{ name: "activate" as const, label: "وەرگرتنی بەردە فڕێدراوەکە" }] : []),
              { name: "viewHistory" as const, label: "بینینی مێژووی بەردە فڕێدراوەکان" },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "activate" && canDrawDiscard) onDrawDiscard();
              if (event.nativeEvent.actionName === "viewHistory") onViewDiscards?.();
            }}
            collapsable={false}
            onLayout={measureDiscardTop}
            {...discardDragHandlers.panHandlers}
          >
            <OkeyTileFace
              tile={stationaryDiscardTile}
              compact
              isWildcard={isOkeyWildcard(stationaryDiscardTile, okeyTile)}
            />
          </View>
        ) : (
          <View ref={discardTopRef} collapsable={false} onLayout={measureDiscardTop} style={styles.emptyDiscard} />
        )}
        {discardCount > 0 ? <Text style={styles.discardCount}>{discardCount}</Text> : null}
        {discardDragSnapshot && discardDragActive ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.draggedTileOverlay,
              {
                width: discardTileSize.width,
                height: discardTileSize.height,
                transform: [
                  { translateX: discardDragPosition.x },
                  { translateY: discardDragPosition.y },
                ],
              },
            ]}
          >
            <OkeyTileFace
              tile={discardDragSnapshot.tile}
              compact
              width={discardTileSize.width}
              height={discardTileSize.height}
              isWildcard={isOkeyWildcard(discardDragSnapshot.tile, okeyTile)}
            />
          </Animated.View>
        ) : null}
      </View>

      <View
        ref={deckRootRef}
        onLayout={measureDeckRoot}
        style={styles.drawStackNatural}
        {...deckDragHandlers.panHandlers}
      >
        <View
          testID="okey-draw-deck"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        >
        <View
          pointerEvents="none"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`بەردی نیشاندەر، ${getOkeyTileAccessibilityLabel(indicatorTile)}`}
          style={styles.indicatorTileSpot}
        >
          <OkeyTileFace tile={indicatorTile} compact isWildcard={false} />
        </View>
        {Array.from({ length: 9 }).map((_, index) => (
          <View
            key={index}
            ref={index === 8 ? deckTopRef : undefined}
            collapsable={false}
            onLayout={index === 8 ? measureDeckTop : undefined}
            style={[styles.drawStackLayer, { top: index * 3 }, index === 8 && (hideTopDeckTile || deckDragActive) ? styles.hiddenRackTile : undefined]}
          >
            <OkeyTileBack unstyled width={42} height={58} />
          </View>
        ))}
        {deckDragActive ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.draggedTileOverlay,
              {
                width: 42,
                height: 58,
                transform: [
                  { translateX: deckDragPosition.x },
                  { translateY: deckDragPosition.y },
                ],
              },
            ]}
          >
            <OkeyTileBack unstyled width={42} height={58} />
          </Animated.View>
        ) : null}
        {deckCount > 0 ? <Text style={styles.deckCount}>{deckCount}</Text> : null}
        </View>
      </View>
      {/* Render Joker (نوز) centered in the center piles when indicator is joker */}
      {indicatorTile && indicatorTile.isFakeJoker ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: `${CENTER_JOKER_REL_X * 100}%`,
            top: `${CENTER_JOKER_REL_Y * 100}%`,
            transform: [
              { translateX: -0.5 * (layout.usableWidth * CENTER_JOKER_SIZE_PCT) },
              {
  translateY:
    -0.5 *
    (typeof layout.centerPiles.height === "number"
      ? layout.centerPiles.height
      : 120),
},
            ],
            width: layout.usableWidth * CENTER_JOKER_SIZE_PCT,
            height: Math.max(54, layout.usableWidth * CENTER_JOKER_SIZE_PCT * 1.4),
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
        >
          <OkeyTileFace tile={indicatorTile} compact width={layout.usableWidth * CENTER_JOKER_SIZE_PCT} height={Math.max(54, layout.usableWidth * CENTER_JOKER_SIZE_PCT * 1.4)} />
        </View>
      ) : null}
    </View>
  );
}

export const MemoizedOkeyCenterPiles = memo(OkeyCenterPiles);

