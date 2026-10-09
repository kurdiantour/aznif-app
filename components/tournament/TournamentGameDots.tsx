import { StyleSheet, View } from "react-native";

export type GameResult = "win" | "loss" | "not_played";

export default function TournamentGameDots({
  results,
  variant,
  compact = false,
}: {
  results: GameResult[];
  variant: "intro" | "active";
  compact?: boolean;
}) {
  const intro = variant === "intro";
  return (
    <View style={intro ? styles.introDots : styles.activeDots}>
      {results.map((result, index) => (
        <View
          key={index}
          style={[
            intro ? styles.introDot : compact ? styles.dotCompact : styles.dot,
            result === "win" && styles.dotWin,
            result === "loss" && styles.dotLoss,
            result === "not_played" &&
              (intro ? styles.introDotNotPlayed : styles.activeDotNotPlayed),
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  introDots: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: 9,
  },
  introDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  activeDots: {
    direction: "ltr",
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "center",
    alignItems: "center",
    width: 76,
    rowGap: 5,
    columnGap: 2,
    marginTop: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotCompact: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotWin: { backgroundColor: "#45d483" },
  dotLoss: { backgroundColor: "#ef5b68" },
  introDotNotPlayed: { backgroundColor: "rgba(255,255,255,0.25)" },
  activeDotNotPlayed: { backgroundColor: "rgba(255,255,255,0.22)" },
});
