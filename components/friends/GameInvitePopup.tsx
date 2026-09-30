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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemainingSeconds(0);
      return;
    }

    const updateRemainingTime = () => {
      const expiresAt = new Date(
        invite.expiresAt,
      ).getTime();

      const nextRemaining = Math.max(
        0,
        Math.ceil((expiresAt - Date.now()) / 1000),
      );

      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        onExpire();
      }
    };

    updateRemainingTime();

    const interval = setInterval(
      updateRemainingTime,
      1000,
    );

    return () => {
      clearInterval(interval);
    };
  }, [invite, onExpire]);

  if (!invite) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <LinearGradient
          colors={[
            "rgba(2,6,23,0.92)",
            "rgba(9,18,40,0.86)",
          ]}
          style={styles.gradient}
        >
          <View style={styles.headerPanel}>
            <View style={styles.timerCircle}>
              <Text style={styles.timerNumber}>
                {remainingSeconds}
              </Text>
            </View>

            <Text style={styles.title}>
              {invite.senderName}
            </Text>

            <Text style={styles.message}>
              بانگهێشتی کردوویت بۆ یاری.
            </Text>
          </View>

          {error ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              disabled={busy}
              onPress={onDecline}
              style={({ pressed }) => [
                styles.button,
                styles.declineButton,
                pressed &&
                  !busy &&
                  styles.buttonPressed,
                busy &&
                  styles.buttonDisabled,
              ]}
            >
              <Text style={styles.declineText}>
                ڕەتکردنەوە
              </Text>
            </Pressable>

            <Pressable
              disabled={busy}
              onPress={onAccept}
              style={({ pressed }) => [
                styles.button,
                styles.acceptButton,
                pressed &&
                  !busy &&
                  styles.buttonPressed,
                busy &&
                  styles.buttonDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator
                  color="#ffffff"
                  size="small"
                />
              ) : (
                <Text style={styles.acceptText}>
                  قبووڵکردن
                </Text>
              )}
            </Pressable>
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,6,23,0.82)",
  },

  card: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(4,10,25,0.86)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 20,
  },

  gradient: {
    width: "100%",
    padding: 12,
  },

  headerPanel: {
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.22)",
    backgroundColor: "rgba(15,23,42,0.66)",
  },

  timerCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.28)",
    backgroundColor: "rgba(248,215,116,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },

  timerNumber: {
    color: "#f8d774",
    fontSize: 20,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },

  title: {
    width: "100%",
    color: "#ffffff",
    fontSize: 19,
    lineHeight: 28,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  message: {
    width: "100%",
    marginTop: 5,
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  error: {
    marginBottom: 10,
    color: "#ff8a8a",
    fontFamily: "SpedaBold",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    writingDirection: "rtl",
  },

  actions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },

  button: {
    flex: 1,
    minHeight: 46,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  declineButton: {
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.24)",
    backgroundColor: "rgba(248,215,116,0.08)",
  },

  acceptButton: {
    backgroundColor: "#2563eb",
  },

  declineText: {
    color: "#f8d774",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },

  acceptText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },

  buttonPressed: {
    opacity: 0.86,
  },

  buttonDisabled: {
    opacity: 0.55,
  },
});