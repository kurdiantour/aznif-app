import type { Player, RoundResult } from "@/types/game";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DominoTile from "./DominoTile";

const POINTS_APPEAR_DELAY_MS = 900;
const POINTS_HOLD_MS = 850;
const POINTS_FLY_MS = 700;
const HAND_REVEAL_MS = 350;

type Props = {
  visible: boolean;
  roundResult: RoundResult | null | undefined;
  lastTilePoints?: number;
  players: Player[];
  topPlayer?: Player;
  leftPlayer?: Player;
  rightPlayer?: Player;
  humanPlayer?: Player;
};

export default function RoundResultReveal({
  visible,
  roundResult,
  lastTilePoints = 0,
  players,
  topPlayer,
  leftPlayer,
  rightPlayer,
}: Props) {
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const lastTileProgress = useRef(new Animated.Value(0)).current;
  const handPointsProgress = useRef(new Animated.Value(0)).current;
  const handRevealProgress = useRef(new Animated.Value(1)).current;
  const handPoints = roundResult?.awardedPoints ?? 0;
  const roundAnimationKey = visible && roundResult
    ? `${roundResult.winnerId ?? "round"}:${lastTilePoints}:${handPoints}`
    : null;

  useEffect(() => {
    lastTileProgress.stopAnimation();
    handPointsProgress.stopAnimation();
    handRevealProgress.stopAnimation();
    lastTileProgress.setValue(0);
    handPointsProgress.setValue(0);
    handRevealProgress.setValue(lastTilePoints > 0 ? 0 : 1);
    if (!roundAnimationKey) return;

    const animatePoints = (progress: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.spring(progress, {
          toValue: 1,
          speed: 16,
          bounciness: 8,
          useNativeDriver: true,
        }),
        Animated.delay(POINTS_HOLD_MS),
        Animated.timing(progress, {
          toValue: 2,
          duration: POINTS_FLY_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);

    if (lastTilePoints <= 0 && handPoints <= 0) return;

    const revealHands = Animated.timing(handRevealProgress, {
      toValue: 1,
      duration: HAND_REVEAL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    const animation = lastTilePoints > 0 && handPoints > 0
      ? Animated.sequence([
        animatePoints(lastTileProgress, POINTS_APPEAR_DELAY_MS),
        Animated.parallel([
          revealHands,
          animatePoints(handPointsProgress, HAND_REVEAL_MS + 250),
        ]),
      ])
      : lastTilePoints > 0
        ? Animated.sequence([
          animatePoints(lastTileProgress, POINTS_APPEAR_DELAY_MS),
          revealHands,
        ])
      : animatePoints(
        handPointsProgress,
        POINTS_APPEAR_DELAY_MS,
      );

    animation.start();
    return () => animation.stop();
  }, [handPoints, handPointsProgress, handRevealProgress, lastTilePoints, lastTileProgress, roundAnimationKey]);

  const pointAnimationStyle = (progress: Animated.Value) => ({
    opacity: progress.interpolate({
      inputRange: [0, 0.08, 1.82, 2],
      outputRange: [0, 1, 1, 0],
    }),
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 1, 2],
          outputRange: [0, 0, Math.max(0, overlaySize.width / 2 - 143)],
        }),
      },
      {
        translateY: progress.interpolate({
          inputRange: [0, 1, 2],
          outputRange: [8, 0, Math.max(0, overlaySize.height / 2 - 43)],
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [0, 1, 1.72, 2],
          outputRange: [0.4, 1, 1, 0.42],
        }),
      },
    ],
  });
  const revealedHandStyle = {
    opacity: handRevealProgress,
  };

  const handleOverlayLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setOverlaySize({ width, height });
  };

  if (!visible || !roundResult) return null;

  const winner = players.find((player) => player.id === roundResult.winnerId);
  const isBlocked = roundResult.endReason === "blocked";

  const tilesFor = (player: Player) =>
    roundResult.remainingTilesByPlayer?.[player.id] ?? [];

  return (
    <View
      style={styles.resultOverlay}
      pointerEvents="none"
      onLayout={handleOverlayLayout}
    >
      <View style={styles.resultCenter}>
        {isBlocked && (
          <Text style={styles.resultReasonText}>یاری پست بوو</Text>
        )}
        <Text style={styles.resultWinnerText}>
          {winner ? `${winner.name} بردیەوە` : "کۆتایی هاتنی دەور"}
        </Text>

        <View style={styles.pointsAnimationSlot}>
          {lastTilePoints > 0 && (
            <Animated.View
              style={[styles.resultPointsBadge, pointAnimationStyle(lastTileProgress)]}
            >
              <Text style={styles.pointsLabel}>آخرین تایل</Text>
              <Text style={styles.resultPointsText}>+{lastTilePoints}</Text>
            </Animated.View>
          )}
          {handPoints > 0 && (
            <Animated.View
              style={[
                styles.resultPointsBadge,
                styles.handPointsBadge,
                pointAnimationStyle(handPointsProgress),
              ]}
            >
              <Text style={styles.resultPointsText}>+{handPoints}</Text>
            </Animated.View>
          )}
        </View>
      </View>

      {topPlayer && (
        <Animated.View style={[styles.revealTilesTop, revealedHandStyle]}>
          <View style={styles.revealTilesRow}>
            {tilesFor(topPlayer).map((tile) => (
              <DominoTile key={tile.id} tile={tile} width={28} height={54} />
            ))}
          </View>
        </Animated.View>
      )}

      {leftPlayer && (
        <Animated.View style={[styles.revealTilesLeft, revealedHandStyle]}>
          <View style={styles.revealTilesColumn}>
            {tilesFor(leftPlayer).map((tile) => (
              <DominoTile
                key={tile.id}
                tile={tile}
                width={24}
                height={46}
                rotation={90}
              />
            ))}
          </View>
        </Animated.View>
      )}

      {rightPlayer && (
        <Animated.View style={[styles.revealTilesRight, revealedHandStyle]}>
          <View style={styles.revealTilesColumn}>
            {tilesFor(rightPlayer).map((tile) => (
              <DominoTile
                key={tile.id}
                tile={tile}
                width={24}
                height={46}
                rotation={270}
              />
            ))}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  resultOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
  },

  resultCenter: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    zIndex: 230,
  },

  resultWinnerText: {
    color: "#f8f3df",
    fontSize: 16,
    fontFamily: "SpedaBold",
  },
  resultReasonText: {
    color: "#fbbf24",
    fontSize: 18,
    fontFamily: "SpedaBold",
    marginBottom: 6,
  },

  resultPointsText: {
    color: "#facc15",
    fontSize: 30,
    fontFamily: "SpedaBold",
    textShadowColor: "rgba(250, 204, 21, 0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  resultPointsBadge: {
    position: "absolute",
    top: 0,
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(9, 11, 29, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.48)",
    zIndex: 260,
  },
  pointsAnimationSlot: {
    width: 190,
    height: 58,
    marginTop: 4,
    alignItems: "center",
  },
  handPointsBadge: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  pointsLabel: {
    color: "#f8f3df",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  revealTilesTop: {
    position: "absolute",
    top: 82,
    alignSelf: "center",
    alignItems: "center",
    zIndex: 210,
  },

  revealTilesLeft: {
    position: "absolute",
    left: 74,
    top: "50%",
    transform: [{ translateY: -10 }],
    alignItems: "center",
    zIndex: 210,
  },

  revealTilesRight: {
    position: "absolute",
    right: 74,
    top: "50%",
    transform: [{ translateY: -10 }],
    alignItems: "center",
    zIndex: 210,
  },

  revealTilesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  revealTilesColumn: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
});
