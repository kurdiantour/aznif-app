import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

type GameCardProps = {
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  image?: number;
  centerImage?: number;
  centerImageFullCard?: boolean;
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
  centerImage,
  centerImageFullCard = false,
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

      {centerImage && (
        <View style={styles.centerImageWrapper} pointerEvents="none">
          <Image
            source={centerImage}
            style={[
              styles.centerImage,
              centerImageFullCard && styles.centerImageFullCard,
              !centerImageFullCard && isTablet && styles.centerImageTablet,
            ]}
            contentFit={centerImageFullCard ? "cover" : "contain"}
            cachePolicy="memory-disk"
            priority="high"
            transition={0}
          />
        </View>
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

type TournamentCardProps = {
  isTablet?: boolean;
  onPress?: () => void;
};

function TournamentCard({
  isTablet = false,
  onPress,
}: TournamentCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="تۆڕنامەنت"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles.tournamentCard,
        isTablet && styles.cardTablet,
        pressed && styles.cardPressed,
      ]}
    >
      <LinearGradient
        colors={["#090817", "#22103f", "#4a176f", "#10091f"]}
        locations={[0, 0.34, 0.7, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        colors={["transparent", "rgba(4,2,10,0.96)"]}
        style={[styles.bottomFade, isTablet && styles.bottomFadeTablet]}
        pointerEvents="none"
      />

      <View
        style={[
          styles.cardInfo,
          styles.tournamentCardInfo,
          isTablet && styles.cardInfoTablet,
        ]}
        pointerEvents="none"
      >
        <Text
          style={[
            styles.cardTitle,
            styles.tournamentTitle,
            isTablet && styles.cardTitleTablet,
          ]}
        >
          تۆڕنامەنت
        </Text>

        <Text
          style={[
            styles.cardSubtitle,
            styles.tournamentSubtitle,
            isTablet && styles.cardSubtitleTablet,
          ]}
        >
          پێشبڕکێ بکە و خەڵات ببەوە
        </Text>
      </View>

<View style={styles.iconBox} pointerEvents="none">
  <Ionicons name="trophy" size={22} color="#f8d774" />
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
        <View style={styles.previewActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Domino Preview"
            style={styles.previewButton}
            onPress={() => router.push("/domino/preview")}
          >
            <Text style={styles.previewButtonText}>Domino Preview</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Okey Preview"
            style={styles.previewButton}
            onPress={() => router.push("/okey/preview")}
          >
            <Text style={styles.previewButtonText}>Okey Preview</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.content, isTablet && styles.contentTablet]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cardScroll}
          contentContainerStyle={[
            styles.cardRow,
            isTablet && styles.cardRowTablet,
          ]}
        >
          <GameCard
            isTablet={isTablet}
            title="دۆمینۆ"
            subtitle="توانای خۆت بسەلمێنە"
            icon="grid-outline"
            image={require("@/assets/images/lobby/fun/aznif-card-v3.webp")}
            onPress={() => router.push("/domino/fun")}
          />

          <GameCard
            isTablet={isTablet}
            title="ئۆکەی"
            subtitle="توانای خۆت بسەلمێنە"
            icon="ellipse-outline"
            image={require("@/assets/images/lobby/fun/okey-card.webp")}
            onPress={() => router.push({ pathname: "/okey", params: { currency: "fun" } } as never)}
          />

          {/* Tournament card temporarily disabled – component preserved for future use
          <TournamentCard isTablet={isTablet} onPress={() => router.push("/tournament" as never)} />
          */}

          <GameCard
            isTablet={isTablet}
            title="دامە"
            subtitle="تێچوو 500 سکە"
            icon="grid-outline"
            centerImage={require("@/assets/images/lobby/fun/dama.webp")}
            centerImageFullCard
            onPress={() => router.push({ pathname: "/dama/game", params: { mode: "online" } })}
          />

          <GameCard
            isTablet={isTablet}
            title="تاولە"
            subtitle="بەم زووانە"
            icon="cube-outline"
            centerImage={require("@/assets/images/lobby/fun/tawla.webp")}
            disabled={true}
            showComingSoonClock={true}
          />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewActions: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 10,
    flexDirection: "row",
    gap: 8,
  },

  previewButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#3b1676",
  },

  previewButtonText: {
    color: "#fff",
    fontWeight: "600",
  },

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

  cardScroll: {
    flexGrow: 0,
    width: "100%",
  },

  cardRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 2,
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

  centerImageWrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  centerImage: {
    width: 115,
    height: 115,
    marginTop: -15,
  },

  centerImageTablet: {
    width: 172,
    height: 172,
    marginTop: -22,
  },

  centerImageFullCard: {
    width: "100%",
    height: "100%",
    marginTop: 0,
  },

  tournamentCard: {
    borderColor: "rgba(248,215,116,0.48)",
    backgroundColor: "#120a26",
    shadowColor: "#a855f7",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 10,
  },

  tournamentCardInfo: {
    bottom: 18,
  },

  tournamentTitle: {
    color: "#fff8df",
  },

  tournamentSubtitle: {
    color: "#e8dcff",
  },
});
