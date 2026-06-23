import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

type SettingsDrawerProps = { visible: boolean; onClose: () => void };

const DRAWER_WIDTH = Math.min(282, Dimensions.get("window").width * 0.66);

export function SettingsDrawer({ visible, onClose }: SettingsDrawerProps) {
  const router = useRouter();
  const slideX = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(true);

  useEffect(() => {
    if (!visible) return;
    slideX.setValue(DRAWER_WIDTH);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: 0,
        duration: 190,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slideX, fade]);

  function closeDrawer() {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: DRAWER_WIDTH,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(onClose);
  }

  function navigateTo(path: "/delete-account" | "/forgot-password") {
    closeDrawer();
    requestAnimationFrame(() => router.push(path));
  }

  if (!visible) return null;

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={styles.backdropPressable} onPress={closeDrawer} />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          { width: DRAWER_WIDTH, transform: [{ translateX: slideX }] },
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.title}>ڕێکخستنەکان</Text>
          <View style={styles.divider} />

          <View style={styles.section}>
            <SettingSwitch
              icon="volume-high-outline"
              label="دەنگەکان"
              value={soundEffectsEnabled}
              onValueChange={setSoundEffectsEnabled}
              
  />
  <SettingRow
    icon="language-outline"
    label="زمان"
    value="کوردی"
  />
</View>

          <View style={styles.section}>
            <SettingRow
              icon="key-outline"
              label="ڕێکخستنەوەی وشەی نهێنی"
              onPress={() => navigateTo("/forgot-password")}
            />
            <SettingRow
              icon="trash-outline"
              label="سڕینەوەی هەژمار"
              danger
              onPress={() => navigateTo("/delete-account")}
            />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function SettingSwitch({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingItem}>
      <SettingIcon icon={icon} />
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        style={styles.settingSwitch}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#393347", true: "#22c55e" }}
        thumbColor="#fff"
        ios_backgroundColor="#393347"
      />
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
      style={({ pressed }) => [styles.settingItem, pressed && styles.pressed]}
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
    <View style={[styles.iconBox, danger && styles.dangerIconBox]}>
      <Ionicons name={icon} size={16} color={danger ? "#fca5a5" : "#c4b5fd"} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: "flex-end",
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
  },
  backdropPressable: { flex: 1 },
  drawer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    height: "100%",
    backgroundColor: "#090716",
    borderLeftWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.3)",
    paddingHorizontal: 12,
    elevation: 1000,
  },
  scrollContent: { 
    paddingTop: 32, 
    paddingBottom: 26, 
    direction: "rtl" 
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "left",
  },
  divider: {
    marginTop: 14,
    height: 1,
    backgroundColor: "rgba(167, 139, 250, 0.17)",
  },
  section: { marginTop: 14, gap: 8, direction: "rtl" },
  settingItem: {
    minHeight: 50,
    borderRadius: 11,
    paddingLeft: 10,
    paddingRight: 52,
    backgroundColor: "#0d0920",
    flexDirection: "row-reverse",
    direction: "rtl",
    alignItems: "center",
  },
  pressed: { opacity: 0.82 },
  iconBox: {
    position: "absolute",
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#251748",
    borderWidth: 1,
    borderColor: "rgba(167, 139, 250, 0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerIconBox: {
    backgroundColor: "#321524",
    borderColor: "rgba(251, 113, 133, 0.34)",
  },
settingLabel: {
  position: "absolute",
  top: 15,
  right: 52,
  left: 52,
  color: "#fff",
  fontSize: 12,
  fontFamily: "SpedaBold",
  textAlign: "left",
},
  dangerLabel: { color: "#fca5a5" },
  settingValue: {
    position: "absolute",
    left: 10,
    color: "#c5b4ed",
    fontSize: 11,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },
  settingSwitch: { position: "absolute", left: 7 },
});
