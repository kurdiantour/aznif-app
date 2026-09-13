import { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { formatCurrencyAmount } from "@/lib/aznif-display";

export type RewardRainType = "coin" | "gem" | "mc" | "special_chest";

export type RewardRainEvent = {
  id: number;
  type: RewardRainType;
  amount: number;
};

type Props = {
  event: RewardRainEvent | null;
};

const PARTICLE_COUNT = 26;

export function GoldCoinIcon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Circle
        cx="16"
        cy="16"
        r="13"
        fill="#b8860b"
        stroke="#ffd45c"
        strokeWidth="1.5"
      />
      <Circle cx="16" cy="16" r="10" fill="#ffd45c" />
      <Path
        d="M9 16C9 12.134 12.134 9 16 9"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <Path
        d="M16 11L17.2 13.8L20.2 14.1L17.9 16.1L18.6 19L16 17.5L13.4 19L14.1 16.1L11.8 14.1L14.8 13.8L16 11Z"
        fill="#b8860b"
      />
    </Svg>
  );
}

export function SpecialChestIcon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Rect
        x="4"
        y="14"
        width="24"
        height="13"
        rx="2"
        fill="#5c3c24"
        stroke="#ffd45c"
        strokeWidth="1.5"
      />
      <Path
        d="M4 14C4 8.5 7 5 16 5C25 5 28 8.5 28 14H4Z"
        fill="#7a4f30"
        stroke="#ffd45c"
        strokeWidth="1.5"
      />
      <Rect x="8" y="5" width="2" height="22" fill="#ffd45c" opacity="0.8" />
      <Rect x="22" y="5" width="2" height="22" fill="#ffd45c" opacity="0.8" />
      <Rect x="4" y="13" width="24" height="2" fill="#ffd45c" opacity="0.9" />
      <Rect
        x="13"
        y="11"
        width="6"
        height="7"
        rx="1"
        fill="#f8d675"
        stroke="#b8860b"
        strokeWidth="1"
      />
      <Circle cx="16" cy="14" r="1" fill="#14121d" />
      <Path d="M15.5 14L15 17H17L16.5 14H15.5Z" fill="#14121d" />
    </Svg>
  );
}

export function RewardCurrencyIcon({
  type,
  size = 32,
}: {
  type: RewardRainType;
  size?: number;
}) {
  if (type === "coin") return <GoldCoinIcon size={size} />;
  if (type === "special_chest") return <SpecialChestIcon size={size} />;

  return (
    <Text style={{ fontSize: size * 0.88, lineHeight: size }}>
      {type === "gem" ? "💎" : "✨"}
    </Text>
  );
}

function rewardLabel(type: RewardRainType) {
  if (type === "coin") return "سکە";
  if (type === "gem") return "گەوهەر";
  if (type === "mc") return "ئەزنیف";
  return "سندووقی تایبەت";
}

export default function RewardRain({ event }: Props) {
  const { width, height } = useWindowDimensions();

  const [values] = useState(() =>
    Array.from(
      { length: PARTICLE_COUNT },
      () => new Animated.Value(0),
    ),
  );

  const [amountProgress] = useState(() => new Animated.Value(0));

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
        leftRatio: ((index * 37) % 101) / 100,
        drift: ((index * 53) % 90) - 45,
        size: 22 + ((index * 7) % 16),
        delay: (index % 9) * 68 + Math.floor(index / 9) * 95,
        duration: 2100 + ((index * 83) % 650),
        rotation: 160 + ((index * 47) % 260),
      })),
    [],
  );

  useEffect(() => {
    if (!event) return;

    values.forEach((value) => {
      value.stopAnimation();
      value.setValue(0);
    });

    amountProgress.stopAnimation();
    amountProgress.setValue(0);

    const particleAnimations = values.map((value, index) =>
      Animated.timing(value, {
        toValue: 1,
        delay: particles[index].delay,
        duration: particles[index].duration,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    );

    Animated.parallel([
      ...particleAnimations,
      Animated.sequence([
        Animated.timing(amountProgress, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.delay(1100),
        Animated.timing(amountProgress, {
          toValue: 0,
          duration: 320,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [amountProgress, event, particles, values]);

  if (!event) return null;

  const amountScale = amountProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.76, 1],
  });

  const amountTranslateY = amountProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <View pointerEvents="none" style={styles.overlay}>
      {particles.map((particle, index) => {
        const progress = values[index];

        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-90, Math.max(420, height + 90)],
        });

        const translateX = progress.interpolate({
          inputRange: [0, 0.45, 1],
          outputRange: [0, particle.drift, particle.drift * 0.45],
        });

        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", `${particle.rotation}deg`],
        });

        const opacity = progress.interpolate({
          inputRange: [0, 0.05, 0.9, 1],
          outputRange: [0, 1, 1, 0],
        });

        return (
          <Animated.View
            key={`${event.id}-${index}`}
            style={[
              styles.particle,
              {
                left: Math.max(
                  0,
                  Math.min(
                    width - particle.size,
                    width * particle.leftRatio,
                  ),
                ),
                opacity,
                transform: [
                  { translateX },
                  { translateY },
                  { rotate },
                ],
              },
            ]}
          >
            <RewardCurrencyIcon
              type={event.type}
              size={particle.size}
            />
          </Animated.View>
        );
      })}

      <Animated.View
        style={[
          styles.amountBadge,
          {
            opacity: amountProgress,
            transform: [
              { translateY: amountTranslateY },
              { scale: amountScale },
            ],
          },
        ]}
      >
        <RewardCurrencyIcon type={event.type} size={34} />

        <Text style={styles.amountText}>
          {event.type === "special_chest"
            ? rewardLabel(event.type)
            : `+${formatCurrencyAmount(
                event.amount,
                event.type === "mc" ? "mc" : event.type,
              )} ${rewardLabel(event.type)}`}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    elevation: 100,
    overflow: "hidden",
  },

  particle: {
    position: "absolute",
    top: 0,
  },

  amountBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "38%",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(20,18,29,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.58)",
  },

  amountText: {
    color: "#fff6d8",
    fontSize: 20,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },
});