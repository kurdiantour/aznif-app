import { Image } from "expo-image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { useOkeyResponsiveLayout } from "../layout/OkeyResponsiveLayoutProvider";
import {
  OPPONENT_RACK_HEIGHT,
  OPPONENT_RACK_WIDTH,
  OPPONENT_TILE_WIDTH,
} from "../layout/uiPositions";
import { useOkeyCosmetics } from "../hooks/useOkeyCosmetics";
import { OkeyTileBack } from "./OkeyTileFace";
import { OkeyTurnTimerBar } from "./OkeyTurnTimerBar";

const DEAL_TILE_DURATION_MS = 420;
const DEAL_BATCH_INTERVAL_MS = 180;
const DEAL_PLAYER_COUNT = 4;
const DEAL_BATCH_SIZE = 3;
const MAX_HAND_SIZE = 15;
const DISPLAY_TILE_LIMIT = 7;

type DealTile = {
  id: number;
  batchIndex: number;
  indexInBatch: number;
  targetSlot: number;
};

function buildDealTiles(handCount: number): DealTile[] {
  const safeCount = Math.max(0, Math.min(MAX_HAND_SIZE, handCount));
  const result: DealTile[] = [];

  let dealt = 0;
  let batchIndex = 0;

  while (dealt < safeCount) {
    const batchSize = Math.min(DEAL_BATCH_SIZE, safeCount - dealt);

    for (let indexInBatch = 0; indexInBatch < batchSize; indexInBatch += 1) {
      const tileIndex = dealt + indexInBatch;

      result.push({
        id: tileIndex,
        batchIndex,
        indexInBatch,
        targetSlot: tileIndex % DISPLAY_TILE_LIMIT,
      });
    }

    dealt += batchSize;
    batchIndex += 1;
  }

  return result;
}

