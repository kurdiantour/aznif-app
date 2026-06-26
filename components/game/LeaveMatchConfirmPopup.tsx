import { BlurView } from "expo-blur";
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

export default function LeaveMatchConfirmPopup({
  visible,
  loading = false,
  onCancel,
  onConfirm,
}: LeaveMatchConfirmPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.scrim} />

      <BlurView intensity={45} tint="dark" style={styles.modal}>
        <Text style={styles.title}>لە یارییەکە دەچیتە دەرەوە؟</Text>

        <Text style={styles.body}>
          ئەگەر دەرچیت، بۆت لە جیاتی تۆ یاری دەکات.
          {"\n"}
          دۆڕان واتە لەدەستدانی پوینت.
        </Text>

        <View style={styles.actions}>
          <Pressable
            style={styles.cancelButton}
            onPress={onCancel}
            disabled={loading}
          >
            <Text style={styles.cancelText}>پاشگەزبوونەوە</Text>
          </Pressable>

          <Pressable
            style={[styles.confirmButton, loading && styles.buttonDisabled]}
            onPress={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.confirmText}>دەرچوون لە یاری</Text>
            )}
          </Pressable>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9, 3, 18, 0.24)",
  },

  modal: {
    width: "86%",
    maxWidth: 400,
    minHeight: 180,
    borderRadius: 6,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 20,
    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "rgba(58, 25, 92, 0.18)",

    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",

    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 20,
  },

  title: {
    color: "#f8f3df",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  body: {
    marginTop: 10,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  actions: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },

  cancelButton: {
    minWidth: 112,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  confirmButton: {
    minWidth: 128,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dc2626",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },

  buttonDisabled: {
    opacity: 0.65,
  },

  cancelText: {
    color: "#f8f3df",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  confirmText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
});