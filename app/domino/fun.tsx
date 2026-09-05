import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { useWallet } from "@/lib/wallet-context";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import {
  consumePendingLeaderboardConsent,
  hasPendingLeaderboardConsent,
  setCurrentLeaderboardVisibility,
} from "@/lib/leaderboardVisibility";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";

type GameMode = "1v1" | "2v2";
type MatchType = "duo" | "squad";

type FunCardProps = {
  title: string;
  subtitle: string;
  entry: number;
  image?: ImageSourcePropType;
  gradientColors?: readonly [string, string];
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  isTablet: boolean;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
};

function FunCard({
  title,
  subtitle,
  entry,
  image,
  gradientColors,
  icon,
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
      {image ? (
        <Image
          source={image}
          style={styles.cardImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <LinearGradient
          colors={gradientColors || ["#1d1145", "#3b1676"]}
          style={StyleSheet.absoluteFill}
        />
      )}

      {icon && (
        <View style={[styles.iconShell, isTablet && styles.iconShellTablet]}>
          <MaterialCommunityIcons
            name={icon}
            size={isTablet ? 38 : 30}
            color="#fff7d6"
          />
        </View>
      )}

      <LinearGradient
        colors={[
          "rgba(0,0,0,0.04)",
          "rgba(0,0,0,0.22)",
          "rgba(0,0,0,0.94)",
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

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
            {entry.toLocaleString("en-US")}
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
            { backgroundColor: "rgba(99,102,241,0.24)", borderColor: "rgba(99,102,241,0.45)" }
          ]}
        >
          <Text
            style={[
              styles.entryCurrency,
              isTablet && styles.entryCurrencyTablet,
              { color: "#a5b4fc", fontFamily: "SpedaBold" }
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
  const {
    profile,
    loading: profileLoading,
  } = useProfile();

  const { coinBalance } = useWallet();

  const { width, height } = useWindowDimensions();

  const isTablet = Math.min(width, height) >= 600;

  const [searchingMode, setSearchingMode] =
    useState<GameMode | null>(null);

  const [
    showLeaderboardConsent,
    setShowLeaderboardConsent,
  ] = useState(false);

  const [
    isSavingLeaderboardConsent,
    setIsSavingLeaderboardConsent,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(null);
  useEffect(() => {
    let mounted = true;

    async function checkPendingConsent() {
      if (!profile) {
        if (mounted) {
          setShowLeaderboardConsent(false);
        }

        return;
      }

      try {
        const pendingConsent =
          await hasPendingLeaderboardConsent();

        if (mounted) {
          setShowLeaderboardConsent(pendingConsent);
        }
      } catch (reason) {
        console.warn(
          "Failed to check leaderboard consent:",
          reason,
        );

        if (mounted) {
          setShowLeaderboardConsent(false);
        }
      }
    }

    void checkPendingConsent();

    return () => {
      mounted = false;
    };
  }, [profile]);

  const saveLeaderboardConsent = async (
    value: boolean,
  ) => {
    if (isSavingLeaderboardConsent) {
      return;
    }

    setIsSavingLeaderboardConsent(true);

    try {
      await setCurrentLeaderboardVisibility(value);
      await consumePendingLeaderboardConsent();

      setShowLeaderboardConsent(false);
    } catch (reason) {
      console.warn(
        "Failed to save leaderboard consent:",
        reason,
      );
    } finally {
      setIsSavingLeaderboardConsent(false);
    }
  };

  const getMatchmakingError = (
    reason: unknown,
  ) => {
    const message =
      reason instanceof Error
        ? reason.message
        : typeof (reason as { message?: unknown })?.message === "string"
          ? String((reason as { message: string }).message)
        : "Unable to start matchmaking.";

    const normalized = message.toLowerCase();

    if (
      normalized.includes("authentication") ||
      normalized.includes("jwt")
    ) {
      return "تکایە دووبارە بچۆرە ژوورەوە.";
    }

    if (
      normalized.includes("insufficient") ||
      normalized.includes("balance")
    ) {
      return "Coinی پێویستت بۆ ئەم یارییە نییە.";
    }

    if (
      normalized.includes("network") ||
      normalized.includes("fetch")
    ) {
      return "پەیوەندی ئینتەرنێت هەڵەی تێدایە.";
    }

    return "نەتوانرا گەڕان بۆ یاری دەست پێ بکات.";
  };

  const startPublicMatch = async (
    mode: GameMode,
    matchType: MatchType,
  ) => {
    if (searchingMode) {
      return;
    }

    if (!profile) {
      router.push("/login");
      return;
    }

    setSearchingMode(mode);
    setError(null);

    try {
      const entryFee = mode === "1v1" ? 500 : 3500;
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
        pathname: "/domino/matchmaking",
        params: {
          mode,
          matchmaking_status: result.status,
          room_id: result.room_id ?? "",
          matchType,
          playMode: "fun",
          entryFee: String(mode === "1v1" ? 500 : 3500),
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

  if (!profileLoading && !profile) {
    return <Redirect href="/login" />;
  }

  if (profileLoading) {
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
              title="پێکدادان"
              subtitle="یاریی دوو کەسی، توانای خۆت بسەلمێنە"
              entry={500}
              image={require(
                "@/assets/images/mode-select/1vs1.webp"
              )}
              isTablet={isTablet}
              disabled={isSearching || (coinBalance !== null && coinBalance < 500)}
              loading={searchingMode === "1v1"}
              onPress={() => {
                void startPublicMatch(
                  "1v1",
                  "duo",
                );
              }}
            />

            <FunCard
              title="هاوپەیمان"
              subtitle="یاریی چوار کەسی، لەگەڵ هاوپەیمانەکەت"
              entry={3500}
              image={require(
                "@/assets/images/mode-select/2vs2.webp"
              )}
              isTablet={isTablet}
              disabled={isSearching || (coinBalance !== null && coinBalance < 3500)}
              loading={searchingMode === "2v2"}
              onPress={() => {
                void startPublicMatch(
                  "2v2",
                  "squad",
                );
              }}
            />
          </View>

          {error ? (
            <Text
              style={[
                styles.errorText,
                isTablet && styles.errorTextTablet,
              ]}
            >
              {error}
            </Text>
          ) : null}
        </View>
      </View>

      <BottomNav />

      {showLeaderboardConsent ? (
        <View
          style={styles.consentBackdrop}
          pointerEvents="auto"
        >
          <View
            style={[
              styles.consentDialog,
              isTablet &&
                styles.consentDialogTablet,
            ]}
          >
            <Text
              style={[
                styles.consentText,
                isTablet &&
                  styles.consentTextTablet,
              ]}
            >
              ڕازیت بە نیشاندانی ناو، پلە و خاڵەکانت
              لە خشتەی پێشبڕکێ؟
            </Text>

            <View style={styles.consentActions}>
              <Pressable
                disabled={
                  isSavingLeaderboardConsent
                }
                onPress={() => {
                  void saveLeaderboardConsent(true);
                }}
                style={({ pressed }) => [
                  styles.consentButton,
                  styles.consentPrimaryButton,
                  pressed &&
                    !isSavingLeaderboardConsent &&
                    styles.cardPressed,
                ]}
              >
                {isSavingLeaderboardConsent ? (
                  <ActivityIndicator
                    color="#ffffff"
                  />
                ) : (
                  <Text
                    style={
                      styles.consentPrimaryButtonText
                    }
                  >
                    ڕازیم
                  </Text>
                )}
              </Pressable>

              <Pressable
                disabled={
                  isSavingLeaderboardConsent
                }
                onPress={() => {
                  void saveLeaderboardConsent(false);
                }}
                style={({ pressed }) => [
                  styles.consentButton,
                  styles.consentSecondaryButton,
                  pressed &&
                    !isSavingLeaderboardConsent &&
                    styles.cardPressed,
                ]}
              >
                <Text
                  style={
                    styles.consentSecondaryButtonText
                  }
                >
                  نەخێر
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
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
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: "rgba(180,120,255,0.42)",
    backgroundColor: "rgba(17,24,39,0.82)",
  },

  cardTablet: {
    width: 240,
    height: 300,
    borderRadius: 18,
    borderWidth: 1.4,
  },

  iconShell: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    position: "absolute",
    top: 24,
  },

  iconShellTablet: {
    width: 72,
    height: 72,
    borderRadius: 18,
    top: 36,
  },

  cardDisabled: {
    opacity: 0.68,
  },

  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },

  cardImage: {
    width: "100%",
    height: "100%",
  },

  cardInfo: {
    position: "absolute",
    left: 15,
    right: 15,
    bottom: 56,
    alignItems: "center",
  },

  cardInfoTablet: {
    left: 22,
    right: 22,
    bottom: 78,
  },

  cardTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  cardTitleTablet: {
    fontSize: 25,
  },

  cardSubtitle: {
    marginTop: 5,
    color: "#f3f4f6",
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  cardSubtitleTablet: {
    marginTop: 9,
    fontSize: 16,
    lineHeight: 25,
  },

  entryBox: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    height: 32,
    borderRadius: 9,
    backgroundColor: "rgba(2,6,23,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  entryBoxTablet: {
    left: 16,
    right: 16,
    bottom: 16,
    height: 46,
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
    fontFamily: "SpedaBold",
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

  errorText: {
    marginTop: 12,
    paddingHorizontal: 14,
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  errorTextTablet: {
    marginTop: 18,
    fontSize: 16,
    lineHeight: 25,
  },

  consentBackdrop: {
    position: "absolute",
    top: -14,
    right: 0,
    bottom: -18,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.64)",
  },

  consentDialog: {
    width: "100%",
    maxWidth: 360,
    padding: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.34)",
    backgroundColor: "#0b1024",
  },

  consentDialogTablet: {
    maxWidth: 520,
    padding: 28,
    borderRadius: 16,
  },

  consentText: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 28,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  consentTextTablet: {
    fontSize: 21,
    lineHeight: 34,
  },

  consentActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },

  consentButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  consentPrimaryButton: {
    backgroundColor: "#2563eb",
  },

  consentSecondaryButton: {
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.32)",
    backgroundColor: "rgba(15,23,42,0.9)",
  },

  consentPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  consentSecondaryButtonText: {
    color: "#e5e7eb",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
});
