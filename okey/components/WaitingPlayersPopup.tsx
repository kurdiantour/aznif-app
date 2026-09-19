import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { AVATAR_IDS, type AvatarId } from "@/types/avatar";
import { formatCurrencyAmount } from "@/lib/aznif-display";

type Props = {
  visible: boolean;
  entryFee: number;
  currency: "fun" | "aznif";
  members: {
    playerIndex: number;
    avatarUrl: string | null;
  }[];
  countdownEndsAt: string | null;
  canCancel: boolean;
  loading?: boolean;
  onCancel: () => void;
};

export default function WaitingPlayersPopup({
  visible,
  entryFee,
  currency,
  members,
  countdownEndsAt,
  canCancel,
  loading = false,
  onCancel,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!countdownEndsAt) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => clearInterval(timer);
  }, [countdownEndsAt]);

  const countdownSeconds = countdownEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(countdownEndsAt) - now) / 1_000,
        ),
      )
    : null;

  if (!visible) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlay}
    >
      <View style={styles.backdrop}>
        <BlurView
          intensity={45}
          tint="dark"
          style={styles.card}
        >
          <View style={styles.entryFee}>
            <Text style={styles.currencyEmoji}>
              {currency === "aznif" ? "\u2728" : "\u{1FA99}"}
            </Text>

            <Text style={styles.entryFeeText}>
              تێچووی یاری:{" "}
              <Text style={styles.entryFeeAmount}>{formatCurrencyAmount(entryFee, currency === "aznif" ? "aznif" : "Coin")}</Text>{" "}
              {currency === "aznif"
                ? "ئەزنیف"
                : "سکە"}
            </Text>
          </View>

          <Text style={styles.title}>
            چاوەڕوانی یاریزانەکان
          </Text>



          <View style={styles.players}>
            {[0, 2, 1, 3].map(
              (index, displayIndex) => {
                const member = members.find(
                  (item) =>
                    item.playerIndex === index,
                );

                const active = !!member;
                const avatarId = member?.avatarUrl &&
                    AVATAR_IDS.includes(member.avatarUrl as AvatarId)
                  ? member.avatarUrl as AvatarId
                  : undefined;

                return (
                  <View
                    key={index}
                    style={styles.playerSlot}
                  >
                    <View
                      style={[
                        styles.player,
                        active &&
                          styles.playerActive,
                      ]}
                    >
                      {member ? (
                        <PlayerAvatar
                          avatarId={avatarId}
                          avatarUrl={avatarId ? undefined : member.avatarUrl ?? undefined}
                          size={42}
                        />
                      ) : (
                        <Ionicons
                          name="person-outline"
                          size={20}
                          color="rgba(255,255,255,0.42)"
                        />
                      )}
                    </View>

                    {displayIndex === 1 ? (
                      <View
                        style={styles.startStatus}
                      >
                        {countdownSeconds ===
                        null ? (
                          <ActivityIndicator
                            size="small"
                            color="#f8d774"
                          />
                        ) : (
                          <Text
                            style={
                              styles.startStatusText
                            }
                          >
                            {countdownSeconds}
                          </Text>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              },
            )}
          </View>

          <Pressable
            disabled={loading || !canCancel}
            onPress={onCancel}
            style={[
              styles.cancelButton,
              (loading || !canCancel) &&
                styles.cancelButtonDisabled,
            ]}
          >
            {loading || !canCancel ? (
              <ActivityIndicator
                size="small"
                color="#ffffff"
              />
            ) : (
              <Text style={styles.cancelText}>
                پاشگەز بوومەوە
              </Text>
            )}
          </Pressable>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  currencyEmoji: { fontSize: 20 },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1201,
    elevation: 1201,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(9, 3, 18, 0.24)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  card: {
    width: "82%",
    maxWidth: 500,
    minHeight: 280,

    borderRadius: 10,
    overflow: "hidden",

    paddingHorizontal: 18,
    paddingVertical: 14,

    backgroundColor: "rgba(0, 0, 0, 0.12)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",

    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },

    elevation: 20,
  },

  entryFee: {
    marginTop: 0,
    marginBottom: 10,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  entryFeeAmount: { fontFamily: "RobotoMedium" },
  entryFeeText: {
    color: "rgba(255,247,218,0.82)",
    fontSize: 13,
    fontFamily: "SpedaRegular",
  },

  title: {
    marginTop: 0,
    color: "#f8d774",
    fontSize: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  players: {
    marginTop: 20,
    flexDirection: "row",
    gap: 12,
  },

  playerSlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  startStatus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },

  startStatusText: {
    color: "#f8d774",
    fontSize: 17,
    fontWeight: "800",
  },

player: {
  width: 48,
  height: 48,
  borderRadius: 18,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.18)",
  backgroundColor: "rgba(255,255,255,0.06)",
  alignItems: "center",
  justifyContent: "center",
},

  playerActive: {
    borderColor: "rgba(248,215,116,0.72)",
    backgroundColor:
      "rgba(248,215,116,0.14)",
  },

  cancelButton: {
    marginTop: 30,
    minWidth: 150,
    height: 36,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(220,38,38,0.88)",
  },

  cancelButtonDisabled: {
    opacity: 0.58,
  },

  cancelText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },
});