export function OkeyOpponentSeat({
  playerId,
  name,
  count,
  active,
  side,
  turnTimeLeftMilliseconds,
  turnDeadlineAt,
  serverClockOffsetMs,
  turnDurationSeconds,
  turnTimerPhase = "throw",
  dealResetKey,
  dealOrigin,
  onMeasured,
  onPress,
}: {
  playerId?: string;
  name: string;
  count: number;
  active: boolean;
  side: "top" | "left" | "right";
  turnTimeLeftMilliseconds: number;
  turnDeadlineAt: string | null;
  serverClockOffsetMs: number;
  turnDurationSeconds: number | null;
  turnTimerPhase?: "draw" | "throw";
  dealResetKey?: string;
  dealOrigin?: { x: number; y: number } | null;
  onMeasured?: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onPress?: () => void;
}) {
  const layout = useOkeyResponsiveLayout();
  const { getPlayerAssets } = useOkeyCosmetics();
  const seatRef = useRef<View | null>(null);

  const dealOrder = side === "top" ? 1 : side === "left" ? 2 : 3;

  const [wrapperOrigin, setWrapperOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const dealOriginX = dealOrigin?.x;
  const dealOriginY = dealOrigin?.y;
  const wrapperOriginX = wrapperOrigin?.x;
  const wrapperOriginY = wrapperOrigin?.y;

  const animatedDealKey = useRef<string | undefined>(undefined);

  const [dealing, setDealing] = useState(false);

  const dealTiles = useMemo(() => buildDealTiles(count), [count]);

  const tileAnimations = useMemo(
    () => Array.from({ length: MAX_HAND_SIZE }, () => new Animated.Value(1)),
    [],
  );

  const dealAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const targetBackCount =
    Number.isFinite(count) ? Math.min(DISPLAY_TILE_LIMIT, Math.max(0, Math.floor(count))) : 0;
  const slotSpacing = targetBackCount > 1
    ? Math.min(OPPONENT_TILE_WIDTH + 1, (OPPONENT_RACK_WIDTH - 16 - OPPONENT_TILE_WIDTH) / (targetBackCount - 1))
    : 0;

  useEffect(() => {
    if (
      !dealResetKey ||
      animatedDealKey.current === dealResetKey ||
      dealOriginX === undefined ||
      dealOriginY === undefined ||
      wrapperOriginX === undefined ||
      wrapperOriginY === undefined ||
      count <= 0
    ) {
      return;
    }

    animatedDealKey.current = dealResetKey;
    setDealing(true);

    dealAnimRef.current?.stop();

    tileAnimations.forEach((anim, index) => {
      anim.setValue(index < dealTiles.length ? 0 : 1);
    });

    const animations = dealTiles.map((tile) => {
      const delay =
        (tile.batchIndex * DEAL_PLAYER_COUNT + dealOrder) *
        DEAL_BATCH_INTERVAL_MS;

      return Animated.timing(tileAnimations[tile.id], {
        toValue: 1,
        duration: DEAL_TILE_DURATION_MS,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    });

    const parallel = Animated.parallel(animations);
    dealAnimRef.current = parallel;

    parallel.start(({ finished }) => {
      if (!finished) return;

      dealAnimRef.current = null;

      setDealing(false);
    });

    return () => {
      dealAnimRef.current?.stop();
      dealAnimRef.current = null;

      setDealing(false);
    };
  }, [
    count,
    dealOrder,
    dealOriginX,
    dealOriginY,
    dealResetKey,
    dealTiles,
    targetBackCount,
    tileAnimations,
    wrapperOriginX,
    wrapperOriginY,
  ]);

  const measureSeat = useCallback(() => {
    seatRef.current?.measureInWindow((x, y, width, height) => {
      setWrapperOrigin({ x, y });
      onMeasured?.({ x, y, width, height });
    });
  }, [onMeasured]);

  useEffect(() => {
    const frame = requestAnimationFrame(measureSeat);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playerId, measureSeat]);

  // The rack reflects the hand count; deal flights are presentation only.

  return (
<Pressable
  ref={seatRef}
  collapsable={false}
  onLayout={measureSeat}
  onPress={onPress}
  disabled={!onPress}
  style={[
    styles.opponentSeat,
    side === "left" && styles.leftSeat,
    side === "right" && styles.rightSeat,
    layout.seats[side],
  ]}
>
      <View style={styles.opponentRackWrap}>
        <View style={styles.opponentRack}>
          <Image
            pointerEvents="none"
            source={getPlayerAssets(playerId).opponentRack}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            cachePolicy="memory-disk"
            transition={0}
          />

          <View testID={`opponent-rack-${side}`} style={styles.opponentTilesRow}>
            {Array.from({ length: targetBackCount }).map((_, index) => (
              <View
                key={`settled-${index}`}
                style={{ marginLeft: index === 0 ? 0 : slotSpacing - OPPONENT_TILE_WIDTH }}
              >
                <OkeyTileBack small />
              </View>
            ))}
          </View>

          {dealing && dealOrigin && wrapperOrigin ? (
            <View testID={`opponent-deal-${side}`} pointerEvents="none" style={styles.dealFlightLayer}>
              {dealTiles.map((tile) => {
                const progress = tileAnimations[tile.id];

                const targetOffsetX =
                  (tile.targetSlot - (targetBackCount - 1) / 2) *
                  slotSpacing;

                const targetScreenX =
                  wrapperOrigin.x +
                  OPPONENT_RACK_WIDTH / 2 +
                  targetOffsetX;

                const targetScreenY =
                  wrapperOrigin.y +
                  OPPONENT_RACK_HEIGHT / 2;

                const screenFromX = dealOrigin.x - targetScreenX;
                const screenFromY = dealOrigin.y - targetScreenY;

                const localFromX =
                  side === "left"
                    ? -screenFromY
                    : side === "right"
                      ? screenFromY
                      : screenFromX;

                const localFromY =
                  side === "left"
                    ? screenFromX
                    : side === "right"
                      ? -screenFromX
                      : screenFromY;

                const withinBatchOffset =
                  (tile.indexInBatch - 1) * 3;

                return (
                  <Animated.View
                    key={`deal-${dealResetKey}-${tile.id}`}
                    style={[
                      styles.flyingTile,
                      {
                        left:
                          OPPONENT_RACK_WIDTH / 2 -
                          12 +
                          targetOffsetX +
                          withinBatchOffset,
                        top: OPPONENT_RACK_HEIGHT / 2 - 16,
                        opacity: progress.interpolate({
                          inputRange: [0, 0.12, 0.88, 1],
                          outputRange: [0, 1, 1, 0],
                        }),
                        transform: [
                          {
                            translateX: progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [localFromX, 0],
                            }),
                          },
                          {
                            translateY: progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [localFromY, 0],
                            }),
                          },
                          {
                            scale: progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1.18, 1],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <OkeyTileBack small />
                  </Animated.View>
                );
              })}
            </View>
          ) : null}
        </View>

        <OkeyTurnTimerBar
          active={active}
          deadlineAt={turnDeadlineAt}
          serverClockOffsetMs={serverClockOffsetMs}
          remainingMilliseconds={turnTimeLeftMilliseconds}
          durationSeconds={turnDurationSeconds}
          phase={turnTimerPhase}
          orientation="horizontal"
          reverse={side !== "left"}
          style={
            side === "top"
              ? styles.opponentTimerTop
              : side === "left"
                ? styles.opponentTimerLeft
                : styles.opponentTimerRight
          }
        />
      </View>

      <View style={styles.namePlate}>
        <Text
          style={styles.nameText}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

export const MemoizedOkeyOpponentSeat = memo(OkeyOpponentSeat);

const styles = StyleSheet.create({
  opponentSeat: {
    position: "absolute",
    alignItems: "center",
    gap: 0,
    zIndex: 500,
    elevation: 500,
  },

  leftSeat: {
    transform: [
      { rotate: "-90deg" },
      { translateY: -30 },
    ],
  },

  rightSeat: {
    transform: [
      { rotate: "90deg" },
      { translateY: -30 },
    ],
  },

  opponentRackWrap: {
    position: "relative",
    overflow: "visible",
  },

  opponentRack: {
    width: OPPONENT_RACK_WIDTH,
    height: OPPONENT_RACK_HEIGHT,
    paddingHorizontal: 8,
    overflow: "visible",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  opponentTilesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  dealFlightLayer: {
    ...StyleSheet.absoluteFill,
    overflow: "visible",
    zIndex: 5000,
    elevation: 5000,
  },

  flyingTile: {
    position: "absolute",
    zIndex: 5001,
    elevation: 5001,
  },

  namePlate: {
    width: 96,
    maxWidth: 96,
    minWidth: 0,
    overflow: "hidden",
    height: 20,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.32)",
  },

  nameText: {
    flexShrink: 1,
    width: "100%",
    color: "#f8edd0",
    fontSize: 13,
    textAlign: "center",
  },

  opponentTimerTop: {
    left: 0,
    right: 0,
    top: -7,
    height: 4,
  },

  opponentTimerLeft: {
    left: 0,
    right: 0,
    top: -7,
    height: 4,
  },

  opponentTimerRight: {
    left: 0,
    right: 0,
    top: -7,
    height: 4,
  },
});

