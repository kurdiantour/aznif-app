import type { GameInvite } from "@/lib/gameInvites";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type GameInvitePopupProps = {
  invite: GameInvite | null;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
};

export function GameInvitePopup({
  invite,
  busy,
  error,
  onAccept,
  onDecline,
  onExpire,
}: GameInvitePopupProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!invite) {
      setRemainingSeconds(0);
      return;
    }

    const updateRemainingTime = () => {
      const expiresAt = new Date(invite.expiresAt).getTime();

      const nextRemaining = Math.max(
        0,
        Math.ceil((expiresAt - Date.now()) / 1000)
      );

      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        onExpire();
      }
    };

    updateRemainingTime();

    const interval = setInterval(updateRemainingTime, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [invite, onExpire]);

  if (!invite) return null;

  return (
    <View style={styles.backdrop}>
      <LinearGradient
        colors={["#24134b", "#090d21"]}
        style={styles.card}
      >
        <View style={styles.timerCircle}>
          <Text style={styles.timerNumber}>{remainingSeconds}</Text>
        </View>

        <Text style={styles.title}>{invite.senderName}</Text>

        <Text style={styles.message}>
          بانگهێشتی کردوویت بۆ یاری.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ڕەتکردنەوەی بانگهێشت"
            disabled={busy}
            onPress={onDecline}
            style={({ pressed }) => [
              styles.button,
              styles.declineButton,
              pressed && !busy && styles.buttonPressed,
              busy && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.buttonText}>ڕەتکردنەوە</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="قبووڵکردنی بانگهێشت"
            disabled={busy}
            onPress={onAccept}
            style={({ pressed }) => [
              styles.button,
              styles.acceptButton,
              pressed && !busy && styles.buttonPressed,
              busy && styles.buttonDisabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.buttonText}>قبووڵکردن</Text>
            )}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },

  card: {
    width: 360,
    maxWidth: "88%",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    alignItems: "center",
    borderRadius: 16,
  },

  timerCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#22c55e",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },

  timerNumber: {
    color: "#ffffff",
    fontSize: 22,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },

  title: {
    marginTop: 14,
    color: "#ffffff",
    fontSize: 16,
    textAlign: "center",
    writingDirection: "rtl",
  },

  message: {
    marginTop: 7,
    color: "#d9d5e8",
    fontFamily: "SpedaBold",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl",
  },

  error: {
    marginTop: 8,
    color: "#ff8a8a",
    fontFamily: "SpedaBold",
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    writingDirection: "rtl",
  },

  actions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },

  button: {
    flex: 1,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },

  acceptButton: {
    backgroundColor: "#16a34a",
  },

  declineButton: {
    backgroundColor: "#4b5563",
  },

  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },

  buttonDisabled: {
    opacity: 0.55,
  },

  buttonText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },
});
