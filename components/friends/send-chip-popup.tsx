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
    submitting ||
    !parsedAmount ||
    parsedAmount <= 0;

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
        style={styles.cardShell}
        onPress={() => {}}
      >
        <LinearGradient
          colors={["#22114a", "#0b1027"]}
          style={styles.popup}
        >
          <Text style={styles.title}>
            گواستنەوەی ئەزنیف بۆ
          </Text>

          <Text
            style={styles.playerId}
            numberOfLines={1}
          >
            ( {friend.name} )
          </Text>

          <TextInput
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setError(null);
            }}
            placeholder="0"
            placeholderTextColor="rgba(255,255,255,0.22)"
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

          <View style={styles.footer}>
            <Pressable
              style={[
                styles.sendButton,
                isSendDisabled &&
                  styles.sendButtonDisabled,
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
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,

    zIndex: 9999,
    elevation: 9999,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "rgba(2, 4, 15, 0.78)",
  },

  cardShell: {
    width: 360,
    maxWidth: "88%",
  },

  popup: {
    width: "100%",

    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,

    alignItems: "center",

    borderRadius: 16,

    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,

    shadowOffset: {
      width: 0,
      height: 8,
    },

    elevation: 16,
  },

  title: {
    color: "#ffffff",

    fontSize: 16,
    fontFamily: "SpedaBold",

    textAlign: "center",
    writingDirection: "rtl",
  },

  playerId: {
    marginTop: 7,
    marginBottom: 16,

    color: "#ffffff",

    fontSize: 15,
    lineHeight: 20,

    textAlign: "center",
  },

  input: {
    width: "100%",
    height: 36,

    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",

    backgroundColor: "rgba(0,0,0,0.22)",
    color: "#ffffff",

    paddingHorizontal: 14,
    paddingVertical: 0,

    fontSize: 16,

    textAlign: "center",
  },

  errorText: {
    marginTop: 12,

    color: "#ff8a8a",

    fontSize: 12,
    fontFamily: "SpedaBold",

    textAlign: "center",
    writingDirection: "rtl",
  },

  footer: {
    width: "100%",
    marginTop: 18,
  },

  sendButton: {
    width: "100%",
    height: 40,

    borderRadius: 10,
    backgroundColor: "#7c3aed",

    alignItems: "center",
    justifyContent: "center",
  },

  sendButtonDisabled: {
    opacity: 0.35,
  },

  sendText: {
    color: "#ffffff",

    fontSize: 13,
    fontFamily: "SpedaBold",

    textAlign: "center",
    writingDirection: "rtl",
  },
});
