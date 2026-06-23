import { getBalance, transferFunds } from "@/lib/wallet";
import { notifyWalletRefresh } from "@/lib/walletEvents";
import type { Friend } from "@/lib/friends";
import { useEffect, useState } from "react";
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
  const isSendDisabled = submitting || !parsedAmount || parsedAmount <= 0;

  const handleSend = async () => {
    if (isSendDisabled) return;

    setError(null);

    if (parsedAmount > mcBalance) {
      setError("Insufficient ئەزنیف balance.");
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
      setError("Transfer failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.popup} onPress={() => {}}>
          <Text style={styles.title}>گواستنەوەی ئەزنیف بۆ</Text>
          <Text style={styles.playerId}>{friend.name}</Text>

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
                <Text style={styles.sendText}>ئەزنیف بنێرە</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  popup: {
    width: "100%",
    maxWidth: 470,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.45)",
    backgroundColor: "#0f0b1f",
  },

  title: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  playerId: {
    marginTop: 6,
    marginBottom: 14,
    color: "#aaa7bc",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  input: {
    width: "84%",
    height: 40,
    alignSelf: "center",
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
    marginTop: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  sendButton: {
    width: "50%",
    height: 40,
    borderRadius: 8,
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
    textTransform: "uppercase",
  },
});
