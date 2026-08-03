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

type GameCardProps = {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  image?: number;
  disabled?: boolean;
  badge?: string;
  isTablet?: boolean;
  onPress?: () => void;
};

function GameCard({
  title,
  subtitle,
  icon,
  image,
  disabled,
  badge,
  isTablet,
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
      onPress={disabled ? undefined : onPress}
    >
      {image ? (
        <Image
          source={image}
          style={styles.cardImageInner}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <LinearGradient
          colors={["#1d1145", "#3b1676", "#090b1d"]}
          style={styles.cardImage}
        />
      )}

      {badge ? (
        <View
          style={[
            styles.comingSoonBadge,
            isTablet && styles.comingSoonBadgeTablet,
          ]}
        >
          <Text
            style={[
              styles.comingSoonText,
              isTablet && styles.comingSoonTextTablet,
            ]}
          >
            {badge}
          </Text>
        </View>
      ) : (
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={22} color="#f8d774" />
        </View>
      )}

      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.92)"]}
        style={[styles.bottomFade, isTablet && styles.bottomFadeTablet]}
      />

      <View style={[styles.cardInfo, isTablet && styles.cardInfoTablet]}>
        <Text style={[styles.cardTitle, isTablet && styles.cardTitleTablet]}>
          {title}
        </Text>
        <Text
          style={[styles.cardSubtitle, isTablet && styles.cardSubtitleTablet]}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

export default function PlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  return (
    <View style={[styles.content, isTablet && styles.contentTablet]}>
      <View style={[styles.cardRow, isTablet && styles.cardRowTablet]}>
        <GameCard
          isTablet={isTablet}
          title="Domino"
          subtitle="Lobby, 1v1, 2v2, and private rooms."
          icon="grid-outline"
          image={require("@/assets/images/lobby/create-room.webp")}
          onPress={() => router.push("/(tabs)/lobby")}
        />

        <GameCard
          isTablet={isTablet}
          title="ئۆکەی"
          subtitle="ئۆکەیی کلاسیک بە یاساکانی تەواوی نۆرە، مەڵد، خاڵ و بەرد."
          icon="ellipse-outline"
          image={require("@/assets/images/okey/lobby/okey-card.png")}
          onPress={() => router.push("/okey")}
        />

        <View style={[styles.card, styles.cardPlaceholder, isTablet && styles.cardTablet]} />
        <View style={[styles.card, styles.cardPlaceholder, isTablet && styles.cardTablet]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    width: "100%",
    height: "80%",
    maxHeight: 238,
    minHeight: 205,
    justifyContent: "center",
    marginTop: 0,
  },
  contentTablet: {
    width: "100%",
    height: "72%",
    maxHeight: 520,
    minHeight: 390,
    marginTop: 12,
  },
  cardRow: {
    width: "100%",
    height: "100%",
    alignSelf: "center",
    flexDirection: "row-reverse",
    
    gap: 8,
  },
  cardRowTablet: {
    gap: 18,
  },
  card: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1.2,
    borderColor: "rgba(180,120,255,0.42)",
    backgroundColor: "rgba(17,24,39,0.82)",
  },
  cardTablet: {
    borderRadius: 18,
    borderWidth: 1.4,
  },
  cardDisabled: {
    opacity: 0.65,
  },
  cardPlaceholder: {
    opacity: 0,
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
    top: 12,
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
  comingSoonBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(88, 28, 135, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(233, 213, 255, 0.55)",
  },
  comingSoonBadgeTablet: {
    top: 16,
    right: 16,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  comingSoonText: {
    color: "#f3e8ff",
    fontSize: 8,
    fontFamily: "SpedaBold",
  },
  comingSoonTextTablet: {
    fontSize: 11,
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
});