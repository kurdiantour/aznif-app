import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import DailyGiftButton from "@/components/daily-gift/DailyGiftButton";
import { GamePartyChip } from "@/components/friends/GamePartyChip";
import DailyGiftModal from "@/components/daily-gift/DailyGiftModal";
import DailyQuestsButton from "@/components/daily-quests/DailyQuestsButton";
import DailyQuestsModal from "@/components/daily-quests/ConnectedDailyQuestsModal";
import { useDailyGift } from "@/hooks/useDailyGift";
import { useDailyQuests } from "@/hooks/useDailyQuests";
import { useGameParty } from "@/lib/gameInvitesProvider";
import { ENABLE_SHOP_FEATURES } from "@/lib/platformFeatures";
import { useAuthState } from "@/lib/auth-state";

export type BottomNavKey =
  | "home"
  | "aznif"
  | "leaderboard"
  | "shop";

type BottomNavProps = {
  active?: BottomNavKey | null;
  onChange?: (key: BottomNavKey) => void;
  requireAuth?: boolean;
  inFlow?: boolean;
};

const allItems = [
  {
    key: "home",
    label: "ڕێزبەندی",
    icon: "game-controller",
    href: "/play",
  },

  {
    key: "aznif",
    label: "ئەزنیف",
    icon: "cash",
    href: "/aznif",
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
] as const;

const items = allItems.filter(
  (item) =>
    ENABLE_SHOP_FEATURES ||
    item.key !== "shop"
);

export function BottomNav({
  active: controlledActive,
  onChange,
  requireAuth = false,
  inFlow = false,
}: BottomNavProps) {
  const pathname = usePathname();

  const [dailyGiftVisible, setDailyGiftVisible] =
    useState(false);

  const [dailyQuestsVisible, setDailyQuestsVisible] =
    useState(false);

  const dailyGift = useDailyGift();
  const dailyQuests = useDailyQuests();
  const { userId } = useAuthState();
  const {
    party,
    cancelParty,
    cancellingParty,
    partyError,
  } = useGameParty();

  const routeActive: BottomNavKey =
    pathname.includes("leaderboard")
      ? "leaderboard"
      : ENABLE_SHOP_FEATURES &&
          pathname.includes("shop")
        ? "shop"
        : pathname.includes("aznif")
          ? "aznif"
          : "home";

  const active =
    controlledActive === undefined
      ? routeActive
      : controlledActive;

  const handlePress = (
    key: BottomNavKey,
    href: (typeof items)[number]["href"]
  ) => {
    if (onChange) {
      onChange(key);
      return;
    }

    if (requireAuth && key !== "home") {
      router.push("/login");
      return;
    }

    router.push(href);
  };

  return (
    <>
      <View style={[styles.wrapper, !inFlow && styles.overlay]}>
        <View style={styles.row}>
          {party && userId ? (
            <GamePartyChip
              party={party}
              currentUserId={userId}
              cancelling={cancellingParty}
              error={partyError}
              onCancel={() => void cancelParty()}
            />
          ) : null}

          {/* Daily Gift Button */}

          <DailyGiftButton
            canClaim={dailyGift.status?.canClaim}
            onPress={() => {
              setDailyGiftVisible(true);
              void dailyGift.refresh();
            }}
          />

          <DailyQuestsButton
            claimableCount={dailyQuests.claimableCount}
            onPress={() => {
              setDailyQuestsVisible(true);
              void dailyQuests.refresh();
            }}
          />

          {/* Main Navigation */}

          <View style={styles.container}>
            {items.map((item) => {
              const isActive =
                active === item.key;

              return (
                <Pressable
                  key={item.key}
                  onPress={() =>
                    handlePress(
                      item.key,
                      item.href
                    )
                  }
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.item,
                    isActive &&
                      styles.activeItem,
                    pressed &&
                      styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={15}
                    color={
                      isActive
                        ? "#ffffff"
                        : "rgba(255,255,255,0.52)"
                    }
                  />

                  <Text
                    style={[
                      styles.text,
                      isActive
                        ? styles.activeText
                        : styles.inactiveText,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <DailyGiftModal
        visible={dailyGiftVisible}
        statuses={dailyGift.status?.statuses}
        nextResetAt={dailyGift.status?.nextResetAt}
        claiming={dailyGift.claiming}
        onClaim={dailyGift.claim}
        onClose={() =>
          setDailyGiftVisible(false)
        }
      />

      <DailyQuestsModal
        visible={dailyQuestsVisible}
        quests={dailyQuests.status?.quests}
        nextResetAt={dailyQuests.status?.nextResetAt}
        loading={dailyQuests.loading}
        error={dailyQuests.error}
        claimingId={dailyQuests.claimingId}
        onClaim={dailyQuests.claim}
        onRetry={dailyQuests.refresh}
        onClose={() =>
          setDailyQuestsVisible(false)
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    zIndex: 999,
    elevation: 20,
  },

  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
  },

  row: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },

  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      "rgba(180,120,255,0.18)",

    backgroundColor:
      "rgba(12,10,30,0.88)",
  },

  item: {
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  activeItem: {
    backgroundColor:
      "rgba(150,90,255,0.22)",

    borderWidth: 1,
    borderColor:
      "rgba(190,140,255,0.35)",
  },

  pressed: {
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
    color:
      "rgba(255,255,255,0.52)",
  },
});
