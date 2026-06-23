import { getCurrentUserId, getTransactions } from "@/lib/wallet";
import { WalletTransaction } from "@/types/wallet";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export default function WalletHistoryScreen() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getTransactions(), getCurrentUserId()])
      .then(([txs, uid]) => {
        setTransactions(txs);
        setCurrentUserId(uid);
      })
      .finally(() => setLoading(false));
  }, []);

  const getLabel = (item: WalletTransaction, isOutgoing: boolean) => {
    if (item.transaction_type === "transfer") {
      return isOutgoing ? "Sent" : "Received";
    }
    if (item.transaction_type === "reward") {
      return "Reward";
    }
    if (
      item.transaction_type === "manual_purchase" ||
      item.transaction_type === "shop_purchase"
    ) {
      return "Purchase";
    }
    if (item.transaction_type === "bet") {
      return "Create Room Bet";
    }
    return item.transaction_type;
  };

  const renderItem = ({ item }: { item: WalletTransaction }) => {
    const isOutgoing = currentUserId
      ? item.from_user_id === currentUserId
      : false;
    const label = getLabel(item, isOutgoing);
    const counterparty = isOutgoing
      ? item.to_user_id
      : item.from_user_id || "System";
    const sign =
      item.transaction_type === "reward" ? "+" : isOutgoing ? "-" : "+";
    const currencyLabel = item.currency === "Gold" ? "گەوهەر" : item.currency;
    const amountText = `${sign}${item.amount.toFixed(item.currency === "Gold" ? 0 : 2)} ${currencyLabel}`;

    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <Text style={styles.transactionLabel}>{label}</Text>
          <Text style={styles.transactionAmount}>{amountText}</Text>
        </View>
        <Text style={styles.transactionDetail}>
          لایەنی بەرامبەر: {counterparty}
        </Text>
        <Text style={styles.transactionDetail}>
          {new Date(item.created_at).toLocaleString()}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>مێژووی مامەڵەکان</Text>
        <Pressable onPress={() => router.back()} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>گەڕانەوە</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#7dd3fc" size="large" style={styles.loader} />
      ) : transactions.length === 0 ? (
        <Text style={styles.emptyText}>هێشتا هیچ مامەڵەیەک تۆمار نەکراوە.</Text>
      ) : (
        <FlatList
          data={transactions}
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
    backgroundColor: "#090b1d",
    padding: 24,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    color: "#ffffff",
    fontSize: 30,
    fontFamily: "SpedaBold",
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  closeButtonText: {
    color: "#7dd3fc",
    fontSize: 14,
    fontFamily: "SpedaBold",
  },
  loader: {
    marginTop: 40,
  },
  emptyText: {
    color: "#9fb0d1",
    fontSize: 15,
    marginTop: 32,
  },
  listContent: {
    gap: 14,
  },
  transactionCard: {
    backgroundColor: "#132347",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#2c4d8f",
    marginBottom: 12,
  },
  transactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  transactionLabel: {
    color: "#cbd5e1",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  transactionAmount: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
  },
  transactionDetail: {
    color: "#b7c5ff",
    fontSize: 13,
    marginTop: 4,
  },
});
