import {
  MOCK_SHOP_ITEMS,
  SHOP_CATEGORIES,
  type MockShopItem,
  type ShopCategory,
} from "@/constants/shop";
import { Ionicons } from "@expo/vector-icons";
import { FullWindowOverlay } from "react-native-screens";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect } from "expo-router";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Image as ReactNativeImage,
  type ImageSourcePropType,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getMyShopState, purchaseOrEquipShopItem } from "@/lib/shop";
import { ENABLE_SHOP_FEATURES } from "@/lib/platformFeatures";
import { useWallet } from "@/lib/wallet-context";
import { ShopPopupContext } from "@/components/shop/InsufficientGemsPopup";

function ItemPreview({
  item,
  onTablePreviewPress,
}: {
  item: MockShopItem;
  onTablePreviewPress: (source: ImageSourcePropType) => void;
}) {
  const { category } = item;

  if (category === "tables") {
    const { width, height } = ReactNativeImage.resolveAssetSource(
      item.images.shopPreview,
    );

    return (
      <Pressable
        onPress={() => onTablePreviewPress(item.images.shopPreview)}
        accessibilityRole="imagebutton"
        accessibilityLabel="پیشاندانی وێنە بە قەبارەی تەواو"
        style={[
          styles.preview,
          styles.tablePreview,
          { aspectRatio: width / height },
        ]}
      >
        <ExpoImage
          source={item.images.shopPreview}
          style={styles.tablePreviewImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={0}
        />
      </Pressable>
    );
  }

  if (category === "domino-skins" && item.previewImage) {
    return (
      <ExpoImage
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
  const [fullscreenPreview, setFullscreenPreview] =
    useState<ImageSourcePropType | null>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

        <ScrollView
          style={styles.content}
          contentContainerStyle={[
            styles.grid,
            category === "tables" && styles.tableGrid,
          ]}
          showsVerticalScrollIndicator={false}
        >
            {items.map((item) => {
              const isEquipped = equipped[item.category] === item.id;
              const isOwned = ownedItemIds.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  disabled={busyItemId !== null}
                  onPress={
                    item.category === "tables"
                      ? undefined
                      : () => handleItemAction(item)
                  }
                  accessibilityLabel={isOwned ? "ئایتمی کڕدراو" : "ئایتمی شۆپ"}
                  style={[
                    styles.card,
                    item.category === "tables" && styles.tableCard,
                    isEquipped && styles.cardEquipped,
                  ]}
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
                    {item.category === "tables" ? (
                      <Pressable
                        disabled={busyItemId !== null || isEquipped}
                        onPress={() => handleItemAction(item)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isEquipped
                            ? "بەکارهاتووە"
                            : isOwned
                              ? "کڕدراوە"
                              : "بیکڕە"
                        }
                        style={[
                          styles.tableAction,
                          !isOwned && styles.tableActionBuy,
                          isOwned && !isEquipped && styles.tableActionOwned,
                          isEquipped && styles.tableActionEquipped,
                        ]}
                      >
                        {isEquipped ? (
                          <Ionicons name="checkmark" size={13} color="#74f1a8" />
                        ) : null}
                        <Text style={styles.tableActionLabel}>
                          {isEquipped ? "بەکارهاتووە" : isOwned ? "کڕدراوە" : "بیکڕە"}
                        </Text>
                      </Pressable>
                    ) : isEquipped ? (
                      <View style={styles.equippedBadge}>
                        <Ionicons name="checkmark" size={13} color="#74f1a8" />
                        <Text style={styles.equippedLabel}>بەکارهاتووە</Text>
                      </View>
                    ) : null}
                  </View>
                  <ItemPreview
                    item={item}
                    onTablePreviewPress={setFullscreenPreview}
                  />
                </Pressable>
              );
            })}
        </ScrollView>
      </View>

      {fullscreenPreview ? (
        Platform.OS === "ios" ? (
          <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
            <View style={styles.fullscreenPreview}>
              <ExpoImage
                source={fullscreenPreview}
                style={styles.fullscreenPreviewImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
              />
              <Pressable
                onPress={() => setFullscreenPreview(null)}
                accessibilityRole="button"
                accessibilityLabel="داخستن"
                hitSlop={12}
                style={styles.fullscreenCloseButton}
              >
                <Ionicons name="close" size={34} color="#f8d774" />
              </Pressable>
            </View>
          </FullWindowOverlay>
        ) : (
          <Modal
            visible
            animationType="fade"
            onRequestClose={() => setFullscreenPreview(null)}
          >
            <View style={styles.fullscreenPreview}>
              <ExpoImage
                source={fullscreenPreview}
                style={styles.fullscreenPreviewImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
              />
              <Pressable
                onPress={() => setFullscreenPreview(null)}
                accessibilityRole="button"
                accessibilityLabel="داخستن"
                hitSlop={12}
                style={styles.fullscreenCloseButton}
              >
                <Ionicons name="close" size={34} color="#f8d774" />
              </Pressable>
            </View>
          </Modal>
        )
      ) : null}

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
  body: { flex: 1, flexDirection: "row", gap: 12 },
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
  content: { flex: 1, marginBottom: 63 },
  grid: { flexDirection: "row", gap: 8 },
  tableGrid: { flexWrap: "wrap" },
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
  tableCard: { width: "48.7%", minHeight: 0 },
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
  tableAction: {
    minWidth: 72,
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  tableActionBuy: {
    borderColor: "rgba(248,215,116,0.72)",
    backgroundColor: "rgba(120,77,18,0.38)",
  },
  tableActionOwned: {
    borderColor: "rgba(180,120,255,0.58)",
    backgroundColor: "rgba(89,48,145,0.32)",
  },
  tableActionEquipped: {
    borderColor: "rgba(110,231,183,0.62)",
    backgroundColor: "rgba(29,112,78,0.28)",
  },
  tableActionLabel: {
    color: "#f4f0ff",
    fontSize: 9,
    fontFamily: "SpedaBold",
  },
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
  tablePreview: {
    width: "100%",
    height: undefined,
  },
  tablePreviewImage: {
    width: "100%",
    height: "100%",
  },
  fullscreenPreview: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenPreviewImage: {
    width: "100%",
    height: "100%",
  },
  fullscreenCloseButton: {
    position: "absolute",
    top: 24,
    right: 24,
    zIndex: 1,
    elevation: 1,
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
