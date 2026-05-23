import { getBalance } from '@/lib/wallet';
import { Wallet } from '@/types/wallet';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const shopItems = [
  {
    id: 'table-skin',
    title: 'Table Skin',
    subtitle: 'Cosmetic table background',
    price: 45,
  },
  {
    id: 'tile-skin',
    title: 'Domino Tile Skin',
    subtitle: 'New tile artwork',
    price: 60,
  },
  {
    id: 'avatar-frame',
    title: 'Avatar Frame',
    subtitle: 'Cosmetic player frame',
    price: 30,
  },
];

export default function ShopScreen() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getBalance()
      .then(setWallet)
      .catch((err) => setError(err.message || 'Unable to load balance.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Shop</Text>
      <Text style={styles.subtitle}>Gold/Gems are used only for cosmetics and shop purchases.</Text>

      {loading ? (
        <ActivityIndicator color="#7dd3fc" size="large" style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : wallet ? (
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Gold Balance</Text>
          <Text style={styles.balanceValue}>{wallet.balances.gold.toFixed(0)} Gold</Text>
        </View>
      ) : null}

      <View style={styles.shopList}>
        {shopItems.map((item) => (
          <View key={item.id} style={styles.shopItem}>
            <View>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
            </View>
            <View style={styles.itemActions}>
              <Text style={styles.itemPrice}>{item.price} Gold</Text>
              <Pressable style={styles.disabledButton} disabled>
                <Text style={styles.disabledButtonText}>Coming Soon</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.note}>This is a mock shop layout. Gold/Gems are displayed here as a cosmetic currency only.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#090b1d',
    padding: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9fb0d1',
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  loader: {
    marginTop: 32,
  },
  errorText: {
    color: '#ff8a8a',
    marginBottom: 18,
  },
  balanceCard: {
    backgroundColor: '#132347',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2c4d8f',
    marginBottom: 20,
  },
  balanceLabel: {
    color: '#9fb0d1',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  balanceValue: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
  },
  shopList: {
    gap: 14,
  },
  shopItem: {
    backgroundColor: '#132347',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2c4d8f',
  },
  itemTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  itemSubtitle: {
    color: '#b7c5ff',
    fontSize: 13,
  },
  itemActions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemPrice: {
    color: '#facc15',
    fontSize: 14,
    fontWeight: '700',
  },
  disabledButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  disabledButtonText: {
    color: '#9fb0d1',
    fontSize: 13,
    fontWeight: '700',
  },
  note: {
    marginTop: 22,
    color: '#9fb0d1',
    fontSize: 13,
    lineHeight: 20,
  },
});
