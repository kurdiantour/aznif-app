import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import TournamentGameDots, { type GameResult } from "./TournamentGameDots";

type Player = {
  rank: number;
  name: string;
  points: number;
  reward: string;
  results: GameResult[];
};

type Props = {
  isTablet: boolean;
};

function getGameStats(results: GameResult[]) {
  return {
    played: results.filter((result) => result !== "not_played").length,
    wins: results.filter((result) => result === "win").length,
    losses: results.filter((result) => result === "loss").length,
  };
}

const PLAYERS: Player[] = [
  {
    rank: 1,
    name: "AZAD",
    points: 117,
    reward: "30,000",
    results: [
      "win",
      "win",
      "loss",
      "win",
      "win",
      "loss",
      "win",
      "win",
    ],
  },
  {
    rank: 2,
    name: "KURDO",
    points: 117,
    reward: "20,000",
    results: [
      "win",
      "loss",
      "win",
      "win",
      "loss",
      "win",
      "win",
      "win",
    ],
  },
  {
    rank: 3,
    name: "DANUSH",
    points: 106,
    reward: "15,000",
    results: [
      "win",
      "win",
      "loss",
      "win",
      "loss",
      "win",
      "not_played",
      "not_played",
    ],
  },
  {
    rank: 4,
    name: "SHAKIR",
    points: 98,
    reward: "10,000",
    results: [
      "win",
      "loss",
      "win",
      "win",
      "loss",
      "not_played",
      "not_played",
      "not_played",
    ],
  },
  {
    rank: 5,
    name: "ARYAN",
    points: 91,
    reward: "7,000",
    results: [
      "loss",
      "win",
      "win",
      "loss",
      "win",
      "not_played",
      "not_played",
      "not_played",
    ],
  },
  { rank: 6, name: "BARAN", points: 86, reward: "5,000", results: ["win", "loss", "win", "win", "loss", "not_played", "not_played", "not_played"] },
  { rank: 7, name: "DILAN", points: 82, reward: "4,000", results: ["win", "win", "loss", "loss", "win", "not_played", "not_played", "not_played"] },
  { rank: 8, name: "SIRWAN", points: 78, reward: "3,000", results: ["loss", "win", "win", "loss", "win", "not_played", "not_played", "not_played"] },
  { rank: 9, name: "HEMIN", points: 74, reward: "2,000", results: ["win", "loss", "loss", "win", "win", "not_played", "not_played", "not_played"] },
];

const MY_PLAYER: Player = {
  rank: 18,
  name: "YOU",
  points: 64,
  reward: "—",
  results: [
    "win",
    "loss",
    "win",
    "win",
    "not_played",
    "not_played",
    "not_played",
    "not_played",
  ],
};

export default function TournamentActive({
  isTablet,
}: Props) {
  const handlePlay = () => {
    // فعلاً فقط UI
    // بعداً مسیر ورود به بازی اینجا وصل می‌شود.
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.mainContent,
          isTablet && styles.mainContentTablet,
        ]}
      >
        <View style={styles.sponsorColumn}>
          <View style={styles.sponsorImageWrap}>
            <Image
              source={require("@/assets/tournament/tournament-hero.png")}
              style={styles.sponsorImage}
              contentFit="cover"
              contentPosition="center"
            />

            <View style={styles.sponsorShade} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play"
              onPress={handlePlay}
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.playIconCircle}>
                <Ionicons
                  name="play"
                  size={15}
                  color="#ffd45c"
                />
              </View>

              <Text style={styles.playButtonText}>
                یاری بکە
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.rankingColumn}>
          <View style={styles.topThree}>
            <TopPlayer player={PLAYERS[2]} />

            <TopPlayer
              player={PLAYERS[0]}
              featured
            />

            <TopPlayer player={PLAYERS[1]} />
          </View>

          <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent} showsVerticalScrollIndicator={false}>
            {PLAYERS.slice(3).map((player) => (
              <PlayerRow
                key={player.rank}
                player={player}
              />
            ))}
          </ScrollView>

          <View style={styles.myRankSection}>
            <PlayerRow
              player={MY_PLAYER}
              highlighted
            />
          </View>
        </View>
      </View>
    </View>
  );
}

