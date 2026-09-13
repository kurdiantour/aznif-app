import { formatAznif } from "@/lib/aznif-display";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId, getTransactions } from "@/lib/wallet";
import { WalletTransaction } from "@/types/wallet";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";

export function TransfersPanel() {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
                  item.transaction_type === "transfer" &&
                  item.currency === "MC",
              )
              .flatMap((item) => [item.from_user_id, item.to_user_id])
              .filter((id): id is string => !!id),
          ),
        );

        if (profileIds.length === 0) {
          setProfileNames({});
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("id, username")
          .in("id", profileIds);

        if (error) throw error;

        setProfileNames(
          Object.fromEntries(
            (data ?? []).map((profile: any) => [profile.id, profile.username]),
          ),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const transferTransactions = useMemo(() => {
    return transactions.filter(
      (item) => item.transaction_type === "transfer" && item.currency === "MC",
    );
  }, [transactions]);

  const renderItem = ({ item }: { item: WalletTransaction }) => {
    const isOutgoing = currentUserId
      ? item.from_user_id === currentUserId
      : false;

    const profileId = isOutgoing ? item.to_user_id : item.from_user_id;
    const player = profileId
      ? (profileNames[profileId] ?? "یارێزانی نەناسراو")
      : "سیستەم";
    const title = isOutgoing ? "ئەزنیف نێردراو" : "ئەزنیف وەرگیراو";
    const direction = isOutgoing ? "بۆ" : "لە";

    return (
      <View style={styles.transferCard}>
        <View style={styles.transferInfo}>
          <Text style={styles.transferTitle} numberOfLines={1}>
            {title} {direction}: {player}
          </Text>
        </View>

        <Text
          style={[
            styles.transferAmount,
            isOutgoing ? styles.outgoingAmount : styles.incomingAmount,
          ]}
          numberOfLines={1}
        >
          {isOutgoing ? "-" : "+"}
          {formatAznif(item.amount)} ئەزنیف
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color="#a855f7" size="large" style={styles.loader} />
      ) : transferTransactions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>هێشتا هیچ گواستنەوەیەک نییە</Text>

          <Text style={styles.emptyText}>
            مێژووی گواستنەوەی ئەزنیفەکانت لێرە دەردەکەوێت.
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
    gap: 8,
    paddingBottom: 18,
  },

  transferCard: {
    minHeight: 48,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(170,105,255,0.28)",
    backgroundColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  transferInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
  },

  transferTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "right",
    width: "100%",
  },

  transferAmount: {
    minWidth: 96,
    fontSize: 12,
    fontFamily: "RobotoMedium",
    textAlign: "left",
  },

  incomingAmount: {
    color: "#22c55e",
  },

  outgoingAmount: {
    color: "#f59e0b",
  },

  emptyBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },

  emptyTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    marginBottom: 8,
    textAlign: "center",
  },

  emptyText: {
    color: "#9ca3af",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
    lineHeight: 19,
  },
});
