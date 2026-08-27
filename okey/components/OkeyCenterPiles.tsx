import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

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
  onDeckDragPointChange?: (point: { x: number; y: number } | null) => void;
  onDiscardDragActiveChange?: (active: boolean) => void;
  onDiscardDragPointChange?: (point: { x: number; y: number } | null) => void;
  onDeckMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onDiscardMeasured?: (rect: { x: number; y: number; width: number; height: number }) => void;
  hideTopDeckTile?: boolean;
  hideTopDiscardTile?: boolean;
  discardPresentationFallback?: OkeyTile | null;
};

export function OkeyCenterPiles({
  deckCount,
  topDiscard,
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
  onDeckDragPointChange,
  onDiscardDragActiveChange,
  onDiscardDragPointChange,
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
  const [discardDragPosition, setDiscardDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [deckDragPosition, setDeckDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [discardTileSize, setDiscardTileSize] = useState({ width: 38, height: 54 });
  const displayedTopDiscard = hideTopDiscardTile
    ? discardPresentationFallback ?? null
    : topDiscard;
  useEffect(() => {
    onDiscardDragActiveChange?.(!!discardDragPosition);
  }, [discardDragPosition, onDiscardDragActiveChange]);
  const measureRoot = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      rootOriginRef.current = { x, y };
    });
  }, []);
  const measureDeckTop = useCallback(() => {
    deckTopRef.current?.measureInWindow((x, y, width, height) => onDeckMeasured?.({ x, y, width, height }));
  }, [onDeckMeasured]);
  const measureDiscardTop = useCallback(() => {
    discardTopRef.current?.measureInWindow((x, y, width, height) => {
      setDiscardTileSize({ width, height });
      onDiscardMeasured?.({ x, y, width, height });
    });
  }, [onDiscardMeasured]);
  const setDiscardDragPositionFromGesture = useCallback((gesture: { moveX: number; moveY: number }) => {
    setDiscardDragPosition({
      x: gesture.moveX - rootOriginRef.current.x - discardTileSize.width / 2,
      y: gesture.moveY - rootOriginRef.current.y - discardTileSize.height / 2,
    });
  }, [discardTileSize.height, discardTileSize.width]);
  const clearDiscardDrag = useCallback(() => {
    discardDragStartedRef.current = false;
    setDiscardDragPosition(null);
    onDiscardDragPointChange?.(null);
  }, [onDiscardDragPointChange]);
  const clearDeckDrag = useCallback(() => {
    setDeckDragPosition(null);
    onDeckDragPointChange?.(null);
  }, [onDeckDragPointChange]);
  const deckDragHandlers = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => canDraw && deckCount > 0,
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        canDraw && deckCount > 0 && Math.hypot(gesture.dx, gesture.dy) > 3,
      onPanResponderGrant: () => {
        deckRootRef.current?.measureInWindow((x, y) => {
          deckOriginRef.current = { x, y };
        });
      },
      onPanResponderMove: (_, gesture) => {
        onDeckDragPointChange?.({ x: gesture.moveX, y: gesture.moveY });
        setDeckDragPosition({
          x: gesture.moveX - deckOriginRef.current.x - 21,
          y: gesture.moveY - deckOriginRef.current.y - 29,
        });
      },
      onPanResponderRelease: (_, gesture) => {
        if (Math.hypot(gesture.dx, gesture.dy) >= 8) {
          onDeckDroppedOnRack?.({ x: gesture.moveX, y: gesture.moveY });
        }
        clearDeckDrag();
      },
      onPanResponderTerminate: clearDeckDrag,
    }),
    [canDraw, clearDeckDrag, deckCount, onDeckDragPointChange, onDeckDroppedOnRack],
  );
  const discardDragHandlers = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => !!displayedTopDiscard,
      onMoveShouldSetPanResponder: (_, gesture) => !!displayedTopDiscard && Math.hypot(gesture.dx, gesture.dy) > 3,
      onPanResponderGrant: () => {
        measureRoot();
        measureDiscardTop();
        discardDragStartedRef.current = false;
        setDiscardDragPosition(null);
      },
      onPanResponderMove: (_, gesture) => {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        if (canDrawDiscard && !!displayedTopDiscard && distance > 8 && !discardDragStartedRef.current) {
          discardDragStartedRef.current = true;
        }
        if (discardDragStartedRef.current) {
          const point = { x: gesture.moveX, y: gesture.moveY };
          setDiscardDragPositionFromGesture(gesture);
          onDiscardDragPointChange?.(point);
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
    [canDrawDiscard, clearDiscardDrag, measureDiscardTop, measureRoot, onDiscardDragPointChange, onDiscardDroppedOnRack, onViewDiscards, setDiscardDragPositionFromGesture, displayedTopDiscard],
  );
  return (
    <View style={[styles.centerPiles, layout.centerPiles, (discardDragPosition || deckDragPosition) && styles.activeDiscardDragLayer]}>
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
        {displayedTopDiscard ? (
          <View
            testID="okey-top-discard"
            ref={discardTopRef}
            accessible
            accessibilityRole="button"
            accessibilityLabel={OKEY_ACCESSIBILITY.discardLabel(displayedTopDiscard, discardCount, isOkeyWildcard(displayedTopDiscard, okeyTile))}
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
            style={discardDragPosition ? styles.hiddenRackTile : undefined}
          >
            <OkeyTileFace
              tile={displayedTopDiscard}
              compact
              isWildcard={isOkeyWildcard(displayedTopDiscard, okeyTile)}
            />
          </View>
        ) : (
          <View ref={discardTopRef} collapsable={false} onLayout={measureDiscardTop} style={styles.emptyDiscard} />
        )}
        {discardCount > 0 ? <Text style={styles.discardCount}>{discardCount}</Text> : null}
        {displayedTopDiscard && discardDragPosition ? (
          <View
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
              tile={displayedTopDiscard}
              compact
              width={discardTileSize.width}
              height={discardTileSize.height}
              isWildcard={isOkeyWildcard(displayedTopDiscard, okeyTile)}
            />
          </View>
        ) : null}
      </View>

      <View
        ref={deckRootRef}
        style={styles.drawStackNatural}
        {...deckDragHandlers.panHandlers}
      >
        <Pressable
          testID="okey-draw-deck"
          disabled={!canDraw}
          onPress={onDrawDeck}
          accessibilityRole="button"
          accessibilityLabel={OKEY_ACCESSIBILITY.drawDeckLabel(deckCount)}
          accessibilityHint={OKEY_ACCESSIBILITY.drawDeckHint}
          accessibilityState={{ disabled: !canDraw }}
          style={StyleSheet.absoluteFillObject}
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
            style={[styles.drawStackLayer, { top: index * 3 }, index === 8 && (hideTopDeckTile || deckDragPosition) ? styles.hiddenRackTile : undefined]}
          >
            <OkeyTileBack unstyled width={42} height={58} />
          </View>
        ))}
        {deckDragPosition ? (
          <View
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
          </View>
        ) : null}
        {deckCount > 0 ? <Text style={styles.deckCount}>{deckCount}</Text> : null}
        </Pressable>
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