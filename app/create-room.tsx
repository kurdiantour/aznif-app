import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { LobbyHeader } from '@/components/lobby/LobbyHeader';
import { getBalance } from '@/lib/wallet';
import { Wallet } from '@/types/wallet';

const BET_OPTIONS = [10, 25, 50, 100, 250];

export default function CreateRoomScreen() {
  const router = useRouter();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [selectedBet, setSelectedBet] = useState<number>(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBalance()
      .then(setWallet)
      .catch(() => setError('Unable to load balance.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectBet = (amount: number) => {
    setError(null);
    setSelectedBet(amount);
  };

  const handleBackToLobby = () => {
    router.replace('/(tabs)/lobby');
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <LobbyHeader />

        <View style={styles.loading}>
          <ActivityIndicator color="#ffffff" size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LobbyHeader />

      <View style={styles.content}>
        {BET_OPTIONS.map((amount) => {
          const active = selectedBet === amount;
          const disabled = wallet ? amount > wallet.balances.mc : true;

          return (
            <Pressable
              key={amount}
              style={[
                styles.card,
                active && styles.cardActive,
                disabled && styles.cardDisabled,
              ]}
              onPress={() => handleSelectBet(amount)}
              disabled={disabled}
            >
              <Image
                source={require('@/assets/images/lobby/create-room.webp')}
                style={styles.cardImageInner}
                resizeMode="cover"
              />

              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.92)']}
                style={styles.bottomFade}
              />

              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle}>{amount} MC</Text>

                <Text style={styles.cardSubtitle}>
                  Prize pool {amount * 2} MC
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={styles.backButton} onPress={handleBackToLobby}>
        <Text style={styles.backButtonText}>گەڕانەوە</Text>
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#090b1d',
    paddingHorizontal: 36,
    paddingTop: 14,
    paddingBottom: 26,
  },

  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },

  card: {
    flex: 1,
    height: 226,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(180,120,255,0.42)',
    backgroundColor: 'rgba(17,24,39,0.82)',
  },

  cardActive: {
    borderColor: '#facc15',
  },

  cardDisabled: {
    opacity: 0.42,
  },

  cardImageInner: {
    width: '100%',
    height: '100%',
  },

  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
  },

  cardInfo: {
    position: 'absolute',
    left: 15,
    right: 15,
    bottom: 12,
  },

  cardTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontFamily: 'SpedaBold',
  },

  cardSubtitle: {
    marginTop: 2,
    color: '#f3f4f6',
    fontSize: 10,
    fontFamily: 'SpedaBold',
  },

  backButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },

  backButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'SpedaBold',
  },

  errorText: {
    marginTop: 10,
    color: '#ff9a9a',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },
});
