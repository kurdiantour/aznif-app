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

import { ConsentModal } from "@/components/leaderboard/ConsentModal";

type GameCardProps = {
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  image?: number;
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

export default function PlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  const isTablet = Math.min(width, height) >= 600;

  return (
    <View style={styles.screenWrapper}>
      {__DEV__ && (
        <View style={styles.devButtonsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.devButton,
              pressed && styles.devButtonPressed,
            ]}
            onPress={() => router.push("/okey/preview")}
          >
            <Ionicons name="flask-outline" size={12} color="#f8d774" />
            <Text style={styles.devButtonText}>Okey Preview</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.devButton,
              pressed && styles.devButtonPressed,
            ]}
            onPress={() => router.push("/domino/preview")}
          >
            <Ionicons name="flask-outline" size={12} color="#f8d774" />
            <Text style={styles.devButtonText}>Domino 2v2 Preview</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.content, isTablet && styles.contentTablet]}>
        <View style={[styles.cardRow, isTablet && styles.cardRowTablet]}>
          <GameCard
            isTablet={isTablet}
            title="ئەزنیف"
            subtitle="توانای خۆت بسەلمێنە"
            icon="grid-outline"
            image={require("@/assets/images/lobby/aznif-card-v3.png")}
            onPress={() => router.push("/domino")}
          />

          <GameCard
            isTablet={isTablet}
            title="ئۆکەی"
            subtitle="توانای خۆت بسەلمێنە"
            icon="ellipse-outline"
            image={require("@/assets/images/okey/lobby/okey-card.png")}
            onPress={() => router.push("/okey")}
          />

          <GameCard
            isTablet={isTablet}
            title="تاولە"
            subtitle="بەم زووانە"
            icon="cube-outline"
            image={require("@/assets/images/lobby/backgammon-card.png")}
            disabled={true}
            showComingSoonClock={true}
          />

          <GameCard
            isTablet={isTablet}
            title="دامە"
            subtitle="بەم زووانە"
            icon="grid-outline"
            image={require("@/assets/images/lobby/dame-card.png")}
            disabled={true}
            showComingSoonClock={true}
          />
        </View>

        <ConsentModal />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    width: "100%",
  },

  devButtonsRow: {
    position: "absolute",
    top: -12,
    right: 0,
    flexDirection: "row",
    gap: 8,
    zIndex: 10,
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
    // Glow effect matching Aznif purple
    shadowColor: "#a855f7",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 5,
  },

  devButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.35)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },

  devButtonPressed: {
    opacity: 0.7,
  },

  devButtonText: {
    color: "#e9d5ff",
    fontSize: 10,
    fontFamily: "SpedaBold",
    marginLeft: 4,
  },

  content: {
    alignSelf: "center",
    width: "100%",
    height: "80%",
    maxHeight: 240,
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
    borderRadius: 12,
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
});
