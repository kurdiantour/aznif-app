import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
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

import {
  openSpecialChest,
  type DailyGiftCardStatus,
  type DailyGiftClaimResult,
} from "@/lib/dailyGift";
import { formatAznif } from "@/lib/aznif-display";
import RewardRain, {
  GoldCoinIcon,
  RewardCurrencyIcon,
  SpecialChestIcon,
  type RewardRainEvent,
  type RewardRainType,
} from "@/components/rewards/RewardRain";

type Props = {
  visible: boolean;
  onClose: () => void;
  statuses?: DailyGiftCardStatus[];
  nextResetAt?: string;
  claiming?: boolean;
  onClaim?: () => Promise<DailyGiftClaimResult | null>;
};

type GiftDay = {
  day: string;
  icon: string;
  reward: string;
  rewardType: RewardRainType;
  rewardAmount: number;
  status: "done" | "current" | "lock";
};

const days: GiftDay[] = [
  { day: "یەکەم", icon: "gold_coin", reward: "500 سکه", rewardType: "coin", rewardAmount: 500, status: "done" },
  {
    day: "دووەم",
    icon: "gold_coin",
    reward: "1,000 سکه",
    rewardType: "coin",
    rewardAmount: 1_000,
    status: "current",
  },
  {
    day: "سێیەم",
    icon: "\u{1F48E}",
    reward: "30 گەوهەر",
    rewardType: "gem",
    rewardAmount: 30,
    status: "lock",
  },
  {
    day: "چوارەم",
    icon: "gold_coin",
    reward: "1,500 سکه",
    rewardType: "coin",
    rewardAmount: 1_500,
    status: "lock",
  },
  {
    day: "پێنجەم",
    icon: "\u{1F48E}",
    reward: "70 گەوهەر",
    rewardType: "gem",
    rewardAmount: 70,
    status: "lock",
  },
  {
    day: "شەشەم",
    icon: "\u2728",
    reward: `${formatAznif(1)} ئەزنیف`,
    rewardType: "mc",
    rewardAmount: 1,
    status: "lock",
  },
  {
    day: "حەفتەم",
    icon: "special_chest",
    reward: "سندووقی تایبەت",
    rewardType: "special_chest",
    rewardAmount: 1,
    status: "lock",
  },
];

const REWARD_SOUND = require("@/assets/audio/game/tile-placement-5.mp3");

function formatClaimReward(result: DailyGiftClaimResult) {
  if (
    result.alreadyClaimed ||
    !result.rewardType ||
    typeof result.rewardAmount !== "number"
  ) {
    return null;
  }

  const labels = {
    coin: "سکە",
    gem: "گەوهەر",
    mc: "ئەزنیف",
    special_chest: "سندووقی تایبەت",
  } as const;

  return `+${result.rewardType === "mc" ? formatAznif(result.rewardAmount) : result.rewardAmount.toLocaleString("en-US")} ${labels[result.rewardType]}`;
}

function getTimeUntilTomorrow(nextResetAt?: string) {
  const now = new Date();
  const tomorrow = nextResetAt ? new Date(nextResetAt) : new Date(now);

  if (!nextResetAt || Number.isNaN(tomorrow.getTime())) {
    tomorrow.setHours(24, 0, 0, 0);
  }

  const remaining = Math.max(
    0,
    tomorrow.getTime() - now.getTime(),
  );

  const values = [
    Math.floor(remaining / 3_600_000),
    Math.floor((remaining % 3_600_000) / 60_000),
    Math.floor((remaining % 60_000) / 1_000),
  ];

  return values
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export default function DailyGiftModal({
  visible,
  onClose,
  statuses,
  nextResetAt,
  claiming = false,
  onClaim,
}: Props) {
  const [mounted, setMounted] = useState(visible);
  const [timeLeft, setTimeLeft] = useState(() =>
    getTimeUntilTomorrow(nextResetAt)
  );
  const [claimFeedback, setClaimFeedback] = useState<string | null>(null);
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const feedbackHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewardPlayer = useAudioPlayer(REWARD_SOUND);
  const [rewardRainEvent, setRewardRainEvent] = useState<RewardRainEvent | null>(null);
  const rewardRainSequence = useRef(0);

  const progress = useRef(
    new Animated.Value(visible ? 1 : 0),
  ).current;

  const closing = useRef(false);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: "mixWithOthers",
    }).catch(() => undefined);
  }, []);