function TopPlayer({
  player,
  featured = false,
}: {
  player: Player;
  featured?: boolean;
}) {
  const { played, wins, losses } = getGameStats(player.results);

  return (
    <View
      style={[
        styles.topPlayer,
        featured && styles.topPlayerFeatured,
      ]}
    >
      <View
        style={[
          styles.rankBadge,
          featured && styles.rankBadgeFirst,
        ]}
      >
        <Text
          style={[
            styles.rankBadgeText,
            featured && styles.rankBadgeTextFirst,
          ]}
        >
          {player.rank}
        </Text>
      </View>

      <View
        style={[
          styles.avatar,
          featured && styles.avatarFeatured,
        ]}
      >
        <Ionicons
          name="person"
          size={featured ? 17 : 15}
          color="#fff"
        />
      </View>

      <Text style={styles.playerName}>
        {player.name}
      </Text>

      <TournamentGameDots
        results={player.results}
        variant="active"
        compact
      />

<View style={styles.statsRow}>
  <View style={styles.statItem}>
    <Text style={styles.statValue}>{played}</Text>
    <Text style={styles.statLabel}>یاری</Text>
  </View>

  <View style={styles.statDivider} />

  <View style={styles.statItem}>
    <Text style={styles.statValue}>{wins}</Text>
    <Text style={styles.statLabel}>بردنەوە</Text>
  </View>

  <View style={styles.statDivider} />

  <View style={styles.statItem}>
    <Text style={styles.statValue}>{losses}</Text>
    <Text style={styles.statLabel}>دۆڕان</Text>
  </View>
</View>

<View style={styles.topBottomRow}>
  <Text style={styles.rewardText}>
    {player.reward} Aznif
  </Text>

  <Text style={styles.pointsText}>
    <Text style={styles.number}>
      {player.points}
    </Text>{" "}
    خاڵ
  </Text>
</View>
    </View>
  );
}

function PlayerRow({
  player,
  highlighted = false,
}: {
  player: Player;
  highlighted?: boolean;
}) {
  const { played, wins, losses } = getGameStats(player.results);

  return (
    <View
      style={[
        styles.playerRow,
        highlighted && styles.playerRowHighlighted,
      ]}
    >
      <View style={styles.rowRank}>
        <Text style={styles.rowRankText}>
          #{player.rank}
        </Text>
      </View>

      <View style={styles.rowAvatar}>
        <Ionicons
          name="person"
          size={14}
          color="#fff"
        />
      </View>

      <View style={styles.rowIdentity}>
        <Text style={styles.rowName} numberOfLines={1}>
          {player.name}
        </Text>
      </View>

      <View style={styles.rowProgress}>
        <TournamentGameDots results={player.results} variant="active" />
      </View>

      <Text style={styles.rowStats} numberOfLines={1}>
        <Text style={styles.number}>{played}</Text>{" "}یاری |{" "}
        <Text style={styles.number}>{wins}</Text>{" "}بردنەوە |{" "}
        <Text style={styles.number}>{losses}</Text>{" "}دۆڕان
      </Text>

      <View style={styles.rowReward}>
        <Text style={styles.rowRewardValue} numberOfLines={1}>
          {player.reward}{player.reward !== "—" && <Text style={styles.rowRewardLabel}> Aznif</Text>}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    backgroundColor: "#090711",
  },

  pressed: {
    opacity: 0.72,
  },

  mainContent: {
    flex: 1,

    direction: "ltr",
    flexDirection: "row",

    gap: 14,

    paddingTop: 68,
    paddingBottom: 14,
    paddingHorizontal: 18,
  },

  mainContentTablet: {
    gap: 20,
    paddingHorizontal: 26,
    paddingBottom: 20,
  },

  sponsorColumn: {
    width: "29%",
    maxWidth: 300,
    minWidth: 180,
  },

  sponsorImageWrap: {
    height: "100%",

    overflow: "hidden",

    borderRadius: 16,

    backgroundColor: "#120c1f",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  sponsorImage: {
    width: "100%",
    height: "100%",
  },

  sponsorShade: {
    ...StyleSheet.absoluteFill,

    backgroundColor: "rgba(7,3,14,0.20)",
  },

playButton: {
  position: "absolute",

  left: "50%",
  bottom: 12,
  transform: [{ translateX: -88 }],

  height: 50,
  paddingHorizontal: 48,

  direction: "ltr",
  flexDirection: "row",

  alignItems: "center",
  justifyContent: "center",

  gap: 7,

  borderRadius: 14,

  backgroundColor: "rgba(10,7,18,0.84)",

  borderWidth: 1,
  borderColor: "rgba(255,212,92,0.48)",

  shadowColor: "#000",
  shadowOpacity: 0.34,
  shadowRadius: 12,
  shadowOffset: {
    width: 0,
    height: 6,
  },
  elevation: 10,
},

  playIconCircle: {
    width: 25,
    height: 25,
    borderRadius: 13,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "rgba(255,212,92,0.10)",

    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.20)",
  },

  playButtonText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },

  rankingColumn: {
    flex: 1,
    minWidth: 0,
    direction: "rtl",
  },

  topThree: {
    height: 158,

    direction: "ltr",
    flexDirection: "row",

    alignItems: "flex-end",
    gap: 8,
  },

  topPlayer: {
    flex: 1,
    height: 142,
    minWidth: 0,

    paddingHorizontal: 8,
    paddingTop: 9,
    paddingBottom: 8,

    borderRadius: 14,

    alignItems: "center",

    backgroundColor: "rgba(17,12,30,0.92)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  topPlayerFeatured: {
    height: 154,

    backgroundColor: "rgba(31,21,36,0.96)",

    borderColor: "rgba(240,186,53,0.46)",
  },

  rankBadge: {
    position: "absolute",

    top: 7,
    left: 7,

    width: 23,
    height: 23,
    borderRadius: 7,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "rgba(255,255,255,0.08)",
  },

  rankBadgeFirst: {
    backgroundColor: "#f0ba35",
  },

  rankBadgeText: {
    color: "#ddd3e8",
    fontSize: 9,
    fontFamily: "RobotoMedium",
  },

  rankBadgeTextFirst: {
    color: "#241600",
  },

  avatar: {
    width: 35,
    height: 35,
    borderRadius: 18,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "rgba(255,255,255,0.08)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  avatarFeatured: {
    width: 39,
    height: 39,
    borderRadius: 20,

    borderColor: "rgba(240,186,53,0.36)",
  },

  playerName: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "RobotoMedium",
    marginTop: 5,
  },

