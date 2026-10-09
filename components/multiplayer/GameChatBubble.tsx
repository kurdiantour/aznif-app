import React, { useEffect, useRef, useState } from "react";
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
  seatAnchorRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  onComplete?: () => void;
};

export default function GameChatBubble({
  message,
  messageId,
  seat,
  isEmoji,
  seatAnchorRect,
  onComplete,
}: GameChatBubbleProps) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.92));

  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    opacity.setValue(0);
    scale.setValue(isEmoji ? 0.72 : 0.92);

    const enterDuration = 130;
    const exitDuration = 250;
    const totalDisplayDuration = 3000;

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: enterDuration,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: enterDuration,
          useNativeDriver: true,
        }),
      ]),

      Animated.delay(
        totalDisplayDuration -
          enterDuration -
          exitDuration,
      ),

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: exitDuration,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.94,
          duration: exitDuration,
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        onCompleteRef.current?.();
      }
    });

    return () => {
      animation.stop();
    };
  }, [
    isEmoji,
    messageId,
    opacity,
    scale,
  ]);

  const sideGap = 12;

  const positionStyle =
    seatAnchorRect
      ? seat === "top"
        ? {
            top:
              seatAnchorRect.y +
              seatAnchorRect.height +
              4,
            left:
              seatAnchorRect.x +
              seatAnchorRect.width / 2,
            width: 0,
          }
        : seat === "left"
          ? {
              top:
                seatAnchorRect.y +
                seatAnchorRect.height / 2,
              left:
                seatAnchorRect.x +
                seatAnchorRect.width +
                sideGap,
              width: 0,
              height: 0,
            }
          : {
              top:
                seatAnchorRect.y +
                seatAnchorRect.height / 2,
              left:
                seatAnchorRect.x -
                sideGap,
              width: 0,
              height: 0,
            }
      : isEmoji
        ? styles[`emoji_${seat}`]
        : seat === "left"
          ? [
              styles.emoji_left,
              styles.sideTextAnchor,
            ]
          : seat === "right"
            ? [
                styles.emoji_right,
                styles.sideTextAnchor,
              ]
            : styles[`emoji_${seat}`];

  const rotation =
    !isEmoji && seat === "left"
      ? "-90deg"
      : !isEmoji && seat === "right"
        ? "90deg"
        : "0deg";

  return React.createElement(
    View,
    {
      pointerEvents: "none",
      style: [
        styles.position,
        positionStyle,
      ],
    },
    React.createElement(
      Animated.View,
      {
        style: [
          !isEmoji && styles.textContainer,
          {
            opacity,
            transform: [
              { rotate: rotation },
              { scale },
            ],
          },
        ],
      },
      React.createElement(
        Text,
        {
          numberOfLines: 1,
          ellipsizeMode: "clip",
          style: isEmoji
            ? styles.emoji
            : styles.messageText,
        },
        message,
      ),
    ),
  );
}

const styles = StyleSheet.create({
  position: {
    position: "absolute",
    zIndex: 920,
    elevation: 920,

    alignItems: "center",
    justifyContent: "center",

    overflow: "visible",
  },

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

  sideTextAnchor: {
    width: 0,
    height: 0,
  },

  emoji: {
    fontSize: 36,
    lineHeight: 44,
    textAlign: "center",
  },

  textContainer: {
    width: 180,
    minHeight: 30,

    paddingHorizontal: 8,
    paddingVertical: 4,

    alignItems: "center",
    justifyContent: "center",

    overflow: "visible",
  },

  messageText: {
    width: "100%",

    color: "#ffffff",

    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",

    writingDirection: "rtl",
    textAlign: "center",

    flexWrap: "nowrap",
  },
});