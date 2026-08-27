import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Text, View } from "react-native";

import { isOkeyWildcard, MAX_PLAYER_MELDS } from "@/okey/engine/okey-engine";
import type { OkeyMeld, OkeyPlayer, OkeyTile } from "@/okey/types/okey";
import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import { chunkOkeyMeldRows, OkeyMeldView, TABLE_MELD_TILE_HEIGHT, TABLE_MELD_TILE_WIDTH } from "./OkeyMeldView";
import { styles } from "./okeyStyles";
import { OkeyTileBack, OkeyTileFace } from "./OkeyTileFace";

const MELD_ENTRY_STAGGER_MS = 300;
const MELD_ENTRY_DURATION_MS = 950;
const MELD_META_ENTRY_DELAY_MS = MELD_ENTRY_DURATION_MS + 100;
type MeldRect = { x: number; y: number; width: number; height: number };
type MeldOffset = { x: number; y: number };
type MeldEntryOrigin = { x: number; y: number; arc: number };

function getMeldTileSignature(meld: OkeyMeld) {
  return meld.tiles.map((tile) => tile.id).sort().join("|");
}

function AnimatedSpentTile({
  tile,
  okeyTile,
  locked,
  animate,
  sourceOrigin,
}: {
  tile: OkeyTile;
  okeyTile: OkeyTile;
  locked: boolean;
  animate: boolean;
  sourceOrigin: MeldEntryOrigin;
}) {
  const shouldAnimateRef = useRef(animate);
  const [isAnimating, setIsAnimating] = useState(shouldAnimateRef.current);
  const progress = useRef(new Animated.Value(shouldAnimateRef.current ? 0 : 1)).current;

  useEffect(() => {
    if (!shouldAnimateRef.current) return;

    progress.setValue(0);

const animation = Animated.timing(progress, {
  toValue: 1,
  duration: 1250,
  easing: Easing.inOut(Easing.quad),
  useNativeDriver: true,
});

    animation.start(({ finished }) => {
      if (finished) setIsAnimating(false);
    });

    return () => animation.stop();
  }, [progress]);

  const distance = Math.hypot(sourceOrigin.x, sourceOrigin.y);
  const arcHeight = Math.min(120, Math.max(48, distance * 0.22));
  const middleY = sourceOrigin.y * 0.5 - arcHeight;

  return (
    <Animated.View
      style={{
        width: TABLE_MELD_TILE_WIDTH,
        height: TABLE_MELD_TILE_HEIGHT,
        zIndex: isAnimating ? 160 : 1,
        elevation: isAnimating ? 160 : 1,
        opacity: 1,
        transform: [
          {
            translateX: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [sourceOrigin.x, 0],
            }),
          },
          {
            translateY: progress.interpolate({
              inputRange: [0, 0.5, 0.88, 1],
              outputRange: [sourceOrigin.y, middleY, -4, 0],
            }),
          },
          {
            scale: progress.interpolate({
              inputRange: [0, 0.48, 0.84, 0.94, 1],
              outputRange: [1, 1.1, 1.03, 0.96, 1],
            }),
          },
          {
            rotate: progress.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [
                "0deg",
                sourceOrigin.x >= 0 ? "4deg" : "-4deg",
                "0deg",
              ],
            }),
          },
        ],
      }}
    >
      {locked ? (
        <OkeyTileBack
          unstyled
          width={TABLE_MELD_TILE_WIDTH}
          height={TABLE_MELD_TILE_HEIGHT}
        />
      ) : (
        <OkeyTileFace
          tile={tile}
          compact
          width={TABLE_MELD_TILE_WIDTH}
          height={TABLE_MELD_TILE_HEIGHT}
          isWildcard={isOkeyWildcard(tile, okeyTile)}
        />
      )}
    </Animated.View>
  );
}