statsRow: {
  direction: "ltr",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  marginTop: 6,
},

statItem: {
  minWidth: 38,
  alignItems: "center",
},

statValue: {
  color: "#fff",
  fontSize: 11,
  fontFamily: "RobotoMedium",
},

statLabel: {
  color: "#fff",
  fontSize: 8,
  fontFamily: "SpedaRegular",
  writingDirection: "rtl",
  marginTop: 1,
},

statDivider: {
  width: 1,
  height: 22,
  backgroundColor: "rgba(255,255,255,0.12)",
},

  number: {
    fontFamily: "RobotoMedium",
  },

  topBottomRow: {
    width: "100%",
    marginTop: "auto",

    direction: "ltr",
    flexDirection: "row",

    alignItems: "center",
    justifyContent: "space-between",

    paddingTop: 6,

    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },

  pointsText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "SpedaRegular",
    writingDirection: "rtl",
  },

  rewardText: {
    color: "#ffd45c",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },

  rows: {
    marginTop: 18,
    height: 138,
    flexGrow: 0,
  },

  rowsContent: {
    gap: 6,
  },

  playerRow: {
    height: 42,

    direction: "ltr",
    flexDirection: "row",

    alignItems: "center",

    paddingHorizontal: 10,

    borderRadius: 12,

    backgroundColor: "rgba(15,10,26,0.90)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },

  playerRowHighlighted: {
    backgroundColor: "rgba(38,28,20,0.96)",

    borderColor: "rgba(240,186,53,0.42)",
  },

  rowRank: {
    width: 34,
    alignItems: "center",
  },

  rowRankText: {
    color: "#ffd45c",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },

  rowAvatar: {
    width: 29,
    height: 29,
    borderRadius: 15,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "rgba(255,255,255,0.07)",

    marginRight: 8,
  },

  rowIdentity: {
    width: 78,
  },

  rowName: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "RobotoMedium",
  },

  rowProgress: {
    width: 76,
    justifyContent: "center",
    marginTop: -6,
  },

  rowStats: {
    flex: 1,
    color: "#fff",
    fontSize: 9,
    fontFamily: "SpedaRegular",
    writingDirection: "rtl",
    textAlign: "center",
  },

  rowReward: {
    width: 92,
    alignItems: "flex-end",
  },

  rowRewardValue: {
    color: "#ffd45c",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },

  rowRewardLabel: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },

  myRankSection: {
    paddingTop: 7,
  },
});
