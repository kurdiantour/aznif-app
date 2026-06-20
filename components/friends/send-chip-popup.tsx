import { getBalance, transferFunds } from '@/lib/wallet';
import { notifyWalletRefresh } from '@/lib/walletEvents';
import type { Friend } from '@/lib/friends';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
  const [amount, setAmount] = useState('');
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

  if (!friend) return null;

  const handleSend = async () => {
    if (submitting) return;

    setError(null);

    const parsedAmount = Number(amount.replace(/[^0-9.]/g, ''));

    if (!parsedAmount || parsedAmount <= 0) {
      setError('Please enter a valid MC amount.');
      return;
    }

    if (parsedAmount > mcBalance) {
      setError('Insufficient MC balance.');
      return;
    }

    setSubmitting(true);

    try {
      await transferFunds(friend.id, parsedAmount);

      const wallet = await getBalance();
      setMcBalance(wallet.balances.mc);

      notifyWalletRefresh();
      setAmount('');
      onTransferSuccess?.();
      onClose();
    } catch (err) {
      console.error('[SendChipPopup] MC transfer failed:', err);
      setError('Transfer failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.popup}>
          <Text style={styles.balance}>
            Balance: {loadingBalance ? '...' : mcBalance.toFixed(0)} MC
          </Text>

          <Text style={styles.title}>تۆکن بنێرە بۆ {friend.name}</Text>
          <Text style={styles.playerId}>ناسنامە: {friend.playerId}</Text>

          <View style={styles.divider} />

          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor="rgba(255,255,255,0.38)"
            keyboardType="numeric"
            style={styles.input}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.footer}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>پاشگەزبوونەوە</Text>
            </Pressable>

            <Pressable
              style={[styles.sendButton, submitting && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.sendText}>تۆکن بنێرە</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  popup: {
    width: '100%',
    maxWidth: 470,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.45)',
    backgroundColor: '#0f0b1f',
  },

  balance: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
    marginBottom: 22,
  },

  title: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  divider: {
    width: '72%',
    height: 1,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 12,
    marginBottom: 28,
  },

  input: {
    width: '84%',
    height: 44,
    alignSelf: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    color: '#ffffff',
    paddingHorizontal: 14,
    fontSize: 18,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  errorText: {
    color: '#ff8a8a',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
    marginTop: 12,
  },

  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },

  cancelButton: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  cancelText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textTransform: 'uppercase',
  },

  sendButton: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },

  playerId: {
    marginTop: 6,
    color: '#aaa7bc',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  sendButtonDisabled: {
    opacity: 0.65,
  },

  sendText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textTransform: 'uppercase',
  },
});
