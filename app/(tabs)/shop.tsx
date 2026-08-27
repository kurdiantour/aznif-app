import {
  MOCK_SHOP_ITEMS,
  SHOP_CATEGORIES,
  type MockShopItem,
  type ShopCategory,
} from "@/constants/shop";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect } from "expo-router";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getMyShopState, purchaseOrEquipShopItem } from "@/lib/shop";
import { ENABLE_SHOP_FEATURES } from "@/lib/platformFeatures";
import { useWallet } from "@/lib/wallet-context";
import { ShopPopupContext } from "@/components/shop/InsufficientGemsPopup";

function ItemPreview({ item }: { item: MockShopItem }) {
  const { category } = item;

  if (category === "tables") {
    return (
      <Image
        source={item.images.shopPreview}
        style={styles.preview}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />
    );
  }

  if (category === "domino-skins" && item.previewImage) {
    return (
      <Image
        source={item.previewImage}
        style={styles.preview}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />
    );
  }

  const { preview } = item;

  return (
    <LinearGradient colors={preview.colors} style={styles.preview}>
      {category === "domino-skins" ? (
        <View style={styles.dominoPreviewRow}>
          {[0, 1, 2].map((tile) => (
            <View
              key={tile}
              style={[
                styles.dominoPreviewTile,
                { borderColor: preview.accent },
              ]}
            >
              <View
                style={[
                  styles.dominoDivider,
                  { backgroundColor: preview.accent },
                ]}
              />
              <View style={[styles.pip, { backgroundColor: preview.accent }]} />
              {tile !== 0 ? (
                <View
                  style={[
                    styles.pip,
                    styles.pipLower,
                    { backgroundColor: preview.accent },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.coverPreview}>
          <View
            style={[styles.coverGlow, { backgroundColor: preview.accent }]}
          />
          <View style={[styles.coverAvatar, { borderColor: preview.accent }]} />
          <View
            style={[styles.coverLine, { backgroundColor: preview.accent }]}
          />
        </View>
      )}
    </LinearGradient>
  );
}

function ShopContent() {
  const { refreshWallet } = useWallet();
  const [category, setCategory] = useState<ShopCategory>("tables");
  const [ownedItemIds, setOwnedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [equipped, setEquipped] = useState<
    Partial<Record<ShopCategory, string>>
  >({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const { showInsufficientGems, showPurchaseConfirmation } =
    useContext(ShopPopupContext);
  const items = useMemo(
    () => MOCK_SHOP_ITEMS.filter((item) => item.category === category),
    [category],
  );

  const refreshShopState = useCallback(async () => {
    const nextState = await getMyShopState();
    setOwnedItemIds(nextState.ownedItemIds);
    setEquipped(nextState.equippedByCategory);
  }, []);

  useEffect(() => {
    void refreshShopState().catch((error) =>
      console.warn("Unable to load Shop state", error),
    );
  }, [refreshShopState]);

  async function purchaseOrEquipItem(item: MockShopItem) {
    if (busyItemId) return;

    setBusyItemId(item.id);
    try {
      const result = await purchaseOrEquipShopItem(item.id);
      if (result.status === "insufficient_gems") {
        showInsufficientGems();
        return;
      }

      await refreshShopState();
      void refreshWallet();
    } catch (error) {
      console.warn("Unable to purchase or equip Shop item", error);
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleItemAction(item: MockShopItem) {
    if (busyItemId) return;

    if (ownedItemIds.has(item.id) || item.price === 0) {
      void purchaseOrEquipItem(item);
      return;
    }

    showPurchaseConfirmation({
      price: item.price,
      onConfirm: () => purchaseOrEquipItem(item),
    });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <View style={styles.sidebar}>
          {SHOP_CATEGORIES.map((tab) => {
            const active = tab.id === category;
            return (
              <Pressable
                key={tab.id}
                style={[styles.sidebarItem, active && styles.sidebarItemActive]}
                onPress={() => setCategory(tab.id)}
              >
                <Text
                  style={[
                    styles.categoryText,
                    active && styles.categoryTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.content}>
          <View style={styles.grid}>
            {items.map((item) => {
              const isEquipped = equipped[item.category] === item.id;
              const isOwned = ownedItemIds.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  disabled={busyItemId !== null}
                  onPress={() => handleItemAction(item)}
                  accessibilityLabel={isOwned ? "ئایتمی کڕدراو" : "ئایتمی شۆپ"}
                  style={[styles.card, isEquipped && styles.cardEquipped]}
                >
                  <View style={styles.cardTopRow}>
                    <View style={styles.priceBadge}>
                      <Text style={styles.priceEmoji}>{"\u{1F48E}"}</Text>
                      <Text style={styles.priceText}>
                        {item.price === 0
                          ? "بەخۆڕایی"
                          : item.price.toLocaleString()}
                      </Text>
                    </View>
                    {isEquipped ? (
                      <View style={styles.equippedBadge}>
                        <Ionicons name="checkmark" size={13} color="#74f1a8" />
                        <Text style={styles.equippedLabel}>بەکارهاتووە</Text>
                      </View>
                    ) : null}
                  </View>
                  <ItemPreview item={item} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

    </View>
  );
}

export default function ShopScreen() {
  if (!ENABLE_SHOP_FEATURES) {
    return <Redirect href="/(tabs)/play" />;
  }

  return <ShopContent />;
}

const styles = StyleSheet.create({
  priceEmoji: {
    fontSize: 12,
  },
  screen: { flex: 1 },
  walletSummary: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    paddingBottom: 10,
  },
  walletPill: {
    height: 34,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(7,9,19,0.58)",
  },
  walletText: { color: "#fff", fontSize: 12, fontFamily: "RobotoMedium" },
  body: { flex: 1, flexDirection: "row", gap: 12, paddingBottom: 82 },
  sidebar: { width: 150, gap: 10, paddingTop: 2 },
  sidebarItem: {
    height: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarItemActive: {
    borderColor: "rgba(255,184,64,0.85)",
    backgroundColor: "rgba(28,17,52,0.35)",
  },
  categoryText: {
    color: "#c6c9d8",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  categoryTextActive: { color: "#fff" },
  content: { flex: 1 },
  grid: { flexDirection: "row", gap: 8 },
  card: {
    width: "31.3%",
    minHeight: 205,
    overflow: "hidden",
    borderRadius: 14,
    padding: 8,
    borderWidth: 1.2,
    borderColor: "rgba(180,120,255,0.42)",
    backgroundColor: "rgba(17,24,39,0.82)",
  },
  cardEquipped: { borderColor: "rgba(110,231,183,0.82)" },
  cardTopRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 1,
  },
  priceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(230,238,255,0.34)",
    backgroundColor: "rgba(7,9,19,0.76)",
  },
  priceText: { color: "#f7d979", fontSize: 10, fontFamily: "RobotoMedium" },
  equippedBadge: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(29,112,78,0.28)",
  },
  equippedLabel: { color: "#bdf9d1", fontSize: 9, fontFamily: "SpedaBold" },
  preview: {
    height: 165,
    marginTop: 7,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  dominoPreviewRow: { flexDirection: "row", alignItems: "center" },
  dominoPreviewTile: {
    width: 23,
    height: 43,
    marginHorizontal: -2,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: 1.5,
    alignItems: "center",
    paddingTop: 7,
  },
  dominoDivider: {
    position: "absolute",
    left: 3,
    right: 3,
    top: 20,
    height: 1,
    opacity: 0.7,
  },
  pip: { width: 4, height: 4, borderRadius: 3, opacity: 0.85 },
  pipLower: { position: "absolute", bottom: 7 },
  coverPreview: {
    width: "78%",
    height: "63%",
    overflow: "hidden",
    borderRadius: 10,
    backgroundColor: "rgba(2,6,23,0.2)",
    padding: 9,
    justifyContent: "flex-end",
  },
  coverGlow: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    top: -30,
    right: -14,
    opacity: 0.25,
  },
  coverAvatar: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 2,
    backgroundColor: "#10152a",
  },
  coverLine: {
    marginTop: 5,
    width: "58%",
    height: 4,
    borderRadius: 3,
    opacity: 0.8,
  },
});
