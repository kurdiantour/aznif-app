import { supabase } from '@/lib/supabase';
import { getCurrentUserId, getTransactions } from '@/lib/wallet';
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);

    Promise.all([getTransactions(), getCurrentUserId()])
      .then(async ([txs, userId]) => {
        setTransactions(txs);
        setCurrentUserId(userId);

        const profileIds = Array.from(new Set(
          txs.flatMap((item) => [item.from_user_id, item.to_user_id]).filter((id): id is string => !!id)
        ));
        if (profileIds.length === 0) return;

        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, player_id')
          .in('id', profileIds);
        if (error) throw error;

        setProfileNames(Object.fromEntries(
          (data ?? []).map((profile: any) => [
            profile.id,
            `${profile.username} (ID: ${profile.player_id})`,
          ])
        ));
      })
      .finally(() => setLoading(false));
  }, []);

  const transferTransactions = useMemo(() => {
    return transactions.filter(
      (item) => item.transaction_type === 'transfer' && item.currency === 'MC'
    );
  }, [transactions]);

  const renderItem = ({ item }: { item: WalletTransaction }) => {
    const isOutgoing = item.from_user_id === currentUserId;
    const profileId = isOutgoing ? item.to_user_id : item.from_user_id;
    const player = profileId ? profileNames[profileId] ?? 'یاریزانی نەناسراو' : 'سیستەم';

    return (
      <View style={styles.transferCard}>
        <View>
          <Text style={styles.transferTitle}>
            {isOutgoing ? 'تۆکنی نێردراو' : 'تۆکنی وەرگیراو'}
          </Text>

          <Text style={styles.transferPlayer}>
            {isOutgoing ? 'بۆ' : 'لە'}: {player}
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
          <Text style={styles.title}>گواستنەوەکان</Text>
          <Text style={styles.subtitle}>تۆکنە نێردراو و وەرگیراوەکان</Text>
        </View>

        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>گەڕانەوە</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#a855f7" size="large" style={styles.loader} />
      ) : transferTransactions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>هێشتا هیچ گواستنەوەیەک نییە</Text>
          <Text style={styles.emptyText}>
            تۆکنە نێردراو و وەرگیراوەکانت لێرە دەردەکەون.
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
    fontFamily: 'SpedaBold',
  },

  subtitle: {
    marginTop: 4,
    color: '#9ca3af',
    fontSize: 13,
    fontFamily: 'SpedaBold',
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
    fontFamily: 'SpedaBold',
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
    fontFamily: 'SpedaBold',
    marginBottom: 5,
  },

  transferPlayer: {
    color: '#d8ccff',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    marginBottom: 4,
  },

  transferDate: {
    color: '#8f9bb7',
    fontSize: 11,
    fontFamily: 'SpedaBold',
  },

  transferAmount: {
    fontSize: 18,
    fontFamily: 'SpedaBold',
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
    fontFamily: 'SpedaBold',
    marginBottom: 8,
  },

  emptyText: {
    color: '#9ca3af',
    fontSize: 13,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
    lineHeight: 19,
  },
});
