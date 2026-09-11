import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  consumePendingLeaderboardConsent,
  hasPendingLeaderboardConsent,
  setCurrentLeaderboardVisibility,
} from "@/lib/leaderboardVisibility";
import { useProfile } from "@/lib/profile";

export function GlobalLeaderboardConsent() {
  const { profile } = useProfile();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  const [visible, setVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkPendingConsent() {
      if (!profile) {
        if (isMounted) {
          setVisible(false);
        }

        return;
      }

      try {
        const pendingConsent =
          await hasPendingLeaderboardConsent();

        if (isMounted) {
          setVisible(pendingConsent);
        }
      } catch (error) {
        console.warn(
          "Failed to check leaderboard consent:",
          error,
        );

        if (isMounted) {
          setVisible(false);
        }
      }
    }

    void checkPendingConsent();

    return () => {
      isMounted = false;
    };
  }, [profile]);

  const saveConsent = async (
    value: boolean,
  ) => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await setCurrentLeaderboardVisibility(value);
      await consumePendingLeaderboardConsent();

      setVisible(false);
    } catch (error) {
      console.warn(
        "Failed to save leaderboard consent:",
        error,
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!profile || !visible) {
    return null;
  }

  return (
    <View
      style={styles.backdrop}
      pointerEvents="auto"
    >
      <View
        style={[
          styles.dialog,
          isTablet && styles.dialogTablet,
        ]}
      >
        <Text
          style={[
            styles.description,
            isTablet && styles.descriptionTablet,
          ]}
        >
          ڕازیت بە نیشاندانی ناو، پلە و خاڵەکانت
          لە خشتەی پێشبڕکێ؟
        </Text>

        <View style={styles.actions}>
          <Pressable
            disabled={isSaving}
            onPress={() => {
              void saveConsent(true);
            }}
            style={({ pressed }) => [
              styles.button,
              styles.acceptButton,
              pressed &&
                !isSaving &&
                styles.buttonPressed,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator
                color="#ffffff"
              />
            ) : (
              <Text style={styles.acceptButtonText}>
                ڕازیم
              </Text>
            )}
          </Pressable>

          <Pressable
            disabled={isSaving}
            onPress={() => {
              void saveConsent(false);
            }}
            style={({ pressed }) => [
              styles.button,
              styles.rejectButton,
              pressed &&
                !isSaving &&
                styles.buttonPressed,
            ]}
          >
            <Text style={styles.rejectButtonText}>
              نەخێر
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
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

  dialog: {
    width: "100%",
    maxWidth: 390,
    padding: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.34)",
    backgroundColor: "#0b1024",
  },

  dialogTablet: {
    maxWidth: 520,
    padding: 28,
    borderRadius: 16,
  },

  description: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 28,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  descriptionTablet: {
    fontSize: 21,
    lineHeight: 34,
  },

  actions: {
    flexDirection: "row",
    marginTop: 18,
  },

  button: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  acceptButton: {
    marginRight: 10,
    backgroundColor: "#2563eb",
  },

  rejectButton: {
    marginLeft: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.32)",
    backgroundColor: "rgba(15,23,42,0.9)",
  },

  acceptButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  rejectButtonText: {
    color: "#e5e7eb",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});
