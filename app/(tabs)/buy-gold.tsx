import { PlayerAvatar } from "@/components/player/PlayerAvatar"
import { PLAYER_TURN_DURATION_SECONDS } from "@/hooks/gameShared"
import { Player } from "@/types/game"
import { useEffect, useRef } from "react"
import { Text, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Rect } from "react-native-svg"

const AnimatedRect = Animated.createAnimatedComponent(Rect)

type Props = {
  player: Player
  remainingTiles?: number
  showPass?: boolean
  scale?: number
}

const CARD_WIDTH = 190
const CARD_HEIGHT = 64
const CARD_RADIUS = 12
const CARD_BORDER_STROKE = 2

function CardTurnBorder({
  visible,
  durationSeconds = PLAYER_TURN_DURATION_SECONDS,
  scale = 1,
}: {
  visible: boolean
  durationSeconds?: number
  scale?: number
}) {
  const progress = useRef(new Animated.Value(0)).current

  const width = CARD_WIDTH * scale
  const height = CARD_HEIGHT * scale
  const strokeWidth = CARD_BORDER_STROKE * scale
  const radius = CARD_RADIUS * scale

  const rectWidth = width - strokeWidth
  const rectHeight = height - strokeWidth
  const perimeter = 2 * (rectWidth + rectHeight)

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
    outputRange: [perimeter, 0],
  })

  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    >
      <Rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={rectWidth}
        height={rectHeight}
        rx={radius}
        ry={radius}
        stroke="rgba(20, 241, 193, 0.08)"
        strokeWidth={strokeWidth}
        fill="none"
      />

      <AnimatedRect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={rectWidth}
        height={rectHeight}
        rx={radius}
        ry={radius}
        stroke="rgba(20, 241, 193, 0.9)"
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${perimeter} ${perimeter}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </Svg>
  )
}

export default function PlayerSeat({
  player,
  remainingTiles,
  showPass = false,
  scale = 1,
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
      <View
        style={[
          styles.card,
          {
            width: CARD_WIDTH * scale,
            height: CARD_HEIGHT * scale,
            paddingLeft: 7 * scale,
            paddingRight: 15 * scale,
            borderRadius: CARD_RADIUS * scale,
          },
        ]}
      >
        <CardTurnBorder visible={player.isActive} scale={scale} />

        <View style={[styles.avatarWrap, { width: 58 * scale, height: 58 * scale }]}>
          <PlayerAvatar
            avatarId={player.avatarId}
            size={46 * scale}
            style={[
              styles.avatar,
              {
                width: 46 * scale,
                height: 46 * scale,
                borderRadius: 23 * scale,
              },
            ]}
          />
        </View>

        <View style={[styles.info, { marginLeft: 10 * scale }]}>
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              {
                fontSize: 15 * scale,
                maxWidth: 96 * scale,
              },
            ]}
          >
            {player.name}
          </Text>

          <View
            style={[
              styles.tileRow,
              {
                marginTop: 5 * scale,
                gap: 4 * scale,
              },
            ]}
          >
            {Array.from({ length: Math.max(0, tileCount) }).map((_, index) => (
              <View
                key={index}
                style={[
                  styles.miniTile,
                  {
                    width: 6 * scale,
                    height: 12 * scale,
                    borderRadius: 3 * scale,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </View>

      {showPass && (
        <View
          style={[
            styles.passBadge,
            {
              right: -76 * scale,
              width: 68 * scale,
              height: 48 * scale,
              borderRadius: 24 * scale,
              transform: [{ translateY: -24 * scale }],
            },
          ]}
        >
          <Text style={[styles.passText, { fontSize: 13 * scale }]}>تێپەڕبوون</Text>
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
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: "rgba(4, 18, 31, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(20, 241, 193, 0.28)",
    shadowColor: "#14f1c1",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  avatarWrap: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },

  avatar: {
    backgroundColor: "#061626",
    borderWidth: 2,
    borderColor: "#14f1c1",
    alignItems: "center",
    justifyContent: "center",
  },

  info: {
    flex: 1,
    justifyContent: "center",
    zIndex: 2,
  },

  name: {
    color: "#ffffff",
    fontFamily: 'Speda-Bold',
    letterSpacing: 0.2,
  },

  tileRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  miniTile: {
    backgroundColor: "#eaf7f2",
    opacity: 0.92,
  },

  passBadge: {
    position: "absolute",
    top: "50%",
    backgroundColor: "rgba(4, 18, 31, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(20, 241, 193, 0.38)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#14f1c1",
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 7,
  },

  passText: {
    color: "#14f1c1",
    fontFamily: 'Speda-Bold',
    letterSpacing: 0.8,
  },
})
