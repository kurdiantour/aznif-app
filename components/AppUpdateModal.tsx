import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAppUpdate, UpdateStatus } from "@/hooks/useAppUpdate";

interface AppUpdateModalProps {
  previewMode?: UpdateStatus;
}

export function AppUpdateModal({
  previewMode,
}: AppUpdateModalProps) {
  const { status, loading, setStatus } = useAppUpdate();
  const [devPreview, setDevPreview] = React.useState(__DEV__ ? "optional" : null);

  const currentStatus = previewMode || (devPreview ? devPreview : status);

  if (loading && !previewMode && !devPreview) return null;
  if (currentStatus === "none") return null;

  const isForce = currentStatus === "force";

  const handleUpdate = () => {
    if (devPreview) {
      setDevPreview(null);
      return;
    }
    const url =
      Platform.OS === "ios"
        ? "https://apps.apple.com/app/id6780178355"
        : "market://details?id=com.aznif.app";

    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        if (Platform.OS === "android") {
          Linking.openURL(
            "https://play.google.com/store/apps/details?id=com.aznif.app",
          );
        } else {
          Linking.openURL(
            "https://apps.apple.com/app/id6780178355",
          );
        }
      }
    });
  };

  const handleLater = () => {
    if (devPreview) {
      setDevPreview(null);
      return;
    }
    setStatus("none");
  };

  return (
    <View style={styles.overlay}>
      <LinearGradient
        colors={[
          "rgba(2, 6, 23, 0.92)",
          "rgba(9, 18, 40, 0.86)",
        ]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.fixedContent}>
        <View style={styles.card}>
          <View style={styles.headerPanel}>
            <Ionicons
              name="cloud-download-outline"
              size={26}
              color="#f8d774"
            />

            <Text style={styles.title}>
              وەشانی نوێ بەردەستە!
            </Text>

            <Text style={styles.subtitle}>
              {isForce
                ? "بۆ بەردەوامبوون لە بەکارهێنانی ئەزنیف، پێویستە نوێی بکەیتەوە."
                : "وەشانێکی نوێی ئەزنیف بەردەستە. دەتەوێت ئێستا نوێی بکەیتەوە؟"}
            </Text>
          </View>

          <View style={styles.form}>
            <Pressable
              style={styles.primaryButton}
              onPress={handleUpdate}
            >
              <Text style={styles.primaryText}>
                نوێکردنەوە
              </Text>
            </Pressable>

            {!isForce && (
              <Pressable
                style={styles.secondaryButton}
                onPress={handleLater}
              >
                <Text style={styles.secondaryText}>
                  دواتر
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
  },

  fixedContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  card: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(4, 10, 25, 0.86)",
    padding: 12,
  },

  headerPanel: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.22)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },

  title: {
    color: "#ffffff",
    fontSize: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 10,
  },

  subtitle: {
    color: "#b6c2d8",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 22,
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 8,
  },

  form: {
    gap: 9,
  },

  primaryButton: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    marginTop: 4,
  },

  primaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 15,
    textAlign: "center",
    writingDirection: "rtl",
  },

  secondaryButton: {
    minHeight: 46,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
  },

  secondaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },
});