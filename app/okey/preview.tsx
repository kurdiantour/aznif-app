import { Redirect } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useLocalOkeyPreviewGame } from "@/okey/hooks/useLocalOkeyPreviewGame";
import OkeyGameTableScene from "@/okey/scenes/OkeyGameTableScene";

const LATENCY_PRESETS = [0, 100, 250, 500] as const;

export default function OkeyPreviewScreen() {
  const [latencyMs, setLatencyMs] = useState<number>(100);
  const [connected, setConnected] = useState(true);

  const controller = useLocalOkeyPreviewGame({
    latencyMs,
    connected,
  });

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
            Realtime Preview
          </Text>

          <View style={styles.row}>
            {LATENCY_PRESETS.map((value) => {
              const active = latencyMs === value;

              return (
                <Pressable
                  key={value}
                  onPress={() => setLatencyMs(value)}
                  style={[
                    styles.pill,
                    active && styles.pillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      active && styles.pillTextActive,
                    ]}
                  >
                    {value}ms
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => setConnected((value) => !value)}
            style={[
              styles.connectionButton,
              !connected && styles.connectionButtonDisconnected,
            ]}
          >
            <Text style={styles.connectionText}>
              {connected ? "Disconnect" : "Reconnect"}
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
    width: 220,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  devTitle: {
    marginBottom: 8,
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  pillActive: {
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  pillText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "600",
  },
  pillTextActive: {
    color: "#fff",
  },
  connectionButton: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(52, 211, 153, 0.22)",
  },
  connectionButtonDisconnected: {
    backgroundColor: "rgba(248, 113, 113, 0.24)",
  },
  connectionText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});