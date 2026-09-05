import { Ionicons } from "@expo/vector-icons";
import { Animated, StyleSheet, Text, View } from "react-native";

type OkeyForcedKonkanProps = {
  visible: boolean;
  panelProgress: Animated.Value | Animated.AnimatedInterpolation<number>;
  countdownProgress: Animated.Value | Animated.AnimatedInterpolation<number>;
};

export function OkeyForcedKonkan({
  visible,
  panelProgress,
  countdownProgress,
}: OkeyForcedKonkanProps) {
  /*
   * Keep the component mounted while the presentation policy owns
   * the entrance/exit animation. Visibility is expressed by the
   * authoritative presentation progress rather than by changing
   * gameplay state here.
   */
  if (!visible && !panelProgress) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.panel,
        {
          opacity: panelProgress,
          transform: [
            {
              translateY: panelProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [-110, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.titleRow}>
        <Ionicons name="lock-closed" size={15} color="#f8d774" />
        <Text style={styles.text}>ع©غ†ظ†ع©ط§ظ†غŒ ظ†ط§ع†ط§ط±غŒ</Text>
      </View>

      <Text style={styles.subtitle}>طھغŒظ…غŒ ط¯ظˆط§ع©غ•ظˆطھظˆظˆ ظ†ط§ع†ط§ط±غ• ع©غ†ظ†ع©ط§ظ† ط¨ع©ط§طھ</Text>

      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              transform: [{ scaleX: countdownProgress }],
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 0,
    left: "30%",
    right: "30%",
    zIndex: 950,
    elevation: 950,
    minHeight: 88,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 10,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(17, 18, 17, 0.98)",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: "rgba(242, 211, 124, 0.38)",
    shadowColor: "#000",
    shadowOpacity: 0.48,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },

  titleRow: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },

  text: {
    color: "#f8f3df",
    fontSize: 17,
    lineHeight: 25,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  subtitle: {
    marginTop: 1,
    color: "rgba(248, 243, 223, 0.68)",
    fontSize: 10,
    lineHeight: 17,
    fontFamily: "SpedaRegular",
    textAlign: "center",
    writingDirection: "rtl",
  },

  progressTrack: {
    width: "72%",
    height: 2,
    marginTop: 7,
    overflow: "hidden",
    borderRadius: 1,
    backgroundColor: "rgba(248, 215, 116, 0.16)",
  },

  progressFill: {
    width: "100%",
    height: "100%",
    borderRadius: 1,
    backgroundColor: "#f8d774",
  },
});