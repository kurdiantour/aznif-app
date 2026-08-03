import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

export function EliminatedPlayerOverlay() {
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel="دەستەکەت سووتا. تا کۆتایی ئەم ڕاوندە دەرکراویت." style={overlayStyles.root}>
      <MaterialCommunityIcons name="alert" size={32} color="#ff3131" />

      <Text style={overlayStyles.title}>
        دەستەکەت سووتا
      </Text>

      <Text style={overlayStyles.message}>
        تا کۆتایی ئەم ڕاوندە دەرکراویت.
      </Text>
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,49,49,0.42)",
    backgroundColor: "rgba(0,0,0,0.92)",
  },
  title: {
    marginTop: 8,
    color: "#ff3131",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  message: {
    marginTop: 8,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});