import { FeedbackPopup } from "@/components/lobby/FeedbackPopup";
import { AvatarProgressRing } from "@/components/player/AvatarProgressRing";
import { getFriendRequests } from "@/lib/friends";
import { useAuthState } from "@/lib/auth-state";
import { useProfile } from "@/lib/profile";
import { getRankTitleFromPoints } from "@/lib/progression";
import { useWallet } from "@/lib/wallet-context";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppLayout } from "@/hooks/useAppLayout";

let friendRequestHeaderChannelSequence = 0;

export function LobbyHeader() {
  const {
    isCompact,
    isCompactWidth,
    isCompactHeight,
    isLandscape,
  } = useAppLayout();

  const { profile, loading } = useProfile();
  const userId = useAuthState().userId;
  const rankTitle = getRankTitleFromPoints(profile?.points);

  const {
    coinBalance: rawCoinBalance,
    gemBalance: rawGemBalance,
  } = useWallet();

  const coinBalance = rawCoinBalance?.toLocaleString() ?? "...";
  const gemBalance = rawGemBalance?.toLocaleString() ?? "...";

  const [friendRequestCount, setFriendRequestCount] = useState(0);
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  const refreshFriendRequestCount = useCallback(async () => {
    if (loading || !userId) {
      return;
    }

    try {
      const requests = await getFriendRequests(userId);
      setFriendRequestCount(requests.length);
    } catch (error) {
      console.log("[LobbyHeader] Failed to load friend requests:", error);
      setFriendRequestCount(0);
    }
  }, [loading, userId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFriendRequestCount();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [refreshFriendRequestCount]);

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const channelId = ++friendRequestHeaderChannelSequence;

    async function subscribeToFriendRequests() {
      if (loading || !userId || !mounted) return;

      channel = supabase
        .channel(`friend-request-header-count:${userId}:${channelId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "friendships",
            filter: `addressee_id=eq.${userId}`,
          },
          () => {
            void refreshFriendRequestCount();
          },
        )
        .subscribe();
    }

    void subscribeToFriendRequests();

    return () => {
      mounted = false;

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [loading, userId, refreshFriendRequestCount]);

  return (
    <>
      <View>
        <View
          style={[
            styles.topBar,
            {
              paddingHorizontal: isCompactWidth
                ? 16
                : isLandscape
                  ? 20
                  : 30,
              rowGap: isCompact ? 4 : 8,
            },
            (isLandscape || isCompactHeight) && {
              flexWrap: "nowrap",
            },
          ]}
        >
          <Pressable
            style={[styles.userBox, isCompact && { width: 140 }]}
            onPress={() => router.push(userId ? "/profile" : "/login")}
          >
            <AvatarProgressRing
              avatarId={profile?.avatarId}
              avatarUrl={profile?.avatarUrl}
              points={profile?.points}
              size={50}
            />

            <View style={styles.userText}>
              <Text style={styles.username} numberOfLines={1}>
                {profile?.displayName ?? (userId ? "Player" : "Guest")}
              </Text>

              <Text style={styles.level}>
                {rankTitle}
              </Text>
            </View>
          </Pressable>

          <View style={styles.topRight}>
            {userId ? (
              <View
                style={[
                  styles.balanceGroup,
                  isCompactWidth && { gap: 4 },
                  (isLandscape || isCompactHeight) && {
                    flexWrap: "nowrap",
                  },
                ]}
              >
                <LinearGradient
                  colors={[
                    "rgba(245,197,66,0.24)",
                    "rgba(255,255,255,0.06)",
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.balancePillCoin,
                    isCompact && styles.balancePillCompact,
                  ]}
                >
                  <View style={styles.balanceIconCircleCoin}>
                    <Text style={styles.currencyEmoji}>
                      {"\u{1FA99}"}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.balanceText,
                      isCompact && { flexShrink: 1 },
                    ]}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                  >
                    {coinBalance}{" "}
                    <Text style={styles.balanceTextKurdish}>
                      سکە
                    </Text>
                  </Text>
                </LinearGradient>

                <LinearGradient
                  colors={[
                    "rgba(168,85,247,0.24)",
                    "rgba(255,255,255,0.06)",
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.balancePillSecondary,
                    isCompact && styles.balancePillCompact,
                  ]}
                >
                  <View style={styles.balanceIconCircleGold}>
                    <Text style={styles.currencyEmoji}>
                      {"\u{1F48E}"}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.balanceText,
                      isCompact && { flexShrink: 1 },
                    ]}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                  >
                    {gemBalance}{" "}
                    <Text style={styles.balanceTextKurdish}>
                      گەوهەر
                    </Text>
                  </Text>
                </LinearGradient>
              </View>
            ) : loading ? (
              <View style={styles.authPlaceholder} />
            ) : (
              <Pressable
                style={styles.signInButton}
                onPress={() => router.push("/login")}
              >
                <Text style={styles.signInText}>
                  چوونەژوورەوە
                </Text>
              </Pressable>
            )}

            <Pressable
              style={styles.topIcon}
              onPress={() => router.push("/invite-friends")}
            >
              <Ionicons name="people" size={19} color="#ffffff" />

              {!loading && userId && friendRequestCount > 0 ? (
                <View style={styles.friendRequestBadge}>
                  <Text style={styles.friendRequestBadgeText}>
                    {friendRequestCount > 9
                      ? "9+"
                      : friendRequestCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            <Pressable
              style={styles.topIcon}
              accessibilityRole="button"
              accessibilityLabel="Feedback"
              onPress={() => setFeedbackVisible(true)}
            >
              <Ionicons
                name="create"
                size={19}
                color="#FFD45C"
              />
            </Pressable>

            <Pressable
              style={styles.topIcon}
              onPress={() => router.push("/settings")}
            >
              <Ionicons
                name="settings-outline"
                size={19}
                color="#ffffff"
              />
            </Pressable>
          </View>
        </View>

        <LinearGradient
          colors={[
            "rgba(168,85,247,0)",
            "rgba(168,85,247,0.75)",
            "rgba(20,241,193,0.55)",
            "rgba(168,85,247,0)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradientLine}
        />
      </View>

      <FeedbackPopup
        visible={feedbackVisible}
        onClose={() => setFeedbackVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  topBar: {
    minHeight: 48,
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 30,
    rowGap: 8,
  },

  userBox: {
    width: 165,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
  },

  userText: {
    alignItems: "flex-end",
  },

  avatar: {
    width: 50,
    height: 50,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  username: {
    maxWidth: 105,
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "RobotoMedium",
    textAlign: "right",
  },

  level: {
    marginTop: 1,
    color: "#8fa4d3",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "right",
  },

  topRight: {
    flexDirection: "row-reverse",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },

  balanceGroup: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
  },

  balancePill: {
    height: 36,
    minWidth: 140,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,214,102,0.20)",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },

  balancePillCoin: {
    height: 36,
    minWidth: 112,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.28)",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },

  balanceIconCircleCoin: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: "rgba(245,197,66,0.18)",
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },

  currencyEmoji: {
    fontSize: 14,
  },

  balancePillSecondary: {
    height: 36,
    minWidth: 140,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.26)",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },

  balancePillCompact: {
    minWidth: 80,
    paddingHorizontal: 8,
    gap: 4,
    flexShrink: 1,
  },

  balanceIconCircle: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: "rgba(255,183,59,0.20)",
    borderWidth: 1,
    borderColor: "rgba(255,214,102,0.30)",
    alignItems: "center",
    justifyContent: "center",
  },

  balanceIconCircleGold: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: "rgba(168,85,247,0.20)",
    borderWidth: 1,
    borderColor: "rgba(216,180,254,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },

  balanceText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "RobotoMedium",
    letterSpacing: 0.2,
    flexShrink: 0,
  },

  balanceTextKurdish: {
    fontFamily: "SpedaBold",
  },

  topIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  friendRequestBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: "#ef4444",
    borderWidth: 1,
    borderColor: "#090b1d",
    alignItems: "center",
    justifyContent: "center",
  },

  friendRequestBadgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontFamily: "RobotoMedium",
    lineHeight: 11,
  },

  signInButton: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116,0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },

  signInText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },

  authPlaceholder: {
    width: 96,
    height: 36,
  },

  headerGradientLine: {
    height: 1,
    marginTop: 10,
    borderRadius: 999,
    opacity: 0.95,
  },
});
