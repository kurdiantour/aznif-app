import { Ionicons } from "@expo/vector-icons";
import {
  getCurrentLeaderboardVisibility,
  setCurrentLeaderboardVisibility,
} from "@/lib/leaderboardVisibility";
import { useProfile } from "@/lib/profile";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  const { profile } = useProfile();
  const { width } = useWindowDimensions();
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(true);
  const [leaderboardVisible, setLeaderboardVisible] = useState(true);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const isWideLayout = width >= 720;

  useEffect(() => {
    let isMounted = true;

    async function loadLeaderboardVisibility() {
      if (!profile) return;

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
  }, [profile]);

  async function handleLeaderboardVisibleChange(value: boolean) {
    setLeaderboardVisible(value);

    try {
      await setCurrentLeaderboardVisibility(value);
    } catch (error) {
      console.warn("Failed to update leaderboard visibility:", error);
      setLeaderboardVisible((current) => !current);
    }
  }

  return (
    <View style={styles.background}>
      <View style={styles.fixedContent}>
        <View style={[styles.panel, isWideLayout && styles.panelWide]}>
          <View style={styles.topRow}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}>
              <Ionicons name="arrow-forward" size={20} color="#ffffff" />
            </Pressable>
            <Text style={styles.screenTitle}>ڕێکخستنەکان</Text>
            <View style={styles.iconButtonPlaceholder} />
          </View>

          <View style={[styles.contentRow, !isWideLayout && styles.contentStack]}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="shield-checkmark-outline" size={18} color="#f8d774" />
                </View>
                <Text style={styles.sectionTitle}>هەژمار</Text>
              </View>

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
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="options-outline" size={18} color="#f8d774" />
                </View>
                <Text style={styles.sectionTitle}>گشتی</Text>
              </View>

              <SettingSwitch
                icon="volume-high-outline"
                label="دەنگەکان"
                value={soundEffectsEnabled}
                onValueChange={setSoundEffectsEnabled}
              />
              {profile ? (
                <SettingSwitch
                  icon="trophy-outline"
                  label="خشتەی پێشبڕکێ"
                  value={leaderboardVisible}
                  onValueChange={handleLeaderboardVisibleChange}
                  disabled={loadingLeaderboard}
                />
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
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
          trackColor={{ false: "#334155", true: "#1d4ed8" }}
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
  sectionCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    padding: 14,
    gap: 10,
  },
  sectionHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  sectionIcon: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "right",
    writingDirection: "rtl",
  },
  settingItem: {
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    backgroundColor: "rgba(2, 6, 23, 0.36)",
  },
  pressed: {
    opacity: 0.82,
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
