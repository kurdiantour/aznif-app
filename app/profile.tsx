import { AvatarPickerModal } from "@/components/player/AvatarPickerModal";
import { AvatarProgressRing } from "@/components/player/AvatarProgressRing";
import type { AvatarId } from "@/constants/avatars";
import { getCurrentLeaderboardRank, useProfile } from "@/lib/profile";
import {
  calculateLevelFromPoints,
  getRankTitleFromLevel,
  getRankTitleFromPoints,
  MAX_LEVEL,
  POINTS_PER_LEVEL,
} from "@/lib/progression";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, loading, updateProfile } = useProfile();
  const { width } = useWindowDimensions();
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [modalProgress] = useState(() => new Animated.Value(0));
  const isClosing = useRef(false);

  useEffect(() => {
    Animated.timing(modalProgress, {
      toValue: 1,
      duration: 310,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    return () => modalProgress.stopAnimation();
  }, [modalProgress]);

  const closeProfile = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;

    Animated.timing(modalProgress, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) router.back();
      else isClosing.current = false;
    });
  }, [modalProgress, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftName(profile?.displayName ?? "");
  }, [profile?.displayName]);

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
      <ProfileShell progress={modalProgress}>
        <ActivityIndicator color="#f8d774" />
      </ProfileShell>
    );
  }

  if (!profile) {
    return <Redirect href="/login" />;
  }

  const currentProfile = profile;
  const points = Math.max(currentProfile.points ?? 0, 0);
  const level = calculateLevelFromPoints(points);
  const pointsInLevel = points % POINTS_PER_LEVEL;
  const progress = Math.max(pointsInLevel / POINTS_PER_LEVEL, 0.04);
  const rankTitle = getRankTitleFromPoints(points);
  const nextRankTitle =
    level >= MAX_LEVEL ? null : getRankTitleFromLevel(level + 1);
  const pointsToNextLevel =
    level >= MAX_LEVEL ? 0 : POINTS_PER_LEVEL - pointsInLevel;
  const avatarId = currentProfile.avatarId as AvatarId | undefined;
  const isWideLayout = width >= 720;
  const gamesPlayed = Math.max(currentProfile.gamesPlayed ?? 0, 0);
  const gamesWon = Math.max(currentProfile.gamesWon ?? 0, 0);
  const gamesLost = Math.max(currentProfile.gamesLost ?? 0, 0);

  function startEditingName() {
    setDraftName(currentProfile.displayName);
    setIsEditingName(true);
  }

  async function finishEditingName() {
    if (savingName) return;

    const trimmed = draftName.trim();

    if (!trimmed || trimmed === currentProfile.displayName) {
      setDraftName(currentProfile.displayName);
      setIsEditingName(false);
      return;
    }

    setSavingName(true);

    try {
      await updateProfile({ displayName: trimmed });
      setIsEditingName(false);
    } catch (error) {
      console.warn("Failed to update profile name:", error);
      setDraftName(currentProfile.displayName);
    } finally {
      setSavingName(false);
    }
  }

  async function handleSelectAvatar(nextAvatarId: AvatarId) {
    if (nextAvatarId === "bot-avatar" || savingAvatar) {
      return;
    }

    setSavingAvatar(true);

    try {
      await updateProfile({ avatarId: nextAvatarId });
      setIsAvatarPickerOpen(false);
    } catch (error) {
      console.warn("Failed to update avatar:", error);
    } finally {
      setSavingAvatar(false);
    }
  }

  async function handleOpenTelegram() {
    await Linking.openURL("https://t.me/aznifcommunity");
  }

  return (
    <ProfileShell progress={modalProgress}>
      <Animated.View
        style={[
          styles.panel,
          isWideLayout && styles.panelWide,
          {
            transform: [
              {
                translateY: modalProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
              {
                scale: modalProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          },
        ]}
      >
        <View pointerEvents="none" style={styles.topGlow} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close profile"
          hitSlop={10}
          onPress={closeProfile}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="close" size={20} color="#f8d675" />
        </Pressable>

        <View style={styles.topRow}>
          <Text style={styles.screenTitle}>پڕۆفایل</Text>
          <View style={styles.iconButtonPlaceholder} />
        </View>

        <View style={[styles.contentRow, !isWideLayout && styles.contentStack]}>
          <View style={styles.profileCard}>
            <View style={styles.avatarRing}>
              <AvatarProgressRing
                avatarId={avatarId}
                avatarUrl={currentProfile.avatarUrl}
                points={points}
                size={82}
                strokeWidth={3}
                gap={3}
              />

              <Pressable
                accessibilityLabel="Change avatar"
                style={[styles.changeAvatarButton, savingAvatar && styles.disabled]}
                onPress={() => setIsAvatarPickerOpen(true)}
                disabled={savingAvatar}
              >
                {savingAvatar ? (
                  <ActivityIndicator color="#f8d774" size="small" />
                ) : (
                  <Ionicons name="camera-outline" size={15} color="#f8d774" />
                )}
              </Pressable>
            </View>
                <View style={styles.nameRow}>
                  {isEditingName ? (
                    <TextInput
                      value={draftName}
                      onChangeText={setDraftName}
                      onBlur={() => void finishEditingName()}
                      onSubmitEditing={() => void finishEditingName()}
                      editable={!savingName}
                      returnKeyType="done"
                      maxLength={18}
                      selectTextOnFocus
                      style={styles.nameInput}
                    />
                  ) : (
                    <>
                      <Text style={styles.name} numberOfLines={1}>
                        {currentProfile.displayName}
                      </Text>
                      <Pressable
                        accessibilityLabel="Change profile name"
                        style={styles.editNameButton}
                        onPress={startEditingName}
                      >
                        <Ionicons name="pencil" size={13} color="#f8d774" />
                      </Pressable>
                    </>
                  )}
                </View>
                <Text style={styles.rank}>{currentProfile.playerId}</Text>

              <Pressable style={styles.telegramButton} onPress={handleOpenTelegram}>
                <View style={styles.telegramIconBox}>
                  <Ionicons name="paper-plane-outline" size={14} color="#f8d774" />
                </View>
                <Text style={styles.telegramText}>بەشداری تیلیگراممان بە</Text>
              </Pressable>

          </View>

          <View style={styles.detailsColumn}>
            <View style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <Text style={styles.points}>{points.toLocaleString()} Points</Text>
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
                {level >= MAX_LEVEL ? (
                  <Text style={styles.nextLevelText}>
                    گەیشتوویت بە بەرزترین پلە
                  </Text>
                ) : (
                  <View style={styles.nextLevelContent}>
                    <Text style={styles.nextLevelEnglish}>
                      {`${pointsToNextLevel.toLocaleString()} Points`}
                    </Text>
                    <Text style={styles.nextLevelKurdish}>
                      {`ماوە بۆ ئاستی ${nextRankTitle}`}
                    </Text>
                  </View>
                )}
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
      </Animated.View>

      <AvatarPickerModal
        visible={isAvatarPickerOpen}
        selectedAvatarId={avatarId}
        onSelect={(nextAvatarId) => void handleSelectAvatar(nextAvatarId)}
        onClose={() => {
          if (!savingAvatar) {
            setIsAvatarPickerOpen(false);
          }
        }}
      />
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

function ProfileShell({
  children,
  progress,
}: {
  children: React.ReactNode;
  progress: Animated.Value;
}) {
  return (
    <Animated.View style={[styles.background, { opacity: progress }]}>
      <View style={styles.fixedContent}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "rgba(5,4,12,0.8)",
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
    maxWidth: 800,
    height: 360,
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.52)",
    backgroundColor: "#14121d",
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 17,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.46,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  panelWide: {
    maxWidth: 800,
  },
  topGlow: {
    position: "absolute",
    top: -55,
    left: "23%",
    width: "54%",
    height: 110,
    borderRadius: 60,
    backgroundColor: "rgba(255,202,68,0.1)",
  },
  topRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 50,
  },
  screenTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    transform: [{ translateY: -10 }],
  },
  iconButton: {
    position: "absolute",
    top: 12,
    right: 13,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.22)",
    backgroundColor: "rgba(255,212,92,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonPlaceholder: {
    display: "none",
  },
  pressed: {
    opacity: 0.72,
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
    alignItems: "center",
    justifyContent: "center",
  },
  changeAvatarButton: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.46)",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    borderRadius: 35,
  },
  nameRow: {
    marginTop: 9,
    minHeight: 36,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  name: {
    maxWidth: 150,
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },

  editNameButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  nameInput: {
    width: 190,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(2, 6, 23, 0.72)",
    color: "#ffffff",
    paddingHorizontal: 10,
    fontSize: 16,
    fontFamily: "RobotoMedium",
    textAlign: "center",
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
    fontFamily: "RobotoMedium",
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
    height: 4,
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
