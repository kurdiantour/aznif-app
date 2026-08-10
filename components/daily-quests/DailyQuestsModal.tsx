import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const quests = [
  {
    title: "یەک یاریی دۆمینۆ تەواو بکە",
    icon: "game-controller-outline" as const,
    progress: "0/1",
    reward: "+500 سکە",
  },
  {
    title: "دوو یاریی ئۆکەی تەواو بکە",
    icon: "dice-outline" as const,
    progress: "0/2",
    reward: "+10 گەوهەر",
  },
  {
    title: "یەک یاریی ئۆکەی ببەرەوە",
    icon: "trophy-outline" as const,
    progress: "0/1",
    reward: "+1,000 سکە",
  },
];

function getTimeUntilTomorrow() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const remaining = Math.max(0, tomorrow.getTime() - now.getTime());
  return [
    Math.floor(remaining / 3_600_000),
    Math.floor((remaining % 3_600_000) / 60_000),
    Math.floor((remaining % 60_000) / 1_000),
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export default function DailyQuestsModal({ visible, onClose }: Props) {
  const [mounted, setMounted] = useState(visible);
  const [timeLeft, setTimeLeft] = useState(getTimeUntilTomorrow);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      closing.current = false;
      onClose();
    });
  }, [onClose, progress]);

  useEffect(() => {
    if (!visible) {
      if (mounted && !closing.current) close();
      return;
    }
    closing.current = false;
    setMounted(true);
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 310,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [close, mounted, progress, visible]);

  useEffect(() => {
    if (!mounted || !visible) return;
    setTimeLeft(getTimeUntilTomorrow());
    const interval = setInterval(() => setTimeLeft(getTimeUntilTomorrow()), 1_000);
    return () => clearInterval(interval);
  }, [mounted, visible]);

  if (!mounted) return null;

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <Animated.View style={[styles.overlay, { opacity: progress }]} pointerEvents="box-none">
      <View style={styles.backdrop} />
      <Animated.View style={[styles.box, { transform: [{ translateY }, { scale }] }]}>
        <View pointerEvents="none" style={styles.topGlow} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="داخستنی ئەرکە ڕۆژانەکان"
          hitSlop={10}
          onPress={close}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={20} color="#f8d675" />
        </Pressable>

        <View style={styles.heading}>
          <View style={styles.headingIcon}>
            <Ionicons name="clipboard" size={22} color="#ffd45c" />
          </View>
          <Text style={styles.title}>ئەرکە ڕۆژانەکان</Text>
          <Text style={styles.subtitle}>ئەرکەکانی ئەمڕۆ تەواو بکە</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quests}
        >
          {quests.map((quest) => (
            <View key={quest.title} style={styles.card}>
              <Text style={styles.questTitle}>{quest.title}</Text>
              <View style={styles.questIcon}>
                <Ionicons name={quest.icon} size={29} color="#ffd45c" />
              </View>
              <View style={styles.progressTrack}>
                <View style={styles.progressFill} />
              </View>
              <View style={styles.progressPill}>
                <Text style={styles.progressText}>{quest.progress}</Text>
              </View>
              <View style={styles.rewardRow}>
                <Text style={styles.rewardText}>{quest.reward}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.timerRow}>
          <Ionicons name="time-outline" size={15} color="#cdb980" />
          <Text style={styles.timerLabel}>نوێبوونەوەی ئەرکەکان</Text>
          <Text style={styles.timerValue}>{timeLeft}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5000,
    elevation: 5000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,4,12,0.8)",
  },
  box: {
    width: "100%",
    maxWidth: 800,
    minHeight: 360,
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.52)",
    backgroundColor: "#14121d",
    paddingTop: 22,
    paddingBottom: 17,
    shadowColor: "#000",
    shadowOpacity: 0.46,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
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
  close: {
    position: "absolute",
    top: 12,
    right: 13,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,212,92,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.22)",
  },
  pressed: { opacity: 0.72 },
  heading: { alignItems: "center", paddingHorizontal: 50, marginBottom: 18 },
  headingIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
    backgroundColor: "rgba(255,202,68,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.35)",
  },
  title: { color: "#fff6d8", fontSize: 19, fontFamily: "SpedaBold" },
  subtitle: {
    color: "#afa8bc",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    marginTop: 3,
    textAlign: "center",
  },
  quests: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, paddingVertical: 6 },
  card: {
    width: 190,
    height: 158,
    marginHorizontal: 5,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#34303e",
    backgroundColor: "#201d29",
  },
  questTitle: { color: "#d9d3df", fontSize: 12, fontFamily: "SpedaBold", textAlign: "center" },
  questIcon: { height: 55, alignItems: "center", justifyContent: "center" },
  progressTrack: {
    width: "100%",
    height: 5,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: "#34303e",
  },
  progressFill: { width: 0, height: "100%", backgroundColor: "#ffd45c" },
  progressPill: {
    marginTop: "auto",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(255,212,92,0.12)",
  },
  progressText: { color: "#f6d77d", fontSize: 10, fontFamily: "SpedaBold" },
  rewardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 5,
  },
  rewardText: { color: "#f6d77d", fontSize: 11, fontFamily: "SpedaBold" },
  timerRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  timerLabel: { color: "#aaa2b5", fontSize: 12, fontFamily: "SpedaRegular" },
  timerValue: {
    color: "#f8d675",
    fontSize: 13,
    fontFamily: "SpedaBold",
    fontVariant: ["tabular-nums"],
  },
});
