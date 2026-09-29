import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/types/avatar";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AvatarPreviewContext } from "@/components/player/avatar-preview-popup";

import {
  getCurrentLeaderboardRank,
  getLeaderboardProfiles,
  getProfileById,
  useProfile,
} from "@/lib/profile";
import type { Profile } from "@/types/profile";
import {
  calculateLevelFromPoints,
  getRankTitleFromLevel,
  getRankTitleFromPoints,
  MAX_LEVEL,
  POINTS_PER_LEVEL,
} from "@/lib/progression";
import { useWallet } from "@/lib/wallet-context";
import { supabase } from "@/lib/supabase";
import { sendFriendRequest, respondFriendRequest } from "@/lib/friends";

type LeaderboardPlayer = {
  id: string;
  name: string;
  points: number;
  gem?: number;
  avatarId?: AvatarId;
  avatarUrl?: string;
};

const MEDAL_COLORS: Record<number, string> = {
  1: "#FACC15",
  2: "#CBD5E1",
  3: "#D97706",
};

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function LeaderboardScreen() {
  const { profile } = useProfile();
  const { gemBalance } = useWallet();
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [currentRank, setCurrentRank] = useState<number | null>(null);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [fetchedProfile, setFetchedProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const { showPreview } = useContext(AvatarPreviewContext);
  const [rawFriendship, setRawFriendship] = useState<{ id: string | null; status: "pending" | "accepted" | "rejected" | null; direction: "incoming" | "outgoing" | null } | null>(null);
  const [friendActionLoading, setFriendActionLoading] = useState(false);

  const activePlayerId = selectedPlayerId ?? profile?.id ?? null;
  const selectedProfile = activePlayerId === profile?.id ? profile : fetchedProfile;
  const friendship = !profile || !activePlayerId || profile.id === activePlayerId ? null : rawFriendship;

  useEffect(() => {
    let isMounted = true;
    if (!profile || !activePlayerId || profile.id === activePlayerId) {
      return;
    }

    const checkFriendship = async () => {
      const { data } = await supabase
        .from("friendships")
        .select("id, status, requester_id")
        .or(`and(requester_id.eq.${profile.id},addressee_id.eq.${activePlayerId}),and(requester_id.eq.${activePlayerId},addressee_id.eq.${profile.id})`)
        .maybeSingle();

      if (isMounted) {
        if (data) {
          setRawFriendship({
            id: data.id,
            status: data.status,
            direction: data.requester_id === profile.id ? "outgoing" : "incoming",
          });
        } else {
          setRawFriendship({ id: null, status: null, direction: null });
        }
      }
    };
    void checkFriendship();

    return () => { isMounted = false; };
  }, [profile, activePlayerId]);

  useEffect(() => {
    let isMounted = true;
    if (!activePlayerId || activePlayerId === profile?.id) return;

    const loadProfile = async () => {
      setLoadingProfile(true);
      try {
        const data = await getProfileById(activePlayerId);
        if (isMounted) setFetchedProfile(data);
      } catch (err) {
        console.warn("Failed to load selected profile:", err);
      } finally {
        if (isMounted) setLoadingProfile(false);
      }
    };

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [activePlayerId, profile?.id]);

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
            points: player.points,
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

  const handleFriendAction = async () => {
    if (!profile || !activePlayerId || activePlayerId === profile.id) return;

    setFriendActionLoading(true);
    try {
      if (!friendship || friendship.status === null || friendship.status === "rejected") {
        await sendFriendRequest(activePlayerId);
        setRawFriendship({ id: "temp", status: "pending", direction: "outgoing" });
      } else if (friendship.status === "pending" && friendship.direction === "incoming" && friendship.id) {
        await respondFriendRequest(friendship.id, true);
        setRawFriendship((prev) => prev ? { ...prev, status: "accepted" } : null);
      }
    } catch (err) {
      console.warn("Friend action failed:", err);
    } finally {
      setFriendActionLoading(false);
    }
  };

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

  const renderPanel = () => {
    if (loadingProfile && !selectedProfile) {
      return (
        <View style={[styles.panelWrapper, styles.panelCentered]}>
          <ActivityIndicator color="#f8d774" size="large" />
        </View>
      );
    }

    if (!selectedProfile) {
      return (
        <View style={[styles.panelWrapper, styles.panelCentered]}>
          <Text style={styles.panelPlaceholderText}>یاریزانێک هەڵبژێرە</Text>
        </View>
      );
    }

    const p = selectedProfile;
    const points = Math.max(p.points ?? 0, 0);
    const level = calculateLevelFromPoints(points);
    const pointsInLevel = points % POINTS_PER_LEVEL;
    const progress = Math.max(pointsInLevel / POINTS_PER_LEVEL, 0.04);
    const rankTitle = getRankTitleFromPoints(points);
    const nextRankTitle = level >= MAX_LEVEL ? null : getRankTitleFromLevel(level + 1);
    const pointsToNextLevel = level >= MAX_LEVEL ? 0 : POINTS_PER_LEVEL - pointsInLevel;

    const gamesPlayed = Math.max(p.gamesPlayed ?? 0, 0);
    const gamesWon = Math.max(p.gamesWon ?? 0, 0);
    const gamesLost = Math.max(p.gamesLost ?? 0, 0);

    return (
      <View style={styles.panelWrapper}>
        <View style={styles.panelHeader}>
          <Pressable
            onPress={() => {
              if (p.avatarUrl || p.avatarId) {
                showPreview({ id: p.avatarId, url: p.avatarUrl });
              }
            }}
            disabled={!p.avatarUrl && !p.avatarId}
          >
            <PlayerAvatar
              avatarId={p.avatarId}
              avatarUrl={p.avatarUrl}
              size={64}
              style={styles.panelAvatar}
            />
          </Pressable>
          <View style={styles.panelHeaderTextContainer}>
            <Text style={styles.panelName} numberOfLines={1}>{p.displayName}</Text>
            <Text style={styles.panelPlayerId}>ID: {p.playerId}</Text>
            <Text style={styles.panelRankTitle}>{rankTitle}</Text>
          </View>

          {profile && p.id !== profile.id && (
            <Pressable
              style={styles.friendButton}
              onPress={handleFriendAction}
              disabled={friendActionLoading || friendship?.status === "pending" && friendship?.direction === "outgoing" || friendship?.status === "accepted"}
            >
              {friendActionLoading ? (
                <ActivityIndicator size="small" color="#c4b5fd" />
              ) : friendship?.status === "accepted" ? (
                <Ionicons name="checkmark" size={19} color="#10b981" />
              ) : friendship?.status === "pending" && friendship?.direction === "outgoing" ? (
                <Ionicons name="time" size={19} color="#f59e0b" />
              ) : (
                <Ionicons name="person-add" size={18} color="#c4b5fd" />
              )}
            </Pressable>
          )}
        </View>

        <View style={styles.panelStats}>
          <View style={styles.progressCard}>
            <View style={styles.progressBarRow}>
              <View style={styles.progressTrackWrapper}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
              </View>
            </View>
            {level >= MAX_LEVEL ? (
              <Text style={styles.remainingPointsText}>گەیشتوویت بە بەرزترین پلە</Text>
            ) : (
              <Text style={styles.remainingPointsText}>{`${pointsToNextLevel.toLocaleString()} خاڵ ماوە بۆ پلەی ${nextRankTitle}`}</Text>
            )}
          </View>

          <View style={styles.statsGrid}>
            <StatCell label="یارییەکان" value={gamesPlayed.toLocaleString()} />
            <StatCell label="سەرکەوتن" value={gamesWon.toLocaleString()} />
            <StatCell label="دۆڕاندن" value={gamesLost.toLocaleString()} />
          </View>
        </View>
      </View>
    );
  };

  if (!profile) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.contentRow}>
        <View style={styles.listContainer}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.rankHeader]}>پلە</Text>
            <Text style={[styles.headerText, styles.playersHeader]}>یاریزانان</Text>
            <Text style={[styles.headerText, styles.pointsHeader]}>خاڵ</Text>
            <Text style={[styles.headerText, styles.goldHeader]}>گەوهەر</Text>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {sortedPlayers.map((player, index) => {
              const rank = index + 1;
              const isCurrentUser = player.id === profile?.id;
              const isSelected = player.id === activePlayerId;

              return (
                <Pressable
                  key={player.id}
                  onPress={() => setSelectedPlayerId(player.id)}
                  style={[
                    styles.row,
                    rank <= 3 && styles.topRow,
                    isCurrentUser && styles.currentUserRow,
                    isSelected && styles.selectedRow,
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
                        {isCurrentUser ? (
                          <Text style={styles.kurdishText}> (تۆ)</Text>
                        ) : null}
                      </Text>
                    </View>
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
                </Pressable>
              );
            })}
          </ScrollView>

          {!isCurrentUserInTop50 && currentRank !== null ? (
            <Pressable
              onPress={() => setSelectedPlayerId(profile.id)}
              style={[
                styles.row,
                styles.currentUserRow,
                styles.pinnedCurrentUserRow,
                activePlayerId === profile.id && styles.selectedRow,
              ]}
            >
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
                    {profile.displayName} <Text style={styles.kurdishText}>(تۆ)</Text>
                  </Text>
                </View>
              </View>

              <View style={styles.pointsColumn}>
                <Text style={[styles.pointsText, styles.currentUserText]}>
                  {profile.points.toLocaleString()}
                </Text>
              </View>

              <View style={styles.goldColumn}>
                <Text style={[styles.goldText, styles.currentUserText]}>
                  {gemBalance?.toLocaleString() ?? "..."}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.panelSide}>
          {renderPanel()}
        </View>
      </View>
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
  contentRow: {
    flex: 1,
    flexDirection: "row",
    gap: 16,
  },
  listContainer: {
    flex: 1.7,
  },
  panelSide: {
    flex: 1,
    maxWidth: 290,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    overflow: "hidden",
  },
  panelWrapper: {
    flex: 1,
    padding: 16,
    alignItems: "center",
  },
  panelCentered: {
    justifyContent: "center",
  },
  panelPlaceholderText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    width: "100%",
    gap: 12,
  },
  panelAvatar: {
  },
  panelHeaderTextContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  panelName: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "RobotoMedium",
    fontWeight: "500",
    textAlign: "left",
    marginBottom: 2,
  },
  panelPlayerId: {
    color: "#f8d774",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    textAlign: "left",
  },
  panelRankTitle: {
    color: "#cbd5e1",
    fontSize: 10,
    fontFamily: "SpedaBold",
    textAlign: "left",
    marginTop: 2,
  },
  friendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.3)",
  },
  panelStats: {
    width: "100%",
    gap: 12,
  },
  // Progress Bar styles
  progressCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    padding: 14,
  },
  progressBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  progressTrackWrapper: {
    flex: 1,
  },

  remainingPointsText: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginTop: 8,
  },
  progressTrack: {
    height: 4,
    borderRadius: 99,
    backgroundColor: "#020617",
    overflow: "hidden",
    alignItems: "flex-end",
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: "#f8d774",
  },
  nextLevelRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.16)",
    backgroundColor: "rgba(248, 215, 116, 0.08)",
    marginTop: 14,
    paddingHorizontal: 10,
  },
  nextLevelText: {
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  nextLevelContent: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  nextLevelEnglish: {
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "RobotoMedium",
  },
  nextLevelKurdish: {
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },
  // Stat Grid Styles
  statsGrid: {
    flexDirection: "row",
    gap: 8,
  },
  statCell: {
    flex: 1,
    minHeight: 58,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  statValue: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },
  statLabel: {
    color: "#b6c2d8",
    fontSize: 10,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 3,
  },

  // existing table styles
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
    fontFamily: "SpedaBold",
    fontWeight: "700",
    letterSpacing: 0.7,
  },
  rankHeader: { width: 38, textAlign: "center", marginRight: 8 },
  playersHeader: { flex: 1, textAlign: "left" },
  levelHeader: { width: 58, textAlign: "right" },
  pointsHeader: { width: 68, textAlign: "right", paddingRight: 8 },
  goldHeader: { width: 64, textAlign: "right", paddingRight: 8 },
  list: { flex: 1 },
  listContent: { gap: 8, paddingBottom: 16 },
  row: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 16,
    backgroundColor: "rgba(15,23,42,0.82)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  topRow: { backgroundColor: "rgba(35,46,26,0.72)" },
  currentUserRow: { backgroundColor: "rgba(80,62,18,0.82)" },
  pinnedCurrentUserRow: { marginTop: 8, borderColor: "#facc15" },
  selectedRow: { borderColor: "#facc15", backgroundColor: "rgba(15,23,42,0.95)" },
  playerColumn: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  rankBox: { width: 38, marginRight: 8, alignItems: "center", justifyContent: "center" },
  rankText: { color: "#f8fafc", fontSize: 13, fontFamily: "RobotoMedium", fontWeight: "500", textAlign: "center" },
  currentUserText: { color: "#facc15" },
  kurdishText: { fontFamily: "SpedaBold" },
  playerAvatar: { marginRight: 8, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  playerInfo: { flex: 1, minWidth: 0 },
  playerName: { color: "#ffffff", fontSize: 13, fontFamily: "RobotoMedium", fontWeight: "500", letterSpacing: 0.7 },
  levelColumn: { width: 58, alignItems: "flex-end" },
  levelText: { color: "#cbd5e1", fontSize: 13, fontFamily: "SpedaBold", fontWeight: "400" },
  pointsColumn: { width: 68, alignItems: "flex-end", paddingRight: 8 },
  pointsText: { color: "#f97316", fontSize: 13, fontFamily: "RobotoMedium", fontWeight: "500" },
  goldColumn: { width: 64, alignItems: "flex-end", paddingRight: 8 },
  goldText: { color: "#d6d3d1", fontSize: 13, fontFamily: "RobotoMedium", fontWeight: "500" },
});
