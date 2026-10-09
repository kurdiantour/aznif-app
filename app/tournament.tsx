import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import TournamentActive from "@/components/tournament/TournamentActive";
import TournamentIntro from "@/components/tournament/TournamentIntro";

const MOCK_TIMER = "24 : 00 : 00";
const MOCK_PARTICIPANTS = "1,248";

export default function TournamentScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  const isTablet = Math.min(width, height) >= 600;
  const [showActive, setShowActive] = useState(false);

  return (
    <View style={[styles.screen, showActive && styles.activeScreen]}>
      {!showActive ? (
        <TournamentIntro
          isTablet={isTablet}
          onJoin={() => setShowActive(true)}
        />
      ) : (
        <TournamentActive isTablet={isTablet} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={26} color="#fff" />
      </Pressable>

      <View style={styles.topStats}>
        <View style={styles.timerMeta}>
          <Text style={styles.metaValue}>{MOCK_TIMER}</Text>
          <Text style={styles.metaLabel}>ماوەی پاڵەوانێتی</Text>
        </View>

        <View style={styles.topDivider} />

        <View style={styles.participants}>
          <Text style={styles.metaValue}>{MOCK_PARTICIPANTS}</Text>
          <Text style={styles.metaLabel}>بەشداربوو</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  activeScreen: {
    backgroundColor: "#05091c",
  },

  pressed: { opacity: 0.72 },
  closeButton: {
    position: "absolute",
    zIndex: 10,
    top: 12,
    right: 14,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  topStats: {
    position: "absolute",
    zIndex: 10,
    top: 14,
    left: 60,
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  timerMeta: { alignItems: "center", justifyContent: "center" },
  participants: { alignItems: "center", justifyContent: "center" },
  topDivider: { width: 1, height: 38, backgroundColor: "rgba(255,255,255,0.22)" },
  metaValue: { color: "#fff", fontSize: 22, fontFamily: "RobotoMedium" },
  metaLabel: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    writingDirection: "rtl",
    textAlign: "center",
    marginTop: 1,
  },
});
