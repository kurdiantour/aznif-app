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
  isLocalGame?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const LEAVE_TITLE = "\u0644\u06d5 \u06cc\u0627\u0631\u06cc\u06cc\u06d5\u06a9\u06d5 \u062f\u06d5\u0686\u06cc\u062a\u06d5 \u062f\u06d5\u0631\u06d5\u0648\u06d5\u061f";
const LOCAL_GAME_BODY = "\u0626\u06d5\u06af\u06d5\u0631 \u062f\u06d5\u0631\u0686\u06cc\u062a\u060c \u06cc\u0627\u0631\u06cc\u06cc\u06d5\u06a9\u06d5 \u06a9\u06c6\u062a\u0627\u06cc\u06cc \u062f\u06ce\u062a.";
const ONLINE_GAME_BODY = "\u0626\u06d5\u06af\u06d5\u0631 \u062f\u06d5\u0631\u0686\u06cc\u062a\u060c \u0628\u06c6\u062a \u0644\u06d5 \u062c\u06cc\u0627\u062a\u06cc \u062a\u06c6 \u06cc\u0627\u0631\u06cc \u062f\u06d5\u06a9\u0627\u062a.\n\u062f\u06c6\u0695\u0627\u0646 \u0648\u0627\u062a\u06d5 \u0644\u06d5\u062f\u06d5\u0633\u062a\u062f\u0627\u0646\u06cc \u067e\u0648\u06cc\u0646\u062a.";
const CANCEL_TEXT = "\u067e\u0627\u0634\u06af\u06d5\u0632\u0628\u0648\u0648\u0646\u06d5\u0648\u06d5";
const CONFIRM_TEXT = "\u062f\u06d5\u0631\u0686\u0648\u0648\u0646 \u0644\u06d5 \u06cc\u0627\u0631\u06cc";

export default function LeaveMatchConfirmPopup({
  visible,
  loading = false,
  isLocalGame = false,
  onCancel,
  onConfirm,
}: LeaveMatchConfirmPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.scrim} />

      <BlurView intensity={45} tint="dark" style={styles.modal}>
        <Text style={styles.title}>{LEAVE_TITLE}</Text>

        <Text style={styles.body}>
          {isLocalGame ? LOCAL_GAME_BODY : ONLINE_GAME_BODY}
        </Text>

        <View style={styles.actions}>
          <Pressable
            style={styles.cancelButton}
            onPress={onCancel}
            disabled={loading}
          >
            <Text style={styles.cancelText}>{CANCEL_TEXT}</Text>
          </Pressable>

          <Pressable
            style={[styles.confirmButton, loading && styles.buttonDisabled]}
            onPress={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.confirmText}>{CONFIRM_TEXT}</Text>
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