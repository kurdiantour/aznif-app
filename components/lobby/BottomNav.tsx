import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ENABLE_SHOP_FEATURES } from "@/lib/platformFeatures";

export type BottomNavKey = "home" | "leaderboard" | "shop" | "friends";

type BottomNavProps = {
  active?: BottomNavKey;
  onChange?: (key: BottomNavKey) => void;
};

const allItems = [
  {
    key: "home",
    label: "سەرەکی",
    icon: "home",
    href: "/lobby",
  },
  {
    key: "leaderboard",
    label: "خشتەی پێشبڕکێ",
    icon: "trophy",
    href: "/leaderboard",
  },
  {
    key: "shop",
    label: "شۆپ",
    icon: "storefront",
    href: "/shop",
  },
  {
    key: "friends",
    label: "هاوڕێکان",
    icon: "people",
    href: "/invite-friends",
  },
] as const;

const items = allItems.filter(
  (item) => ENABLE_SHOP_FEATURES || item.key !== "shop",
);

export function BottomNav({
  active: controlledActive,
  onChange,
}: BottomNavProps) {
  const pathname = usePathname();

  const routeActive: BottomNavKey = pathname.includes("leaderboard")
    ? "leaderboard"
    : ENABLE_SHOP_FEATURES && pathname.includes("shop")
      ? "shop"
      : pathname.includes("invite")
        ? "friends"
        : "home";

  const active = controlledActive ?? routeActive;

  const handlePress = (
    key: BottomNavKey,
    href: (typeof items)[number]["href"],
  ) => {
    if (onChange) {
      onChange(key);
      return;
    }

    router.push(href);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        {items.map((item) => {
          const isActive = active === item.key;

          return (
            <Pressable
              key={item.key}
              onPress={() => handlePress(item.key, item.href)}
              hitSlop={10}
              style={({ pressed }) => [
                styles.item,
                isActive && styles.activeItem,
                pressed && styles.pressedItem,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={isActive ? "#ffffff" : "rgba(255,255,255,0.52)"}
              />

              <Text
                style={[
                  styles.text,
                  isActive ? styles.activeText : styles.inactiveText,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: "center",
    zIndex: 999,
    elevation: 20,
  },

  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(180,120,255,0.18)",
    backgroundColor: "rgba(12, 10, 30, 0.88)",
  },

  item: {
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  activeItem: {
    backgroundColor: "rgba(150, 90, 255, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(190,140,255,0.35)",
  },

  pressedItem: {
    opacity: 0.82,
  },

  text: {
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  activeText: {
    color: "#ffffff",
  },

  inactiveText: {
    color: "rgba(255,255,255,0.52)",
  },
});
