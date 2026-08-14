import { BlurView } from "expo-blur";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { MatchReward } from "@/types/game";

type GameOverPopupProps = {
  visible: boolean;
  didWin: boolean;
  isPracticeMode?: boolean;
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
  isPracticeMode = false,
  reward,
  teamScores,
  finishReason,
  onClose,
}: GameOverPopupProps) {
  if (!visible) {
    return null;
  }

  const isAznifMatch =
    reward?.currency === "aznif";

  const formatDelta = (value: number) =>
    `${value > 0 ? "+" : ""}${value.toLocaleString()}`;

  const rewardValueStyle = (value: number) => {
    if (value > 0) {
      return styles.rewardValuePositive;
    }

    if (value < 0) {
      return styles.rewardValueNegative;
    }

    return styles.rewardValueNeutral;
  };

  const resultText =
    didWin &&
    (finishReason === "opponent_team_manual_leave" ||
      finishReason === "opponent_manual_leave")
      ? "بەرامبەرەکەت لە یارییەکە دەرچوو تۆ براوە بویت."
      : didWin
        ? "یارییەکە تەواو بوو • تۆ براوە بویت!"
        : "یارییەکە تەواو بوو • تۆ دۆڕایت";

  return (
    <View
      style={styles.overlay}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <BlurView
          intensity={45}
          tint="dark"
          style={styles.card}
        >
          <View style={styles.titleRow}>
            <Text style={styles.titleStar}>
              {"\u2726"}
            </Text>

            <Text
              accessibilityRole="header"
              style={styles.title}
            >
              {
                "\u0626\u06d5\u0646\u062c\u0627\u0645\u06cc \u06cc\u0627\u0631\u06cc"
              }
            </Text>

            <Text style={styles.titleStar}>
              {"\u2726"}
            </Text>
          </View>

          <View
            style={[
              styles.resultBadge,
              didWin
                ? styles.resultBadgeWin
                : styles.resultBadgeLoss,
            ]}
          >
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={[
                styles.resultText,
                didWin
                  ? styles.resultTextWin
                  : styles.resultTextLoss,
              ]}
            >
              {resultText}
            </Text>
          </View>

          {teamScores ? (
            <View style={styles.section}>
              <View style={styles.scoreRow}>
                <View style={styles.scoreSide}>
                  <Text style={styles.scoreLabel}>
                    تیمی ئێوە
                  </Text>

                  <Text style={styles.teamAScore}>
                    {teamScores.teamA}
                  </Text>
                </View>

                <View style={styles.scoreDivider} />

                <View style={styles.scoreSide}>
                  <Text style={styles.scoreLabel}>
                    تیمی بەرامبەر
                  </Text>

                  <Text style={styles.teamBScore}>
                    {teamScores.teamB}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {reward ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {
                  "\u062e\u06d5\u06b5\u0627\u062a\u06d5\u06a9\u0627\u0646"
                }
              </Text>

              <View style={styles.rewardRow}>
                {!isPracticeMode ? (
                  <View style={styles.rewardCard}>
                    <Text style={styles.rewardIcon}>
                      {isAznifMatch
                        ? "\u2728"
                        : "\u{1FA99}"}
                    </Text>

                    <View style={styles.rewardValueRow}>
                      <Text
                        style={[
                          styles.rewardValue,
                          rewardValueStyle(reward.coin),
                        ]}
                      >
                        {formatDelta(reward.coin)}
                      </Text>

                      <Text style={styles.rewardLabel}>
                        {isAznifMatch
                          ? "Aznif"
                          : "Coin"}
                      </Text>
                    </View>
                  </View>
                ) : null}

                {!isAznifMatch && !isPracticeMode ? (
                  <View style={styles.rewardCard}>
                      <Text style={styles.rewardIcon}>
                        {"\u{1F48E}"}
                      </Text>

                      <View style={styles.rewardValueRow}>
                        <Text
                          style={[
                            styles.rewardValue,
                            rewardValueStyle(
                              reward.gem,
                            ),
                          ]}
                        >
                          {formatDelta(reward.gem)}
                        </Text>

                        <Text style={styles.rewardLabel}>
                          گەوهەر
                        </Text>
                      </View>
                  </View>
                ) : null}

                {!isAznifMatch ? (
                  <View style={styles.rewardCard}>
                      <Text style={styles.rewardIcon}>
                        {"\u2B50"}
                      </Text>

                      <View style={styles.rewardValueRow}>
                        <Text
                          style={[
                            styles.rewardValue,
                            rewardValueStyle(
                              reward.points,
                            ),
                          ]}
                        >
                          {formatDelta(
                            reward.points,
                          )}
                        </Text>

                        <Text style={styles.rewardLabel}>
                          Point
                        </Text>
                      </View>
                  </View>
                ) : null}
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
                دەرچوون
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
    maxWidth: 580,
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
    shadowOffset: {
      width: 0,
      height: 8,
    },
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

  resultTextWin: {
    color: "#dcfce7",
  },

  resultTextLoss: {
    color: "#fee2e2",
  },

  section: {
    width: "100%",
    marginBottom: 14,
  },

  sectionTitle: {
    color: "rgba(248, 243, 223, 0.82)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginBottom: 7,
  },

  scoreRow: {
    width: "100%",
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },

  scoreSide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  scoreDivider: {
    width: 1,
    height: 42,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },

  scoreLabel: {
    color: "rgba(248, 243, 223, 0.72)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  teamAScore: {
    marginTop: 4,
    color: "#7db0ff",
    fontSize: 24,
    fontFamily: "RobotoMedium",
  },

  teamBScore: {
    marginTop: 4,
    color: "#ff8585",
    fontSize: 24,
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
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.065)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  rewardValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 2,
  },

  rewardIcon: {
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
  },

  rewardValue: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "RobotoMedium",
  },

  rewardValuePositive: {
    color: "#22c55e",
  },

  rewardValueNegative: {
    color: "#ff8a8a",
  },

  rewardValueNeutral: {
    color: "#f8f3df",
  },

  rewardLabel: {
    color: "rgba(248, 243, 223, 0.78)",
    fontSize: 15,
    lineHeight: 18,
    fontFamily: "RobotoMedium",
  },

  actions: {
    width: "100%",
    flexDirection: "row",
    marginTop: 2,
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
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  buttonPressed: {
    opacity: 0.78,
  },
});
