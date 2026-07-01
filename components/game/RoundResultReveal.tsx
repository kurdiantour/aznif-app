import type { Player, RoundResult } from "@/types/game";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DominoTile from "./DominoTile";

const POINTS_APPEAR_DELAY_MS = 0;
const POINTS_HOLD_MS = 4_300;
const POINTS_FLY_MS = 300;
const HAND_REVEAL_MS = 350;

type Props = {
  visible: boolean;
  roundResult: RoundResult | null | undefined;
  players: Player[];
  topPlayer?: Player;
  leftPlayer?: Player;
  rightPlayer?: Player;
  humanPlayer?: Player;
  qapatPlayerId?: string | null;
};

export default function RoundResultReveal({
  visible,
  roundResult,
  players,
  topPlayer,
  leftPlayer,
  rightPlayer,
  qapatPlayerId = null,
}: Props) {
  const handPointsProgress = useRef(new Animated.Value(0)).current;
  const handRevealProgress = useRef(new Animated.Value(1)).current;
  const handPoints = roundResult?.awardedPoints ?? 0;
  const roundAnimationKey = visible && roundResult
    ? `${roundResult.winnerId ?? "round"}:${handPoints}`
    : null;

  useEffect(() => {
    handPointsProgress.stopAnimation();
    handRevealProgress.stopAnimation();
    handPointsProgress.setValue(0);
    handRevealProgress.setValue(0);
    if (!roundAnimationKey) return;

    const animatePoints = (progress: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(POINTS_HOLD_MS),
        Animated.timing(progress, {
          toValue: 2,
          duration: POINTS_FLY_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);

    const revealHands = Animated.timing(handRevealProgress, {
      toValue: 1,
      duration: HAND_REVEAL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    const animation = handPoints > 0
      ? Animated.parallel([
          revealHands,
          animatePoints(handPointsProgress, POINTS_APPEAR_DELAY_MS),
        ])
      : revealHands;

    animation.start();
    return () => animation.stop();
  }, [handPoints, handPointsProgress, handRevealProgress, roundAnimationKey]);

  const pointAnimationStyle = (progress: Animated.Value) => ({
    opacity: progress.interpolate({
      inputRange: [0, 0.08, 1.82, 2],
      outputRange: [0, 1, 1, 0],
    }),
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1, 2],
          outputRange: [0.4, 1, 1],
        }),
      },
    ],
  });
  const revealedHandStyle = {
    opacity: handRevealProgress,
  };

  if (!visible || !roundResult) return null;

  const winner = players.find((player) => player.id === roundResult.winnerId);
  const winnerRemainingTiles = roundResult.winnerId
    ? roundResult.remainingTilesByPlayer?.[roundResult.winnerId] ?? []
    : [];
  const isBlocked =
    roundResult.endReason === "blocked" || winnerRemainingTiles.length > 0;
  const resultPlayer = isBlocked
    ? players.find((player) => player.id === qapatPlayerId) ?? winner
    : winner;

  const tilesFor = (player: Player) =>
    roundResult.remainingTilesByPlayer?.[player.id] ?? [];

  return (
    <View
      style={styles.resultOverlay}
      pointerEvents="none"
    >
      <View style={styles.resultCenter}>
        <Text style={styles.resultAznifText}>
          {isBlocked ? "( قەپات )" : "( ئەزنیف )"}
        </Text>
        <Text style={styles.resultWinnerText}>
          {resultPlayer?.name ?? "کۆتایی هاتنی دەور"}
        </Text>

        <View style={styles.pointsAnimationSlot}>
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
    textAlign: "center",
  },
  resultAznifText: {
    marginBottom: 4,
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
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
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 210,
  },

  revealTilesRight: {
    position: "absolute",
    right: 74,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
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
