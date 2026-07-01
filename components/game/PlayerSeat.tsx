import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { Player } from "@/types/game";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  player: Player;
  remainingTiles?: number;
  showPass?: boolean;
  dealOrigin?: { x: number; y: number } | null;
  dealToken?: number;
  dealOrder?: number;
  dealPlayerCount?: number;
  dealRotation?: -90 | 0 | 90;
  onPress?: () => void;
};

const TURN_DURATION_SECONDS = 30;
const TURN_RING_SIZE = 44;
const TURN_RING_STROKE_WIDTH = 4;

function TurnRing({
  secondsLeft,
  visible,
  durationSeconds = TURN_DURATION_SECONDS,
  size = TURN_RING_SIZE,
  strokeWidth = TURN_RING_STROKE_WIDTH,
}: {
  secondsLeft: number;
  visible: boolean;
  durationSeconds?: number;
  size?: number;
  strokeWidth?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    if (visible) {
      progress.stopAnimation();
      progress.setValue(0);

      Animated.timing(progress, {
        toValue: 1,
        duration: durationSeconds * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    } else {
      progress.stopAnimation();
      progress.setValue(0);
    }
  }, [visible, durationSeconds, progress]);

  if (!visible) return null;

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={[styles.turnRingWrapper, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFillObject}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(250, 204, 21, 0.22)"
          strokeWidth={strokeWidth}
          fill="none"
        />

        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#facc15"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>

      <View style={styles.timerCenter}>
        <Text style={styles.timerText}>{secondsLeft}</Text>
      </View>
    </View>
  );
}

export default function PlayerSeat({
  player,
  remainingTiles,
  showPass = false,
  dealOrigin = null,
  dealToken = 0,
  dealOrder = 0,
  dealPlayerCount = 1,
  dealRotation = 0,
  onPress,
}: Props) {
  const tileCount =
    remainingTiles ??
    (player as any).tiles?.length ??
    (player as any).hand?.length ??
    (player as any).tileCount ??
    (player as any).remainingTiles ??
    7;

  const wrapperRef = useRef<View | null>(null);
  const [wrapperOrigin, setWrapperOrigin] = useState<{ x: number; y: number } | null>(null);
  const [visibleDealToken, setVisibleDealToken] = useState<number | null>(null);
  const dealtTokenRef = useRef(0);
  const previousTileCountRef = useRef<number | null>(null);
  const tileAnimationsRef = useRef<Animated.Value[]>([]);
  const tileAnimations = Array.from({ length: Math.max(0, tileCount) }, (_, index) => {
    if (!tileAnimationsRef.current[index]) {
      tileAnimationsRef.current[index] = new Animated.Value(1);
    }
    return tileAnimationsRef.current[index];
  });

  const updateWrapperOrigin = () => {
    wrapperRef.current?.measureInWindow((x, y) => setWrapperOrigin({ x, y }));
  };

  useEffect(() => {
    if (!dealToken || dealtTokenRef.current === dealToken || !dealOrigin || !wrapperOrigin) return;
    dealtTokenRef.current = dealToken;
    tileAnimations.forEach((animation) => animation.setValue(0));
    setVisibleDealToken(dealToken);
    Animated.sequence([
      Animated.delay(dealOrder * 95),
      Animated.stagger(
        95 * dealPlayerCount,
        tileAnimations.map((animation) =>
          Animated.timing(animation, {
            toValue: 1,
            duration: 620,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ),
      ),
    ]).start();
  }, [dealOrder, dealOrigin, dealPlayerCount, dealToken, tileAnimations, wrapperOrigin]);

  const isWaitingForNewDeal =
    tileCount >= 7 &&
    (previousTileCountRef.current === null ||
      (previousTileCountRef.current ?? tileCount) < tileCount) &&
    dealtTokenRef.current === dealToken;

  useEffect(() => {
    previousTileCountRef.current = tileCount;
  }, [tileCount]);

  return (
    <View ref={wrapperRef} onLayout={updateWrapperOrigin} style={styles.wrapper}>
      <Pressable style={styles.card} onPress={onPress} disabled={!onPress}>
        <View style={styles.avatarWrap}>
          <TurnRing
            secondsLeft={player.timeLeft}
            visible={player.isActive}
            durationSeconds={TURN_DURATION_SECONDS}
          />

          <PlayerAvatar
            avatarId={player.avatarId}
            size={38}
            style={styles.avatar}
          />
        </View>

        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.name}>
            {player.name}
          </Text>

          <View style={styles.tileRow}>
            {tileAnimations.map((progress, index) => {
              const fromX = dealOrigin && wrapperOrigin
                ? dealOrigin.x - (wrapperOrigin.x + 66 + index * 8)
                : 0;
              const fromY = dealOrigin && wrapperOrigin
                ? dealOrigin.y - (wrapperOrigin.y + 42)
                : 0;
              // Side seats are rotated by their parent. Rotate the global
              // center-to-seat vector back into their local coordinate space
              // so the visible tile still starts at the table centre.
              const localFromX =
                dealRotation === -90
                  ? -fromY
                  : dealRotation === 90
                    ? fromY
                    : fromX;
              const localFromY =
                dealRotation === -90
                  ? fromX
                  : dealRotation === 90
                    ? -fromX
                    : fromY;
              return (
                <Animated.View
                  key={index}
                  style={[
                    styles.miniTile,
                    {
                      opacity:
                        visibleDealToken === dealToken && !isWaitingForNewDeal
                          ? progress
                          : 0,
                      transform: [
                        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [localFromX, 0] }) },
                        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [localFromY, 0] }) },
                        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) },
                      ],
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>
      </Pressable>

      {showPass && (
        <View style={styles.passBadge}>
          <Text style={styles.passEmoji}>✋</Text>
          <Text style={styles.passText}>تێپەڕبوون</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexShrink: 0,
    position: "relative",
  },

  card: {
    minWidth: 138,
    height: 54,

    flexDirection: "row",
    alignItems: "center",

    paddingLeft: 6,
    paddingRight: 12,
    marginTop: 10,
  },

  avatarWrap: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },

  turnRingWrapper: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },

  timerCenter: {
    alignItems: "center",
    justifyContent: "center",
  },

  timerText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "RobotoMedium",
  },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,

    backgroundColor: "#f3e7c8",

    borderWidth: 2,
    borderColor: "#43c47a",

    alignItems: "center",
    justifyContent: "center",

    zIndex: 2,
  },

  avatarText: {
    color: "#5a3b22",
    fontSize: 18,
    fontFamily: "RobotoMedium",
  },

  info: {
    flex: 1,
    marginLeft: 8,
    justifyContent: "center",
  },

  name: {
    color: "#f5e4c7",
    fontSize: 14,
    fontFamily: "RobotoMedium",
    minWidth: 190,
  },

  tileRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 3,
  },

  miniTile: {
    width: 5,
    height: 12,
    borderRadius: 2,
    backgroundColor: "#ead9b8",
    opacity: 0.9,
  },

  passBadge: {
    position: "absolute",

    right: -76,
    top: "50%",

    transform: [{ translateY: -27 }],

    width: 66,
    height: 54,

    borderRadius: 10,

    backgroundColor: "rgba(255,255,255,0.12)",

    borderWidth: 1,
    borderColor: "rgba(248, 243, 223, 0.22)",

    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },

    elevation: 6,
  },

  passEmoji: {
    fontSize: 20,
    marginBottom: 1,
  },

  passText: {
    color: "#f5e4c7",
    fontSize: 12,
    fontFamily: "SpedaBold",
    letterSpacing: 0.3,
  },
});
