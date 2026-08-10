import { Pressable, StyleSheet, Text, View } from "react-native";

import type { OkeyTeamId } from "@/okey/types/okey";

type MatchRewards = {
  currencyLabel: "Coin" | "MC";
  currencyDelta: number;
  gem: number;
  point: number;
};

type Props = {
  visible: boolean;
  winnerTeamId: OkeyTeamId | null;
  matchScores: Record<OkeyTeamId, number>;
  rewards?: MatchRewards | null;
  onNewMatch: () => void;
};


export function OkeyMatchResultPopup({
  visible,
  winnerTeamId,
  matchScores,
  rewards,
  onNewMatch,
}: Props) {
  if (!visible) return null;

  const humanTeamWon = winnerTeamId === "teamA";

  const winnerText = humanTeamWon
    ? "تیمی ئێوە براوە بوو"
    : "تیمی بەرامبەر براوە بوو";

  const formatDelta = (value: number) =>
    `${value > 0 ? "+" : ""}${value.toLocaleString()}`;

  const rewardValueStyle = (value: number) =>
    value > 0
      ? styles.rewardValueWin
      : value < 0
        ? styles.rewardValueLose
        : styles.rewardValueNeutral;

  const rewardChangeLabel = (value: number) =>
    value > 0
      ? "\u0628\u06d5\u062f\u06d5\u0633\u062a\u0647\u06ce\u0646\u0627"
      : value < 0
        ? "\u0644\u06d5\u062f\u06d5\u0633\u062a\u062f\u0627"
        : "\u0628\u06ce \u06af\u06c6\u0695\u0627\u0646\u06a9\u0627\u0631\u06cc";

  return (
    <View
      style={styles.overlayRoot}
      pointerEvents="box-none"
      accessibilityViewIsModal
      accessibilityRole="alert"
    >
      <View
        style={styles.backdrop}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={styles.titleStar}>✦</Text>

          <Text accessibilityRole="header" style={styles.title}>
            ئەنجامی یاری
          </Text>

          <Text style={styles.titleStar}>✦</Text>
        </View>

        <View
          style={[
            styles.winnerBadge,
            humanTeamWon
              ? styles.winnerBadgeWin
              : styles.winnerBadgeLose,
          ]}
        >
          <Text
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[
              styles.winnerText,
              humanTeamWon
                ? styles.winnerTextWin
                : styles.winnerTextLose,
            ]}
          >
            {winnerText}
          </Text>
        </View>

        <View style={styles.scoreRow}>
          <View style={styles.scoreSide}>
            <Text style={styles.scoreLabel}>تیمی ئێوە</Text>

            <Text style={styles.scoreValue}>
              {matchScores.teamA}
            </Text>
          </View>

          <View style={styles.scoreDivider} />

          <View style={styles.scoreSide}>
            <Text style={styles.scoreLabel}>
              تیمی بەرامبەر
            </Text>

            <Text style={styles.scoreValue}>
              {matchScores.teamB}
            </Text>
          </View>
        </View>

        {rewards ? (
          <View style={styles.rewardSection}>
            <View style={styles.rewardRow}>
              {[
                { label: "Gem", value: rewards.gem },
                { label: rewards.currencyLabel, value: rewards.currencyDelta },
                { label: "Point", value: rewards.point },
              ].map((reward) => (
                <View key={reward.label} style={styles.rewardCard}>
                  <Text style={styles.rewardLabel}>{reward.label}</Text>
                  <Text
                    style={[
                      styles.rewardValue,
                      rewardValueStyle(reward.value),
                    ]}
                  >
                    {formatDelta(reward.value)}
                  </Text>
                  <Text style={styles.rewardChangeLabel}>
                    {rewardChangeLabel(reward.value)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="یارییەکی نوێ"
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={onNewMatch}
        >
          <Text style={styles.buttonText}>
            دەرچوون
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1002,
    elevation: 1002,
    alignItems: "center",
    justifyContent: "center",
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
  },

  card: {
    width: 450,
    minHeight: 320,
    paddingTop: 18,
    paddingBottom: 18,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: "rgba(223, 223, 223, 0.95)",
    alignItems: "center",
    zIndex: 1003,
    elevation: 1003,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 6,
  },

  title: {
    color: "#178754",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    textShadowColor: "rgba(23, 135, 84, 0.20)",
    textShadowOffset: {
      width: 0,
      height: 1,
    },
    textShadowRadius: 3,
  },

  titleStar: {
    color: "#178754",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  winnerBadge: {
    minWidth: 210,
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  winnerBadgeWin: {
    backgroundColor: "rgba(15, 92, 59, 0.92)",
    borderColor: "#24C774",
  },

  winnerBadgeLose: {
    backgroundColor: "rgba(108, 31, 31, 0.92)",
    borderColor: "#EF5B5B",
  },

  winnerText: {
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  winnerTextWin: {
    color: "#D8FFEA",
  },

  winnerTextLose: {
    color: "#FFE1E1",
  },

  scoreRow: {
    width: "100%",
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.16)",
  },

  scoreSide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  scoreDivider: {
    width: 1,
    height: 38,
    backgroundColor: "rgba(0, 0, 0, 0.16)",
  },

  scoreLabel: {
    color: "rgba(0, 0, 0, 0.62)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  scoreValue: {
    marginTop: 3,
    color: "#000000",
    fontSize: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  rewardSection: {
    width: "100%",
    marginTop: 8,
  },

  rewardRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },

  rewardCard: {
    flex: 1,
    height: 66,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.16)",
    backgroundColor: "rgba(255, 255, 255, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },

  rewardLabel: {
    color: "rgba(0, 0, 0, 0.60)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  rewardValue: {
    marginTop: 5,
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  rewardValueWin: {
    color: "#159653",
  },

  rewardValueLose: {
    color: "#D64545",
  },

  rewardValueNeutral: {
    color: "#6B7280",
  },

  rewardChangeLabel: {
    marginTop: 2,
    color: "rgba(0, 0, 0, 0.48)",
    fontSize: 9,
    fontFamily: "SpedaRegular",
    textAlign: "center",
  },

  button: {
    minWidth: 150,
    height: 40,
    marginTop: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
  },

  buttonPressed: {
    opacity: 0.82,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "SpedaRegular",
  },
});