import { useProfile } from "@/lib/profile";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

const MIN_SPLASH_DURATION = 5000;
const BAR_COUNT = 7;
const BAR_DURATION = 2200;

const KEYFRAMES = [
  { t: 0, x: 0, r: 0, o: 0.2 },
  { t: 0.1428, x: -22, r: 0, o: 1 },
  { t: 0.2856, x: -45, r: 0, o: 1 },
  { t: 0.3712, x: -58, r: 0, o: 1 },
  { t: 0.4284, x: -67, r: 10, o: 1 },
  { t: 0.5712, x: -90, r: 40, o: 1 },
  { t: 0.714, x: -112, r: 62, o: 1 },
  { t: 0.8568, x: -135, r: 72, o: 1 },
  { t: 1, x: -157, r: 74, o: 0.2 },
];

export default function IndexScreen() {
  const router = useRouter();
  const { profile, loading: startupLoading } = useProfile();
  const progress = useRef(new Animated.Value(0)).current;
  const [minimumDurationElapsed, setMinimumDurationElapsed] = useState(false);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: BAR_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [progress]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setMinimumDurationElapsed(true);
    }, MIN_SPLASH_DURATION);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!minimumDurationElapsed || startupLoading) return;

    router.replace(profile ? "/(tabs)/play" : "/login");
  }, [minimumDurationElapsed, profile, router, startupLoading]);

  return (
    <View style={styles.container}>
      <View style={styles.loader}>
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const offset = index / BAR_COUNT;
          const inputRange = KEYFRAMES.map((frame) => frame.t);
          const translateXRange = KEYFRAMES.map((frame) => frame.x);
          const rotateRange = KEYFRAMES.map((frame) => `${frame.r}deg`);
          const opacityRange = KEYFRAMES.map((frame) => frame.o);
          const barProgress = Animated.modulo(
            Animated.add(progress, offset),
            1,
          );

          return (
            <Animated.View
              key={index}
              style={[
                styles.bar,
                {
                  opacity: barProgress.interpolate({
                    inputRange,
                    outputRange: opacityRange,
                  }),
                  transform: [
                    {
                      translateX: barProgress.interpolate({
                        inputRange,
                        outputRange: translateXRange,
                      }),
                    },
                    {
                      rotate: barProgress.interpolate({
                        inputRange,
                        outputRange: rotateRange,
                      }),
                    },
                  ],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050b22",
    alignItems: "center",
    justifyContent: "center",
  },

  loader: {
    position: "relative",
    width: 160,
    height: 46,
  },

  bar: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 5,
    height: 40,
    borderRadius: 2,
    backgroundColor: "#f8fbff",
  },
});
