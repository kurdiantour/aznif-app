import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import { useAuthState } from "@/lib/auth-state";

export function GlobalLeaderboardConsent() {
  const { userId } = useAuthState();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  const [visible, setVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkPendingConsent() {
      if (!userId) {
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
  }, [userId]);

  const saveConsent = async (value: boolean) => {
    if (isSaving) return;

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

  if (!userId || !visible) {
    return null;
  }

  return (
    <View style={styles.backdrop}>
      <View
        style={[
          styles.card,
          isTablet && styles.cardTablet,
        ]}
      >
        <LinearGradient
          colors={[
            "rgba(2,6,23,0.92)",
            "rgba(9,18,40,0.86)",
          ]}
          style={[
            styles.gradient,
            isTablet && styles.gradientTablet,
          ]}
        >
          <View
            style={[
              styles.headerPanel,
              isTablet && styles.headerPanelTablet,
            ]}
          >
            <View
              style={[
                styles.iconWrap,
                isTablet && styles.iconWrapTablet,
              ]}
            >
              <Ionicons
                name="trophy-outline"
                size={isTablet ? 30 : 24}
                color="#f8d774"
              />
            </View>

            <Text
              style={[
                styles.description,
                isTablet && styles.descriptionTablet,
              ]}
            >
             ڕازیت ناو، پلە و خاڵەکانت لە خشتەی پێشبڕکێ نیشان بدرێت و بەشداری پێشبڕکێی گشتی بکەیت؟
            </Text>
          </View>

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
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text
                  style={[
                    styles.acceptButtonText,
                    isTablet &&
                      styles.buttonTextTablet,
                  ]}
                >
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
              <Text
                style={[
                  styles.rejectButtonText,
                  isTablet &&
                    styles.buttonTextTablet,
                ]}
              >
                نەخێر
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
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
    zIndex: 5000,
    elevation: 5000,
    paddingHorizontal: 22,
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

  cardTablet: {
    maxWidth: 520,
  },

  gradient: {
    width: "100%",
    padding: 12,
  },

  gradientTablet: {
    padding: 18,
  },

  headerPanel: {
    minHeight: 120,
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

  headerPanelTablet: {
    minHeight: 150,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  iconWrap: {
    width: 42,
    height: 42,
    marginBottom: 8,

    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.22)",
    backgroundColor: "rgba(248,215,116,0.08)",

    alignItems: "center",
    justifyContent: "center",
  },

  iconWrapTablet: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginBottom: 10,
  },

  description: {
    width: "100%",
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 24,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  descriptionTablet: {
    fontSize: 20,
    lineHeight: 32,
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

  acceptButton: {
    backgroundColor: "#2563eb",
  },

  rejectButton: {
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.24)",
    backgroundColor: "rgba(248,215,116,0.08)",
  },

  acceptButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  rejectButtonText: {
    color: "#f8d774",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  buttonTextTablet: {
    fontSize: 18,
  },

  buttonPressed: {
    opacity: 0.86,
  },
});