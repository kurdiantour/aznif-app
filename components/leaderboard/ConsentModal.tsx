import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  consumePendingLeaderboardConsent,
  hasPendingLeaderboardConsent,
  setCurrentLeaderboardVisibility,
} from "@/lib/leaderboardVisibility";
import { useProfile } from "@/lib/profile";

export function ConsentModal() {
  const {
    profile,
    loading: profileLoading,
  } = useProfile();

  const [visible, setVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkPendingConsent() {
      if (profileLoading) {
        return;
      }

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
  }, [profile, profileLoading]);

  const saveConsent = async (
    value: boolean,
  ) => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      /*
       * همان وضعیت مشترکی که Settings استفاده می‌کند.
       * true  = نمایش در Leaderboard
       * false = مخفی‌بودن در Leaderboard
       */
      await setCurrentLeaderboardVisibility(value);

      /*
       * مشخص می‌کند که سؤال اولیه از کاربر پرسیده شده است.
       * تغییر بعدی در Settings باعث نمایش دوباره Popup نمی‌شود.
       */
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

  if (
    profileLoading ||
    !profile ||
    !visible
  ) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={() => {
        // Popup بدون انتخاب کاربر بسته نمی‌شود.
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>
            ڕەزامەندی خشتەی پێشبڕکێ
          </Text>

          <Text style={styles.description}>
            ڕازیت بە نیشاندانی ناو، پلە و خاڵەکانت لە
            خشتەی پێشبڕکێ؟
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
                isSaving && styles.buttonDisabled,
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
                isSaving && styles.buttonDisabled,
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
  },

  dialog: {
    width: "100%",
    maxWidth: 360,
    padding: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.34)",
    backgroundColor: "#0b1024",
  },

  title: {
    color: "#f8d774",
    fontSize: 17,
    lineHeight: 27,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  description: {
    marginTop: 8,
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 27,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
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
    backgroundColor: "#2563eb",
  },

  rejectButton: {
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.32)",
    backgroundColor: "rgba(15,23,42,0.94)",
  },

  acceptButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  rejectButtonText: {
    color: "#e5e7eb",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  buttonDisabled: {
    opacity: 0.62,
  },

  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});