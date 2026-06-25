import type { Friend } from "@/lib/friends";
import { getBalance, transferFunds } from "@/lib/wallet";
import { notifyWalletRefresh } from "@/lib/walletEvents";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

export const SendChipPopupContext = createContext<SendChipPopupController>({
  showSendChipPopup: () => {},
});

export function SendChipPopup({
  visible,
  friend,
  onClose,
  onTransferSuccess,
}: SendChipPopupProps) {
  const [amount, setAmount] = useState("");
  const [mcBalance, setMcBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadBalance() {
      if (!visible) return;

      setLoadingBalance(true);

      try {
        const wallet = await getBalance();

        if (mounted) {
          setMcBalance(wallet.balances.mc);
        }
      } catch {
        if (mounted) {
          setMcBalance(0);
        }
      } finally {
        if (mounted) {
          setLoadingBalance(false);
        }
      }
    }

    loadBalance();

    return () => {
      mounted = false;
    };
  }, [visible]);

  if (!visible || !friend) return null;

  const parsedAmount = Number(amount.replace(/[^0-9.]/g, ""));
  const isSendDisabled =
    submitting || loadingBalance || !parsedAmount || parsedAmount <= 0;

  const handleSend = async () => {
    if (isSendDisabled) return;

    setError(null);

    if (parsedAmount > mcBalance) {
      setError("ئەزنیفی پێویستت نییە.");
      return;
    }

    setSubmitting(true);

    try {
      await transferFunds(friend.id, parsedAmount);

      const wallet = await getBalance();
      setMcBalance(wallet.balances.mc);

      notifyWalletRefresh();
      setAmount("");
      onTransferSuccess?.();
      onClose();
    } catch (err) {
      console.error("[SendChipPopup] MC transfer failed:", err);
      setError("گواستنەوەکە سەرکەوتوو نەبوو.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      <Pressable style={styles.cardShell} onPress={() => {}}>
        <LinearGradient colors={["#22114a", "#0b1027"]} style={styles.popup}>
          <Text style={styles.title}>گواستنەوەی ئەزنیف بۆ</Text>
          <Text style={styles.playerId} numberOfLines={1}>
            {friend.name}
          </Text>

          <TextInput
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setError(null);
            }}
            placeholder="0"
            placeholderTextColor="rgba(255,255,255,0.38)"
            keyboardType="numeric"
            style={styles.input}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.footer}>
            <Pressable
              style={[
                styles.sendButton,
                isSendDisabled && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={isSendDisabled}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.sendText}>بینێرە</Text>
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
    paddingHorizontal: 24,
  },

  cardShell: {
    width: "100%",
    maxWidth: 310,
  },

  popup: {
    width: "100%",
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
  },

  title: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  playerId: {
    marginTop: 8,
    marginBottom: 16,
    color: "#aaa7bc",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  input: {
    width: "100%",
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
    backgroundColor: "rgba(0,0,0,0.22)",
    color: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: 16,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  errorText: {
    color: "#ff8a8a",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    marginTop: 12,
  },

  footer: {
    width: "100%",
    marginTop: 18,
  },

  sendButton: {
    width: "100%",
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(221, 214, 254, 0.6)",
    backgroundColor: "#7c3aed",
    alignItems: "center",
    justifyContent: "center",
  },

  sendButtonDisabled: {
    opacity: 0.35,
  },

  sendText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
});
