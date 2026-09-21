import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";

export function MatchCosmeticsGate({ ready, children }: { ready: boolean; children: ReactNode }) {
  if (ready) return children;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#101820" }}>
    <ActivityIndicator accessibilityLabel="Loading match cosmetics" color="#ffffff" />
  </View>;
}
