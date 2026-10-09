import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import TournamentGameDots, { type GameResult } from "./TournamentGameDots";

type Props = {
  isTablet: boolean;
  onJoin: () => void;
};

const MOCK_HAS_JOINED = true;

const MOCK_GAME_RESULTS: GameResult[] = [
  "win",
  "win",
  "loss",
  "not_played",
  "not_played",
  "not_played",
  "not_played",
  "not_played",
];

const MOCK_GAMES_PLAYED = 3;
const MOCK_WINS = 2;
const MOCK_LOSSES = 1;

export default function TournamentIntro({
  isTablet,
  onJoin,
}: Props) {
  return (
    <View style={styles.introContainer}>
      <Image
        source={require("@/assets/tournament/tournament-hero.png")}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition="center"
        accessible={false}
      />

      <View
        style={[
          styles.contentFrame,
          isTablet && styles.contentFrameTablet,
        ]}
      >
        <View style={styles.details}>
          <Text style={styles.smallTitle}>
            پاڵەوانێتی ئەزنیف
          </Text>

          <Text
            style={[
              styles.title,
              isTablet && styles.titleTablet,
            ]}
          >
            پاڵەوانێتی دەستپێک
          </Text>

          <Text style={styles.description}>
            بەشداری پاڵەوانێتی بکە، یارییەکانت بکە و لە ڕیزبەندی بەرەو
            سەرەوە بچۆ.{" "}
            <Text style={styles.englishNumber}>10</Text>{" "}
            یاریزانی یەکەم خەڵاتی ئەزنیف وەردەگرن.
          </Text>

          {MOCK_HAS_JOINED && (
            <View style={styles.progressSection}>
              <TournamentGameDots results={MOCK_GAME_RESULTS} variant="intro" />

              <View style={styles.progressSummary}>
                <Text style={styles.progressText}>
                  <Text style={styles.englishNumber}>
                    {MOCK_GAMES_PLAYED}/8
                  </Text>{" "}
                  یاری
                </Text>

                <View style={styles.summaryDot} />

                <Text style={styles.progressText}>
                  <Text style={styles.englishNumber}>{MOCK_WINS}</Text>{" "}
                  بردنەوە
                </Text>

                <View style={styles.summaryDot} />

                <Text style={styles.progressText}>
                  <Text style={styles.englishNumber}>{MOCK_LOSSES}</Text>{" "}
                  دۆڕان
                </Text>
              </View>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={onJoin}
            style={({ pressed }) => [
              styles.joinButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={MOCK_HAS_JOINED ? "game-controller" : "trophy"}
              size={20}
              color="#241600"
            />

            <Text style={styles.joinText}>
              {MOCK_HAS_JOINED
                ? "یاری بکە"
                : "بەشداری پاڵەوانێتی بکە"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.72,
  },

  introContainer: {
    flex: 1,
    justifyContent: "center",
  },

  contentFrame: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 26,
    width: "52%",
    minWidth: 230,
    maxWidth: 510,
    justifyContent: "center",
    paddingTop: 64,
  },

  contentFrameTablet: {
    right: 34,
  },

  details: {
    width: "100%",
    alignItems: "flex-start",
  },

  smallTitle: {
    width: "100%",
    color: "#f5f3f7",
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "left",
    writingDirection: "rtl",
  },

  title: {
    width: "100%",
    color: "#fff",
    fontSize: 34,
    fontFamily: "SpedaBold",
    textAlign: "left",
    writingDirection: "rtl",
    marginTop: 5,
  },

  titleTablet: {
    fontSize: 42,
  },

  description: {
    width: "100%",
    color: "#d4c9df",
    fontSize: 16,
    lineHeight: 21,
    fontFamily: "SpedaRegular",
    textAlign: "left",
    writingDirection: "rtl",
    marginTop: 11,
  },

  englishNumber: {
    fontFamily: "RobotoMedium",
  },

  progressSection: {
    marginTop: 18,
    alignItems: "flex-start",
  },

  progressSummary: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  progressText: {
    color: "#e6ddeb",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    writingDirection: "rtl",
  },

  summaryDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.42)",
  },

  joinButton: {
    width: 230,
    height: 48,
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#f0ba35",
    borderWidth: 1,
    borderColor: "#ffda6b",
  },

  joinText: {
    color: "#241600",
    fontSize: 13,
    fontFamily: "SpedaBold",
    fontWeight: "900",
    writingDirection: "rtl",
  },
});
