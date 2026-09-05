import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { DailyQuest } from "@/lib/dailyQuests";

type Props = {
  visible: boolean;
  quests?: DailyQuest[] | null;
  nextResetAt?: string | null;
  loading?: boolean;
  error?: Error | null;
  claimingId?: string | null;
  onClaim?: (instanceId: string) => Promise<unknown>;
  onRetry?: () => Promise<unknown>;
  onClose: () => void;
};

function countdown(resetAt?: string | null) {
  const reset = resetAt ? new Date(resetAt).getTime() : Number.NaN;
  const value = Number.isFinite(reset) ? Math.max(0, reset - Date.now()) : 0;
  return [Math.floor(value / 3_600_000), Math.floor(value % 3_600_000 / 60_000), Math.floor(value % 60_000 / 1_000)]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

function rewardText(quest: DailyQuest) {
  const amount = Number.isFinite(quest.rewardAmount) ? quest.rewardAmount : 0;
  const unit = quest.rewardType === "coin" ? "سکە" : quest.rewardType === "gem" ? "گەوهەر" : "ئەزنیف";
  return `+${amount.toLocaleString()} ${unit}`;
}

export default function ConnectedDailyQuestsModal({ visible, quests, nextResetAt,
  loading = false, error, claimingId, onClaim, onRetry, onClose }: Props) {
  const [timeLeft, setTimeLeft] = useState(() => countdown(nextResetAt));
  const safeQuests = Array.isArray(quests) ? quests.filter(Boolean) : [];

  useEffect(() => {
    if (!visible) return;
    setTimeLeft(countdown(nextResetAt));
    const interval = setInterval(() => setTimeLeft(countdown(nextResetAt)), 1_000);
    return () => clearInterval(interval);
  }, [nextResetAt, visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View pointerEvents="none" style={styles.backdrop} />
      <View style={styles.box}>
        <View pointerEvents="none" style={styles.topGlow} />
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={20} color="#f8d675" />
        </Pressable>
        <View style={styles.headingIcon}><Ionicons name="clipboard" size={22} color="#ffd45c" /></View>
        <Text style={styles.title}>ئەرکە ڕۆژانەکان</Text>
        <Text style={styles.subtitle}>ئەرکەکانی ئەمڕۆ تەواو بکە و خەڵاتەکان وەربگرە</Text>

        {loading && safeQuests.length === 0 ? <View style={styles.stateCard}><ActivityIndicator color="#ffd45c" /></View> : null}
        {error && safeQuests.length === 0 ? (
          <Pressable disabled={!onRetry} onPress={() => void onRetry?.()} style={styles.stateCard}>
            <Text style={styles.errorText}>بارکردن سەرکەوتوو نەبوو — دووبارە هەوڵ بدەوە</Text>
          </Pressable>
        ) : null}
        {!loading && !error && safeQuests.length === 0 ? <View style={styles.stateCard}><Ionicons name="clipboard-outline" size={30} color="#ffd45c" /><Text style={styles.empty}>ئەرکی ئەمڕۆ بەردەست نییە</Text></View> : null}

        {safeQuests.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quests}>
            {safeQuests.map((quest) => {
              const target = Number.isFinite(quest.target) && quest.target > 0 ? quest.target : 1;
              const progress = Number.isFinite(quest.progress) ? Math.max(0, quest.progress) : 0;
              const width = `${Math.min(100, progress / target * 100)}%` as `${number}%`;
              const metric = typeof quest.metric === "string" ? quest.metric : "";
              const icon = quest.gameType === "domino" ? "game-controller-outline" : metric.includes("won") ? "trophy-outline" : "dice-outline";
              return (
                <View key={quest.instanceId || `${quest.title}-${quest.sortOrder}`} style={[styles.card, quest.canClaim && styles.claimableCard]}>
                  <Text style={styles.questTitle}>{quest.title || "ئەرکی ڕۆژانە"}</Text>
                  <Ionicons name={icon} size={29} color="#ffd45c" style={styles.questIcon} />
                  <View style={styles.track}><View style={[styles.fill, { width }]} /></View>
                  <Text style={styles.progress}>{progress}/{target}</Text>
                  {quest.claimed ? (
                    <View style={styles.claimed}><Ionicons name="checkmark" size={12} color="#fff" /><Text style={styles.claimedText}>وەرگیرا</Text></View>
                  ) : quest.canClaim ? (
                    <Pressable disabled={claimingId !== null || !onClaim} onPress={() => void onClaim?.(quest.instanceId)} style={styles.claimButton}>
                      <Text style={styles.claimText}>{claimingId === quest.instanceId ? "چاوەڕێ بکە..." : `وەرگرتن ${rewardText(quest)}`}</Text>
                    </Pressable>
                  ) : <Text style={styles.reward}>{rewardText(quest)}</Text>}
                </View>
              );
            })}
          </ScrollView>
        ) : null}
        <View style={styles.timer}><Ionicons name="time-outline" size={15} color="#cdb980" />
          <Text style={styles.timerLabel}>نوێبوونەوەی ئەرکەکان</Text><Text style={styles.timerValue}>{timeLeft}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 5000, elevation: 5000, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5,4,12,0.82)" },
  box: { width: "100%", maxWidth: 800, minHeight: 360, overflow: "hidden", borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,212,92,0.52)", backgroundColor: "#14121d", paddingTop: 22, paddingBottom: 17, shadowColor: "#000", shadowOpacity: 0.46, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 20 },
  topGlow: { position: "absolute", top: -55, left: "23%", width: "54%", height: 110, borderRadius: 60, backgroundColor: "rgba(255,202,68,0.1)" },
  close: { position: "absolute", top: 12, right: 13, zIndex: 2, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,212,92,0.1)" },
  headingIcon: { alignSelf: "center", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,202,68,0.14)" },
  title: { marginTop: 7, color: "#fff6d8", fontSize: 19, fontFamily: "SpedaBold", textAlign: "center" },
  subtitle: { marginTop: 3, marginBottom: 14, color: "#afa8bc", fontSize: 12, fontFamily: "SpedaRegular", textAlign: "center" },
  stateCard: { minWidth: 250, minHeight: 145, marginVertical: 18, paddingHorizontal: 24, alignSelf: "center", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,212,92,0.22)", backgroundColor: "#2a211b" }, empty: { color: "#d9d3df", textAlign: "center", fontFamily: "SpedaBold" },
  errorText: { color: "#f3a8a8", fontFamily: "SpedaBold" }, quests: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, paddingVertical: 6 },
  card: { width: 190, height: 178, marginHorizontal: 5, padding: 12, alignItems: "center", borderRadius: 16, borderWidth: 1, borderColor: "#34303e", backgroundColor: "#201d29" },
  claimableCard: { borderColor: "#d8ae45" }, questTitle: { color: "#d9d3df", fontSize: 12, fontFamily: "SpedaBold", textAlign: "center" },
  questIcon: { marginVertical: 12 }, track: { width: "100%", height: 5, overflow: "hidden", borderRadius: 3, backgroundColor: "#34303e" }, fill: { height: "100%", backgroundColor: "#ffd45c" },
  progress: { marginTop: 7, color: "#f6d77d", fontSize: 10, fontFamily: "SpedaBold" }, reward: { marginTop: "auto", color: "#f6d77d", fontSize: 11, fontFamily: "SpedaBold" },
  claimButton: { marginTop: "auto", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#d39c23" }, claimText: { color: "#251b09", fontSize: 10, fontFamily: "SpedaBold" },
  claimed: { marginTop: "auto", flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#277d59" }, claimedText: { color: "#fff", fontSize: 9, fontFamily: "SpedaBold" },
  timer: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 }, timerLabel: { color: "#aaa2b5", fontSize: 12, fontFamily: "SpedaRegular" }, timerValue: { color: "#f8d675", fontSize: 13, fontFamily: "SpedaBold", fontVariant: ["tabular-nums"] },
});
