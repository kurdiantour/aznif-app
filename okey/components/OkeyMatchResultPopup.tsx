import { Pressable, StyleSheet, Text, View } from "react-native";

import type { OkeyTeamId } from "@/okey/types/okey";

type Props = {
  visible: boolean;
  winnerTeamId: OkeyTeamId | null;
  matchScores: Record<OkeyTeamId, number>;
  onNewMatch: () => void;
};

export function OkeyMatchResultPopup({ visible, winnerTeamId, matchScores, onNewMatch }: Props) {
  if (!visible) return null;

  const winnerText = winnerTeamId === "teamA" ? "تیمی تۆ" : winnerTeamId === "teamB" ? "تیمی بەرامبەر" : "یەکسان";

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none" accessibilityViewIsModal accessibilityRole="alert">
      <View style={styles.backdrop} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>ئەنجامی یاری</Text>
        <Text style={styles.winnerLabel}>براوە</Text>
        <Text accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.winnerText}>{winnerText}</Text>

        <View style={styles.scoreRow}>
          <View style={styles.scoreSide}>
            <Text style={styles.scoreLabel}>تیمی تۆ</Text>
            <Text style={styles.scoreValue}>{matchScores.teamA}</Text>
          </View>
          <View style={styles.scoreSide}>
            <Text style={styles.scoreLabel}>بەرامبەر</Text>
            <Text style={styles.scoreValue}>{matchScores.teamB}</Text>
          </View>
        </View>

        <View style={styles.rewardSlot}>
          <Text style={styles.rewardTitle}>پێشبینینی خەڵات</Text>
          <Text style={styles.rewardText}>خەڵاتی دراو، گەوهەر و جام تا پشتڕاستکردنەوەی ڕاژەکار ناچالاکە.</Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="یارییەکی نوێ" accessibilityHint="دوو جار لێبدە بۆ دەستپێکردنی یارییەکی نوێ." style={styles.button} onPress={onNewMatch}>
          <Text style={styles.buttonText}>یارییەکی نوێ</Text>
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
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  card: {
    width: 290,
    minHeight: 250,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: "rgba(223, 223, 223, 0.95)",
    alignItems: "center",
    zIndex: 1003,
    elevation: 1003,
  },
  title: { color: "#000000", fontSize: 12, fontFamily: "SpedaRegular", textAlign: "center", marginBottom: 14 },
  winnerLabel: { color: "rgba(0,0,0,0.62)", fontSize: 10, fontFamily: "SpedaBold", textAlign: "center" },
  winnerText: { marginTop: 3, color: "#000000", fontSize: 20, fontFamily: "SpedaBold", textAlign: "center" },
  scoreRow: { width: "100%", flexDirection: "row", marginTop: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.18)" },
  scoreSide: { flex: 1, alignItems: "center" },
  scoreLabel: { color: "rgba(0,0,0,0.62)", fontSize: 9, fontFamily: "SpedaBold" },
  scoreValue: { marginTop: 3, color: "#000000", fontSize: 16, fontFamily: "SpedaRegular" },
  rewardSlot: { width: "100%", minHeight: 46, marginTop: 14, borderRadius: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.16)", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  rewardTitle: { color: "#000000", fontSize: 10, fontFamily: "SpedaBold" },
  rewardText: { marginTop: 3, color: "rgba(0,0,0,0.58)", fontSize: 9, fontFamily: "SpedaRegular", textAlign: "center" },
  button: { minWidth: 118, height: 30, borderRadius: 6, marginTop: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#111827" },
  buttonText: { color: "#ffffff", fontSize: 10, fontFamily: "SpedaRegular" },
});
