import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { formatAznif } from "@/lib/aznif-display";
import { useWallet } from "@/lib/wallet-context";

type GameCardProps = {
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  image?: any;
  disabled?: boolean;
  isTablet?: boolean;
  showComingSoonClock?: boolean;
  onPress?: () => void;
};

function GameCard({
  title,
  subtitle,
  icon,
  image,
  disabled = false,
  isTablet = false,
  showComingSoonClock = false,
  onPress,
}: GameCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        isTablet && styles.cardTablet,
        disabled && styles.cardDisabled,
        pressed && !disabled && styles.cardPressed,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      {image ? (
        <View style={styles.cardImage}>
          <Image
            source={image}
            style={styles.cardImageInner}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="high"
            transition={0}
          />
        </View>
      ) : (
        <LinearGradient
          colors={["#1d1145", "#3b1676", "#090b1d"]}
          style={styles.cardImage}
        />
      )}

      {showComingSoonClock ? (
        <View style={styles.clockBox}>
          <Ionicons name="time-outline" size={20} color="#e9d5ff" />
        </View>
      ) : (
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={22} color="#f8d774" />
        </View>
      )}

      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.92)"]}
        style={[styles.bottomFade, isTablet && styles.bottomFadeTablet]}
        pointerEvents="none"
      />

      <View
        style={[styles.cardInfo, isTablet && styles.cardInfoTablet]}
        pointerEvents="none"
      >
        <Text style={[styles.cardTitle, isTablet && styles.cardTitleTablet]}>
          {title}
        </Text>

        {!!subtitle && (
          <Text
            style={[
              styles.cardSubtitle,
              isTablet && styles.cardSubtitleTablet,
            ]}
          >
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export default function AznifPlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { aznifBalance } = useWallet();
  const balanceText = aznifBalance !== null ? formatAznif(aznifBalance) : "0";

  const isTablet = Math.min(width, height) >= 600;

  return (
    <View style={styles.screenWrapper}>
      <View style={[styles.content, isTablet && styles.contentTablet]}>
        <View style={[styles.cardRow, isTablet && styles.cardRowTablet]}>
          <GameCard
            isTablet={isTablet}
            title="دۆمینۆ"
            subtitle="توانای خۆت بسەلمێنە"
            icon="grid-outline"
            image={require("@/assets/images/lobby/aznft/dominoaznifcard.webp")}
            onPress={() => router.push("/domino/aznif")}
          />

          <GameCard
            isTablet={isTablet}
            title="ئۆکەی"
            subtitle="توانای خۆت بسەلمێنە"
            icon="ellipse-outline"
            image={require("@/assets/images/lobby/aznft/okeyaznifcard.webp")}
            onPress={() => router.push("/okey/aznif")}
          />

          <View
            style={[
              styles.freeBalanceContainer,
              isTablet && styles.freeBalanceContainerTablet,
            ]}
          >
            <Text style={[styles.freeIcon, isTablet && styles.freeIconTablet]}>
              ✨
            </Text>
            <Text style={[styles.freeLabel, isTablet && styles.freeLabelTablet]}>
              ئەزنیف
            </Text>
            <Text style={[styles.freeValue, isTablet && styles.freeValueTablet]} adjustsFontSizeToFit numberOfLines={1}>
              {balanceText}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    width: "100%",
  },

  clockBox: {
    position: "absolute",
    top: 10,
    right: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.55)",
    backgroundColor: "rgba(15, 11, 42, 0.72)",
    shadowColor: "#a855f7",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 5,
  },

  content: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    justifyContent: "center",
  },

  contentTablet: {
    width: "100%",
  },

  cardRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 8,
  },

  cardRowTablet: {
    gap: 18,
  },

  card: {
    width: 200,
    height: 250,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(87, 63, 117, 0.5)",
    backgroundColor: "rgba(17,24,39,0.82)",
  },

  cardTablet: {
    width: 240,
    height: 300,
    borderRadius: 12,
    borderWidth: 1.4,
  },

  cardDisabled: {
    opacity: 0.65,
  },

  cardPressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.9,
  },

  cardImage: {
    width: "100%",
    height: "100%",
  },

  cardImageInner: {
    width: "100%",
    height: "100%",
  },

  iconBox: {
    position: "absolute",
    top: 10,
    right: 12,
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.32)",
    backgroundColor: "rgba(2, 6, 23, 0.62)",
  },

  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
  },

  bottomFadeTablet: {
    height: 125,
  },

  cardInfo: {
    position: "absolute",
    left: 15,
    right: 15,
    bottom: 12,
    alignItems: "center",
  },

  cardInfoTablet: {
    left: 20,
    right: 20,
    bottom: 18,
  },

  cardTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  cardTitleTablet: {
    fontSize: 24,
  },

  cardSubtitle: {
    marginTop: 5,
    color: "#f3f4f6",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  cardSubtitleTablet: {
    marginTop: 8,
    fontSize: 16,
  },

  freeBalanceContainer: {
    width: 408,
    height: 250,
    justifyContent: "center",
    alignItems: "center",
  },

  freeBalanceContainerTablet: {
    width: 498,
    height: 300,
    justifyContent: "center",
    alignItems: "center",
  },

  freeIcon: {
    fontSize: 32,
    textAlign: "center",
    width: "100%",
    marginBottom: 6,
  },

  freeIconTablet: {
    fontSize: 48,
    marginBottom: 10,
  },

  freeLabel: {
    color: "#e9d5ff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    marginBottom: 8,
    textAlign: "center",
    width: "100%",
  },

  freeLabelTablet: {
    fontSize: 20,
    marginBottom: 12,
  },

  freeValue: {
    color: "#ffd674",
    fontSize: 20,
    fontFamily: "RobotoMedium",
    textAlign: "center",
    width: "100%",
  },

  freeValueTablet: {
    fontSize: 32,
  },
});
