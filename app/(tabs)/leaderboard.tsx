import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  getCurrentLeaderboardRank,
  getLeaderboardProfiles,
  useProfile,
} from "@/lib/profile";
import { getRankTitleFromLevel } from "@/lib/progression";

type LeaderboardPlayer = {
  id: string;
  name: string;
  level: number;
  points: number;
  aznif?: number;
  coin?: number;
  gem?: number;
  avatarId?: AvatarId;
  avatarUrl?: string;
};

const MEDAL_COLORS: Record<number, string> = {
  1: "#FACC15",
  2: "#CBD5E1",
  3: "#D97706",
};

export default function LeaderboardScreen() {
  const { profile } = useProfile();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [currentRank, setCurrentRank] = useState<number | null>(null);

  const loadPlayers = useCallback(() => {
    let isMounted = true;

    const refreshPlayers = async () => {
      if (!profile) {
        setPlayers([]);
        setCurrentRank(null);
        return;
      }

      try {
        const [leaderboard, rank] = await Promise.all([
          getLeaderboardProfiles(50),
          getCurrentLeaderboardRank(profile.id),
        ]);

        if (!isMounted) return;

        setPlayers(
          leaderboard.map((player) => ({
            id: player.id,
            name: player.displayName,
            level: player.level,
            points: player.points,
            aznif: player.aznif,
            coin: player.coin,
            gem: player.gem,
            avatarId: player.avatarId as AvatarId | undefined,
            avatarUrl: player.avatarUrl,
          })),
        );
        setCurrentRank(rank);
      } catch (error) {
        console.warn("Failed to load leaderboard:", error);

        if (isMounted) {
          setPlayers([]);
          setCurrentRank(null);
        }
      }
    };

    void refreshPlayers();

    return () => {
      isMounted = false;
    };
  }, [profile]);

  useFocusEffect(loadPlayers);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.points - a.points),
    [players],
  );

  const isCurrentUserInTop50 = players.some(
    (player) => player.id === profile?.id,
  );

  const renderRank = (rank: number, isCurrentUser: boolean) => {
    const medalColor = MEDAL_COLORS[rank];

    if (medalColor) {
      return <Ionicons name="medal" size={18} color={medalColor} />;
    }

    return (
      <Text style={[styles.rankText, isCurrentUser && styles.currentUserText]}>
        #{rank}
      </Text>
    );
  };

  if (!profile) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerText, styles.rankHeader]}>پلە</Text>
        <Text style={[styles.headerText, styles.playersHeader]}>یاریزانان</Text>
        <Text style={[styles.headerText, styles.levelHeader]}>ئاست</Text>
        <Text style={[styles.headerText, styles.pointsHeader]}>Points</Text>
        <Text style={[styles.headerText, styles.aznifHeader]}>ئەزنیف</Text>
        <Text style={[styles.headerText, styles.goldHeader]}>Gem</Text>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {sortedPlayers.map((player, index) => {
          const rank = index + 1;
          const isCurrentUser = player.id === profile?.id;

          return (
            <View
              key={player.id}
              style={[
                styles.row,
                rank <= 3 && styles.topRow,
                isCurrentUser && styles.currentUserRow,
              ]}
            >
              <View style={styles.playerColumn}>
                <View style={styles.rankBox}>
                  {renderRank(rank, isCurrentUser)}
                </View>

                <PlayerAvatar
                  avatarId={player.avatarId}
                  avatarUrl={player.avatarUrl}
                  size={28}
                  style={styles.playerAvatar}
                />

                <View style={styles.playerInfo}>
                  <Text
                    style={[
                      styles.playerName,
                      isCurrentUser && styles.currentUserText,
                    ]}
                    numberOfLines={1}
                  >
                    {player.name}
                    {isCurrentUser ? " (تۆ)" : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.levelColumn}>
                <Text
                  style={[
                    styles.levelText,
                    isCurrentUser && styles.currentUserText,
                  ]}
                >
                  {getRankTitleFromLevel(player.level)}
                </Text>
              </View>

              <View style={styles.pointsColumn}>
                <Text
                  style={[
                    styles.pointsText,
                    isCurrentUser && styles.currentUserText,
                  ]}
                >
                  {player.points.toLocaleString()}
                </Text>
              </View>

              <View style={styles.aznifColumn}>
                <Text
                  style={[
                    styles.aznifText,
                    isCurrentUser && styles.currentUserText,
                  ]}
                >
                  {(player.aznif ?? 0).toLocaleString()}
                </Text>
              </View>

              <View style={styles.goldColumn}>
                <Text
                  style={[
                    styles.goldText,
                    isCurrentUser && styles.currentUserText,
                  ]}
                >
                  {(player.gem ?? 0).toLocaleString()}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {!isCurrentUserInTop50 && currentRank !== null ? (
        <View style={[styles.row, styles.currentUserRow, styles.pinnedCurrentUserRow]}>
          <View style={styles.playerColumn}>
            <View style={styles.rankBox}>
              {renderRank(currentRank, true)}
            </View>

            <PlayerAvatar
              avatarId={profile.avatarId}
              avatarUrl={profile.avatarUrl}
              size={28}
              style={styles.playerAvatar}
            />

            <View style={styles.playerInfo}>
              <Text
                style={[styles.playerName, styles.currentUserText]}
                numberOfLines={1}
              >
                {profile.displayName} (تۆ)
              </Text>
            </View>
          </View>

          <View style={styles.levelColumn}>
            <Text style={[styles.levelText, styles.currentUserText]}>
              {getRankTitleFromLevel(profile.level)}
            </Text>
          </View>

          <View style={styles.pointsColumn}>
            <Text style={[styles.pointsText, styles.currentUserText]}>
              {profile.points.toLocaleString()}
            </Text>
          </View>

          <View style={styles.aznifColumn}>
            <Text style={[styles.aznifText, styles.currentUserText]}>
              {profile.coin.toLocaleString()}
            </Text>
          </View>

          <View style={styles.goldColumn}>
            <Text style={[styles.goldText, styles.currentUserText]}>
              {profile.gems.toLocaleString()}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 74,
    direction: "ltr",
  },

  tableHeader: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 6,
    borderRadius: 20,
    backgroundColor: "rgba(15,23,42,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },

  headerText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.7,
  },

  rankHeader: {
    width: 38,
    textAlign: "center",
    marginRight: 8,
  },

  playersHeader: {
    flex: 1,
    textAlign: "left",
  },

  levelHeader: {
    width: 58,
    textAlign: "right",
  },

  pointsHeader: {
    width: 68,
    textAlign: "right",
  },

  aznifHeader: {
    width: 64,
    textAlign: "right",
  },

  goldHeader: {
    width: 64,
    textAlign: "right",
  },

  list: {
    flex: 1,
  },

  listContent: {
    gap: 8,
    paddingBottom: 16,
  },

  row: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 16,
    backgroundColor: "rgba(15,23,42,0.82)",
  },

  topRow: {
    backgroundColor: "rgba(35,46,26,0.72)",
  },

  currentUserRow: {
    backgroundColor: "rgba(80,62,18,0.82)",
  },

  pinnedCurrentUserRow: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#facc15",
  },

  playerColumn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },

  rankBox: {
    width: 38,
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  rankText: {
    color: "#f8fafc",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontWeight: "500",
    textAlign: "center",
  },

  currentUserText: {
    color: "#facc15",
  },

  playerAvatar: {
    marginRight: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  playerInfo: {
    flex: 1,
    minWidth: 0,
  },

  playerName: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontWeight: "500",
    letterSpacing: 0.7,
  },

  levelColumn: {
    width: 58,
    alignItems: "flex-end",
  },

  levelText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontWeight: "400",
  },

  pointsColumn: {
    width: 68,
    alignItems: "flex-end",
  },

  pointsText: {
    color: "#f97316",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontWeight: "500",
  },

  aznifColumn: {
    width: 64,
    alignItems: "flex-end",
  },

  aznifText: {
    color: "#d6d3d1",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontWeight: "500",
  },

  goldColumn: {
    width: 64,
    alignItems: "flex-end",
  },

  goldText: {
    color: "#d6d3d1",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontWeight: "500",
  },
});
