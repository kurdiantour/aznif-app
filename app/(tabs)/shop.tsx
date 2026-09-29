import { getAuthState, subscribeAuthState } from "@/lib/auth-state";
import {
  SHOP_CATEGORIES,
  type ShopCategory,
} from "@/constants/shop";
import { Ionicons } from "@expo/vector-icons";
import { FullWindowOverlay } from "react-native-screens";
import { Image as ExpoImage } from "expo-image";
import { Redirect } from "expo-router";
import { useContext, useEffect, useMemo, useState } from "react";
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
import { purchaseOrEquipShopItem } from "@/lib/shop";
import { ENABLE_SHOP_FEATURES } from "@/lib/platformFeatures";
import { useWallet } from "@/lib/wallet-context";
import { ShopPopupContext } from "@/components/shop/InsufficientGemsPopup";
import {
  getShopDisplayItems,
  type ShopDisplayItem,
} from "@/constants/catalog/cosmetics";
import { useShopState } from "@/hooks/useShopState";

function ItemPreview({
  item,
  onTablePreviewPress,
}: {
  item: ShopDisplayItem;
  onTablePreviewPress: (source: ImageSourcePropType) => void;
}) {
  const { width, height } = ReactNativeImage.resolveAssetSource(
    item.images.shopPreview,
  );
  return (
    <Pressable
      onPress={() => onTablePreviewPress(item.images.shopPreview)}
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

function ShopContent() {
  const { refreshWallet } = useWallet();
  const [category, setCategory] = useState<ShopCategory>("tables");
  const { state, refresh: refreshShopState } = useShopState();
  const equipped = state?.equippedByCategory ?? {};
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  useEffect(() => {
    let generation = getAuthState().generation;
    return subscribeAuthState(() => {
      if (generation === getAuthState().generation) {
        return;
      }
      generation = getAuthState().generation;
      setBusyItemId(null);
    });
  }, []);
  const [fullscreenPreview, setFullscreenPreview] = useState<ImageSourcePropType | null>(null);
  const { showPurchaseConfirmation } = useContext(ShopPopupContext);
  const items = useMemo(
    () => getShopDisplayItems(state).filter((item) => item.category === category),
    [state, category],
  );
  async function purchaseOrEquipItem(
    item: ShopDisplayItem,
    expectedPrice: number | null = null,
  ) {
    if (busyItemId) return;
    const requestAuth = getAuthState();
    setBusyItemId(item.id);
    try {
      const result = await purchaseOrEquipShopItem(item.id, expectedPrice);
      if (getAuthState().generation !== requestAuth.generation) {
        return;
      }
      if (result.status === "insufficient_gems") {
        await refreshWallet();
        if (
          getAuthState().generation === requestAuth.generation &&
          expectedPrice !== null
        ) {
          showPurchaseConfirmation({
            price: expectedPrice,
            onConfirm: () => purchaseOrEquipItem(item, expectedPrice),
          });
        }
        return;
      }
      await refreshShopState();
      if (getAuthState().generation === requestAuth.generation) {
        void refreshWallet();
      }
    } catch (error) {
      if (getAuthState().generation !== requestAuth.generation) {
        return;
      }
      console.warn("Unable to purchase or equip Shop item", error);
    } finally {
      if (getAuthState().generation === requestAuth.generation) {
        setBusyItemId(null);
      }
    }
  }
  async function handleItemAction(item: ShopDisplayItem) {
    if (busyItemId) return;
    if (item.access_kind !== null) {
      void purchaseOrEquipItem(item);
      return;
    }
    if (item.price_gem === null || !item.sale_available) {
      return;
    }
    const expectedPrice = item.price_gem;
    showPurchaseConfirmation({
      price: expectedPrice,
      onConfirm: () => purchaseOrEquipItem(item, expectedPrice),
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
                style={[
                  styles.sidebarItem,
                  active &&
                    styles.sidebarItemActive,
                ]}
                onPress={() => setCategory(tab.id)}
              >
                <Text
                  style={[
                    styles.categoryText,
                    active &&
                      styles.categoryTextActive,
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
            styles.tableGrid,
          ]}
          showsVerticalScrollIndicator={
            false
          }
        >
          {items.map((item) => {
            const isEquipped = equipped[item.category] === item.id;
            const isOwned = item.owned || item.is_default;
            const canUse = item.access_kind !== null;
            return (
              <Pressable
                key={item.id}
                disabled={busyItemId !== null}
                style={[
                  styles.card,
                  styles.tableCard,
                  isEquipped &&
                    styles.cardEquipped,
                ]}
              >
                <View style={styles.cardTopRow}>
                  {!isOwned && (
                    <View style={styles.priceBadge}>
                      <Text style={styles.priceEmoji}>
                        {"\u{1F48E}"}
                      </Text>
                      <Text style={styles.priceText}>
                        {item.access_kind ===
                        "temporary"
                          ? "بەخۆڕایی کاتی"
                          : item.price_gem ===
                              0
                            ? "بەخۆڕایی"
                            : item.price_gem?.toLocaleString() ??
                              "—"}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    disabled={busyItemId !== null || isEquipped}
                    onPress={() => handleItemAction(item)}
                    style={[
                      styles.tableAction,
                      !isOwned &&
                        styles.tableActionBuy,
                      isOwned &&
                        !isEquipped &&
                        styles.tableActionOwned,
                      isEquipped &&
                        styles.tableActionEquipped,
                    ]}
                  >
                    {isEquipped ? (
                      <Ionicons
                        name="checkmark"
                        size={13}
                        color="#74f1a8"
                      />
                    ) : null}
                    <Text style={styles.tableActionLabel}>
                      {isEquipped
                        ? "بەکارهاتووە"
                        : item.is_default
                          ? "بەخۆڕایی"
                          : isOwned
                            ? "کڕدراوە"
                            : canUse
                              ? "بەکاری بهێنە"
                              : "بیکڕە"}
                    </Text>
                  </Pressable>
                </View>
                <ItemPreview item={item} onTablePreviewPress={setFullscreenPreview} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {fullscreenPreview ? (
        Platform.OS === "ios" ? (
          <FullWindowOverlay>
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
                hitSlop={12}
                style={styles.fullscreenCloseButton}
              >
                <Ionicons
                  name="close"
                  size={34}
                  color="#f8d774"
                />
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
                hitSlop={12}
                style={styles.fullscreenCloseButton}
              >
                <Ionicons
                  name="close"
                  size={34}
                  color="#f8d774"
                />
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
    return (
      <Redirect href="/(tabs)/play" />
    );
  }
  return <ShopContent />;
}

const styles = StyleSheet.create({
  priceEmoji: {
    fontSize: 12,
  },
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    gap: 12,
  },
  sidebar: {
    width: 150,
    gap: 10,
    paddingTop: 2,
  },
  sidebarItem: {
    height: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarItemActive: {
    borderColor:
      "rgba(255,184,64,0.85)",
    backgroundColor:
      "rgba(28,17,52,0.35)",
  },
  categoryText: {
    color: "#c6c9d8",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  categoryTextActive: {
    color: "#fff",
  },
  content: {
    flex: 1,
    marginBottom: 63,
  },
  grid: {
    flexDirection: "row",
    gap: 8,
  },
  tableGrid: {
    flexWrap: "wrap",
  },
  card: {
    width: "31.3%",
    minHeight: 205,
    overflow: "hidden",
    borderRadius: 14,
    padding: 8,
    borderWidth: 1.2,
    borderColor:
      "rgba(180,120,255,0.42)",
    backgroundColor:
      "rgba(17,24,39,0.82)",
  },
  tableCard: {
    width: "48.7%",
    minHeight: 0,
  },
  cardEquipped: {
    borderColor:
      "rgba(110,231,183,0.82)",
  },
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
    borderColor:
      "rgba(230,238,255,0.34)",
    backgroundColor:
      "rgba(7,9,19,0.76)",
  },
  priceText: {
    color: "#f7d979",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },
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
    borderColor:
      "rgba(248,215,116,0.72)",
    backgroundColor:
      "rgba(120,77,18,0.38)",
  },
  tableActionOwned: {
    borderColor:
      "rgba(180,120,255,0.58)",
    backgroundColor:
      "rgba(89,48,145,0.32)",
  },
  tableActionEquipped: {
    borderColor:
      "rgba(110,231,183,0.62)",
    backgroundColor:
      "rgba(29,112,78,0.28)",
  },
  tableActionLabel: {
    color: "#f4f0ff",
    fontSize: 9,
    fontFamily: "SpedaBold",
  },
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
});