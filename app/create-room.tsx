import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { LobbyHeader } from '@/components/lobby/LobbyHeader';
import { supabase } from '@/lib/supabase';
import { getBalance } from '@/lib/wallet';
import { Wallet } from '@/types/wallet';

const BET_OPTIONS = [10, 25, 50, 100, 250];

export default function CreateRoomScreen() {
  const router = useRouter();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [selectedBet, setSelectedBet] = useState<number>(25);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [roomCode, setRoomCode] = useState('');
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

  const openPrivateRoom = (roomId: string, code?: string) => {
    router.replace({
      pathname: '/matchmaking',
      params: { mode: '1v1', matchmaking_status: 'private', room_id: roomId, room_code: code ?? '', matchType: 'private' },
    });
  };

  const friendlyRoomError = (reason: unknown, fallback: string) => {
    const message = reason instanceof Error ? reason.message : fallback;
    const normalized = message.toLowerCase();
    if (normalized.includes('not found')) return 'We could not find a room with that code.';
    if (normalized.includes('not joinable') || normalized.includes('full')) return 'This room is no longer available. Ask the host for a new code.';
    if (normalized.includes('authentication')) return 'Please sign in again before joining a room.';
    return message;
  };

  const handleCreateRoom = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: createError } = await supabase.rpc('create_one_vs_one_room', {
        p_bet_amount: selectedBet,
      });
      if (createError) throw createError;
      if (!data?.id) throw new Error('Unable to create a private room.');
      openPrivateRoom(data.id, data.room_code);
    } catch (createError) {
      setError(friendlyRoomError(createError, 'Unable to create private room.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setError('Enter a room code.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: joinError } = await supabase.rpc('join_one_vs_one_room', {
        p_room_code: code,
      });
      if (joinError) throw joinError;
      if (!data?.room_id) throw new Error('Unable to join this private room.');
      openPrivateRoom(data.room_id, code);
    } catch (joinError) {
      setError(friendlyRoomError(joinError, 'Unable to join private room.'));
    } finally {
      setSubmitting(false);
    }
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
                <Text style={styles.cardTitle}>{amount} ئەزنیف</Text>

                <Text style={styles.cardSubtitle}>
                  Prize pool {amount * 2} ئەزنیف
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.privateActions}>
        <Pressable style={[styles.actionButton, submitting && styles.actionButtonDisabled]} onPress={handleCreateRoom} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.actionButtonText}>Create private room</Text>}
        </Pressable>
        <View style={styles.joinRow}>
          <TextInput value={roomCode} onChangeText={setRoomCode} placeholder="Room code" placeholderTextColor="#aab4c8" autoCapitalize="characters" editable={!submitting} style={styles.roomCodeInput} />
          <Pressable style={[styles.joinButton, submitting && styles.actionButtonDisabled]} onPress={handleJoinRoom} disabled={submitting}>
            <Text style={styles.actionButtonText}>Join by code</Text>
          </Pressable>
        </View>
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

  privateActions: { marginTop: 14, gap: 8 },
  actionButton: { height: 44, borderRadius: 12, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: { color: '#ffffff', fontSize: 13, fontFamily: 'SpedaBold' },
  joinRow: { flexDirection: 'row', gap: 8 },
  roomCodeInput: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(180,120,255,0.42)', backgroundColor: 'rgba(17,24,39,0.82)', color: '#ffffff', paddingHorizontal: 12, fontFamily: 'SpedaBold' },
  joinButton: { width: 126, height: 44, borderRadius: 12, backgroundColor: '#6d28d9', alignItems: 'center', justifyContent: 'center' },

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
