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

  const resultText =
    didWin &&
      (finishReason === "opponent_team_manual_leave" ||
        finishReason === "opponent_manual_leave")
      ? "بەرامبەرەکەت لە یارییەکە دەرچوو تۆ براوە بویت."
      : didWin
        ? "یارییەکە تەواو بوو • تۆ براوە بویت!"
        : "یارییەکە تەواو بوو • تۆ دۆڕایت";

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop}>
        <BlurView
          intensity={45}
          tint="dark"
          style={styles.card}
        >
          <Text style={styles.eyebrow}>
            {resultText}
          </Text>

          {teamScores ? (
            <View style={styles.finalScoreBox}>
              <Text style={styles.finalScoreTitle}>
                ئەنجامی کۆتایی
              </Text>

              <View style={styles.finalScorePill}>
                <Text style={styles.teamAScore}>
                  {teamScores.teamA}
                </Text>

                <Text style={styles.scoreDivider}>
                  |
                </Text>

                <Text style={styles.teamBScore}>
                  {teamScores.teamB}
                </Text>
              </View>
            </View>
          ) : null}

          {reward ? (
            <View style={styles.rewardBox}>
              <Text style={styles.rewardLabel}>
                خەڵات
              </Text>

              <Text style={styles.rewardValue}>
                {`+${reward.coin} Coin · +${reward.gem} Gem · ${
                  reward.points >= 0 ? "+" : ""
                }${reward.points} Points`}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              style={styles.secondaryButton}
              onPress={onPlayAgain}
            >
              <Text style={styles.secondaryButtonText}>
                دووبارە یاری بکە
              </Text>
            </Pressable>

            <Pressable
              style={styles.primaryButton}
              onPress={onClose}
            >
              <Text style={styles.primaryButtonText}>
                داخستن
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
    width: "82%",
    maxWidth: 500,
    minHeight: 180,

    borderRadius: 10,
    overflow: "hidden",

    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,

    backgroundColor: "rgba(0, 0, 0, 0.12)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",

    alignItems: "center",

    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },

    elevation: 20,
  },

  eyebrow: {
    color: "#facc15",
    fontSize: 12,
    fontFamily: "SpedaBold",
    letterSpacing: 0.6,
    marginBottom: 16,
    textAlign: "center",
  },

  finalScoreBox: {
    width: "94%",
    alignItems: "center",
    marginBottom: 16,
  },

  finalScoreTitle: {
    color: "rgba(248, 243, 223, 0.86)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    marginBottom: 8,
  },

  finalScorePill: {
    minWidth: 190,
    height: 40,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },

  teamAScore: {
    color: "#4480ef",
    fontSize: 21,
    fontFamily: "RobotoMedium",
  },

  teamBScore: {
    color: "#ef4444",
    fontSize: 21,
    fontFamily: "RobotoMedium",
  },

  scoreDivider: {
    color: "rgba(255,255,255,0.26)",
    fontSize: 22,
    fontFamily: "RobotoMedium",
  },

  rewardBox: {
    width: "94%",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 2,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
  },

  rewardLabel: {
    color: "#f8f3df",
    fontSize: 12,
    fontFamily: "SpedaBold",
    opacity: 0.82,
  },

  rewardValue: {
    marginTop: 5,
    color: "#facc15",
    fontSize: 15,
    fontFamily: "SpedaBold",
  },

  actions: {
    marginTop: 18,
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },

  secondaryButton: {
    flex: 1,
    height: 34,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  secondaryButtonText: {
    color: "#f8f3df",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  primaryButton: {
    flex: 1,
    height: 34,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#facc15",
  },

  primaryButtonText: {
    color: "#071f15",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
});