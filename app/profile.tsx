import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import { getCurrentLeaderboardRank, useProfile } from "@/lib/profile";
import {
  calculateLevelFromPoints,
  getRankTitleFromLevel,
  getRankTitleFromPoints,
  MAX_LEVEL,
  POINTS_PER_LEVEL,
} from "@/lib/progression";
import { signOut } from "@/lib/supabaseAuth";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, loading } = useProfile();
  const { width } = useWindowDimensions();
  const [loggingOut, setLoggingOut] = useState(false);
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadLeaderboardRank() {
      if (!profile) {
        setLeaderboardRank(null);
        return;
      }

      try {
        const rank = await getCurrentLeaderboardRank(profile.id);

        if (isMounted) {
          setLeaderboardRank(rank);
        }
      } catch (error) {
        console.warn("Failed to load leaderboard rank:", error);

        if (isMounted) {
          setLeaderboardRank(null);
        }
      }
    }

    void loadLeaderboardRank();

    return () => {
      isMounted = false;
    };
  }, [profile]);

  if (loading) {
    return (
      <ProfileShell>
        <ActivityIndicator color="#f8d774" />
      </ProfileShell>
    );
  }

  if (!profile) {
    return <Redirect href="/login" />;
  }

  const points = Math.max(profile.points ?? 0, 0);
  const level = calculateLevelFromPoints(points);
  const pointsInLevel = points % POINTS_PER_LEVEL;
  const progress = Math.max(pointsInLevel / POINTS_PER_LEVEL, 0.04);
  const rankTitle = getRankTitleFromPoints(points);
  const nextRankTitle =
    level >= MAX_LEVEL ? null : getRankTitleFromLevel(level + 1);
  const pointsToNextLevel =
    level >= MAX_LEVEL ? 0 : POINTS_PER_LEVEL - pointsInLevel;
  const avatarId = profile.avatarId as AvatarId | undefined;
  const isWideLayout = width >= 720;
  const gamesPlayed = Math.max(profile.gamesPlayed ?? 0, 0);
  const gamesWon = Math.max(profile.gamesWon ?? 0, 0);
  const gamesLost = Math.max(profile.gamesLost ?? 0, 0);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleOpenTelegram() {
    await Linking.openURL("https://t.me/aznifcommunity");
  }

  return (
    <ProfileShell>
      <View style={[styles.panel, isWideLayout && styles.panelWide]}>
        <View style={styles.topRow}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="arrow-forward" size={20} color="#ffffff" />
          </Pressable>
          <Text style={styles.screenTitle}>پڕۆفایل</Text>
          <View style={styles.iconButtonPlaceholder} />
        </View>

        <View style={[styles.contentRow, !isWideLayout && styles.contentStack]}>
          <View style={styles.profileCard}>
            <View style={styles.avatarRing}>
                <PlayerAvatar
                  avatarId={avatarId}
                  size={70}
                  style={styles.avatar}
                />
            </View>

                <Text style={styles.name} numberOfLines={1}>
                  {profile.displayName}
                </Text>
                <Text style={styles.rank}>{profile.playerId}</Text>

              <Pressable style={styles.telegramButton} onPress={handleOpenTelegram}>
                <View style={styles.telegramIconBox}>
                  <Ionicons name="paper-plane-outline" size={14} color="#f8d774" />
                </View>
                <Text style={styles.telegramText}>بەشداری تیلیگراممان بە</Text>
              </Pressable>

                <Pressable
                style={[styles.actionButton, loggingOut && styles.disabled]}
                onPress={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <ActivityIndicator color="#fca5a5" />
                ) : (
                  <>
                    <View style={styles.logoutIconBox}>
                      <Ionicons name="log-out-outline" size={14} color="#fca5a5" />
                    </View>
                    <Text style={styles.logoutText}>دەرچوون</Text>
                  </>
                )}
            </Pressable>
          </View>

          <View style={styles.detailsColumn}>
            <View style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <Text style={styles.points}>{points.toLocaleString()} خاڵ</Text>
                <View style={styles.levelPill}>
                  <Text style={styles.levelPillText}>{rankTitle}</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progress * 100}%` }]}
                />
              </View>
              <View style={styles.nextLevelRow}>
                <Ionicons name="trending-up-outline" size={16} color="#f8d774" />
                <Text style={styles.nextLevelText}>
                  {level >= MAX_LEVEL
                    ? "گەیشتوویت بە بەرزترین پلە"
                    : `${pointsToNextLevel.toLocaleString()} خاڵ ماوە بۆ ${nextRankTitle}`}
                </Text>
              </View>
            </View>

            <View style={styles.statsGrid}>
              <StatCell label="یارییەکان" value={gamesPlayed.toLocaleString()} />
              <StatCell label="سەرکەوتن" value={gamesWon.toLocaleString()} />
              <StatCell label="دۆڕان" value={gamesLost.toLocaleString()} />
              <StatCell
                label="پلەی لیدەربۆرد"
                value={leaderboardRank ? `#${leaderboardRank}` : "-"}
              />
            </View>

            </View>
        </View>
      </View>
    </ProfileShell>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileShell({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.background}>
      <View style={styles.fixedContent}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#020617",
  },
  fixedContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  panel: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: 12,
    gap: 10,
  },
  panelWide: {
    maxWidth: 760,
  },
  topRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  screenTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonPlaceholder: {
    width: 38,
    height: 38,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  contentStack: {
    flexDirection: "column",
  },
  profileCard: {
    flex: 0.9,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  detailsColumn: {
    flex: 1.25,
    minWidth: 0,
    gap: 10,
  },
  avatarRing: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: "#f8d774",
    backgroundColor: "rgba(248, 215, 116, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    borderRadius: 35,
  },
  name: {
    maxWidth: "100%",
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "RobotoMedium",
    textAlign: "center",
    marginTop: 9,
  },
  rank: {
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "RobotoMedium",
    textAlign: "center",
    marginTop: 4,
    writingDirection: "ltr",
  },
  progressCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    padding: 14,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  points: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },
  levelPill: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
    backgroundColor: "rgba(248, 215, 116, 0.12)",
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  levelPillText: {
    color: "#f8d774",
    fontSize: 11,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },
  progressTrack: {
    height: 8,
    borderRadius: 99,
    backgroundColor: "#020617",
    overflow: "hidden",
    marginTop: 14,
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
    marginTop: 1,
    paddingHorizontal: 10,
  },
  nextLevelText: {
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
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
  actionButton: {
    alignSelf: "stretch",
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(251, 113, 133, 0.24)",
    backgroundColor: "rgba(127, 29, 29, 0.12)",
    marginTop: 10,
  },
  telegramButton: {
    alignSelf: "stretch",
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    marginTop: 14,
  },
  telegramIconBox: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoutIconBox: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(251, 113, 133, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  telegramText: {
    flex: 1,
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "right",
    writingDirection: "rtl",
  },
  logoutText: {
    flex: 1,
    color: "#ff8b8b",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "right",
    writingDirection: "rtl",
  },
  disabled: {
    opacity: 0.65,
  },
});
