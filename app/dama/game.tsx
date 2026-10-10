import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import WaitingPlayersPopup, { type WaitingPlayerMember } from '@/components/multiplayer/WaitingPlayersPopup';
import { useGameSystemGestureProtection } from '@/hooks/useGameSystemGestureProtection';
import { hasReadySession, useAuthState } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';

type Access = 'checking' | 'ready' | 'offline' | 'signin';
type MatchmakingStatus = {
  status: 'none' | 'searching' | 'matched' | 'cancelled';
  roomId?: string;
  roomStatus?: string;
  entryFee?: number;
  countdownEndsAt?: string | null;
  players?: WaitingPlayerMember[];
};

function describeMatchmakingError(message: string) {
  if (message.includes('insufficient_entry_balance')) {
    return 'بۆ یاری دامە ٥٠٠ سکە پێویستە';
  }
  if (message.includes('authentication_required')) {
    return 'تکایە بچۆ ژوورەوە و دووبارە هەوڵ بدەوە';
  }
  return message;
}

export default function DamaGameScreen() {
  useGameSystemGestureProtection();
  const auth = useAuthState();
  const [access, setAccess] = useState<Access>('checking');
  const [retry, setRetry] = useState(0);
  const [matchmaking, setMatchmaking] = useState<MatchmakingStatus | null>(null);
  const [matchmakingError, setMatchmakingError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasReadySession(auth)) {
      void Promise.resolve().then(() => {
        if (!cancelled) setAccess(auth.authReady ? 'signin' : 'checking');
      });
      return () => { cancelled = true; };
    }
    void Promise.resolve().then(() => { if (!cancelled) setAccess('checking'); });
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!cancelled) { timedOut = true; setAccess('offline'); }
    }, 8000);
    // getUser contacts Supabase Auth and checks the live session and connection.
    void supabase.auth.getUser().then(({ data, error }) => {
      clearTimeout(timeout);
      if (cancelled || timedOut) return;
      const valid = !error && data.user?.id === auth.userId && hasReadySession();
      setAccess(valid ? 'ready' : 'offline');
    }).catch(() => {
      clearTimeout(timeout);
      if (!cancelled && !timedOut) setAccess('offline');
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [auth, retry]);

  useEffect(() => {
    if (access !== 'ready') {
      setMatchmaking(null);
      return;
    }

    let cancelled = false;
    let polling: ReturnType<typeof setInterval> | null = null;
    const refreshStatus = async () => {
      const { data, error } = await supabase.rpc('dama_matchmaking_status');
      if (cancelled) return;
      if (error) {
        setMatchmakingError(describeMatchmakingError(error.message));
        return;
      }
      const status = data as MatchmakingStatus;
      setMatchmaking(status.status === 'none' || status.status === 'cancelled' ? null : status);
      setMatchmakingError(null);
    };
    const start = async () => {
      const { data, error } = await supabase.rpc('dama_matchmake');
      if (cancelled) return;
      if (error) {
        setMatchmakingError(describeMatchmakingError(error.message));
        return;
      }
      setMatchmaking(data as MatchmakingStatus);
      setMatchmakingError(null);
      polling = setInterval(() => { void refreshStatus(); }, 1_500);
    };

    void start();
    return () => {
      cancelled = true;
      if (polling) clearInterval(polling);
    };
  }, [access]);

  const cancelMatchmaking = async () => {
    setCancelling(true);
    const { error } = await supabase.rpc('dama_cancel_matchmaking');
    setCancelling(false);
    if (error) {
      setMatchmakingError(describeMatchmakingError(error.message));
      return;
    }
    setMatchmaking(null);
  };

  return (
    <View style={styles.scene}>
      <View style={styles.overlay}>
        <Text style={styles.title}>{access === 'checking' ? 'Checking session…' : access === 'signin' ? 'Sign in to play Dama' : access === 'offline' ? 'Connect to the internet to play' : matchmakingError ? 'Unable to enter Dama matchmaking' : matchmaking?.status === 'matched' ? 'Opponent found' : 'Finding an opponent'}</Text>
        {matchmakingError ? <Text style={styles.error}>{matchmakingError}</Text> : null}
        {access === 'offline' && <Pressable style={styles.button} onPress={() => setRetry((value) => value + 1)}><Text style={styles.buttonText}>Retry</Text></Pressable>}
        {access === 'signin' && <Pressable style={styles.button} onPress={() => router.replace('/login')}><Text style={styles.buttonText}>Sign in</Text></Pressable>}
        {access === 'ready' && matchmakingError && <Pressable style={styles.button} onPress={() => router.replace('/(tabs)/play')}><Text style={styles.buttonText}>Back to games</Text></Pressable>}
      </View>
      {access === 'ready' && matchmaking && (
        <WaitingPlayersPopup
          visible
          entryFee={matchmaking.entryFee ?? 500}
          currency="fun"
          players={matchmaking.players ?? []}
          playerCount={2}
          countdownEndsAt={matchmaking.countdownEndsAt ?? null}
          statusMessage={matchmaking.status === 'matched'
            ? 'حریف دۆزرایەوە؛ خزمەتگوزاری دەستپێکردنی یاری ئامادە نییە'
            : undefined}
          canCancel
          loading={cancelling}
          onCancel={() => { void cancelMatchmaking(); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: '#0c0c20', overflow: 'hidden' },
  overlay: { flex: 1, backgroundColor: '#0c0c20', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff3db', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  error: { color: '#ffb4b4', fontSize: 13, textAlign: 'center', marginTop: 12 },
  button: { marginTop: 22, backgroundColor: '#8a4dac', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
