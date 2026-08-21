import { Redirect } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useLocalOkeyPreviewGame } from "@/okey/hooks/useLocalOkeyPreviewGame";
import OkeyGameTableScene from "@/okey/scenes/OkeyGameTableScene";

export default function OkeyPreviewScreen() {
  const controller = useLocalOkeyPreviewGame();

  if (!__DEV__) {
    return <Redirect href="/okey" />;
  }

  return (
    <View style={styles.container}>
      <OkeyGameTableScene
        controller={controller}
        preview
      />

      <View pointerEvents="box-none" style={styles.devOverlay}>
        <View style={styles.devPanel}>
          <Text style={styles.devTitle}>
            Okey Bot Test
          </Text>

          <Text style={styles.devText}>
            You + 3 local bots
          </Text>

          <Pressable
            onPress={controller.newGame}
            style={styles.restartButton}
          >
            <Text style={styles.restartText}>
              Restart Game
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  devOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    paddingTop: 44,
    paddingRight: 10,
  },
  devPanel: {
    width: 150,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  devTitle: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  devText: {
    marginTop: 4,
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "600",
  },
  restartButton: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  restartText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});