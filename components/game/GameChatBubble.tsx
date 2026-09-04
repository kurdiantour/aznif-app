import { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type GameChatBubbleSeat =
  | "bottom"
  | "right"
  | "top"
  | "left";

type GameChatBubbleProps = {
  message: string;
  messageId: string;
  seat: GameChatBubbleSeat;
  isEmoji: boolean;
  onComplete?: () => void;
};

export default function GameChatBubble({
  message,
  messageId,
  seat,
  isEmoji,
  onComplete,
}: GameChatBubbleProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    opacity.setValue(0);
    scale.setValue(isEmoji ? 0.72 : 0.92);

    const visibleDuration = isEmoji ? 1700 : 5000;

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 130,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 150,
          useNativeDriver: true,
        }),
      ]),

      Animated.delay(visibleDuration),

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.94,
          duration: 250,
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        onComplete?.();
      }
    });

    return () => animation.stop();
  }, [
    isEmoji,
    messageId,
    onComplete,
    opacity,
    scale,
  ]);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.position,
        isEmoji
          ? styles[`emoji_${seat}`]
          : styles[`text_${seat}`],
      ]}
    >
      <Animated.View
        style={[
          !isEmoji && styles.textBubble,
          {
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={
            isEmoji
              ? styles.emoji
              : styles.messageText
          }
        >
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: {
    position: "absolute",
    zIndex: 920,
    elevation: 920,
    alignItems: "center",
    justifyContent: "center",
  },

  // -------------------------
  // Emoji — همان جای فعلی
  // -------------------------

  emoji_top: {
    top: "15%",
    left: "45%",
    right: "45%",
  },

  emoji_left: {
    left: "8.5%",
    top: "42%",
  },

  emoji_right: {
    right: "10.5%",
    top: "42%",
  },

  emoji_bottom: {
    bottom: "35%",
    left: "45%",
    right: "45%",
  },

  emoji: {
    fontSize: 36,
    lineHeight: 44,
    textAlign: "center",
  },

  // -------------------------
  // Text — روی محدوده Name Plate
  // -------------------------

  text_top: {
    top: "7%",
    left: "35%",
    right: "35%",
  },

  text_bottom: {
    bottom: "27%",
    left: "35%",
    right: "35%",
  },

  text_left: {
    left: "2%",
    top: "37%",
    width: 150,
    transform: [{ rotate: "90deg" }],
  },

  text_right: {
    right: "2%",
    top: "37%",
    width: 150,
    transform: [{ rotate: "-90deg" }],
  },

  textBubble: {
    minWidth: 110,
    maxWidth: 180,
    minHeight: 30,

    paddingHorizontal: 12,
    paddingVertical: 6,

    borderRadius: 8,

    backgroundColor: "rgba(18, 12, 28, 0.88)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",

    alignItems: "center",
    justifyContent: "center",
  },

  messageText: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "center",
  },
});