import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type LeaveMatchConfirmPopupProps = {
  visible: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const LEAVE_TITLE = "دەرچوون لە یارییەکە؟";

const LEAVE_BODY =
  "بەجێهێشتنی یاری پێش کۆتایی وەک دۆڕان تۆمار دەکرێت و ئەنجامەکە بە پێی یاساکانی یارییەکە هەژمار دەکرێت.";

const CANCEL_TEXT = "پاشگەزبوونەوە";
const CONFIRM_TEXT = "دەرچوون";

export default function LeaveMatchConfirmPopup({
  visible,
  loading = false,
  onCancel,
  onConfirm,
}: LeaveMatchConfirmPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        disabled={loading}
      />

      <View style={styles.card}>
        <LinearGradient
          colors={[
            "rgba(2,6,23,0.92)",
            "rgba(9,18,40,0.86)",
          ]}
          style={styles.gradient}
        >
          <View style={styles.headerPanel}>
            <View style={styles.iconWrap}>
              <Ionicons
                name="exit-outline"
                size={24}
                color="#f8d774"
              />
            </View>

            <Text style={styles.title}>
              {LEAVE_TITLE}
            </Text>

            <Text style={styles.body}>
              {LEAVE_BODY}
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                pressed &&
                  !loading &&
                  styles.buttonPressed,
              ]}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.cancelText}>
                {CANCEL_TEXT}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.confirmButton,
                loading && styles.buttonDisabled,
                pressed &&
                  !loading &&
                  styles.buttonPressed,
              ]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator
                  color="#ffffff"
                  size="small"
                />
              ) : (
                <Text style={styles.confirmText}>
                  {CONFIRM_TEXT}
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
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(2,6,23,0.82)",
  },

  card: {
    width: "90%",
    maxWidth: 450,
    minHeight: 190,

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
    minHeight: 92,
    alignItems: "center",
    justifyContent: "center",

    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,

    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.22)",
    backgroundColor: "rgba(15,23,42,0.66)",
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

  title: {
    width: "100%",
    color: "#ffffff",
    fontSize: 19,
    lineHeight: 28,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  body: {
    width: "100%",
    marginTop: 7,

    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "SpedaBold",

    textAlign: "center",
    writingDirection: "rtl",
  },

  actions: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  cancelButton: {
    flex: 1,
    height: 46,

    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.24)",
    backgroundColor: "rgba(248,215,116,0.08)",

    alignItems: "center",
    justifyContent: "center",
  },

  confirmButton: {
    flex: 1,
    height: 46,

    borderRadius: 6,
    backgroundColor: "#dc2626",

    alignItems: "center",
    justifyContent: "center",
  },

  cancelText: {
    color: "#f8d774",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },

  confirmText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },

  buttonPressed: {
    opacity: 0.86,
  },

  buttonDisabled: {
    opacity: 0.55,
  },
});