import { BlurView } from "expo-blur";
import { MatchReward } from "@/types/game";
import { Pressable, StyleSheet, Text, View } from "react-native";

type GameOverPopupProps = {
  visible: boolean;
  didWin: boolean;
  reward?: MatchReward | null;
  teamScores?: {
    teamA: number;
    teamB: number;
  };
  onClose: () => void;
  onPlayAgain: () => void;
};

export default function GameOverPopup({
  visible,
  didWin,
  reward,
  teamScores,
  onClose,
  onPlayAgain,
}: GameOverPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop}>
        <BlurView intensity={45} tint="dark" style={styles.card}>
          <Text style={styles.eyebrow}>
            {didWin
              ? "یارییەکە تەواو بوو • تۆ براوە بویت!"
              : "یارییەکە تەواو بوو • تۆ دۆڕایت"}
          </Text>

          {teamScores && (
            <View style={styles.finalScoreBox}>
              <Text style={styles.finalScoreTitle}>ئەنجامی کۆتایی</Text>

              <View style={styles.finalScorePill}>
                <Text style={styles.teamAScore}>{teamScores.teamA}</Text>
                <Text style={styles.scoreDivider}>|</Text>
                <Text style={styles.teamBScore}>{teamScores.teamB}</Text>
              </View>
            </View>
          )}

          {reward && didWin && (
            <View style={styles.rewardBox}>
              <Text style={styles.rewardLabel}>خەڵات</Text>

              <Text style={styles.rewardValue}>
                {reward.gold > 0
                  ? `+${reward.gold} گەوهەر · +${reward.points} Point`
                  : `+${reward.points} Point`}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onPlayAgain}>
              <Text style={styles.secondaryButtonText}>دووبارە یاری بکە</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={onClose}>
              <Text style={styles.primaryButtonText}>داخستن</Text>
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
    backgroundColor: "rgba(58, 25, 92, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
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
    fontSize: 11,
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