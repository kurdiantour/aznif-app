import { Ionicons } from "@expo/vector-icons";
import { LogoutConfirmPopup } from "@/components/profile/LogoutConfirmPopup";
import {
  getCurrentLeaderboardVisibility,
  setCurrentLeaderboardVisibility,
} from "@/lib/leaderboardVisibility";
import { useAuthState } from "@/lib/auth-state";
import { signOut } from "@/lib/supabaseAuth";
import { leaveAllActiveOkeyMemberships } from "@/okey/multiplayer/okey-active-membership";
import { useGameFeedbackPreferences } from "@/lib/gameFeedbackPreferences";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export default function SettingsScreen() {
  const router = useRouter();
  const { userId } = useAuthState();
  const { width } = useWindowDimensions();
  const { soundEnabled, hapticsEnabled, setSoundEnabled, setHapticsEnabled } = useGameFeedbackPreferences();
  const [leaderboardVisible, setLeaderboardVisible] = useState(true);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutStartedRef = useRef(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [modalProgress] = useState(() => new Animated.Value(0));
  const isClosing = useRef(false);
  const isWideLayout = width >= 720;

  useEffect(() => {
    Animated.timing(modalProgress, {
      toValue: 1,
      duration: 310,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    return () => modalProgress.stopAnimation();
  }, [modalProgress]);

  const closeSettings = useCallback(() => {
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
    let isMounted = true;

    async function loadLeaderboardVisibility() {
      if (!userId) return;

      setLoadingLeaderboard(true);

      try {
        const nextVisible = await getCurrentLeaderboardVisibility();

        if (isMounted) {
          setLeaderboardVisible(nextVisible);
        }
      } catch (error) {
        console.warn("Failed to load leaderboard visibility:", error);
      } finally {
        if (isMounted) {
          setLoadingLeaderboard(false);
        }
      }
    }

    void loadLeaderboardVisibility();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  async function handleLeaderboardVisibleChange(value: boolean) {
    setLeaderboardVisible(value);

    try {
      await setCurrentLeaderboardVisibility(value);
    } catch (error) {
      console.warn("Failed to update leaderboard visibility:", error);
      setLeaderboardVisible((current) => !current);
    }
  }

  async function performLogout() {
    if (logoutStartedRef.current) return;
    logoutStartedRef.current = true;
    setLoggingOut(true);

    try {
      try {
        await leaveAllActiveOkeyMemberships();
      } catch (error) {
        console.warn("Unable to clean up active Okey matches before sign out:", error);
      }

      const { error } = await signOut();
      if (error) {
        console.warn("Unable to revoke the remote session; signing out locally:", error);
        const { error: localError } = await signOut("local");
        if (localError) throw localError;
      }

      router.replace("/login");
    } catch (error) {
      console.warn("Unable to sign out:", error);
      logoutStartedRef.current = false;
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <Animated.View style={[styles.background, { opacity: modalProgress }]}>
      <View style={styles.fixedContent}>
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
            accessibilityLabel="Close settings"
            hitSlop={10}
            onPress={closeSettings}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.closePressed,
            ]}
          >
            <Ionicons name="close" size={20} color="#f8d675" />
          </Pressable>

          <View style={styles.topRow}>
            <Text style={styles.screenTitle}>ڕێکخستنەکان</Text>
            <View style={styles.iconButtonPlaceholder} />
          </View>

          <View style={[styles.contentRow, !isWideLayout && styles.contentStack]}>
            <View style={styles.sectionCard}>
              <SettingRow
                icon="key-outline"
                label="ڕێکخستنەوەی وشەی نهێنی"
                onPress={() => router.push("/forgot-password")}
              />
              <SettingRow
                icon="trash-outline"
                label="سڕینەوەی هەژمار"
                danger
                onPress={() => router.push("/delete-account")}
              />
              <SettingRow
                icon="log-out-outline"
                label="دەرچوون"
                danger
                onPress={() => setIsLogoutConfirmOpen(true)}
              />
            </View>

            <View style={styles.sectionCard}>
              <SettingSwitch
                icon="volume-high-outline"
                label="دەنگی یاری"
                value={soundEnabled}
                onValueChange={setSoundEnabled}
              />
              <SettingSwitch
                icon="phone-portrait-outline"
                label="لەرینەەی مۆبایل"
                value={hapticsEnabled}
                onValueChange={setHapticsEnabled}
              />
              {userId ? (
                <SettingSwitch
                  icon="trophy-outline"
                  label="پیشاندانی لیستی پلەبەندی"
                  value={leaderboardVisible}
                  onValueChange={handleLeaderboardVisibleChange}
                  disabled={loadingLeaderboard}
                />
              ) : null}
            </View>
          </View>
        </Animated.View>
      </View>

      <LogoutConfirmPopup
        visible={isLogoutConfirmOpen}
        loading={loggingOut}
        onCancel={() => setIsLogoutConfirmOpen(false)}
        onConfirm={() => void performLogout()}
      />
    </Animated.View>
  );
}

function SettingSwitch({
  icon,
  label,
  value,
  disabled = false,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={[styles.settingItem, disabled && styles.disabled]}>
      <SettingIcon icon={icon} />
      <Text style={styles.settingLabel}>{label}</Text>
      {disabled ? (
        <ActivityIndicator color="#f8d774" size="small" />
      ) : (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: "#34303e", true: "#d39c23" }}
          thumbColor="#ffffff"
          ios_backgroundColor="#334155"
        />
      )}
    </View>
  );
}

function SettingRow({
  icon,
  label,
  value,
  danger = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.settingItem,
        pressed && onPress ? styles.pressed : null,
      ]}
      onPress={onPress}
    >
      <SettingIcon icon={icon} danger={danger} />
      <Text style={[styles.settingLabel, danger && styles.dangerLabel]}>
        {label}
      </Text>
      {value ? <Text style={styles.settingValue}>{value}</Text> : null}
    </Pressable>
  );
}

function SettingIcon({
  icon,
  danger = false,
}: {
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <View style={[styles.settingIconBox, danger && styles.dangerIconBox]}>
      <Ionicons name={icon} size={16} color={danger ? "#fca5a5" : "#f8d774"} />
    </View>
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
    color: "#fff6d8",
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
  contentRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  contentStack: {
    flexDirection: "column",
  },
  sectionCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#34303e",
    backgroundColor: "#201d29",
    padding: 14,
    gap: 10,
  },
  settingItem: {
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#34303e",
    backgroundColor: "#292235",
  },
  pressed: {
    opacity: 0.82,
  },
  closePressed: {
    opacity: 0.72,
  },
  settingIconBox: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerIconBox: {
    backgroundColor: "rgba(251, 113, 133, 0.1)",
  },
  settingLabel: {
    flex: 1,
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "right",
    writingDirection: "rtl",
  },
  dangerLabel: {
    color: "#fca5a5",
  },
  settingValue: {
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },
  disabled: {
    opacity: 0.7,
  },
});
