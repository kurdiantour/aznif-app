import type { Friend } from "@/lib/friends";
import { transferFunds } from "@/lib/wallet";
import { useWallet } from "@/lib/wallet-context";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type SendChipPopupProps = {
  visible: boolean;
  friend: Friend | null;
  onClose: () => void;
  onTransferSuccess?: () => void;
};

type SendChipPopupController = {
  showSendChipPopup: (
    friend: Friend,
    onTransferSuccess?: () => void,
  ) => void;
};

export const SendChipPopupContext =
  createContext<SendChipPopupController>({
    showSendChipPopup: () => {},
  });

export function SendChipPopup({
  visible,
  friend,
  onClose,
  onTransferSuccess,
}: SendChipPopupProps) {
  const [amount, setAmount] = useState("");
  const { refreshWallet } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (visible) return;

    Keyboard.dismiss();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount("");
    setError(null);
    setSubmitting(false);
  }, [visible]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      () => setKeyboardVisible(true),
    );

    const hideSubscription = Keyboard.addListener(
      "keyboardDidHide",
      () => setKeyboardVisible(false),
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (!visible || !friend) return null;

  const parsedAmount = Number(
    amount.replace(/[^0-9.]/g, ""),
  );

  const isSendDisabled =
    submitting || !parsedAmount || parsedAmount <= 0;

  const handleBackdropPress = () => {
    if (keyboardVisible) {
      Keyboard.dismiss();
      return;
    }

    onClose();
  };

  const handleSend = async () => {
    if (isSendDisabled) return;

    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);

    try {
      await transferFunds(friend.id, parsedAmount);

      void refreshWallet();

      setAmount("");
      onTransferSuccess?.();
      onClose();
    } catch (err) {
      console.error(
        "[SendChipPopup] MC transfer failed:",
        err,
      );

      setError("گواستنەوەکە سەرکەوتوو نەبوو.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleBackdropPress}
      />

      <Pressable
        style={styles.card}
        onPress={() => {}}
      >
        <LinearGradient
          colors={[
            "rgba(2,6,23,0.92)",
            "rgba(9,18,40,0.86)",
          ]}
          style={styles.gradient}
        >
          <View style={styles.headerPanel}>
            <Text style={styles.title}>
              گواستنەوەی ئەزنیف بۆ
            </Text>

            <Text
              style={styles.playerId}
              numberOfLines={1}
            >
              ( {friend.name} )
            </Text>
          </View>

          <TextInput
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setError(null);
            }}
            placeholder="0"
            placeholderTextColor="rgba(255,255,255,0.28)"
            keyboardType="number-pad"
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
            style={styles.input}
          />

          {error ? (
            <Text style={styles.errorText}>
              {error}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.sendButton,
              isSendDisabled &&
                styles.sendButtonDisabled,
              pressed &&
                !isSendDisabled &&
                styles.buttonPressed,
            ]}
            onPress={handleSend}
            disabled={isSendDisabled}
          >
            {submitting ? (
              <ActivityIndicator
                color="#ffffff"
                size="small"
              />
            ) : (
              <Text style={styles.sendText}>
                بینێرە
              </Text>
            )}
          </Pressable>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2, 6, 23, 0.82)",
    paddingHorizontal: 16,
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

  gradient: {
    width: "100%",
    padding: 12,
  },

  headerPanel: {
    minHeight: 92,
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

  title: {
    width: "100%",
    color: "#ffffff",
    fontSize: 19,
    lineHeight: 28,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  playerId: {
    width: "100%",
    marginTop: 6,
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },

  input: {
    width: "100%",
    height: 46,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.18)",
    color: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: 16,
    textAlign: "center",
  },

  errorText: {
    marginTop: 10,
    color: "#ff8a8a",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  sendButton: {
    width: "100%",
    minHeight: 48,
    marginTop: 12,
    borderRadius: 6,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },

  sendButtonDisabled: {
    backgroundColor: "rgba(37,99,235,0.32)",
    opacity: 0.55,
  },

  buttonPressed: {
    opacity: 0.86,
  },

  sendText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
});