useEffect(
  () => () => {
    if (feedbackHoldTimer.current) {
      clearTimeout(feedbackHoldTimer.current);
      feedbackHoldTimer.current = null;
    }

    feedbackOpacity.stopAnimation();
  },
  [feedbackOpacity],
);

  const showClaimFeedback = useCallback(
    (message: string) => {
      if (feedbackHoldTimer.current) clearTimeout(feedbackHoldTimer.current);
      feedbackOpacity.stopAnimation();
      feedbackOpacity.setValue(1);
      setClaimFeedback(message);

      void rewardPlayer
        .seekTo(0, 0, 0)
        .then(() => rewardPlayer.play())
        .catch(() => undefined);

      feedbackHoldTimer.current = setTimeout(() => {
        feedbackHoldTimer.current = null;
        Animated.timing(feedbackOpacity, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setClaimFeedback(null);
        });
      }, 3_000);
    },
    [feedbackOpacity, rewardPlayer],
  );

  const [chestOpening, setChestOpening] = useState(false);

  const playRewardRain = useCallback((type: RewardRainType, amount: number) => {
    rewardRainSequence.current += 1;
    setRewardRainEvent({
      id: rewardRainSequence.current,
      type,
      amount,
    });

    void rewardPlayer
      .seekTo(0, 0, 0)
      .then(() => rewardPlayer.play())
      .catch(() => undefined);
  }, [rewardPlayer]);

  const handleClaim = useCallback(async () => {
    if (!onClaim || claiming || chestOpening) return;
    const result = await onClaim();
    if (!result) return;

    if (result.rewardType === "special_chest") {
      showClaimFeedback("سندووقی تایبەت وەرگیرا!");
      setChestOpening(true);

      setTimeout(async () => {
        try {
          const openResult = await openSpecialChest();
          const rewards: string[] = [];
          if (openResult.awardedCoins > 0) {
            rewards.push(`+${openResult.awardedCoins.toLocaleString("en-US")} سکە`);
          }
          if (openResult.awardedGems > 0) {
            rewards.push(`+${openResult.awardedGems.toLocaleString("en-US")} گەوهەر`);
          }
          if (openResult.awardedMc > 0) {
            rewards.push(`+${formatAznif(openResult.awardedMc)} ئەزنیف`);
          }
          showClaimFeedback(rewards.join("\n"));
        } catch (err) {
          console.warn("Failed to open chest:", err);
          showClaimFeedback("خەتا لە کردنەوەی سندووق!");
        } finally {
          setChestOpening(false);
        }
      }, 1500);
    } else {
      if (result.rewardType && typeof result.rewardAmount === "number") {
        playRewardRain(result.rewardType, result.rewardAmount);
      } else {
        const message = formatClaimReward(result);
        if (message) showClaimFeedback(message);
      }
    }
  }, [claiming, onClaim, showClaimFeedback, chestOpening, playRewardRain]);

  const close = useCallback(() => {
    if (closing.current) return;

    setRewardRainEvent(null);
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
      if (mounted && !closing.current) {
        close();
      }

      return;
    }

    closing.current = false;
    setRewardRainEvent(null);
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

    setTimeLeft(getTimeUntilTomorrow(nextResetAt));

    const interval = setInterval(() => {
      setTimeLeft(getTimeUntilTomorrow(nextResetAt));
    }, 1_000);

    return () => {
      clearInterval(interval);
    };
  }, [mounted, nextResetAt, visible]);

  if (!mounted) {
    return null;
  }

  const overlayOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.overlay,
        {
          opacity: overlayOpacity,
        },
      ]}
    >
      <View style={styles.backdrop} />

      <Animated.View
        style={[
          styles.box,
          {
            transform: [
              { translateY },
              { scale },
            ],
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={styles.topGlow}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="داخستنی دیاریی ڕۆژانە"
          hitSlop={10}
          onPress={close}
          style={({ pressed }) => [
            styles.close,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name="close"
            size={20}
            color="#f8d675"
          />
        </Pressable>

        <View style={styles.heading}>
          <View style={styles.headingIcon}>
            <Ionicons
              name="gift"
              size={22}
              color="#ffd45c"
            />
          </View>

          <Text style={styles.title}>
            دیاریی ڕۆژانە
          </Text>

          <Text style={styles.subtitle}>
            هەموو ڕۆژێک خەڵاتەکەت وەربگرە
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.days}
        >
          {days.map((configuredItem, index) => {
            const item = {
              ...configuredItem,
              status: statuses?.[index] ?? configuredItem.status,
            };
            const rewardNumber = item.reward.match(/^[+\d,.]+/)?.[0] ?? "";
            const rewardLabel = item.reward.slice(rewardNumber.length);
            const isCurrent =
              item.status === "current";

            const isLocked =
              item.status === "lock";
            const isPressable = isCurrent;

            return (
              <Pressable
                key={item.day}
                accessibilityRole={isPressable ? "button" : undefined}
                disabled={!isPressable || claiming || chestOpening}
                onPress={isCurrent && onClaim ? handleClaim : undefined}
                style={[
                  styles.card,
                  isCurrent && styles.activeCard,
                ]}
              >
                <Text
                  style={[
                    styles.day,
                    isCurrent && styles.activeDay,
                  ]}
                >
                  ڕۆژی {item.day}
                </Text>

                <View
                  style={[
                    styles.rewardIcon,
                    isCurrent && styles.activeRewardIcon,
                  ]}
                >
                  {item.icon === "special_chest" ? (
                    <SpecialChestIcon size={34} />
                  ) : item.icon === "gold_coin" ? (
                    <GoldCoinIcon size={30} />
                  ) : item.rewardType === "gem" || item.rewardType === "mc" ? (
                    <RewardCurrencyIcon type={item.rewardType} size={31} />
                  ) : item.icon.includes("-") ? (
                    <Ionicons name={item.icon as any} size={28} color="#f8d675" />
                  ) : (
                    <Text style={styles.rewardEmoji}>{item.icon}</Text>
                  )}
                </View>

                <Text
                  style={[
                    styles.reward,
                    isLocked &&
                      styles.lockedReward,
                  ]}
                >
                  {rewardNumber ? <><Text style={styles.rewardAmount}>{rewardNumber}</Text>{rewardLabel}</> : item.reward}
                </Text>

                {item.status === "done" ? (
                  <View style={styles.done}>
                    <Ionicons
                      name="checkmark"
                      size={13}
                      color="#fff"
                    />

                    <Text style={styles.doneText}>
                      وەرگیرا
                    </Text>
                  </View>
                ) : null}

                {item.status === "current" ? (
                  <View style={styles.todayPill}>
                    <Text style={styles.todayText}>
                      ئەمڕۆ
                    </Text>
                  </View>
                ) : null}

                {item.status === "lock" ? (
                  <View style={styles.lock}>
                    <Ionicons
                      name="lock-closed"
                      size={13}
                      color="#827b8d"
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.timerRow}>
          <Ionicons
            name="time-outline"
            size={15}
            color="#cdb980"
          />

          <Text style={styles.timerLabel}>
            دیاریی داهاتوو
          </Text>

          <Text style={styles.timerValue}>
            {timeLeft}
          </Text>
        </View>

        {claimFeedback ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.claimFeedback,
              { opacity: feedbackOpacity },
            ]}
          >
            <Text style={styles.claimFeedbackText}>
              {claimFeedback}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>

      <RewardRain event={rewardRainEvent} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rewardEmoji: {
    fontSize: 27,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },

  backdrop: {
    ...StyleSheet.absoluteFill,
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
    shadowOffset: {
      width: 0,
      height: 12,
    },

    elevation: 20,
  },

  topGlow: {
    position: "absolute",
    top: -55,
    left: "23%",

    width: "54%",
    height: 110,

    borderRadius: 60,

    backgroundColor:
      "rgba(255,202,68,0.1)",
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

    backgroundColor:
      "rgba(255,212,92,0.1)",

    borderWidth: 1,
    borderColor:
      "rgba(255,212,92,0.22)",
  },

  pressed: {
    opacity: 0.72,
  },

  heading: {
    alignItems: "center",
    paddingHorizontal: 50,
    marginBottom: 18,
  },

  headingIcon: {
    width: 44,
    height: 44,

    borderRadius: 22,

    alignItems: "center",
    justifyContent: "center",

    marginBottom: 7,

    backgroundColor:
      "rgba(255,202,68,0.14)",

    borderWidth: 1,
    borderColor:
      "rgba(255,212,92,0.35)",
  },

  title: {
    color: "#fff6d8",
    fontSize: 19,
    fontFamily: "SpedaBold",
  },

  subtitle: {
    color: "#afa8bc",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    marginTop: 3,
    textAlign: "center",
  },

  days: {
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 6,
  },

  card: {
    width: 98,
    height: 158,

    marginHorizontal: 5,
    paddingVertical: 12,

    alignItems: "center",

    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#34303e",

    backgroundColor: "#201d29",
  },

  activeCard: {
    borderColor: "#ffd45c",
    backgroundColor: "#292235",

    shadowColor: "#f5bd35",
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 3,
    },

    elevation: 7,
  },

  day: {
    color: "#d9d3df",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  activeDay: {
    color: "#fff0b0",
  },

  rewardIcon: {
    height: 48,
    justifyContent: "center",
  },

  activeRewardIcon: {
    transform: [{ scale: 1.08 }],
  },

  rewardAmount: { fontFamily: "RobotoMedium" },

  reward: {
    color: "#f6d77d",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    paddingHorizontal: 5,
  },

  lockedReward: {
    color: "#9991a2",
  },

  done: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,

    marginTop: "auto",

    paddingHorizontal: 8,
    paddingVertical: 3,

    borderRadius: 10,

    backgroundColor: "#277d59",
  },

  doneText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "SpedaBold",
  },

  todayPill: {
    marginTop: "auto",

    paddingHorizontal: 10,
    paddingVertical: 3,

    borderRadius: 10,

    backgroundColor: "#d39c23",
  },

  todayText: {
    color: "#251b09",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  lock: {
    marginTop: "auto",

    width: 24,
    height: 24,

    borderRadius: 12,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor:
      "rgba(132,123,143,0.12)",
  },

  timerRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",

    gap: 6,

    marginTop: 12,
  },

  timerLabel: {
    color: "#aaa2b5",
    fontSize: 12,
    fontFamily: "SpedaRegular",
  },

  timerValue: {
    color: "#f8d675",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    fontVariant: ["tabular-nums"],
  },

  claimFeedback: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  claimFeedbackText: {
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
    color: "#fff6d8",
    backgroundColor: "rgba(20,18,29,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.52)",
    fontSize: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
});

