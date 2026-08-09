import { BlurView } from "expo-blur";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type OkeyMatchMode = "fun" | "aznif";

type OkeyLeaveMatchConfirmPopupProps = {
  visible: boolean;
  mode: OkeyMatchMode;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const LEAVE_TITLE = "\u0644\u06d5 \u06cc\u0627\u0631\u06cc\u06cc\u06d5\u06a9\u06d5 \u062f\u06d5\u0686\u06cc\u062a\u06d5 \u062f\u06d5\u0631\u06d5\u0648\u06d5\u061f";
const FUN_BODY = "\u0626\u06d5\u06af\u06d5\u0631 \u062f\u06d5\u0631\u0686\u06cc\u062a\u060c \u062f\u06d5\u0631\u0686\u0648\u0648\u0646\u06d5\u06a9\u06d5\u062a \u0628\u06c6 \u0626\u06d5\u0645 \u06cc\u0627\u0631\u06cc\u06cc\u06d5\u06cc Okey Fun \u062a\u06c6\u0645\u0627\u0631 \u062f\u06d5\u06a9\u0631\u06ce\u062a.";
const AZNIF_BODY = "\u062a\u06c6 \u062e\u06d5\u0631\u06cc\u06a9\u06cc \u06cc\u0627\u0631\u06cc\u06cc\u06d5\u06a9\u06cc Okey Aznif \u062c\u06ce\u0628\u0647\u06ce\u0695\u06cc\u062a. \u062f\u06d5\u0631\u0686\u0648\u0648\u0646\u06d5\u06a9\u06d5\u062a \u0628\u06d5\u067e\u06ce\u06cc \u06cc\u0627\u0633\u0627\u06a9\u0627\u0646\u06cc \u0647\u06d5\u0645\u0627\u0646 Match \u062a\u06c6\u0645\u0627\u0631 \u062f\u06d5\u06a9\u0631\u06ce\u062a.";
const CANCEL_TEXT = "\u067e\u0627\u0634\u06af\u06d5\u0632\u0628\u0648\u0648\u0646\u06d5\u0648\u06d5";
const CONFIRM_TEXT = "\u062f\u06d5\u0631\u0686\u0648\u0648\u0646 \u0644\u06d5 \u06cc\u0627\u0631\u06cc";

export default function OkeyLeaveMatchConfirmPopup({
  visible,
  mode,
  loading = false,
  onCancel,
  onConfirm,
}: OkeyLeaveMatchConfirmPopupProps) {
  if (!visible) return null;

  const isAznif = mode === "aznif";

  return (
    <View style={styles.overlay}>
      <View style={styles.scrim} />
      <BlurView intensity={45} tint="dark" style={styles.modal}>
        <Text style={styles.title}>{LEAVE_TITLE}</Text>
        <Text style={[styles.body, isAznif && styles.aznifBody]}>
          {isAznif ? AZNIF_BODY : FUN_BODY}
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
    backgroundColor: "rgba(9, 3, 18, 0.28)",
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
    shadowOffset: { width: 0, height: 8 },
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
  aznifBody: {
    color: "#fde68a",
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
