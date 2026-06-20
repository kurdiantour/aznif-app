import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { Player } from "@/types/game";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

type Props = {
  player: Player
  remainingTiles?: number
  showPass?: boolean
}

const TURN_DURATION_SECONDS = 30
const TURN_RING_SIZE = 64
const TURN_RING_STROKE_WIDTH = 4

function TurnRing({
  secondsLeft,
  visible,
  durationSeconds = TURN_DURATION_SECONDS,
  size = TURN_RING_SIZE,
  strokeWidth = TURN_RING_STROKE_WIDTH,
}: {
  secondsLeft: number
  visible: boolean
  durationSeconds?: number
  size?: number
  strokeWidth?: number
}) {
  const progress = useRef(new Animated.Value(0)).current

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  useEffect(() => {
    if (visible) {
      progress.stopAnimation()
      progress.setValue(0)

      Animated.timing(progress, {
        toValue: 1,
        duration: durationSeconds * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start()
    } else {
      progress.stopAnimation()
      progress.setValue(0)
    }
  }, [visible, durationSeconds, progress])

  if (!visible) return null

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  })

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
  )
}

export default function PlayerSeat({
  player,
  remainingTiles,
  showPass = false,
}: Props) {
  const tileCount =
    remainingTiles ??
    (player as any).tiles?.length ??
    (player as any).hand?.length ??
    (player as any).tileCount ??
    (player as any).remainingTiles ??
    7

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        <View style={styles.avatarWrap}>
          <TurnRing
            secondsLeft={player.timeLeft}
            visible={player.isActive}
            durationSeconds={TURN_DURATION_SECONDS}
          />

          <PlayerAvatar avatarId={player.avatarId} size={38} style={styles.avatar} />
        </View>

        <View style={styles.info}>
          <Text numberOfLines={1} style={styles.name}>
            {player.name}
          </Text>

          <View style={styles.tileRow}>
            {Array.from({ length: Math.max(0, tileCount) }).map((_, index) => (
              <View key={index} style={styles.miniTile} />
            ))}
          </View>
        </View>
      </View>

      {showPass && (
        <View style={styles.passBadge}>
          <Text style={styles.passEmoji}>✋</Text>
          <Text style={styles.passText}>تێپەڕبوون</Text>
        </View>
      )}
    </View>
  )
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

    borderRadius: 10,

    backgroundColor: "rgba(94, 62, 34, 0.96)",

    borderWidth: 1,
    borderColor: "rgba(39, 24, 12, 0.75)",

    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },

    elevation: 6,
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
    fontFamily: 'SpedaBold',
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
    fontFamily: 'SpedaBold',
  },

  info: {
    flex: 1,
    marginLeft: 8,
    justifyContent: "center",
  },

  name: {
    color: "#f5e4c7",
    fontSize: 14,
    fontFamily: 'SpedaBold',
    maxWidth: 82,
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

    backgroundColor: "rgba(94, 62, 34, 0.96)",

    borderWidth: 1,
    borderColor: "rgba(39, 24, 12, 0.75)",

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
    fontSize: 14,
    fontFamily: 'SpedaBold',
    letterSpacing: 0.3,
  },
})
