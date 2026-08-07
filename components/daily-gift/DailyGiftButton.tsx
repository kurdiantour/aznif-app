import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import DailyGiftModal from "./DailyGiftModal";

export default function DailyGiftButton() {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Pressable
        accessibilityLabel="کردنەوەی دیاریی ڕۆژانە"
        hitSlop={8}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <View style={styles.innerGlow} />
        <Ionicons name="gift" size={23} color="#ffd45c" />
        <View style={styles.badge}><View style={styles.badgeInner} /></View>
      </Pressable>
      <DailyGiftModal visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: "rgba(255,190,40,0.16)", borderWidth: 1, borderColor: "rgba(255,210,80,0.46)" },
  innerGlow: { position: "absolute", top: -14, width: 36, height: 28, borderRadius: 18, backgroundColor: "rgba(255,236,157,0.18)" },
  badge: { position: "absolute", right: 3, top: 3, width: 11, height: 11, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#ec5664", borderWidth: 1.5, borderColor: "#171221" },
  badgeInner: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#fff1ee" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.96 }] },
});