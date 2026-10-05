import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { useWallet } from "@/lib/wallet-context";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { DOMINO_ENTRY_FEES } from "@/constants/domino-economy";
import { useAuthState } from "@/lib/auth-state";
import { supabase } from "@/lib/supabase";

type GameMode = "1v1" | "2v2";
type MatchType = "duo" | "squad";

type FunCardProps = {
  title: string;
  subtitle: string;
  entry: number;
  gradientColors: readonly [string, string];
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconRepeat?: 1 | 2;
  isTablet: boolean;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
};

function FunCard({
  title,
  subtitle,
  entry,
  gradientColors,
  icon,
  iconRepeat = 1,
  isTablet,
  disabled,
  loading,
  onPress,
}: FunCardProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isTablet && styles.cardTablet,
        disabled && styles.cardDisabled,
        pressed && !disabled && styles.cardPressed,
      ]}
    >
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.cardShade} />

      {icon && (
        <View style={[styles.iconShell, isTablet && styles.iconShellTablet]}>
          {Array.from({ length: iconRepeat }, (_, index) => (
            <MaterialCommunityIcons
              key={`${icon}-${index}`}
              name={icon}
              size={iconRepeat === 2 ? (isTablet ? 28 : 22) : (isTablet ? 38 : 30)}
              color={icon.startsWith("account-") ? "#ffffff" : "#fff7d6"}
            />
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator
            size={isTablet ? "large" : "small"}
            color="#ffffff"
          />

          <Text
            style={[
              styles.searchingText,
              isTablet && styles.searchingTextTablet,
            ]}
          >
            گەڕان بۆ یاریزان...
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.cardInfo,
          isTablet && styles.cardInfoTablet,
        ]}
      >
        <Text
          style={[
            styles.cardTitle,
            isTablet && styles.cardTitleTablet,
          ]}
        >
          {title}
        </Text>

        <Text
          style={[
            styles.cardSubtitle,
            isTablet && styles.cardSubtitleTablet,
          ]}
        >
          {subtitle}
        </Text>
      </View>

      {entry > 0 ? (
        <View
          style={[
            styles.entryBox,
            isTablet && styles.entryBoxTablet,
          ]}
        >
          <Text
            style={[
              styles.entryCurrency,
              isTablet && styles.entryCurrencyTablet,
            ]}
          >
            تێچوو
          </Text>

          <Text
            style={[
              styles.entryAmount,
              isTablet && styles.entryAmountTablet,
            ]}
          >
            {entry.toLocaleString("en-US")} Coin
          </Text>

          <View
            style={[
              styles.coinDot,
              isTablet && styles.coinDotTablet,
            ]}
          />
        </View>
      ) : (
        <View
          style={[
            styles.entryBox,
            isTablet && styles.entryBoxTablet,
          ]}
        >
          <Text
            style={[
              styles.entryCurrency,
              isTablet && styles.entryCurrencyTablet,
            ]}
          >
            ڕاهێنان
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function DominoFunScreen() {
  const { userId, authReady } = useAuthState();


  const { coinBalance } = useWallet();

  const { width, height } = useWindowDimensions();

  const isTablet = Math.min(width, height) >= 600;

  const [searchingMode, setSearchingMode] =
    useState<GameMode | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const getMatchmakingError = (
    reason: unknown,
  ): string | null => {
    const message =
      reason instanceof Error
        ? reason.message
        : typeof (reason as { message?: unknown })?.message === "string"
          ? String((reason as { message: string }).message)
          : "";

    const normalized = message.toLowerCase();

    if (
      normalized.includes("network") ||
      normalized.includes("fetch")
    ) {
      return "پەیوەندی ئینتەرنێت هەڵەی تێدایە.";
    }

    return null;
  };

  const startPublicMatch = async (
    mode: GameMode,
    matchType: MatchType,
  ) => {
    if (searchingMode) {
      return;
    }

    if (!userId) {
      router.push("/login");
      return;
    }

    setSearchingMode(mode);
    setError(null);

    try {
      const entryFee = DOMINO_ENTRY_FEES.fun[mode];
      const { data: result, error: rpcError } = await supabase.rpc(
        "find_domino_match",
        { p_mode: mode, p_currency: "fun", p_entry_fee: entryFee },
      );

      if (rpcError) {
        throw rpcError;
      }

      if (!result?.status) {
        throw new Error(
          "Unable to start matchmaking.",
        );
      }

      router.push({
        pathname: "/domino/game",
        params: {
          mode,
          matchmaking_status: result.status,
          room_id: result.room_id ?? "",
          matchType,
          playMode: "fun",
          entryFee: String(entryFee),
          game: "domino",
        },
      });
    } catch (reason) {
      console.warn(
        "Unable to start Fun matchmaking:",
        reason,
      );

      setSearchingMode(null);
      setError(getMatchmakingError(reason));
    }
  };

  if (authReady && !userId) {
    return <Redirect href="/login" />;
  }

  if (!authReady) {
    return (
      <View style={styles.shell}>
        <LobbyHeader />

        <View style={styles.screenLoading}>
          <ActivityIndicator
            size="large"
            color="#ffffff"
          />
        </View>

      <BottomNav />
      </View>
    );
  }

  const isSearching = searchingMode !== null;

  return (
    <View style={styles.shell}>
      <LobbyHeader />

      <View
        style={[
          styles.shellContent,
          {
            paddingHorizontal: isTablet
              ? TABLET_HORIZONTAL_INSET
              : MOBILE_HORIZONTAL_INSET,
          },
        ]}
      >
        <View style={[styles.content, isTablet && styles.contentTablet]}>
          <View
            style={[
              styles.cardsRow,
              isTablet && styles.cardsRowTablet,
            ]}
          >
            <FunCard
              title="یاری لەگەڵ ڕۆبۆت"
              subtitle="بەرامبەر ڕۆبۆت یاری بکە و تواناکانت تاقی بکەرەوە"
              entry={0}
              gradientColors={[
                "rgba(99,102,241,0.94)",
                "rgba(49,46,129,0.88)",
              ]}
              icon="robot-outline"
              isTablet={isTablet}
              disabled={isSearching}
              loading={false}
              onPress={() => {
                router.push("/domino/play-ai");
              }}
            />

            <FunCard
              title="یاری دوو کەسی"
              subtitle="یاریی دوو کەسی، توانای خۆت بسەلمێنە"
              entry={DOMINO_ENTRY_FEES.fun["1v1"]}
              gradientColors={[
                "rgba(180,117,24,0.96)",
                "rgba(71,42,10,0.94)",
              ]}
              icon="account-multiple-outline"
              isTablet={isTablet}
              disabled={isSearching || (coinBalance !== null && coinBalance < DOMINO_ENTRY_FEES.fun["1v1"])}
              loading={searchingMode === "1v1"}
              onPress={() => {
                void startPublicMatch(
                  "1v1",
                  "duo",
                );
              }}
            />

            <FunCard
              title="یاری چوار کەسی"
              subtitle="یاریی چوار کەسی، لەگەڵ هاوپەیمانەکەت"
              entry={DOMINO_ENTRY_FEES.fun["2v2"]}
              gradientColors={[
                "rgba(30,64,175,0.96)",
                "rgba(15,23,42,0.96)",
              ]}
              icon="account-multiple-outline"
              iconRepeat={2}
              isTablet={isTablet}
              disabled={isSearching || (coinBalance !== null && coinBalance < DOMINO_ENTRY_FEES.fun["2v2"])}
              loading={searchingMode === "2v2"}
              onPress={() => {
                void startPublicMatch(
                  "2v2",
                  "squad",
                );
              }}
            />
          </View>
        </View>
      </View>

      {error ? (
        <View pointerEvents="none" style={styles.toast}>
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color="#fca5a5"
          />

          <Text style={styles.toastText}>{error}</Text>
        </View>
      ) : null}

      <BottomNav />

    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: "#090b1d",
  },

  shellContent: {
    flex: 1,
  },

  content: {
    flex: 1,
    justifyContent: "center",
    paddingTop: 16,
    paddingBottom: 80,
  },

  contentTablet: {
    paddingTop: 24,
    paddingBottom: 100,
  },

  screenLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  cardsRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  cardsRowTablet: {
    gap: 18,
  },

  card: {
    width: 200,
    height: 250,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: 14,
    alignItems: "center",
    justifyContent: "space-between",
  },

  cardTablet: {
    width: 240,
    height: 300,
    borderRadius: 18,
    borderWidth: 1.4,
    padding: 22,
  },

  cardShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(2,6,23,0.24)",
  },

  iconShell: {
    width: 58,
    height: 58,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 2,
    alignSelf: "center",
  },

  iconShellTablet: {
    width: 78,
    height: 78,
    marginTop: 16,
    borderRadius: 20,
  },

  cardDisabled: {
    opacity: 0.68,
  },

  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },

  cardInfo: {
    width: "100%",
    alignItems: "center",
  },

  cardInfoTablet: {},

  cardTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  cardTitleTablet: {
    fontSize: 20,
  },

  cardSubtitle: {
    marginTop: 8,
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  cardSubtitleTablet: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 23,
  },

  entryBox: {
    width: "100%",
    minHeight: 34,
    borderRadius: 9,
    paddingHorizontal: 8,
    backgroundColor: "rgba(2,6,23,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },

  entryBoxTablet: {
    minHeight: 46,
    borderRadius: 12,
    gap: 8,
  },

  entryCurrency: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "SpedaBold",
  },

  entryCurrencyTablet: {
    fontSize: 16,
  },

  entryAmount: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Roboto",
    fontWeight: "700",
  },

  entryAmountTablet: {
    fontSize: 16,
  },

  coinDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#f8d774",
  },

  coinDotTablet: {
    width: 13,
    height: 13,
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,6,23,0.76)",
  },

  searchingText: {
    marginTop: 10,
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  searchingTextTablet: {
    marginTop: 16,
    fontSize: 16,
  },

  toast: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    zIndex: 100,
    elevation: 20,
    maxWidth: "90%",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(20,18,29,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  toastText: {
    color: "#f1e1e1",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },

});
