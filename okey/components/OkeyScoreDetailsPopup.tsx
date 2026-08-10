import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  OkeyRoundScoreDetail,
} from "@/okey/engine/okey-engine";

import type {
  OkeyTeamId,
} from "@/okey/types/okey";

type OkeyRoundScoreDetails = {
  scores: Record<OkeyTeamId, number>;

  details: OkeyRoundScoreDetail[];
};

type OkeyRoundResult = {
  round: number;

  scoreDetails:
    OkeyRoundScoreDetails;

  winnerId: string | null;

  winnerTeamId:
    OkeyTeamId | null;

  endReason:
    | "win"
    | "tile-cycle-limit"
    | null;
};

type Props = {
  visible: boolean;

  onClose?: () => void;

  scoreDetails:
    OkeyRoundScoreDetails;

  finishedMessage?: string;

  round?: number;

  winnerName?: string | null;

  maxRounds?: number;

  roundResults?:
    OkeyRoundResult[];

  matchScores?:
    Record<OkeyTeamId, number>;

  matchFinished?: boolean;

  matchWinnerTeamId?:
    OkeyTeamId | null;

  countdownRemaining?:
    number | null;

  isTileCycleLimit?: boolean;
};

export function OkeyScoreDetailsPopup({
  visible,
  onClose,
  scoreDetails,
  finishedMessage,
  round,
  winnerName = null,
  maxRounds = 7,
  roundResults = [],
  matchScores,
  matchFinished = false,
  matchWinnerTeamId = null,
  countdownRemaining = null,
  isTileCycleLimit = false,
}: Props) {
  if (!visible) {
    return null;
  }

  const currentRound =
    round ?? 1;

  const title =
    isTileCycleLimit
      ? "براوە نییە"
      : finishedMessage ??
        (
          matchFinished
            ? `ئەنجامی یاری ${currentRound}/${maxRounds}`
            : `خولی ${currentRound}/${maxRounds}`
        );

  const resultsByRound =
    new Map(
      roundResults.map(
        (result) => [
          result.round,
          result,
        ],
      ),
    );

  const calculatedTotals =
    roundResults.reduce(
      (totals, result) => ({
        teamA:
          totals.teamA +
          result.scoreDetails
            .scores.teamA,

        teamB:
          totals.teamB +
          result.scoreDetails
            .scores.teamB,
      }),
      {
        teamA: 0,
        teamB: 0,
      },
    );

  const totalScores =
    matchScores ??
    (
      roundResults.length > 0
        ? calculatedTotals
        : scoreDetails.scores
    );

  const finalMessage =
    matchFinished
      ? matchWinnerTeamId ===
        "teamA"
        ? "تیمی تۆ براوەی یارییە"
        : matchWinnerTeamId ===
            "teamB"
          ? "تیمی بەرامبەر براوەی یارییە"
          : "یاری بە یەکسانی کۆتایی هات"
      : null;

  const countdownMessage =
    countdownRemaining === null
      ? ""
      : isTileCycleLimit
        ? `ئەم خولە دوای ${Math.max(
            0,
            countdownRemaining,
          )} چرکە دەست پێ دەکاتەوە`
        : matchFinished
          ? `ئەنجامی کۆتایی دوای ${Math.max(
              0,
              countdownRemaining,
            )} چرکە دەکرێتەوە`
          : `خولی داهاتوو دوای ${Math.max(
              0,
              countdownRemaining,
            )} چرکە دەست پێ دەکات`;

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlayRoot}
    >
      <Pressable
        disabled={!onClose}
        onPress={onClose}
        style={styles.backdrop}
      />

      <View
        accessibilityViewIsModal
        style={styles.card}
      >
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          style={styles.title}
        >
          {title}
        </Text>

        {finalMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.finalMessage}
          >
            {finalMessage}
          </Text>
        ) : null}

        {winnerName && !isTileCycleLimit ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.winnerMessage}
          >
            {`براوە: ${winnerName}`}
          </Text>
        ) : null}

        {isTileCycleLimit ? (
          <View
            style={styles.noWinnerContent}
          >
            <Text
              style={
                styles.noWinnerMessage
              }
            >
              ئەم خولە بەبێ براوە
              کۆتایی هات. هەمان خول
              بە هەمان دابەشکەرەوە
              دەست پێ دەکاتەوە.
            </Text>

            <Text
              style={
                styles.noScoreMessage
              }
            >
              هیچ خاڵێک بۆ ئەم خولە
              تۆمار نەکرا.
            </Text>
          </View>
        ) : (
          <View
            style={styles.historyBox}
          >
            <View
              style={styles.headerRow}
            >
              <Text
                style={[
                  styles.headerText,
                  styles.roundCell,
                ]}
              >
                خ
              </Text>

              <Text
                style={[
                  styles.headerText,
                  styles.scoreCell,
                ]}
              >
                تیمی تۆ
              </Text>

              <Text
                style={[
                  styles.headerText,
                  styles.scoreCell,
                ]}
              >
                بەرامبەر
              </Text>
            </View>

            {Array.from({
              length: maxRounds,
            }).map((_, index) => {
              const roundNumber =
                index + 1;

              const result =
                resultsByRound.get(
                  roundNumber,
                );

              const yourScore =
                result
                  ? String(
                      result
                        .scoreDetails
                        .scores.teamA,
                    )
                  : "-";

              const opponentScore =
                result
                  ? String(
                      result
                        .scoreDetails
                        .scores.teamB,
                    )
                  : "-";

              const yourTeamWon =
                result
                  ?.winnerTeamId ===
                "teamA";

              const opponentTeamWon =
                result
                  ?.winnerTeamId ===
                "teamB";

              return (
                <View
                  key={roundNumber}
                  style={[
                    styles.roundRow,

                    result?.round ===
                    currentRound
                      ? styles.currentRoundRow
                      : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.bodyText,
                      styles.roundCell,
                    ]}
                  >
                    {roundNumber}
                  </Text>

                  <View
                    style={
                      styles.scoreCell
                    }
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.bodyText,

                        yourTeamWon
                          ? styles.winnerScore
                          : null,
                      ]}
                    >
                      {yourScore}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.scoreCell
                    }
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.bodyText,

                        opponentTeamWon
                          ? styles.winnerScore
                          : null,
                      ]}
                    >
                      {opponentScore}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View
          style={styles.bottomDivider}
        />

        <View
          style={styles.totalsRow}
        >
          <Text
            style={[
              styles.totalLabel,
              styles.roundCell,
            ]}
          >
            کۆ
          </Text>

          <Text
            style={[
              styles.totalScore,
              styles.scoreCell,
            ]}
          >
            {totalScores.teamA}
          </Text>

          <Text
            style={[
              styles.totalScore,
              styles.scoreCell,
            ]}
          >
            {totalScores.teamB}
          </Text>
        </View>

        <Text
          accessibilityLiveRegion="polite"
          style={styles.target}
        >
          {countdownMessage}
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

    backgroundColor:
      "rgba(0,0,0,0.65)",
  },

  card: {
    width: 380,
    maxWidth: "92%",

    minHeight: 340,
    maxHeight: "90%",

    borderRadius: 14,

    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,

    backgroundColor:
      "rgba(235,235,235,0.97)",

    zIndex: 1000,
    elevation: 1000,
  },

  title: {
    color: "#000000",

    fontSize: 14,
    fontFamily: "SpedaBold",

    textAlign: "center",

    marginBottom: 8,
  },

  finalMessage: {
    color: "#151515",

    fontSize: 12,
    lineHeight: 18,

    fontFamily: "SpedaBold",

    textAlign: "center",

    marginBottom: 8,
  },

  winnerMessage: {
    color: "#151515",

    fontSize: 12,
    lineHeight: 18,

    fontFamily: "SpedaBold",

    textAlign: "center",

    marginBottom: 8,
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
    lineHeight: 19,

    fontFamily:
      "SpedaRegular",

    textAlign: "center",
  },

  noScoreMessage: {
    marginTop: 14,

    color:
      "rgba(0,0,0,0.68)",

    fontSize: 12,

    fontFamily: "SpedaBold",

    textAlign: "center",
  },

  headerRow: {
    height: 26,

    flexDirection: "row",
    alignItems: "center",

    borderBottomWidth: 1,

    borderBottomColor:
      "rgba(0,0,0,0.18)",
  },

  roundRow: {
    height: 26,

    flexDirection: "row",
    alignItems: "center",
  },

  currentRoundRow: {
    backgroundColor:
      "rgba(255,255,255,0.42)",

    borderRadius: 6,
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

    fontFamily:
      "SpedaRegular",

    textAlign: "center",
  },

  winnerScore: {
    fontFamily: "SpedaBold",

    textDecorationLine:
      "underline",
  },

  roundCell: {
    width: 36,
  },

  scoreCell: {
    flex: 1,

    paddingHorizontal: 4,

    alignItems: "center",
    justifyContent: "center",
  },

  bottomDivider: {
    height: 1,

    backgroundColor:
      "rgba(0,0,0,0.18)",

    marginBottom: 10,
  },

  totalsRow: {
    height: 28,

    flexDirection: "row",
    alignItems: "center",

    direction: "ltr",
  },

  totalLabel: {
    color:
      "rgba(0,0,0,0.62)",

    fontSize: 11,

    fontFamily: "SpedaBold",

    textAlign: "center",
  },

  totalScore: {
    color: "#000000",

    fontSize: 18,

    fontFamily: "SpedaBold",

    textAlign: "center",
  },

  target: {
    minHeight: 18,

    marginTop: 7,

    color: "#000000",

    fontSize: 12,

    fontFamily: "SpedaBold",

    textAlign: "center",
  },
});