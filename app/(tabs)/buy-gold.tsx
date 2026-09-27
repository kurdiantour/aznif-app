import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getAvailableGemPackages } from "@/lib/commerce-data";

export default function BuyGoldScreen() {
  const packages = getAvailableGemPackages();

  const handlePurchase = (productId: string) => {
    // Placeholder for future IAP logic
    console.log("Initiating purchase for product:", productId);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.packages}
      >
        {packages.map((item) => {
          const isPopular = item.badge === "POPULAR";

          const hasBonusOffer =
            item.hasActiveOffer &&
            item.offerType === "BONUS_GEMS" &&
            item.bonusAmount > 0;

          return (
            <View
              key={item.id}
              style={[
                styles.cardOuter,
                isPopular && styles.cardOuterPopular,
              ]}
            >
              {isPopular ? (
                <View style={styles.popularBadge}>
                  <Ionicons
                    name="star"
                    size={10}
                    color="#ffffff"
                  />

                  <Text style={styles.popularText}>
                    بەناوبانگترین
                  </Text>
                </View>
              ) : null}

              <LinearGradient
                colors={
                  isPopular
                    ? [
                        "rgba(116,49,184,0.72)",
                        "rgba(40,18,75,0.96)",
                      ]
                    : [
                        "rgba(42,25,78,0.92)",
                        "rgba(14,14,36,0.98)",
                      ]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                {hasBonusOffer ? (
                  <View style={styles.bonusBadge}>
                    <Ionicons
                      name="gift"
                      size={10}
                      color="#86efac"
                    />

                    <Text style={styles.bonusText}>
                      +{item.bonusAmount.toLocaleString()}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.bonusPlaceholder} />
                )}

                <View
                  style={[
                    styles.gemGlow,
                    isPopular && styles.gemGlowPopular,
                  ]}
                >
                  <Text
                    style={[
                      styles.gemEmoji,
                      isPopular && styles.gemEmojiPopular,
                    ]}
                  >
                    💎
                  </Text>
                </View>

                <View style={styles.amountBlock}>
                  <Text style={styles.gemAmount}>
                    {item.baseGems.toLocaleString()}
                  </Text>

                  <Text style={styles.gemLabel}>
                    گەوهەر
                  </Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.finalGems} gems $${item.finalPriceUsd}`}
                  onPress={() => {
                    handlePurchase(item.id);
                  }}
                  style={({ pressed }) => [
                    styles.buyButton,
                    isPopular && styles.buyButtonPopular,
                    pressed && styles.buyButtonPressed,
                  ]}
                >
                  <LinearGradient
                    colors={
                      isPopular
                        ? ["#8b5cf6", "#6d28d9"]
                        : [
                            "rgba(255,255,255,0.12)",
                            "rgba(255,255,255,0.07)",
                          ]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.buyButtonGradient}
                  >
                    {item.hasActiveOffer &&
                    item.offerType === "PRICE_DISCOUNT" ? (
                      <View style={styles.discountPriceRow}>
                        <Text style={styles.originalPriceText}>
                          ${item.originalPriceUsd.toFixed(2)}
                        </Text>

                        <Text style={styles.priceText}>
                          ${item.finalPriceUsd.toFixed(2)}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.priceText}>
                        ${item.finalPriceUsd.toFixed(2)}
                      </Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </LinearGradient>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Ionicons
          name="shield-checkmark-outline"
          size={13}
          color="#8792b5"
        />

        <Text style={styles.footerText}>
          پارەدان بە شێوەیەکی پارێزراو ئەنجام دەدرێت
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 28,
  },

  packages: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },

  cardOuter: {
    width: 132,
    height: 194,
    position: "relative",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(168,85,247,0.22)",
  },

  cardOuterPopular: {
    width: 142,
    height: 204,
    borderColor: "rgba(192,132,252,0.75)",
    shadowColor: "#a855f7",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: {
      width: 0,
      height: 5,
    },
    elevation: 8,
  },

  card: {
    flex: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingTop: 11,
    paddingBottom: 10,
    alignItems: "center",
    overflow: "hidden",
  },

  popularBadge: {
    position: "absolute",
    zIndex: 5,
    top: -9,
    alignSelf: "center",
    height: 21,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: "#7c3aed",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
  },

  popularText: {
    color: "#ffffff",
    fontSize: 8,
    fontFamily: "SpedaBold",
  },

  bonusBadge: {
    alignSelf: "center",
    minWidth: 54,
    height: 21,
    paddingHorizontal: 8,
    borderRadius: 10.5,
    backgroundColor: "rgba(34,197,94,0.14)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.24)",
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },

  bonusPlaceholder: {
    height: 21,
  },

  bonusText: {
    color: "#86efac",
    fontSize: 11,
    fontFamily: "RobotoMedium",
  },

  gemGlow: {
    width: 58,
    height: 58,
    marginTop: 5,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168,85,247,0.10)",
    borderWidth: 1,
    borderColor: "rgba(192,132,252,0.12)",
  },

  gemGlowPopular: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(168,85,247,0.17)",
    borderColor: "rgba(216,180,254,0.22)",
  },

  gemEmoji: {
    fontSize: 31,
  },

  gemEmojiPopular: {
    fontSize: 35,
  },

  amountBlock: {
    marginTop: 5,
    alignItems: "center",
    justifyContent: "center",
  },

  gemAmount: {
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },

  gemLabel: {
    marginTop: 1,
    color: "#d8b4fe",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  buyButton: {
    width: "100%",
    height: 32,
    marginTop: "auto",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  buyButtonPopular: {
    borderColor: "rgba(216,180,254,0.30)",
  },

  buyButtonPressed: {
    opacity: 0.72,
  },

  buyButtonGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  discountPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  originalPriceText: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "RobotoMedium",
    textDecorationLine: "line-through",
    opacity: 0.6,
  },

  priceText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "RobotoMedium",
  },

  footer: {
    minHeight: 22,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },

  footerText: {
    color: "#737d9e",
    fontSize: 8,
    fontFamily: "SpedaBold",
  },
});