function MeldPreview({
  meld,
  okeyTile,
  onMeasured,
  offset = { x: 0, y: 0 },
  onOffsetChange,
  entryDelayMs = null,
  entryOrigin,
  spendOriginsByPlayerId,
  localPlayerId,
  highlighted = false,
}: {
  meld: OkeyMeld;
  okeyTile: OkeyTile;
  onMeasured?: (meldId: string, rect: MeldRect) => void;
  offset?: MeldOffset;
  onOffsetChange?: (meldId: string, offset: MeldOffset) => void;
  entryDelayMs?: number | null;
  entryOrigin: MeldEntryOrigin;
  spendOriginsByPlayerId: Record<string, MeldEntryOrigin>;
  localPlayerId: string;
  highlighted?: boolean;
}) {
  const meldRef = useRef<View | null>(null);
  const dragStartOffsetRef = useRef(offset);
  const latestOffsetRef = useRef(offset);
  const tileSignature = meld.tiles.map((tile) => tile.id).join("|");
  const previousTileIdsRef = useRef(new Set(meld.tiles.map((tile) => tile.id)));
  const newlyAddedTileIds = new Set(
    meld.tiles.filter((tile) => !previousTileIdsRef.current.has(tile.id)).map((tile) => tile.id),
  );
  // A newly mounted meld must keep its original entry delay. The turn timer
  // re-renders the parent frequently and clears entryDelayMs on the next
  // render; using that live prop would cancel the animation at opacity 0.
  const initialEntryDelayRef = useRef(entryDelayMs);
  const shouldAnimateEntry = initialEntryDelayRef.current !== null;
  const entryProgress = useRef(new Animated.Value(shouldAnimateEntry ? 0 : 1)).current;
  latestOffsetRef.current = offset;

  const measure = useCallback(() => {
    meldRef.current?.measureInWindow((x, y, width, height) => {
onMeasured?.(meld.id, {
  x,
  y,
  width,
  height,
});
    });
  }, [meld.id, onMeasured]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          dragStartOffsetRef.current = latestOffsetRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          onOffsetChange?.(meld.id, {
            x: dragStartOffsetRef.current.x + gesture.dx,
            y: dragStartOffsetRef.current.y + gesture.dy,
          });
        },
        onPanResponderRelease: measure,
        onPanResponderTerminate: measure,
      }),
    [measure, meld.id, onOffsetChange],
  );

