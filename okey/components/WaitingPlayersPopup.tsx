import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PlayerAvatar } from "@/components/player/PlayerAvatar";

type Props = {
  visible: boolean;
  memberCount: number;
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
  memberCount,
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
    if (!countdownEndsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [countdownEndsAt]);

  const countdownSeconds = countdownEndsAt
    ? Math.max(0, Math.ceil((Date.parse(countdownEndsAt) - now) / 1_000))
    : null;
  if (!visible) return null;

  return (
    <View style={styles.layer}>
      <View style={styles.card}>


        <Text style={styles.title}>
          چاوەڕوانی یاریزانەکان
        </Text>

        <Text style={styles.count}>
          {memberCount} / 4
        </Text>
        {countdownSeconds !== null ? (
          <Text style={styles.count}>
            بازی تا {countdownSeconds} ثانیه دیگر شروع می‌شود
          </Text>
        ) : null}

        <View style={styles.entryFee}>
          <Ionicons name={currency === "aznif" ? "diamond" : "game-controller-outline"} size={15} color="#f8d774" />
          <Text style={styles.entryFeeText}>
            تێچووی یاری: {entryFee.toLocaleString()} {currency === "aznif" ? "ئەزنیف" : "سکە"}
          </Text>
        </View>


        <View style={styles.players}>
          {[0, 2, 1, 3].map((index, displayIndex) => {
            const member = members.find(
              (item) => item.playerIndex === index,
            );
            const active = !!member;

            return (
              <View key={index} style={styles.playerSlot}>
                <View
                  style={[
                    styles.player,
                    active && styles.playerActive,
                  ]}
                >
                  {member ? (
                    <PlayerAvatar avatarUrl={member.avatarUrl ?? undefined} size={30} />
                  ) : (
                    <Ionicons name="person-outline" size={17} color="rgba(255,255,255,0.42)" />
                  )}
                </View>
                {displayIndex === 1 ? (
                  <View style={styles.startStatus}>
                    {countdownSeconds === null ? (
                      <ActivityIndicator size="small" color="#f8d774" />
                    ) : (
                      <Text style={styles.startStatusText}>{countdownSeconds}</Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>


        <Pressable
          disabled={loading || !canCancel}
          onPress={onCancel}
          style={[
            styles.cancelButton,
            (loading || !canCancel) && styles.cancelButtonDisabled,
          ]}
        >

          {loading ? (
            <ActivityIndicator
              size="small"
              color="#ffffff"
            />
          ) : !canCancel ? (
            <Text style={styles.cancelText}>شروع بازی در حال آماده‌سازی است</Text>
          ) : (
            <Text style={styles.cancelText}>
              پاشگەز بوومەوە
            </Text>
          )}

        </Pressable>

      </View>
    </View>
  );
}


const styles = StyleSheet.create({

  layer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    zIndex: 1201,
    elevation: 1201,
    transform: [
      {
        translateX: -200,
      },
      {
        translateY: -100,
      },
    ],
  },


  card: {
    minHeight: 280,
    width: 520,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.44)",
    backgroundColor: "rgba(10,18,34,0.96)",
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },


  title: {
    marginTop: 8,
    color: "#f8d774",
    fontSize: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },


  count: {
    marginTop: 3,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },


  entryFee: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  entryFeeText: {
    color: "rgba(255,247,218,0.82)",
    fontSize: 13,
    fontFamily: "SpedaRegular",
  },

  players: {
    marginTop: 12,
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
    width: 34,
    height: 34,
    borderRadius: 17,
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
    marginTop: 14,
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