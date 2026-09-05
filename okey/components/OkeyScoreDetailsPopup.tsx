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


  round?: number;

  playerNamesById: Readonly<Record<string, string>>;

  maxRounds?: number;

  roundResults?:
    OkeyRoundResult[];

  matchScores?:
    Record<OkeyTeamId, number>;

  isTileCycleLimit?: boolean;
  waitingForNextRound?: boolean;
};

function formatRoundScore(score: number) {
  return score >= 0 ? `+${score}` : String(score);
}

export function OkeyScoreDetailsPopup({
  visible,
  onClose,
  scoreDetails,
  round,
  playerNamesById,
  maxRounds = 7,
  roundResults = [],
  matchScores,
  isTileCycleLimit = false,
  waitingForNextRound = false,
}: Props) {
  if (!visible) {
    return null;
  }

  const currentRound =
    round ?? 1;

  const title = "خشتەی خولەکان";


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
<View style={styles.titleBadge}>
  <Text
    accessibilityRole="header"
    accessibilityLiveRegion="assertive"
    style={styles.title}
  >
    {title}
  </Text>
</View>

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


              const yourTeamWon =
                result
                  ?.winnerTeamId ===
                "teamA";

              const opponentTeamWon =
                result
                  ?.winnerTeamId ===
                "teamB";

              const winnerName =
                result?.winnerId
                  ? playerNamesById[result.winnerId]
                  : undefined;

              const yourValue =
                yourTeamWon
                  ? winnerName ?? "-"
                  : opponentTeamWon
                    ? formatRoundScore(result.scoreDetails.scores.teamA)
                    : "-";

              const opponentValue =
                opponentTeamWon
                  ? winnerName ?? "-"
                  : yourTeamWon
                    ? formatRoundScore(result.scoreDetails.scores.teamB)
                    : "-";

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
                      {yourValue}
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
                      {opponentValue}
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

{waitingForNextRound ? (
  <Text
    accessibilityLiveRegion="polite"
    style={styles.target}
  >
    چاوەڕێی دەستی داهاتوو...
  </Text>
) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({

  
  overlayRoot: {
    ...StyleSheet.absoluteFill,

    zIndex: 999,
    elevation: 999,

    alignItems: "center",
    justifyContent: "center",
  },

  backdrop: {
    ...StyleSheet.absoluteFill,

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

titleBadge: {
  alignSelf: "center",

  minWidth: 96,

  paddingHorizontal: 100,
  paddingVertical: 7,
  marginBottom: 10,
  borderRadius: 999,
  backgroundColor: "rgba(0,0,0,0.08)",
  borderColor: "rgba(0,0,0,0.10)",

  alignItems: "center",
  justifyContent: "center",
},

title: {
  color: "#000000",

  fontSize: 14,
  lineHeight: 18,

  fontFamily: "SpedaBold",

  textAlign: "center",
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
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  bodyText: {
    color: "#000000",
    fontSize: 15,
    textAlign: "center",
  },

winnerScore: {
  fontSize: 15,
  lineHeight: 20,
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

    fontSize: 15,

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
