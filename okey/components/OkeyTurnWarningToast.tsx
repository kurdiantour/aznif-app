import { StyleSheet, Text, View } from "react-native";

export function OkeyTurnWarningToast({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.container}
    >
      <Text style={styles.text}>نۆرەی تۆیە</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: -10,
    alignSelf: "center",
    zIndex: 950,
    elevation: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 227, 154, 0.12)",
  },
  text: {
    color: "#FFF8E7",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "SpedaRegular",
    writingDirection: "rtl",
  },
});