import type { Player, RoundResult } from "@/types/game";
import { StyleSheet, Text, View } from "react-native";

type RoundResultPresentationProps = {
  roundResult: RoundResult;
  players: Player[];
};

export default function RoundResultPresentation({
  roundResult,
  players,
}: RoundResultPresentationProps) {
  const winner = players.find((player) => player.id === roundResult.winnerId);

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.winnerText}>
        {winner ? `${winner.name} won the round` : "Round complete"}
      </Text>
      <Text style={styles.pointsText}>+{roundResult.awardedPoints}</Text>

      <View style={styles.playerResults}>
        {players.map((player) => (
          <View key={player.id} style={styles.playerRow}>
            <Text style={styles.playerName}>{player.name}</Text>
            <Text style={styles.pipsText}>
              {roundResult.remainingPipsByPlayer[player.id] ?? 0} pips
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderRadius: 20,
    padding: 20,
    backgroundColor: "rgba(9,11,29,0.92)",
  },
  winnerText: {
    color: "#ffffff",
    fontSize: 22,
    fontFamily: "SpedaBold",
  },
  pointsText: {
    marginTop: 6,
    color: "#facc15",
    fontSize: 30,
    fontFamily: "SpedaBold",
  },
  playerResults: {
    alignSelf: "stretch",
    marginTop: 16,
    gap: 8,
  },
  playerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  playerName: {
    color: "#e5e7eb",
    fontSize: 14,
    fontFamily: "SpedaBold",
  },
  pipsText: {
    color: "#c4b5fd",
    fontSize: 14,
    fontFamily: "SpedaBold",
  },
});
