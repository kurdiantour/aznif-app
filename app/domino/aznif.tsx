import { MaterialCommunityIcons } from "@expo/vector-icons";
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
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { DOMINO_ENTRY_FEES } from "@/constants/domino-economy";
import { formatAznif } from "@/lib/aznif-display";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { useWallet } from "@/lib/wallet-context";

type AznifCardConfig = {
  id: string;
  amount: number;
  mode: "1v1" | "2v2";
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  colors: readonly [string, string];
  enabled: boolean;
};

const AZNIF_CARDS: AznifCardConfig[] = [
  {
    id: "aznif-1v1",
    amount: DOMINO_ENTRY_FEES.aznif["1v1"],
    mode: "1v1",
    title: "پێکدادان",
    description: `بەشداری بە ${formatAznif(DOMINO_ENTRY_FEES.aznif["1v1"])} ئەزنیف و یاریکردنی دوو کەسی. پێکدادان`,
    icon: "shield-outline",
    colors: [
      "rgba(180,117,24,0.96)",
      "rgba(71,42,10,0.94)",
    ],
    enabled: true,
  },
  {
    id: "aznif-2v2",
    amount: DOMINO_ENTRY_FEES.aznif["2v2"],
    mode: "2v2",
    title: "هاوپەیمان",
    description: "بەشداری ئەزنیف و یاریکردنی چوار کەسی. هاوپەیمان",
    icon: "crown-outline",
    colors: [
      "rgba(30,64,175,0.96)",
      "rgba(15,23,42,0.96)",
    ],
    enabled: true,
  },
];

type AznifCardProps = {
  config: AznifCardConfig;
  isTablet: boolean;
  walletBalance: number | null;
  submitting: boolean;
  activeCardId: string | null;
  onPress: () => void;
};

function AznifCard({
  config,
  isTablet,
  walletBalance,
  submitting,
  activeCardId,
  onPress,
}: AznifCardProps) {
  const isComingSoon = !config.enabled;
  const hasEnoughBalance =
    isComingSoon || walletBalance === null || walletBalance >= config.amount;

  const isActive = activeCardId === config.id;

  const disabled =
    isComingSoon ||
    !hasEnoughBalance ||
    submitting;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isTablet && styles.cardTablet,
        disabled && styles.cardDisabled,
        isActive && styles.cardActive,
        pressed && !disabled && styles.cardPressed,
      ]}
    >
      <LinearGradient
        colors={config.colors}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.cardShade} />

      {isComingSoon ? (
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
            بەم زووانە
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.iconShell,
          isTablet && styles.iconShellTablet,
        ]}
      >
        {isActive ? (
          <ActivityIndicator
            size={isTablet ? "large" : "small"}
            color="#fff7d6"
          />
        ) : (
          <MaterialCommunityIcons
            name={config.icon}
            size={isTablet ? 40 : 31}
            color="#fff7d6"
          />
        )}
      </View>

      <View style={styles.cardTextSection}>
        <Text
          style={[
            styles.cardTitle,
            isTablet && styles.cardTitleTablet,
          ]}
        >
          {config.title}
        </Text>

        <Text
          style={[
            styles.cardDescription,
            isTablet && styles.cardDescriptionTablet,
          ]}
        >
          {config.description}
        </Text>
      </View>

      {!isComingSoon ? (
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
            بەشداری
          </Text>

          <Text
            style={[
              styles.entryAmount,
              isTablet && styles.entryAmountTablet,
            ]}
          >
            ( {formatAznif(config.amount)} ) ئەزنیف
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function DominoAznifScreen() {
  const { profile, loading: profileLoading } = useProfile();
  const { width, height } = useWindowDimensions();

  const isTablet = Math.min(width, height) >= 600;

  const { aznifBalance: walletBalance } = useWallet();
  const [activeCardId, setActiveCardId] =
    useState<string | null>(null);
  const startPublicAznifMatch = async (
    config: AznifCardConfig,
  ) => {
    if (
      activeCardId ||
      !config.enabled ||
      config.amount <= 0
    ) {
      return;
    }

    if (!profile) {
      router.push("/login");
      return;
    }

    setActiveCardId(config.id);
    try {
      const { data: result, error: rpcError } =
        await supabase.rpc(
          "find_domino_match",
          {
            p_mode: config.mode,
            p_currency: "aznif",
            p_entry_fee: config.amount,
          },
        );

      if (rpcError) {
        throw rpcError;
      }

      if (
        !result?.status ||
        (result.status === "matched" &&
          !result.room_id)
      ) {
        throw new Error(
          "Unable to start Aznif matchmaking.",
        );
      }

      router.replace({
        pathname: "/domino/matchmaking",
        params: {
          mode: config.mode,
          matchmaking_status: result.status,
          room_id: result.room_id ?? "",
          matchType: config.mode === "1v1" ? "duo" : "squad",
          playMode: "aznif",
          entryFee: String(config.amount),
        },
      });
    } catch (reason) {
      console.warn(
        "Unable to start Aznif matchmaking:",
        reason,
      );

      setActiveCardId(null);
    }
  };

  if (!profileLoading && !profile) {
    return <Redirect href="/login" />;
  }

  if (profileLoading) {
    return (
      <View style={styles.shell}>
        <LobbyHeader />

        <View style={styles.loading}>
          <ActivityIndicator
            size="large"
            color="#ffffff"
          />
        </View>

      <BottomNav />
      </View>
    );
  }

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
            {AZNIF_CARDS.map((config) => (
              <AznifCard
                key={config.id}
                config={config}
                isTablet={isTablet}
                walletBalance={walletBalance}
                submitting={activeCardId !== null}
                activeCardId={activeCardId}
                onPress={() => {
                  void startPublicAznifMatch(config);
                }}
              />
            ))}
          </View>
        </View>
      </View>

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

  loading: {
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

  cardDisabled: {
    opacity: 0.5,
  },

  cardActive: {
    borderColor: "rgba(248,215,116,0.82)",
  },

  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },

  cardShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(2,6,23,0.24)",
  },

  comingSoonBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(88,28,135,0.94)",
    borderWidth: 1,
    borderColor: "rgba(233,213,255,0.55)",
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
    alignSelf: "center",
  },

  iconShellTablet: {
    width: 78,
    height: 78,
    marginTop: 16,
    borderRadius: 20,
  },

  cardTextSection: {
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

  cardDescription: {
    marginTop: 8,
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    lineHeight: 16,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  cardDescriptionTablet: {
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
  fontFamily: "SpedaBold",
},

entryAmountTablet: {
  fontSize: 16,
},


});
