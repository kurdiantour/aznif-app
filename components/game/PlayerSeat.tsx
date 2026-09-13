import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { DOMINO_HUMAN_TURN_DURATION_SECONDS } from "@/domino/shared/timing/domino-turn-timer";
import { Player } from "@/domino/types/domino-game";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

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
  onFlightOriginChange?: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
};

const TURN_DURATION_SECONDS = DOMINO_HUMAN_TURN_DURATION_SECONDS;
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
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  if (!visible) return null;

  const remainingProgress = Math.max(
    0,
    Math.min(1, secondsLeft / durationSeconds),
  );

  const elapsedProgress = 1 - remainingProgress;
  const filledLength = circumference * elapsedProgress;

  return (
    <View
      style={[
        styles.turnRingWrapper,
        {
          width: size,
          height: size,
        },
      ]}
    >
      <Svg
        width={size}
        height={size}
        style={StyleSheet.absoluteFill}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(250, 204, 21, 0.22)"
          strokeWidth={strokeWidth}
          fill="none"
        />

        {filledLength > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#facc15"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${filledLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            rotation={-90}
            originX={size / 2}
            originY={size / 2}
          />
        )}
      </Svg>

      <View style={styles.timerCenter}>
        <Text style={styles.timerText}>
          {Math.max(0, Math.ceil(secondsLeft))}
        </Text>
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
  onFlightOriginChange,
}: Props) {
  const tileCount = remainingTiles ?? player.tileCount;

  const wrapperRef = useRef<View | null>(null);

  const [wrapperOrigin, setWrapperOrigin] =
    useState<{ x: number; y: number } | null>(null);

  const [visibleDealToken, setVisibleDealToken] =
    useState<number | null>(null);

  const dealtTokenRef = useRef(0);

  const tileAnimations = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, tileCount) },
        () => new Animated.Value(1),
      ),
    [tileCount],
  );

  const updateWrapperOrigin = () => {
    wrapperRef.current?.measureInWindow(
      (x, y, width, height) => {
        setWrapperOrigin({ x, y });

        onFlightOriginChange?.({
          x: x + width * 0.58,
          y: y + height * 0.55,
          width: 18,
          height: 38,
        });
      },
    );
  };

  useEffect(() => {
    if (
      !dealToken ||
      dealtTokenRef.current === dealToken ||
      !dealOrigin ||
      !wrapperOrigin
    ) {
      return;
    }

    dealtTokenRef.current = dealToken;

    const timeoutId = setTimeout(() => {
      tileAnimations.forEach((animation) => {
        animation.setValue(0);
      });

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
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    dealOrder,
    dealOrigin,
    dealPlayerCount,
    dealToken,
    tileAnimations,
    wrapperOrigin,
  ]);

  const isWaitingForNewDeal =
    visibleDealToken !== dealToken;

  return (
    <View
      ref={wrapperRef}
      onLayout={updateWrapperOrigin}
      style={styles.wrapper}
    >
      <Pressable
        style={styles.card}
        onPress={onPress}
        disabled={!onPress}
      >
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
          <Text
            numberOfLines={1}
            style={styles.name}
          >
            {player.name}
          </Text>

          <View style={styles.tileRow}>
            {tileAnimations.map(
              (progress, index) => {
                const fromX =
                  dealOrigin && wrapperOrigin
                    ? dealOrigin.x -
                      (
                        wrapperOrigin.x +
                        66 +
                        index * 8
                      )
                    : 0;

                const fromY =
                  dealOrigin && wrapperOrigin
                    ? dealOrigin.y -
                      (
                        wrapperOrigin.y +
                        42
                      )
                    : 0;

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
                          visibleDealToken === dealToken &&
                          !isWaitingForNewDeal
                            ? progress
                            : 0,

                        transform: [
                          {
                            translateX:
                              progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [
                                  localFromX,
                                  0,
                                ],
                              }),
                          },
                          {
                            translateY:
                              progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [
                                  localFromY,
                                  0,
                                ],
                              }),
                          },
                          {
                            scale:
                              progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [
                                  2.2,
                                  1,
                                ],
                              }),
                          },
                        ],
                      },
                    ]}
                  />
                );
              },
            )}
          </View>
        </View>
      </Pressable>

      {showPass && (
        <View style={styles.passBadge}>
          <Text style={styles.passEmoji}>
            ✋
          </Text>

          <Text style={styles.passText}>
            تێپەڕبوون
          </Text>
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

    backgroundColor:
      "rgba(255,255,255,0.12)",

    borderWidth: 1,
    borderColor:
      "rgba(248, 243, 223, 0.22)",

    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: {
      width: 0,
      height: 3,
    },

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