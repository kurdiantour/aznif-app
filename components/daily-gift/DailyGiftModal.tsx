import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = { visible: boolean; onClose: () => void };
type GiftDay = { day: string; icon: keyof typeof Ionicons.glyphMap; reward: string; status: "done" | "current" | "lock" };

const days: GiftDay[] = [
  { day: "یەکەم", icon: "cash-outline", reward: "٥٠٠ سکه", status: "done" },
  { day: "دووەم", icon: "cash-outline", reward: "١٬٠٠٠ سکه", status: "current" },
  { day: "سێیەم", icon: "diamond-outline", reward: "٣٠ گەوهەر", status: "lock" },
  { day: "چوارەم", icon: "cash-outline", reward: "١٬٥٠٠ سکه", status: "lock" },
  { day: "پێنجەم", icon: "diamond-outline", reward: "٧٠ گەوهەر", status: "lock" },
  { day: "شەشەم", icon: "sparkles-outline", reward: "١ ئەزنیف", status: "lock" },
  { day: "حەفتەم", icon: "gift-outline", reward: "سندووقی تایبەت", status: "lock" },
];

function getTimeUntilTomorrow() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const remaining = Math.max(0, tomorrow.getTime() - now.getTime());
  const values = [Math.floor(remaining / 3_600_000), Math.floor((remaining % 3_600_000) / 60_000), Math.floor((remaining % 60_000) / 1_000)];
  return values.map((value) => String(value).padStart(2, "0")).join(":");
}

export default function DailyGiftModal({ visible, onClose }: Props) {
  const [mounted, setMounted] = useState(visible);
  const [timeLeft, setTimeLeft] = useState(getTimeUntilTomorrow);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  const open = useCallback(() => {
    closing.current = false;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 310, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: 190, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      setMounted(false);
      onClose();
    });
  }, [onClose, progress]);

  useEffect(() => {
    if (visible) setMounted(true);
    else if (mounted) close();
  }, [close, mounted, visible]);

  useEffect(() => {
    if (!mounted || !visible) return;
    setTimeLeft(getTimeUntilTomorrow());
    const interval = setInterval(() => setTimeLeft(getTimeUntilTomorrow()), 1_000);
    return () => clearInterval(interval);
  }, [mounted, visible]);

  if (!mounted) return null;
  const overlayOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <Animated.View onLayout={open} style={[styles.box, { transform: [{ translateY }, { scale }] }]}>
          <View style={styles.topGlow} />
          <Pressable accessibilityLabel="داخستنی دیاریی ڕۆژانە" hitSlop={10} onPress={close} style={styles.close}><Ionicons name="close" size={20} color="#f8d675" /></Pressable>
          <View style={styles.heading}>
            <View style={styles.headingIcon}><Ionicons name="gift" size={22} color="#ffd45c" /></View>
            <Text style={styles.title}>دیاریی ڕۆژانە</Text>
            <Text style={styles.subtitle}>هەموو ڕۆژێک خەڵاتەکەت وەربگرە</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            {days.map((item) => (
              <View key={item.day} style={[styles.card, item.status === "current" && styles.activeCard]}>
                <Text style={[styles.day, item.status === "current" && styles.activeDay]}>ڕۆژی {item.day}</Text>
                <View style={[styles.rewardIcon, item.status === "current" && styles.activeRewardIcon]}><Ionicons name={item.icon} size={27} color={item.status === "lock" ? "#827b8d" : "#ffd45c"} /></View>
                <Text style={[styles.reward, item.status === "lock" && styles.lockedReward]}>{item.reward}</Text>
                {item.status === "done" && <View style={styles.done}><Ionicons name="checkmark" size={13} color="#fff" /><Text style={styles.doneText}>وەرگیرا</Text></View>}
                {item.status === "current" && <View style={styles.todayPill}><Text style={styles.todayText}>ئەمڕۆ</Text></View>}
                {item.status === "lock" && <View style={styles.lock}><Ionicons name="lock-closed" size={13} color="#827b8d" /></View>}
              </View>
            ))}
          </ScrollView>
          <View style={styles.timerRow}><Ionicons name="time-outline" size={15} color="#cdb980" /><Text style={styles.timerLabel}>دیاریی داهاتوو</Text><Text style={styles.timerValue}>{timeLeft}</Text></View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(5,4,12,0.8)", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
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
},  topGlow: { position: "absolute", top: -55, left: "23%", width: "54%", height: 110, borderRadius: 60, backgroundColor: "rgba(255,202,68,0.1)" },
  close: { position: "absolute", top: 12, right: 13, zIndex: 2, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,212,92,0.1)", borderWidth: 1, borderColor: "rgba(255,212,92,0.22)" },
  heading: { alignItems: "center", paddingHorizontal: 50, marginBottom: 18 },
  headingIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 7, backgroundColor: "rgba(255,202,68,0.14)", borderWidth: 1, borderColor: "rgba(255,212,92,0.35)" },
  title: { color: "#fff6d8", fontSize: 19, fontFamily: "SpedaBold" }, subtitle: { color: "#afa8bc", fontSize: 12, fontFamily: "Speda", marginTop: 3, textAlign: "center" },
  days: { alignItems: "center", paddingHorizontal: 13, paddingVertical: 6 },
  card: { width: 98, height: 158, marginHorizontal: 5, paddingVertical: 12, alignItems: "center", borderRadius: 16, borderWidth: 1, borderColor: "#34303e", backgroundColor: "#201d29" },
  activeCard: { borderColor: "#ffd45c", backgroundColor: "#292235", shadowColor: "#f5bd35", shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 7 },
  day: { color: "#d9d3df", fontSize: 12, fontFamily: "SpedaBold" }, activeDay: { color: "#fff0b0" }, rewardIcon: { height: 48, justifyContent: "center" }, activeRewardIcon: { transform: [{ scale: 1.08 }] },
  reward: { color: "#f6d77d", fontSize: 12, fontFamily: "SpedaBold", textAlign: "center", paddingHorizontal: 5 }, lockedReward: { color: "#9991a2" },
  done: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: "auto", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: "#277d59" }, doneText: { color: "#fff", fontSize: 9, fontFamily: "SpedaBold" },
  todayPill: { marginTop: "auto", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: "#d39c23" }, todayText: { color: "#251b09", fontSize: 10, fontFamily: "SpedaBold" },
  lock: { marginTop: "auto", width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(132,123,143,0.12)" },
  timerRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 }, timerLabel: { color: "#aaa2b5", fontSize: 12, fontFamily: "Speda" }, timerValue: { color: "#f8d675", fontSize: 13, fontFamily: "SpedaBold", fontVariant: ["tabular-nums"] },
});