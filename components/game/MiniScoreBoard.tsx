import { Pressable, StyleSheet, Text, View } from "react-native";

type MiniScoreBoardProps = {
  teamAName: string;
  teamAScore: number;
  teamBName: string;
  teamBScore: number;
  onPress: () => void;
};

export default function MiniScoreBoard({
  teamAName,
  teamAScore,
  teamBName,
  teamBScore,
  onPress,
}: MiniScoreBoardProps) {
  return (
    <Pressable style={styles.container} onPress={onPress}>
      <View style={styles.scoreItem}>
        <Text numberOfLines={1} style={styles.label}>
          {teamAName}
        </Text>

        <Text style={styles.value}>{teamAScore}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.scoreItem}>
        <Text numberOfLines={1} style={styles.label}>
          {teamBName}
        </Text>

        <Text style={styles.value}>{teamBScore}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 142,
    maxWidth: 178,
    height: 42,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    zIndex: 80,
    borderWidth: 1,
    borderColor: "rgba(248, 243, 223, 0.22)",
  },

  scoreItem: {
    minWidth: 46,
    maxWidth: 78,
    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    color: "#f8f3df",
    fontSize: 9,
    fontFamily: "RobotoMedium",
    letterSpacing: 0,
    maxWidth: "100%",
  },

  value: {
    marginTop: 1,
    color: "#facc15",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },

  divider: {
    width: 1,
    height: 22,
    marginHorizontal: 10,
    backgroundColor: "rgba(250, 204, 21, 0.35)",
  },
});