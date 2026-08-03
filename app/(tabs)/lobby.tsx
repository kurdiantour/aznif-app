import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
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

import { supabase } from "@/lib/supabase";
import {
  consumePendingLeaderboardConsent,
  hasPendingLeaderboardConsent,
  setCurrentLeaderboardVisibility,
} from "@/lib/leaderboardVisibility";
import { useProfile } from "@/lib/profile";
import { rtlStyles } from "@/lib/rtl";

type GameMode = "1v1" | "2v2";
type MatchType = "duo" | "squad";

type ModeCardProps = {
  title?: string;
  subtitle: string;
  image?: ImageSourcePropType;
  imageOnly?: boolean;
  disabled?: boolean;
  badge?: string;
  isTablet?: boolean;
  onPress?: () => void;
};

function ModeCard({
  title,
  subtitle,
  image,
  imageOnly,
  disabled,
  badge,
  isTablet,
  onPress,
}: ModeCardProps) {
  return (
    <Pressable
      style={[
        styles.card,
        isTablet && styles.cardTablet,
        disabled && styles.cardDisabled,
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
      ) : null}

      {!imageOnly && (
        <>
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.92)"]}
            style={[styles.bottomFade, isTablet && styles.bottomFadeTablet]}
          />

          <View style={[styles.cardInfo, isTablet && styles.cardInfoTablet]}>
            {title ? (
              <Text
                style={[styles.cardTitle, isTablet && styles.cardTitleTablet]}
              >
                {title}
              </Text>
            ) : null}

            <Text
              style={[
                styles.cardSubtitle,
                isTablet && styles.cardSubtitleTablet,
              ]}
            >
              {subtitle}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

export default function LobbyScreen() {
  const router = useRouter();
  const { profile } = useProfile();
  const [isSearching, setIsSearching] = useState(false);
  const [showLeaderboardConsent, setShowLeaderboardConsent] = useState(false);
  const [isSavingLeaderboardConsent, setIsSavingLeaderboardConsent] =
    useState(false);
  const { width, height } = useWindowDimensions();

  const shortestSide = Math.min(width, height);
  const isTablet = shortestSide >= 600;
  useEffect(() => {
    let isMounted = true;

    async function checkPendingConsent() {
      if (!profile) {
        setShowLeaderboardConsent(false);
        return;
      }

      try {
        const pendingConsent = await hasPendingLeaderboardConsent();

        if (isMounted) {
          setShowLeaderboardConsent(pendingConsent);
        }
      } catch {
        if (isMounted) {
          setShowLeaderboardConsent(false);
        }
      }
    }

    void checkPendingConsent();

    return () => {
      isMounted = false;
    };
  }, [profile]);

  async function saveLeaderboardConsent(value: boolean) {
    if (isSavingLeaderboardConsent) return;

    setIsSavingLeaderboardConsent(true);

    try {
      await setCurrentLeaderboardVisibility(value);
      await consumePendingLeaderboardConsent();
      setShowLeaderboardConsent(false);
    } catch (error) {
      console.warn("Failed to save leaderboard consent:", error);
    } finally {
      setIsSavingLeaderboardConsent(false);
    }
  }

  const startPublicMatch = async (mode: GameMode, matchType: MatchType) => {
    if (isSearching) return;

    if (!profile) {
      router.push("/login");
      return;
    }

    setIsSearching(true);

    try {
      const { data: result, error } =
        mode === "1v1"
          ? await supabase.rpc("find_one_vs_one_opponent")
          : await supabase.rpc("find_two_vs_two_match");

      if (error) throw error;
      if (!result) throw new Error("نەتوانرا گەڕان بۆ یاری دەست پێ بکات.");

      router.push({
        pathname: "/matchmaking",
        params: {
          mode,
          matchmaking_status: result.status,
          room_id: result.room_id,
          matchType,
        },
      });
    } catch (error) {
      console.warn("Unable to start matchmaking", error);
      setIsSearching(false);
    }
  };

  return (
    <View
      style={[styles.content, rtlStyles.row, isTablet && styles.contentTablet]}
    >
      <View
        style={[
          styles.leftCards,
          rtlStyles.row,
          isTablet && styles.leftCardsTablet,
        ]}
      >
        <ModeCard
          isTablet={isTablet}
          title="پێکدادان"
          subtitle="توانای خۆت بسەلمێنە"
          image={require("@/assets/images/mode-select/1vs1.webp")}
          disabled={isSearching}
          onPress={() => startPublicMatch("1v1", "duo")}
        />

        <ModeCard
          isTablet={isTablet}
          title="هاوپەیمان"
          subtitle="یاری (4) یاریزانی ڕاستەقینە"
          image={require("@/assets/images/mode-select/2vs2.webp")}
          disabled={isSearching}
          onPress={() => startPublicMatch("2v2", "squad")}
        />

        <ModeCard
          isTablet={isTablet}
          title="پاڵەوانیەتی"
          subtitle="تاجی سەرکەوتن چاوەڕێتە"
          badge="بەم زووانە"
          image={require("@/assets/images/lobby/tournament-bg.webp")}
          disabled
        />
      </View>

      <View style={[styles.rightCards, isTablet && styles.rightCardsTablet]}>
        <ModeCard
          isTablet={isTablet}
          subtitle="یاریکردن لەگەڵ رۆبۆت"
          image={require("@/assets/images/lobby/play-ai-bg.webp")}
          disabled={isSearching}
          onPress={() => router.push("/play-ai")}
        />

        <ModeCard
          isTablet={isTablet}
          subtitle="یارییەکی تایبەت دروست بکە"
          image={require("@/assets/images/lobby/create-room.webp")}
          disabled={isSearching}
          onPress={() =>
            profile
              ? router.push({
              pathname: "/create-room",
              params: {
                matchType: "private",
              },
            })
              : router.push("/login")
          }
        />
      </View>

      {showLeaderboardConsent ? (
        <View style={styles.consentBackdrop} pointerEvents="auto">
          <View style={styles.consentDialog}>
            <Text style={styles.consentText}>
              ڕازیت بە نیشاندانی ناو، پلە و خاڵەکانت لە خشتەی پێشبڕکێ؟
            </Text>

            <View style={styles.consentActions}>
              <Pressable
                style={[styles.consentButton, styles.consentPrimaryButton]}
                onPress={() => saveLeaderboardConsent(true)}
                disabled={isSavingLeaderboardConsent}
              >
                {isSavingLeaderboardConsent ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.consentPrimaryButtonText}>ڕازیم</Text>
                )}
              </Pressable>

              <Pressable
                style={[styles.consentButton, styles.consentSecondaryButton]}
                onPress={() => saveLeaderboardConsent(false)}
                disabled={isSavingLeaderboardConsent}
              >
                <Text style={styles.consentSecondaryButtonText}>نەخێر</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
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
    gap: 8,
    marginTop: 0,
  },

  contentTablet: {
    width: "100%",
    height: "72%",
    maxHeight: 520,
    minHeight: 390,
    gap: 18,
    marginTop: 12,
  },

  consentBackdrop: {
    position: "absolute",
    top: -14,
    right: 0,
    bottom: -18,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    backgroundColor: "rgba(0,0,0,0.64)",
  },

  consentDialog: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "#0b1024",
    padding: 18,
  },

  consentText: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "SpedaBold",
    lineHeight: 28,
    textAlign: "center",
    writingDirection: "rtl",
  },

  consentActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },

  consentButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },

  consentPrimaryButton: {
    backgroundColor: "#2563eb",
  },

  consentSecondaryButton: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.32)",
    backgroundColor: "rgba(15, 23, 42, 0.9)",
  },

  consentPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  consentSecondaryButtonText: {
    color: "#e5e7eb",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  leftCards: {
    flex: 1,
    gap: 8,
  },

  leftCardsTablet: {
    gap: 18,
  },

  rightCards: {
    width: "26%",
    gap: 8,
  },

  rightCardsTablet: {
    width: "28%",
    gap: 18,
  },

  card: {
    flex: 1,
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

  cardImage: {
    width: "100%",
    height: "100%",
  },

  cardImageInner: {
    width: "100%",
    height: "100%",
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
  },

  cardSubtitleTablet: {
    marginTop: 8,
    fontSize: 16,
  },
});
