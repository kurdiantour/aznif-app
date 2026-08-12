import { Ionicons } from "@expo/vector-icons";
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

const LEAVE_TITLE =
  "دڵنیایت لە یارییەکە دەچیتە دەرەوە؟";

const LOCAL_GAME_BODY =
    "بەجێهێشتنی یاری پێش کۆتایی وەک دۆڕان تۆمار دەکرێت و پوینت لەدەست دەدەیت.";


const ONLINE_GAME_BODY =
    "بەجێهێشتنی یاری پێش کۆتایی وەک دۆڕان تۆمار دەکرێت و ئەنجامەکە بە پێی یاساکانی یارییەکە هەژمار دەکرێت.";

const CANCEL_TEXT = "پاشگەزبوونەوە";
const CONFIRM_TEXT = "دەرچوون لە یاری";

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
        <View style={styles.warningIconCircle}>
          <Ionicons
            name="warning-outline"
            size={28}
            color="#facc15"
          />
        </View>

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
            style={[
              styles.confirmButton,
              loading && styles.buttonDisabled,
            ]}
            onPress={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.confirmText}>
                {CONFIRM_TEXT}
              </Text>
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
    maxWidth: 480,
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

  warningIconCircle: {
    width: 54,
    height: 54,
    marginBottom: 12,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(250, 204, 21, 0.65)",
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
    fontSize: 14,
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
    minWidth: 140,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  confirmButton: {
    minWidth: 140,
    height: 40,
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
    fontSize: 13,
    fontFamily: "SpedaBold",
  },

  confirmText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },
});