useEffect(() => {
  requestAnimationFrame(() => {
    measure();
  });
}, [
  measure,
  meld.tiles.length,
  offset.x,
  offset.y,
  tileSignature,
]);

  useEffect(() => {
    previousTileIdsRef.current = new Set(meld.tiles.map((tile) => tile.id));
  }, [meld.tiles, tileSignature]);

  useEffect(() => {
    if (!shouldAnimateEntry) return;
    const animation = Animated.sequence([
      Animated.delay(initialEntryDelayRef.current ?? 0),
      Animated.timing(entryProgress, {
        toValue: 1,
        duration: MELD_ENTRY_DURATION_MS,
        easing: Easing.bezier(0.2, 0.72, 0.24, 1),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [entryProgress, shouldAnimateEntry]);

  return (
    <Animated.View
      ref={meldRef}
      onLayout={measure}
      style={[
        styles.meldPreview,
        {
          opacity: entryProgress.interpolate({
            inputRange: [0, 0.14, 1],
            outputRange: [0.72, 1, 1],
          }),
          transform: [
            { translateX: offset.x },
            { translateY: offset.y },
            {
              translateX: entryProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [entryOrigin.x, 0],
              }),
            },
            {
              translateY: entryProgress.interpolate({
                inputRange: [0, 0.62, 0.88, 1],
                outputRange: [entryOrigin.y, entryOrigin.y - entryOrigin.arc, -3, 0],
              }),
            },
            {
              scale: entryProgress.interpolate({
                inputRange: [0, 0.78, 0.9, 1],
                outputRange: [0.8, 1.045, 0.985, 1],
              }),
            },
          ],
          ...(offset.x !== 0 || offset.y !== 0 ? { zIndex: 120, elevation: 120 } : null),
        },
      ]}
      {...panResponder.panHandlers}
    >
      {highlighted ? <View pointerEvents="none" style={styles.meldDropHighlight} /> : null}
      <OkeyMeldView
        meld={meld}
        okeyTile={okeyTile}
        renderTile={(tile) => (
          <AnimatedSpentTile
            tile={tile}
            okeyTile={okeyTile}
            locked={tile.id === meld.lockedTileId}
            animate={newlyAddedTileIds.has(tile.id) && tile.spentByPlayerId !== localPlayerId}
            sourceOrigin={
              (tile.spentByPlayerId && spendOriginsByPlayerId[tile.spentByPlayerId]) || entryOrigin
            }
          />
        )}
      />
</Animated.View>
  );
}

function getMeldEntryOrigin(position: "top" | "left" | "right" | "bottom"): MeldEntryOrigin {
  switch (position) {
    case "top":
      return { x: 0, y: -100, arc: 34 };
    case "left":
      return { x: -140, y: 24, arc: 28 };
    case "right":
      return { x: 140, y: 24, arc: 28 };
    case "bottom":
    default:
      return { x: 0, y: 120, arc: 42 };
  }
}

function getPlayerPosition(index: number): "top" | "left" | "right" | "bottom" {
  if (index === 1) return "top";
  if (index === 2) return "left";
  if (index === 3) return "right";
  return "bottom";
}

function computeAreaCenter(position: "top" | "left" | "right" | "bottom", layout: any) {
  const usableWidth = layout.usableWidth;
  const usableHeight = layout.usableHeight;
  const area: any = layout.meldAreas[position] || {};
  const width = Number(area.width || 0);
  const left = 'left' in area
    ? Number(area.left)
    : usableWidth - (Number(area.right || 0) + width);
  const top = 'top' in area
    ? Number(area.top)
    : usableHeight - (Number(area.bottom || 0));

  const centerX = left + width / 2 - usableWidth / 2;
  const centerY = top - usableHeight / 2; // approximate center using top/bottom anchors
  return { x: centerX, y: centerY };
}

function computeSeatPoint(position: "top" | "left" | "right" | "bottom", layout: any) {
  const w = layout.usableWidth;
  const h = layout.usableHeight;
  switch (position) {
    case "top":
      return { x: 0, y: -Math.round(h * 0.35) };
    case "left":
      return { x: -Math.round(w * 0.42), y: 0 };
    case "right":
      return { x: Math.round(w * 0.42), y: 0 };
    case "bottom":
    default:
      return { x: 0, y: Math.round(h * 0.35) };
  }
}

function getSpendEntryOrigin(
  sourcePosition: "top" | "left" | "right" | "bottom",
  targetPosition: "top" | "left" | "right" | "bottom",
  layout: any,
): MeldEntryOrigin {
  const source = computeSeatPoint(sourcePosition, layout);
  const target = computeAreaCenter(targetPosition, layout);
  return {
    x: source.x - target.x,
    y: source.y - target.y,
    arc: 46,
  };
}
export function OkeyPlayerMeldArea({
  player,
  allPlayers,
  okeyTile,
  position,
  showPlacementGuide = false,
  onMeldMeasured,
  meldOffsets = {},
  onMeldOffsetChange,
  highlightedMeldId,
  suppressEntryAnimationMeldSignatures = [],
}: {
  player: OkeyPlayer;
  allPlayers: OkeyPlayer[];
  okeyTile: OkeyTile;
  position: "top" | "left" | "right" | "bottom";
  showPlacementGuide?: boolean;
  onMeldMeasured?: (playerId: string, meldId: string, rect: MeldRect) => void;
  meldOffsets?: Record<string, MeldOffset>;
  onMeldOffsetChange?: (playerId: string, meldId: string, offset: MeldOffset) => void;
  highlightedMeldId?: string | null;
  suppressEntryAnimationMeldSignatures?: string[];
}) {
  const layout = useOkeyResponsiveLayout();
  const meldRows = chunkOkeyMeldRows(player.melds, MAX_PLAYER_MELDS);
  const entryOrigin = getMeldEntryOrigin(position);
  const spendOriginsByPlayerId = useMemo(
    () => Object.fromEntries(
      allPlayers.map((entry, index) => [
        entry.id,
        getSpendEntryOrigin(getPlayerPosition(index), position, layout),
      ]),
    ),
    [allPlayers, layout, position],
  );
  const previousMeldIdsRef = useRef(new Set(player.melds.map((meld) => meld.id)));
  const metaProgress = useRef(new Animated.Value(player.opened && player.scoreOpened !== 0 ? 1 : 0)).current;
  const newlyAddedMeldIds = player.melds
    .filter((meld) => !previousMeldIdsRef.current.has(meld.id))
    .map((meld) => meld.id);
  const newlyAddedMeldIdSet = new Set(newlyAddedMeldIds);
  const suppressedEntrySignatureSet = new Set(suppressEntryAnimationMeldSignatures);
  const handleMeasured = useCallback(
    (meldId: string, rect: MeldRect) => onMeldMeasured?.(player.id, meldId, rect),
    [onMeldMeasured, player.id],
  );
  const handleOffsetChange = useCallback(
    (meldId: string, offset: MeldOffset) => onMeldOffsetChange?.(player.id, meldId, offset),
    [onMeldOffsetChange, player.id],
  );

  useEffect(() => {
    previousMeldIdsRef.current = new Set(player.melds.map((meld) => meld.id));
  }, [player.melds]);

  useEffect(() => {
    if (!player.opened || player.scoreOpened === 0) {
      metaProgress.setValue(0);
      return;
    }
    const longestEntryDelay = Math.max(0, newlyAddedMeldIds.length - 1) * MELD_ENTRY_STAGGER_MS;
    metaProgress.setValue(newlyAddedMeldIds.length > 0 ? 0 : 1);
    const animation = Animated.sequence([
      Animated.delay(newlyAddedMeldIds.length > 0 ? longestEntryDelay + MELD_META_ENTRY_DELAY_MS : 0),
      Animated.spring(metaProgress, {
        toValue: 1,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [metaProgress, newlyAddedMeldIds.length, player.opened, player.scoreOpened]);

  return (
    <View
      style={[
        styles.meldArea,
        layout.meldAreas[position],
        position === "left" && styles.leftMeldArea,
        showPlacementGuide && styles.meldPlacementGuide,
      ]}
      pointerEvents="box-none"
    >
      {meldRows.length > 0 ? (
        <View
          style={[styles.meldContent, position === "top" && styles.topMeldContent]}
          pointerEvents="box-none"
        >
          {meldRows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.meldRow} pointerEvents="box-none">
              {row.map((meld) => (
                <MeldPreview
                  key={meld.id}
                  meld={meld}
                  okeyTile={okeyTile}
                  onMeasured={handleMeasured}
                  offset={meldOffsets[meld.id]}
                  onOffsetChange={handleOffsetChange}
                  entryDelayMs={
                    newlyAddedMeldIdSet.has(meld.id) &&
                    !suppressedEntrySignatureSet.has(getMeldTileSignature(meld))
                      ? newlyAddedMeldIds.indexOf(meld.id) * MELD_ENTRY_STAGGER_MS
                      : null
                  }
                  entryOrigin={entryOrigin}
                  spendOriginsByPlayerId={spendOriginsByPlayerId}
                  localPlayerId={allPlayers[0].id}
                  highlighted={highlightedMeldId === meld.id}
                />
              ))}
            </View>
          ))}
          {player.eliminated ? (
            <View
              testID={"okey-eliminated-meld-overlay-" + player.id}
              pointerEvents="none"
              style={styles.eliminatedMeldOverlay}
            />
          ) : null}
        </View>
      ) : null}

      {player.opened && player.scoreOpened !== 0 ? (
        <Animated.View
          style={[
            styles.meldMetaPill,
            {
              opacity: metaProgress,
              transform: [{
                scale: metaProgress.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
              }],
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.meldMetaText}>{player.scoreOpened}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

export function OkeyTableMeldAreas({
  players,
  okeyTile,
  showPlacementGuides = false,
  onMeldMeasured,
  meldOffsets,
  onMeldOffsetChange,
  highlightedMeldId,
  suppressLocalEntryAnimationMeldSignatures = [],
}: {
  players: OkeyPlayer[];
  okeyTile: OkeyTile;
  showPlacementGuides?: boolean;
  onMeldMeasured?: (
    playerId: string,
    meldId: string,
    rect: MeldRect,
  ) => void;
  meldOffsets?: Record<string, MeldOffset>;
  onMeldOffsetChange?: (
    playerId: string,
    meldId: string,
    offset: MeldOffset,
  ) => void;
  highlightedMeldId?: string | null;
  suppressLocalEntryAnimationMeldSignatures?: string[];
}) {
  return (
    <View style={styles.tableMeldLayer} pointerEvents="box-none">
      <OkeyPlayerMeldArea
        allPlayers={players}
        player={players[1]}
        okeyTile={okeyTile}
        position="top"
        showPlacementGuide={showPlacementGuides}
        onMeldMeasured={onMeldMeasured}
        meldOffsets={meldOffsets}
        onMeldOffsetChange={onMeldOffsetChange}
        highlightedMeldId={highlightedMeldId}
      />

      <OkeyPlayerMeldArea
        allPlayers={players}
        player={players[2]}
        okeyTile={okeyTile}
        position="left"
        showPlacementGuide={showPlacementGuides}
        onMeldMeasured={onMeldMeasured}
        meldOffsets={meldOffsets}
        onMeldOffsetChange={onMeldOffsetChange}
        highlightedMeldId={highlightedMeldId}
      />

      <OkeyPlayerMeldArea
        allPlayers={players}
        player={players[3]}
        okeyTile={okeyTile}
        position="right"
        showPlacementGuide={showPlacementGuides}
        onMeldMeasured={onMeldMeasured}
        meldOffsets={meldOffsets}
        onMeldOffsetChange={onMeldOffsetChange}
        highlightedMeldId={highlightedMeldId}
      />

      <OkeyPlayerMeldArea
        allPlayers={players}
        player={players[0]}
        okeyTile={okeyTile}
        position="bottom"
        showPlacementGuide={showPlacementGuides}
        onMeldMeasured={onMeldMeasured}
        meldOffsets={meldOffsets}
        onMeldOffsetChange={onMeldOffsetChange}
        highlightedMeldId={highlightedMeldId}
        suppressEntryAnimationMeldSignatures={suppressLocalEntryAnimationMeldSignatures}
      />
    </View>
  );
}

export const MemoizedOkeyTableMeldAreas = memo(OkeyTableMeldAreas);

