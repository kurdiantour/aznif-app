import type { Player, RoundResult } from "@/types/game";
import { StyleSheet, Text, View } from "react-native";
import DominoTile from "./DominoTile";

type Props = {
  visible: boolean;
  roundResult: RoundResult | null | undefined;
  players: Player[];
  topPlayer?: Player;
  leftPlayer?: Player;
  rightPlayer?: Player;
  humanPlayer?: Player;
};

export default function RoundResultReveal({
  visible,
  roundResult,
  players,
  topPlayer,
  leftPlayer,
  rightPlayer,
}: Props) {
  if (!visible || !roundResult) return null;

  const winner = players.find((player) => player.id === roundResult.winnerId);

  const tilesFor = (player: Player) =>
    roundResult.remainingTilesByPlayer?.[player.id] ?? [];

  return (
    <View style={styles.resultOverlay} pointerEvents="none">
      <View style={styles.resultCenter}>
        <Text style={styles.resultWinnerText}>
          {winner ? `${winner.name} بردیەوە` : "کۆتایی هاتنی دەور"}
        </Text>

        <Text style={styles.resultPointsText}>
          +{roundResult.awardedPoints ?? 0}
        </Text>
      </View>

      {topPlayer && (
        <View style={styles.revealTilesTop}>
          <View style={styles.revealTilesRow}>
            {tilesFor(topPlayer).map((tile) => (
              <DominoTile key={tile.id} tile={tile} width={28} height={54} />
            ))}
          </View>
        </View>
      )}

      {leftPlayer && (
        <View style={styles.revealTilesLeft}>
          <View style={styles.revealTilesColumn}>
            {tilesFor(leftPlayer).map((tile) => (
              <DominoTile
                key={tile.id}
                tile={tile}
                width={24}
                height={46}
                rotation={90}
              />
            ))}
          </View>
        </View>
      )}

      {rightPlayer && (
        <View style={styles.revealTilesRight}>
          <View style={styles.revealTilesColumn}>
            {tilesFor(rightPlayer).map((tile) => (
              <DominoTile
                key={tile.id}
                tile={tile}
                width={24}
                height={46}
                rotation={270}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  resultOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 200,
  },

  resultCenter: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    zIndex: 230,
  },

  resultWinnerText: {
    color: "#f8f3df",
    fontSize: 16,
    fontFamily: "SpedaBold",
  },

  resultPointsText: {
    color: "#facc15",
    fontSize: 30,
    fontFamily: "SpedaBold",
    marginTop: 4,
  },

  revealTilesTop: {
    position: "absolute",
    top: 82,
    alignSelf: "center",
    alignItems: "center",
    zIndex: 210,
  },

  revealTilesLeft: {
    position: "absolute",
    left: 74,
    top: "50%",
    transform: [{ translateY: -10 }],
    alignItems: "center",
    zIndex: 210,
  },

  revealTilesRight: {
    position: "absolute",
    right: 74,
    top: "50%",
    transform: [{ translateY: -10 }],
    alignItems: "center",
    zIndex: 210,
  },

  revealTilesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  revealTilesColumn: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
});
