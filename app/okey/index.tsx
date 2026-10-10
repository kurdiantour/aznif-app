
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { formatAznif } from "@/lib/aznif-display";
import { useAuthState } from "@/lib/auth-state";
import { getCachedShopState, getMyShopState } from "@/lib/shop";
import { useWallet } from "@/lib/wallet-context";
import { matchmakeOkeyRoom } from "@/okey/multiplayer/okey-room-api";

type MatchMode = "1v1" | "2v2";

type ModeCardProps = {
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconRepeat?: 1 | 2;
  gradientColors: readonly [string, string];
  isTablet: boolean;
  disabled?: boolean;
  loading?: boolean;
  entry?: number;
  currency: "fun" | "aznif";
  onPress?: () => void;
};

function ModeCard({
  title,
  subtitle,
  icon,
  iconRepeat = 1,
  gradientColors,
  isTablet,
  disabled = false,
  loading = false,
  entry,
  currency,
  onPress,
}: ModeCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
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

      <View
        style={[
          styles.iconShell,
          isTablet && styles.iconShellTablet,
        ]}
      >
        {Array.from({ length: iconRepeat }, (_, index) => (
          <MaterialCommunityIcons
            key={`${icon}-${index}`}
            name={icon}
            size={
              iconRepeat === 2
                ? isTablet
                  ? 28
                  : 22
                : isTablet
                  ? 38
                  : 30
            }
            color={
              icon.startsWith("account-")
                ? "#ffffff"
                : "#fff7d6"
            }
          />
        ))}
      </View>

      {loading ? (
        <View
          style={styles.loadingOverlay}
          testID={`okey-card-loading-${title}`}
        >
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
            گەڕان بۆ یاریزانان...
          </Text>
        </View>
      ) : null}

      <View style={styles.cardInfo}>
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

      {entry !== undefined ? (
        <View
          style={[
            styles.entryBox,
            isTablet && styles.entryBoxTablet,
          ]}
        >
          <Text
            style={[
              styles.entryLabel,
              isTablet && styles.entryLabelTablet,
            ]}
          >
            تێچوو
          </Text>
          <Text
            style={[
              styles.entryAmount,
              currency === "aznif" && styles.entryAmountAznif,
              isTablet && styles.entryAmountTablet,
            ]}
          >
            {currency === "aznif"
              ? `${formatAznif(entry)} ئەزنیف`
              : `${entry.toLocaleString("en-US")} Coin`}
          </Text>
          {currency === "fun" ? (
            <View
              style={[
                styles.coinDot,
                isTablet && styles.coinDotTablet,
              ]}
            />
          ) : null}
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
              styles.entryLabel,
              isTablet && styles.entryLabelTablet,
            ]}
          >
            بەم زووانە
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function OkeyScreen({
  forcedCurrency,
}: {
  forcedCurrency?: "fun" | "aznif";
} = {}) {
  const { currency } = useLocalSearchParams<{
    currency?: string | string[];
  }>();

  const routeCurrency = Array.isArray(currency) ? currency[0] : currency;
  const isAznif = (forcedCurrency ?? routeCurrency) === "aznif";

  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const gameCurrency = isAznif ? "aznif" : "fun";

  const getSelectedTable = (mode: MatchMode) => {
    if (isAznif) {
      return mode === "1v1"
        ? { id: "aznif:1v1", entry: 3 }
        : { id: "aznif:2v2", entry: 7 };
    }

    return mode === "1v1"
      ? { id: "fun:1v1", entry: 500 }
      : { id: "fun:2v2", entry: 1_500 };
  };

  const { userId } = useAuthState();
  const { coinBalance, aznifBalance } = useWallet();

  const balance = isAznif ? aznifBalance : coinBalance;

  const [joiningMode, setJoiningMode] =
    useState<MatchMode | null>(null);
  const [joinError, setJoinError] =
    useState<string | null>(null);

  const joiningRef = useRef(false);

  const startMatchmaking = async (mode: MatchMode) => {
    if (joiningRef.current) return;

    if (!userId) {
      router.push("/login");
      return;
    }

    const selectedTable = getSelectedTable(mode);

    if (balance !== null && balance < selectedTable.entry) {
      setJoinError("موجودی برای ورود به بازی کافی نیست.");
      return;
    }

    joiningRef.current = true;
    setJoiningMode(mode);
    setJoinError(null);

    try {
      if (!getCachedShopState()) {
        await getMyShopState();
      }

      const room = await matchmakeOkeyRoom(selectedTable.id);

      router.replace({
        pathname: "/okey/game",
        params: {
          mode: gameCurrency,
          table: room.tableId,
          tableId: room.tableId,
          matchId: room.matchId,
          matchMode: room.mode,
        },
      });
    } catch (error) {
      console.warn("Unable to join Okey room:", error);
      setJoinError("اتصال به بازی انجام نشد. دوباره تلاش کنید.");
    } finally {
      joiningRef.current = false;
      setJoiningMode(null);
    }
  };

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
        <ScrollView
          contentContainerStyle={[
            styles.content,
            isTablet && styles.contentTablet,
          ]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[
              styles.cardsScroll,
              isTablet && styles.cardsScrollTablet,
            ]}
            contentContainerStyle={[
              styles.cardsRow,
              isTablet && styles.cardsRowTablet,
            ]}
          >
            {!isAznif ? (
              <ModeCard
                title="یاری لەگەڵ بۆت"
                subtitle="بەم زووانە"
                icon="robot-outline"
                gradientColors={[
                  "rgba(99,102,241,0.94)",
                  "rgba(49,46,129,0.88)",
                ]}
                isTablet={isTablet}
                currency={gameCurrency}
                disabled
              />
            ) : null}

            <ModeCard
              title="Okey 1v1"
              subtitle="یاریی دوو کەسی"
              icon="account-multiple-outline"
              gradientColors={[
                "rgba(180,117,24,0.96)",
                "rgba(71,42,10,0.94)",
              ]}
              isTablet={isTablet}
              currency={gameCurrency}
              entry={getSelectedTable("1v1").entry}
              disabled={joiningMode !== null}
              loading={joiningMode === "1v1"}
              onPress={() => void startMatchmaking("1v1")}
            />

            <ModeCard
              title="Okey 2v2"
              subtitle="یاریی چوار کەسی"
              icon="account-multiple-outline"
              iconRepeat={2}
              gradientColors={[
                "rgba(30,64,175,0.96)",
                "rgba(15,23,42,0.96)",
              ]}
              isTablet={isTablet}
              currency={gameCurrency}
              entry={getSelectedTable("2v2").entry}
              disabled={joiningMode !== null}
              loading={joiningMode === "2v2"}
              onPress={() => void startMatchmaking("2v2")}
            />
          </ScrollView>
        </ScrollView>
      </View>

      {joinError ? (
        <Text
          accessibilityRole="alert"
          style={styles.joinError}
        >
          {joinError}
        </Text>
      ) : null}

      <BottomNav active={isAznif ? "aznif" : "home"} />
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
    flexGrow: 1,
    justifyContent: "center",
    paddingTop: 16,
    paddingBottom: 80,
  },
  contentTablet: {
    paddingTop: 24,
    paddingBottom: 100,
  },
  cardsScroll: {
    flexGrow: 0,
    height: 250,
  },
  cardsScrollTablet: {
    height: 300,
  },
  cardsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingRight: 2,
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
  entryLabel: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "SpedaBold",
  },
  entryLabelTablet: {
    fontSize: 16,
  },
  entryAmount: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "Roboto",
    fontWeight: "700",
  },
  entryAmountAznif: {
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
  joinError: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    color: "#fca5a5",
    backgroundColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 9,
    fontFamily: "SpedaBold",
  },
});
