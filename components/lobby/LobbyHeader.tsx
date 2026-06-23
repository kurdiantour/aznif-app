import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { useProfile } from "@/lib/profile";
import { getRankTitleFromPoints } from "@/lib/progression";
import { getBalance } from "@/lib/wallet";
import { subscribeWalletRefresh } from "@/lib/walletEvents";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type LobbyHeaderProps = {
  onProfileDrawerVisibilityChange?: (visible: boolean) => void;
};

export function LobbyHeader({
  onProfileDrawerVisibilityChange,
}: LobbyHeaderProps) {
  const { profile, loading } = useProfile();
  const rankTitle = getRankTitleFromPoints(profile?.points);

  const [mcBalance, setMcBalance] = useState<string>("...");
  const [goldBalance, setGoldBalance] = useState<string>("...");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const loadBalance = useCallback(async () => {
    if (loading || !profile?.id) return;

    try {
      const wallet = await getBalance();
      setMcBalance(Number(wallet.balances.mc || 0).toLocaleString());
      setGoldBalance(Number(wallet.balances.gold || 0).toLocaleString());
    } catch (error) {
      console.log("[LobbyHeader] Failed to load wallet balance:", error);
      setMcBalance("0");
      setGoldBalance("0");
    }
  }, [loading, profile?.id]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    const unsubscribe = subscribeWalletRefresh(() => {
      void loadBalance();
    });

    return () => unsubscribe();
  }, [loadBalance]);

  useEffect(() => {
    onProfileDrawerVisibilityChange?.(isProfileOpen);
  }, [isProfileOpen, onProfileDrawerVisibilityChange]);

  return (
    <>
      <View>
        <View style={styles.topBar}>
          <Pressable
            style={styles.userBox}
            onPress={() => setIsProfileOpen(true)}
          >
            <PlayerAvatar
              avatarId={profile?.avatarId}
              size={50}
              style={styles.avatar}
            />

            <View style={styles.userText}>
              <Text style={styles.username} numberOfLines={1}>
                {profile?.displayName ?? "Player"}
              </Text>

              <Text style={styles.level}>{rankTitle}</Text>
            </View>
          </Pressable>

          <View style={styles.topRight}>
            <View style={styles.balanceGroup}>
              <LinearGradient
                colors={["rgba(255,183,59,0.22)", "rgba(255,255,255,0.07)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.balancePill}
              >
                <View style={styles.balanceIconCircle}>
                  <Ionicons name="wallet" size={14} color="#F5C542" />
                </View>

                <Text style={styles.balanceText}>{mcBalance} ئەزنیف</Text>
              </LinearGradient>

              <Pressable onPress={() => router.push("/buy-gold")}>
                <LinearGradient
                  colors={["rgba(168,85,247,0.24)", "rgba(255,255,255,0.06)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.balancePillSecondary}
                >
                  <View style={styles.balanceIconCircleGold}>
                    <Ionicons name="diamond" size={14} color="#C084FC" />
                  </View>

                  <Text style={styles.balanceText}>{goldBalance} گەوهەر</Text>

                  <View style={styles.plusButton}>
                    <Ionicons name="add" size={15} color="#ffffff" />
                  </View>
                </LinearGradient>
              </Pressable>
            </View>

            <Pressable
              style={styles.topIcon}
              onPress={() => setIsSettingsOpen(true)}
            >
              <Ionicons name="settings-outline" size={19} color="#ffffff" />
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

      <ProfileDrawer
        visible={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      <SettingsDrawer
        visible={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
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
    fontFamily: "SpedaBold",
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
    fontFamily: "SpedaBold",
    letterSpacing: 0.2,
    flexShrink: 0,
  },

  plusButton: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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
  },

  headerGradientLine: {
    height: 1,
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 999,
    opacity: 0.95,
  },
});
