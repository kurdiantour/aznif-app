import { Pressable, StyleSheet, Text, View } from "react-native";

import type { OkeyRoundScoreDetail } from "@/okey/engine/okey-engine";
import type { OkeyTeamId } from "@/okey/types/okey";

type OkeyRoundScoreDetails = {
  scores: Record<OkeyTeamId, number>;
  details: OkeyRoundScoreDetail[];
};

type OkeyRoundResult = {
  round: number;
  scoreDetails: OkeyRoundScoreDetails;
  winnerId: string | null;
  winnerTeamId: OkeyTeamId | null;
  endReason: "win" | "tile-cycle-limit" | null;
};

type Props = {
  visible: boolean;
  onClose?: () => void;
  scoreDetails: OkeyRoundScoreDetails;
  finishedMessage?: string;
  round?: number;
  maxRounds?: number;
  roundResults?: OkeyRoundResult[];
  matchScores?: Record<OkeyTeamId, number>;
  matchFinished?: boolean;
  matchWinnerTeamId?: OkeyTeamId | null;
  countdownRemaining?: number | null;
  isTileCycleLimit?: boolean;
};

export function OkeyScoreDetailsPopup({
  visible,
  onClose,
  scoreDetails,
  finishedMessage,
  round,
  maxRounds = 7,
  roundResults = [],
  matchScores,
  matchFinished = false,
  matchWinnerTeamId = null,
  countdownRemaining = null,
  isTileCycleLimit = false,
}: Props) {
  if (!visible) return null;

  const title = isTileCycleLimit
    ? "براوە نییە"
    : finishedMessage ?? (matchFinished
      ? `یاری ${round ?? maxRounds}/${maxRounds}`
      : `خول ${round ?? 1}/${maxRounds}`);
  const resultsByRound = new Map(roundResults.map((result) => [result.round, result]));
  const totalScores = matchScores ?? roundResults.reduce(
    (totals, result) => ({
      teamA: totals.teamA + result.scoreDetails.scores.teamA,
      teamB: totals.teamB + result.scoreDetails.scores.teamB,
    }),
    { teamA: scoreDetails.scores.teamA, teamB: scoreDetails.scores.teamB },
  );

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none" accessibilityViewIsModal accessibilityRole="alert">
      <View style={styles.backdrop}>
        <Pressable accessible={!!onClose} accessibilityRole="button" accessibilityLabel="داخستنی وردەکاریی نمرەکان" accessibilityHint="دوو جار لێبدە بۆ داخستن." style={styles.backdropPressable} onPress={onClose} />
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" accessibilityLiveRegion="assertive" style={styles.title}>{title}</Text>

        {isTileCycleLimit ? (
          <View style={styles.noWinnerContent}>
            <Text style={styles.noWinnerMessage}>
              ئەم خولە بەبێ براوە کۆتایی هات. هەمان خول بە هەمان دابەشکەرەوە دەست پێ دەکاتەوە.
            </Text>
            <Text style={styles.noScoreMessage}>هیچ خاڵێک بۆ ئەم خولە تۆمار نەکرا.</Text>
          </View>
        ) : (
          <View style={styles.historyBox}>
            <View style={styles.headerRow}>
              <Text style={[styles.headerText, styles.roundCell]}>خ</Text>
              <Text style={[styles.headerText, styles.scoreCell]}>تیمی تۆ</Text>
              <Text style={[styles.headerText, styles.scoreCell]}>بەرامبەر</Text>
            </View>

            {Array.from({ length: maxRounds }).map((_, index) => {
              const roundNumber = index + 1;
              const result = resultsByRound.get(roundNumber);
              const winner = result?.scoreDetails.details.find((detail) => detail.reason === "winner");
              const yourValue = result
                ? winner?.teamId === "teamA"
                  ? winner.playerName
                  : String(result.scoreDetails.scores.teamA)
                : "-";
              const opponentValue = result
                ? winner?.teamId === "teamB"
                  ? winner.playerName
                  : String(result.scoreDetails.scores.teamB)
                : "-";

              return (
                <View key={roundNumber} style={styles.roundRow}>
                  <Text style={[styles.bodyText, styles.roundCell]}>{roundNumber}</Text>
                  <Text style={[styles.bodyText, styles.scoreCell]} numberOfLines={1}>
                    {yourValue}
                  </Text>
                  <Text style={[styles.bodyText, styles.scoreCell]} numberOfLines={1}>
                    {opponentValue}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.bottomDivider} />

        <View style={styles.totalsRow}>
          <Text style={[styles.totalLabel, styles.roundCell]} />
          <Text style={[styles.totalScore, styles.scoreCell]}>{totalScores.teamA}</Text>
          <Text style={[styles.totalScore, styles.scoreCell]}>{totalScores.teamB}</Text>
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.target}>
          {countdownRemaining !== null
            ? isTileCycleLimit
              ? `ئەم خولە دوای ${Math.max(0, countdownRemaining)} چرکە دەست پێ دەکاتەوە`
              : matchFinished
              ? `ئەنجامی کۆتایی دوای ${Math.max(0, countdownRemaining)} چرکە دەکرێتەوە`
              : `خولی داهاتوو دوای ${Math.max(0, countdownRemaining)} چرکە دەست پێ دەکات`
            : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },

  backdropPressable: {
    flex: 1,
  },

  card: {
    width: 380,
    maxWidth: "92%",
    height: 340,
    maxHeight: "90%",
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 16,
    backgroundColor: "rgba(223, 223, 223, 0.95)",
    zIndex: 1000,
    elevation: 1000,
  },

  title: {
    color: "#000000",
    fontSize: 13,
    fontFamily: "SpedaRegular",
    textAlign: "center",
    marginBottom: 12,
  },

  historyBox: {
    height: 208,
    direction: "ltr",
  },

  noWinnerContent: {
    height: 208,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  noWinnerMessage: {
    color: "#000000",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaRegular",
    textAlign: "center",
  },

  noScoreMessage: {
    marginTop: 14,
    color: "rgba(0,0,0,0.68)",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  headerRow: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 0, 0, 0.18)",
  },

  roundRow: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
  },

  headerText: {
    color: "#000000",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  bodyText: {
    color: "#000000",
    fontSize: 13,
    fontFamily: "SpedaRegular",
    textAlign: "center",
  },

  roundCell: {
    width: 36,
  },

  scoreCell: {
    flex: 1,
    paddingHorizontal: 4,
  },


  bottomDivider: {
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
    marginBottom: 12,
  },

  totalsRow: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    direction: "ltr",
  },

  totalLabel: {
    color: "rgba(0,0,0,0.62)",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  totalScore: {
    color: "#000000",
    fontSize: 18,
    fontFamily: "SpedaRegular",
    textAlign: "center",
  },

  target: {
    marginTop: 9,
    color: "#000000",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
});











