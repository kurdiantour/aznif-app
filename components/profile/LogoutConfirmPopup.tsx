import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type LogoutConfirmPopupProps = {
  visible: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LogoutConfirmPopup({
  visible,
  loading = false,
  onCancel,
  onConfirm,
}: LogoutConfirmPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.scrim} onPress={onCancel} disabled={loading} />

      <View style={styles.popup}>
        <View style={styles.iconBox}>
          <Ionicons name="log-out-outline" size={24} color="#fca5a5" />
        </View>

        <View style={styles.copy}>
          <Text style={styles.title}>{"\u062f\u06d5\u0631\u0686\u0648\u0648\u0646"}</Text>
          <Text style={styles.body}>
            {
              "\u062f\u06b5\u0646\u06cc\u0627\u06cc\u062a \u062f\u06d5\u062a\u06d5\u0648\u06ce\u062a \u0628\u0686\u06cc\u062a\u06d5 \u062f\u06d5\u0631\u06d5\u0648\u06d5\u061f"
            }
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.cancelButton]}
            onPress={onCancel}
            disabled={loading}
          >
            <Text style={styles.cancelText}>{"\u0646\u06d5\u062e\u06ce\u0631"}</Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.confirmButton, loading && styles.disabled]}
            onPress={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.confirmText}>{"\u0628\u06d5\u06b5\u06ce"}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1200,
    elevation: 1200,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(2, 6, 23, 0.76)",
  },
  popup: {
    width: "92%",
    maxWidth: 520,
    minHeight: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(251, 113, 133, 0.28)",
    backgroundColor: "#0b1027",
    padding: 16,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.42,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 24,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(251, 113, 133, 0.36)",
    backgroundColor: "rgba(127, 29, 29, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "SpedaBold",
    textAlign: "right",
    writingDirection: "rtl",
  },
  body: {
    marginTop: 7,
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 20,
    fontFamily: "SpedaBold",
    textAlign: "right",
    writingDirection: "rtl",
  },
  actions: {
    width: 148,
    gap: 8,
  },
  button: {
    height: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.28)",
    backgroundColor: "rgba(15, 23, 42, 0.78)",
  },
  confirmButton: {
    borderWidth: 1,
    borderColor: "rgba(254, 202, 202, 0.28)",
    backgroundColor: "#dc2626",
  },
  cancelText: {
    color: "#e5e7eb",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
  confirmText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
  disabled: {
    opacity: 0.65,
  },
});
