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

import Svg, { Rect, Path, Circle } from "react-native-svg";

function SpecialChestIcon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Rect x="4" y="14" width="24" height="13" rx="2" fill="#5c3c24" stroke="#ffd45c" strokeWidth="1.5" />
      <Path d="M4 14C4 8.5 7 5 16 5C25 5 28 8.5 28 14H4Z" fill="#7a4f30" stroke="#ffd45c" strokeWidth="1.5" />
      <Rect x="8" y="5" width="2" height="22" fill="#ffd45c" opacity="0.8" />
      <Rect x="22" y="5" width="2" height="22" fill="#ffd45c" opacity="0.8" />
      <Rect x="4" y="13" width="24" height="2" fill="#ffd45c" opacity="0.9" />
      <Rect x="13" y="11" width="6" height="7" rx="1" fill="#f8d675" stroke="#b8860b" strokeWidth="1" />
      <Circle cx="16" cy="14" r="1" fill="#14121d" />
      <Path d="M15.5 14L15 17H17L16.5 14H15.5Z" fill="#14121d" />
    </Svg>
  );
}

function GoldCoinIcon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Circle cx="16" cy="16" r="13" fill="#b8860b" stroke="#ffd45c" strokeWidth="1.5" />
      <Circle cx="16" cy="16" r="10" fill="#ffd45c" />
      <Path d="M9 16C9 12.134 12.134 9 16 9" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <Path d="M16 11L17.2 13.8L20.2 14.1L17.9 16.1L18.6 19L16 17.5L13.4 19L14.1 16.1L11.8 14.1L14.8 13.8L16 11Z" fill="#b8860b" />
    </Svg>
  );
}

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
  status: "done" | "current" | "lock";
};

const days: GiftDay[] = [
  { day: "یەکەم", icon: "gold_coin", reward: "500 سکه", status: "done" },
  {
    day: "دووەم",
    icon: "gold_coin",
    reward: "1,000 سکه",
    status: "current",
  },
  {
    day: "سێیەم",
    icon: "\u{1F48E}",
    reward: "30 گەوهەر",
    status: "lock",
  },
  {
    day: "چوارەم",
    icon: "gold_coin",
    reward: "1,500 سکه",
    status: "lock",
  },
  {
    day: "پێنجەم",
    icon: "\u{1F48E}",
    reward: "70 گەوهەر",
    status: "lock",
  },
  {
    day: "شەشەم",
    icon: "\u2728",
    reward: "1 ئەزنیف",
    status: "lock",
  },
  {
    day: "حەفتەم",
    icon: "special_chest",
    reward: "سندووقی تایبەت",
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

  return `+${result.rewardAmount.toLocaleString("en-US")} ${labels[result.rewardType]}`;
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
            rewards.push(`+${openResult.awardedMc.toLocaleString("en-US")} ئەزنیف`);
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
      const message = formatClaimReward(result);
      if (message) showClaimFeedback(message);
    }
  }, [claiming, onClaim, showClaimFeedback, chestOpening]);

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
      if (mounted && !closing.current) {
        close();
      }

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
            const isCurrent =
              item.status === "current";

            const isLocked =
              item.status === "lock";

            return (
              <Pressable
                key={item.day}
                accessibilityRole={isCurrent ? "button" : undefined}
                disabled={!isCurrent || claiming || !onClaim}
                onPress={isCurrent ? handleClaim : undefined}
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
                    isCurrent &&
                      styles.activeRewardIcon,
                  ]}
                >
                  {item.icon === "special_chest" ? (
                    <SpecialChestIcon size={34} />
                  ) : item.icon === "gold_coin" ? (
                    <GoldCoinIcon size={30} />
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
                  {item.reward}
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rewardEmoji: {
    fontSize: 27,
  },
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
    fontFamily: "SpedaBold",
    fontVariant: ["tabular-nums"],
  },

  claimFeedback: {
    ...StyleSheet.absoluteFillObject,
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
