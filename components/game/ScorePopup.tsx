import type { MatchReward } from "@/types/game";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
  teamAScore: number;
  teamBScore: number;
  winnerTeamId?: "teamA" | "teamB" | null;
  matchReward?: MatchReward | null;
  teamAName?: string;
  teamBName?: string;
};

const TARGET_SCORE = 350;

const ROAD_COUNT = 4;
const ROAD_VALUE = 100;
const X_VALUE = 20;
const O_VALUE = 5;
const MAX_X_PER_ROAD = 4;
const MAX_O_PER_ROAD = 4;

function clampScore(score: number) {
  return Math.max(0, Math.floor(score / 5) * 5);
}

function buildRoads(score: number) {
  const safeScore = clampScore(score);

  return Array.from({ length: ROAD_COUNT }).map((_, roadIndex) => {
    const roadStart = roadIndex * ROAD_VALUE;
    const roadScore = Math.max(0, Math.min(ROAD_VALUE, safeScore - roadStart));

    const xCount = Math.min(MAX_X_PER_ROAD, Math.floor(roadScore / X_VALUE));
    const remainingAfterX = roadScore - xCount * X_VALUE;
    const oCount = Math.min(
      MAX_O_PER_ROAD,
      Math.floor(remainingAfterX / O_VALUE),
    );

    return {
      xCount,
      oCount,
    };
  });
}

function RoadMarks({ xCount, oCount }: { xCount: number; oCount: number }) {
  return (
    <View style={styles.road}>
      <View style={styles.markLine}>
        {Array.from({ length: MAX_X_PER_ROAD }).map((_, index) => (
          <Text
            key={`x-${index}`}
            style={[styles.xMark, index >= xCount && styles.hiddenMark]}
          >
            X
          </Text>
        ))}
      </View>

      <View style={styles.markLine}>
        {Array.from({ length: MAX_O_PER_ROAD }).map((_, index) => (
          <Text
            key={`o-${index}`}
            style={[styles.oMark, index >= oCount && styles.hiddenMark]}
          >
            O
          </Text>
        ))}
      </View>
    </View>
  );
}

function ScoreRoads({ score }: { score: number }) {
  const roads = buildRoads(score);

  return (
    <View style={styles.roadsBox}>
      {roads.map((road, index) => (
        <RoadMarks
          key={`road-${index}`}
          xCount={road.xCount}
          oCount={road.oCount}
        />
      ))}
    </View>
  );
}

export default function ScorePopup({
  visible,
  onClose,
  teamAScore,
  teamBScore,
  winnerTeamId,
  matchReward,
  teamAName,
  teamBName,
}: Props) {
  const teamA = teamAName ?? "Team A";
  const teamB = teamBName ?? "Team B";

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPressable} onPress={onClose} />
      </View>

      <View style={styles.card}>
        <View style={styles.scoreBoard}>
          <View style={styles.teamSide}>
            <Text style={styles.teamName} numberOfLines={1}>
              {teamA}
            </Text>

            <ScoreRoads score={teamAScore} />

            <Text style={styles.numericScore}>{clampScore(teamAScore)}</Text>
          </View>

          <View style={styles.verticalDivider} />

          <View style={styles.teamSide}>
            <Text style={styles.teamName} numberOfLines={1}>
              {teamB}
            </Text>

            <ScoreRoads score={teamBScore} />

            <Text style={styles.numericScore}>{clampScore(teamBScore)}</Text>
          </View>
        </View>

        {winnerTeamId ? (
          <>
            <Text style={styles.winnerText}>
              {winnerTeamId === "teamA" ? teamA : teamB} wins
            </Text>

            {matchReward ? (
              <View style={styles.rewardRow}>
                <Text style={styles.rewardTitle}>
                  Free match reward
                </Text>

                <Text style={styles.rewardDetail}>
                  +{matchReward.coin} Coin · +{matchReward.gem} Gem · +{matchReward.points} Points
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.bottomDivider} />

        <Text style={styles.target}>ئامانج: {TARGET_SCORE} خاڵ</Text>
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
    width: 290,
    height: 270,
    borderRadius: 10,
    paddingHorizontal: 30,
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: "rgba(223, 223, 223, 0.95)",
    zIndex: 1000,
    elevation: 1000,
  },

  scoreBoard: {
    flexDirection: "row",
    height: 210,
  },

  teamSide: {
    flex: 1,
    alignItems: "center",
  },

  teamName: {
    width: "100%",
    color: "#000000",
    fontSize: 13,
    fontFamily: "SpedaBold",
    marginBottom: 8,
    textAlign: "center",
  },

  verticalDivider: {
    width: 1.5,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    marginHorizontal: 10,
    marginTop: 24,
  },

  roadsBox: {
    width: "100%",
    height: 128,
    alignItems: "center",
    justifyContent: "space-between",
  },

  road: {
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  markLine: {
    height: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  xMark: {
    width: 15,
    color: "#000000",
    fontSize: 16,
    fontFamily: "RobotoMedium",
    lineHeight: 14,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.35)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },

  oMark: {
    width: 15,
    color: "#000000",
    fontSize: 14,
    fontFamily: "RobotoMedium",
    lineHeight: 14,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },

  hiddenMark: {
    opacity: 0,
  },

  numericScore: {
    marginTop: 30,
    color: "#000000",
    fontSize: 16,
    fontFamily: "RobotoMedium",
  },

  winnerText: {
    color: "#000000",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginTop: 8,
  },

  rewardRow: {
    marginTop: 10,
    alignItems: "center",
  },

  rewardTitle: {
    color: "#000000",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },

  rewardDetail: {
    marginTop: 4,
    color: "#000000",
    fontSize: 12,
    fontFamily: "RobotoMedium",
  },

  bottomDivider: {
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
    marginBottom: 9,
  },

  target: {
    color: "#000000",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
});
