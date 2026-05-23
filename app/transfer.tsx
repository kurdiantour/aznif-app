import { CURRENT_USER_ID, getTransactions } from '@/lib/wallet';
import { WalletTransaction } from '@/types/wallet';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function WalletHistoryScreen() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    getTransactions()
      .then(setTransactions)
      .finally(() => setLoading(false));
  }, []);

  const transferTransactions = useMemo(() => {
    return transactions.filter(
      (item) => item.transaction_type === 'transfer' && item.currency === 'MC'
    );
  }, [transactions]);

  const renderItem = ({ item }: { item: WalletTransaction }) => {
    const isOutgoing = item.from_user_id === CURRENT_USER_ID;
    const player = isOutgoing ? item.to_user_id : item.from_user_id || 'System';

    return (
      <View style={styles.transferCard}>
        <View>
          <Text style={styles.transferTitle}>
            {isOutgoing ? 'Sent Chip' : 'Received Chip'}
          </Text>

          <Text style={styles.transferPlayer}>
            {isOutgoing ? 'To' : 'From'}: {player}
          </Text>

          <Text style={styles.transferDate}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
        </View>

        <Text
          style={[
            styles.transferAmount,
            isOutgoing ? styles.outgoingAmount : styles.incomingAmount,
          ]}
        >
          {isOutgoing ? '-' : '+'}
          {item.amount.toFixed(2)} MC
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Transfers</Text>
          <Text style={styles.subtitle}>MC Chips sent and received</Text>
        </View>

        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#a855f7" size="large" style={styles.loader} />
      ) : transferTransactions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No transfers yet</Text>
          <Text style={styles.emptyText}>
            Your sent and received MC Chips will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={transferTransactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090b1d',
    padding: 24,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },

  title: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
  },

  subtitle: {
    marginTop: 4,
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
  },

  backButton: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  backButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  loader: {
    marginTop: 40,
  },

  listContent: {
    gap: 12,
    paddingBottom: 24,
  },

  transferCard: {
    minHeight: 86,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.35)',
    backgroundColor: 'rgba(20,16,42,0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  transferTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 5,
  },

  transferPlayer: {
    color: '#d8ccff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },

  transferDate: {
    color: '#8f9bb7',
    fontSize: 11,
    fontWeight: '700',
  },

  transferAmount: {
    fontSize: 18,
    fontWeight: '900',
  },

  incomingAmount: {
    color: '#22c55e',
  },

  outgoingAmount: {
    color: '#f59e0b',
  },

  emptyBox: {
    marginTop: 42,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.28)',
    backgroundColor: 'rgba(20,16,42,0.82)',
    alignItems: 'center',
  },

  emptyTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
  },

  emptyText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 19,
  },
});