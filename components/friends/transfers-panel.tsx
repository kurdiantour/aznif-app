import { getCurrentUserId, getTransactions } from '@/lib/wallet';
import { supabase } from '@/lib/supabase';
import { WalletTransaction } from '@/types/wallet';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export function TransfersPanel() {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);

    Promise.all([getTransactions(), getCurrentUserId()])
      .then(async ([txs, uid]) => {
        setTransactions(txs);
        setCurrentUserId(uid);

        const profileIds = Array.from(
          new Set(
            txs
              .filter(
                (item) =>
                  item.transaction_type === 'transfer' &&
                  item.currency === 'MC'
              )
              .flatMap((item) => [item.from_user_id, item.to_user_id])
              .filter((id): id is string => !!id)
          )
        );

        if (profileIds.length === 0) {
          setProfileNames({});
          return;
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, player_id')
          .in('id', profileIds);

        if (error) throw error;

        setProfileNames(
          Object.fromEntries(
            (data ?? []).map((profile: any) => [
              profile.id,
              `${profile.username} (${profile.player_id})`,
            ])
          )
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const transferTransactions = useMemo(() => {
    return transactions.filter(
      (item) =>
        item.transaction_type === 'transfer' &&
        item.currency === 'MC'
    );
  }, [transactions]);

  const renderItem = ({ item }: { item: WalletTransaction }) => {
    const isOutgoing = currentUserId
      ? item.from_user_id === currentUserId
      : false;

    const playerId = isOutgoing
      ? item.to_user_id
      : item.from_user_id;

    const player = playerId
      ? profileNames[playerId] ?? playerId
      : 'System';

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
            isOutgoing
              ? styles.outgoingAmount
              : styles.incomingAmount,
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
      {loading ? (
        <ActivityIndicator
          color="#a855f7"
          size="large"
          style={styles.loader}
        />
      ) : transferTransactions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>
            No transfers yet
          </Text>

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
    marginTop: 8,
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