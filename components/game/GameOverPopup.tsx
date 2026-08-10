import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MatchReward } from "@/types/game";

type GameOverPopupProps = {
  visible: boolean;
  didWin: boolean;
  reward?: MatchReward | null;
  teamScores?: {
    teamA: number;
    teamB: number;
  };
  finishReason?: string | null;
  onClose: () => void;
  onPlayAgain: () => void;
};

export default function GameOverPopup({
  visible,
  didWin,
  reward,
  teamScores,
  finishReason,
  onClose,
  onPlayAgain,
}: GameOverPopupProps) {
  if (!visible) {
    return null;
  }

  const formatDelta = (value: number) =>
    `${value > 0 ? "+" : ""}${value.toLocaleString()}`;

  const changeLabel = (value: number) =>
    value > 0
      ? "\u0628\u06d5\u062f\u06d5\u0633\u062a\u0647\u06ce\u0646\u0627"
      : value < 0
        ? "\u0644\u06d5\u062f\u06d5\u0633\u062a\u062f\u0627"
        : "\u0628\u06ce \u06af\u06c6\u0695\u0627\u0646\u06a9\u0627\u0631\u06cc";

  const resultText =
    didWin &&
      (finishReason === "opponent_team_manual_leave" ||
        finishReason === "opponent_manual_leave")
      ? "بەرامبەرەکەت لە یارییەکە دەرچوو تۆ براوە بویت."
      : didWin
        ? "یارییەکە تەواو بوو • تۆ براوە بویت!"
        : "یارییەکە تەواو بوو • تۆ دۆڕایت";

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <BlurView intensity={45} tint="dark" style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.titleStar}>{"\u2726"}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {"\u0626\u06d5\u0646\u062c\u0627\u0645\u06cc \u06cc\u0627\u0631\u06cc"}
            </Text>
            <Text style={styles.titleStar}>{"\u2726"}</Text>
          </View>

          <View
            style={[
              styles.resultBadge,
              didWin ? styles.resultBadgeWin : styles.resultBadgeLoss,
            ]}
          >
            <Ionicons
              name={didWin ? "trophy" : "shield-outline"}
              size={17}
              color={didWin ? "#facc15" : "#ff8a8a"}
            />
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={[
                styles.resultText,
                didWin ? styles.resultTextWin : styles.resultTextLoss,
              ]}
            >
              {resultText}
            </Text>
          </View>

          {teamScores ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {"\u0626\u06d5\u0646\u062c\u0627\u0645\u06cc \u06a9\u06c6\u062a\u0627\u06cc\u06cc"}
              </Text>
              <View style={styles.scoreRow}>
                <View style={[styles.scoreCard, styles.teamACard]}>
                  <Text style={styles.scoreLabel}>{"\u062a\u06cc\u0645\u06cc A"}</Text>
                  <Text style={styles.teamAScore}>{teamScores.teamA}</Text>
                </View>

                <View style={styles.scoreSeparator}>
                  <Text style={styles.scoreSeparatorText}>{"\u2014"}</Text>
                </View>

                <View style={[styles.scoreCard, styles.teamBCard]}>
                  <Text style={styles.scoreLabel}>{"\u062a\u06cc\u0645\u06cc B"}</Text>
                  <Text style={styles.teamBScore}>{teamScores.teamB}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {reward ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {"\u062e\u06d5\u06b5\u0627\u062a\u06d5\u06a9\u0627\u0646"}
              </Text>
              <View style={styles.rewardRow}>
                <View style={styles.rewardCard}>
                  <Ionicons name="logo-bitcoin" size={18} color="#facc15" />
                  <Text style={[styles.rewardValue, reward.coin < 0 && styles.rewardValueNegative]}>{formatDelta(reward.coin)}</Text>
                  <Text style={styles.rewardChangeLabel}>{changeLabel(reward.coin)}</Text>
                  <Text style={styles.rewardLabel}>{reward.currency === "aznif" ? "Aznif" : "Coin"}</Text>
                </View>

                <View style={styles.rewardCard}>
                  <Ionicons name="diamond" size={18} color="#67e8f9" />
                  <Text style={[styles.rewardValue, reward.gem < 0 && styles.rewardValueNegative]}>{formatDelta(reward.gem)}</Text>
                  <Text style={styles.rewardChangeLabel}>{changeLabel(reward.gem)}</Text>
                  <Text style={styles.rewardLabel}>Gem</Text>
                </View>

                <View style={styles.rewardCard}>
                  <Ionicons name="star" size={18} color="#c4b5fd" />
                  <Text
                    style={[
                      styles.rewardValue,
                      reward.points < 0 && styles.rewardValueNegative,
                    ]}
                  >
                    {formatDelta(reward.points)}
                  </Text>
                  <Text style={styles.rewardChangeLabel}>{changeLabel(reward.points)}</Text>
                  <Text style={styles.rewardLabel}>Point</Text>
                </View>
              </View>
            </View>
          ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="دەرچوون"
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={onClose}
        >
          <Text style={styles.primaryButtonText}>
            {"دەرچوون"}
          </Text>
        </Pressable>
      </View>
    </BlurView>
  </View>
</View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(9, 3, 18, 0.24)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "86%",
    maxWidth: 500,
    borderRadius: 16,
    overflow: "hidden",
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
    backgroundColor: "rgba(0, 0, 0, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginBottom: 8,
  },
  title: {
    color: "#f8f3df",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  titleStar: {
    color: "#facc15",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
  resultBadge: {
    maxWidth: "96%",
    minHeight: 42,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 21,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 15,
  },
  resultBadgeWin: {
    backgroundColor: "rgba(20, 83, 45, 0.58)",
    borderColor: "rgba(74, 222, 128, 0.60)",
  },
  resultBadgeLoss: {
    backgroundColor: "rgba(127, 29, 29, 0.48)",
    borderColor: "rgba(248, 113, 113, 0.55)",
  },
  resultText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  resultTextWin: { color: "#dcfce7" },
  resultTextLoss: { color: "#fee2e2" },
  section: {
    width: "100%",
    marginBottom: 14,
  },
  sectionTitle: {
    color: "rgba(248, 243, 223, 0.82)",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginBottom: 7,
  },
  scoreRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
  },
  scoreCard: {
    flex: 1,
    minHeight: 64,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  teamACard: {
    backgroundColor: "rgba(37, 99, 235, 0.16)",
    borderColor: "rgba(96, 165, 250, 0.34)",
  },
  teamBCard: {
    backgroundColor: "rgba(220, 38, 38, 0.14)",
    borderColor: "rgba(248, 113, 113, 0.32)",
  },
  scoreLabel: {
    color: "rgba(248, 243, 223, 0.72)",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },
  teamAScore: {
    color: "#7db0ff",
    fontSize: 24,
    fontFamily: "RobotoMedium",
  },
  teamBScore: {
    color: "#ff8585",
    fontSize: 24,
    fontFamily: "RobotoMedium",
  },
  scoreSeparator: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreSeparatorText: {
    color: "rgba(255,255,255,0.28)",
    fontSize: 15,
    fontFamily: "RobotoMedium",
  },
  rewardRow: {
    width: "100%",
    flexDirection: "row",
    gap: 8,
  },
  rewardCard: {
    flex: 1,
    minHeight: 70,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.065)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  rewardValue: {
    marginTop: 2,
    color: "#f8f3df",
    fontSize: 15,
    lineHeight: 18,
    fontFamily: "RobotoMedium",
  },
  rewardValueNegative: { color: "#ff8a8a" },
  rewardChangeLabel: {
    color: "rgba(248, 243, 223, 0.48)",
    fontSize: 8,
    lineHeight: 10,
    fontFamily: "SpedaRegular",
  },
  rewardLabel: {
    color: "rgba(248, 243, 223, 0.58)",
    fontSize: 9,
    lineHeight: 12,
    fontFamily: "RobotoMedium",
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  secondaryButton: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  secondaryButtonText: {
    color: "#f8f3df",
    fontSize: 11,
    fontFamily: "SpedaBold",
  },
  primaryButton: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#facc15",
  },
  primaryButtonText: {
    color: "#071f15",
    fontSize: 11,
    fontFamily: "SpedaBold",
  },
  buttonPressed: { opacity: 0.78 },
});
