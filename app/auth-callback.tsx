import { supabase } from '@/lib/supabase';
import { useURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

function callbackParams(url: string) {
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const fragment = url.split('#')[1] ?? '';
  return new URLSearchParams(`${query}&${fragment}`);
}

export default function AuthCallbackScreen() {
  const router = useRouter(); const url = useURL(); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; const recover = async () => { if (!url) return; try { const params = callbackParams(url); const callbackError = params.get('error_description') ?? params.get('error'); if (callbackError) throw new Error(callbackError); const code = params.get('code'); const accessToken = params.get('access_token'); const refreshToken = params.get('refresh_token'); if (code) { const { error } = await supabase.auth.exchangeCodeForSession(code); if (error) throw error; } else if (accessToken && refreshToken) { const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }); if (error) throw error; } else { const { data } = await supabase.auth.getSession(); if (!data.session) throw new Error('This sign-in link is invalid or has expired.'); } const isRecovery = params.get('flow') === 'recovery' || params.get('type') === 'recovery'; router.replace(isRecovery ? '/reset-password' : '/verify-email'); } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Unable to complete authentication.'); } }; void recover(); return () => { active = false; }; }, [router, url]);
  return <View style={styles.screen}>{error ? <><Text style={styles.title}>Authentication link failed</Text><Text style={styles.message}>{error}</Text><Text style={styles.message} onPress={() => router.replace('/login')}>Return to sign in</Text></> : <><ActivityIndicator color="#fff" size="large" /><Text style={styles.message}>Completing authentication…</Text></>}</View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#050b22', alignItems: 'center', justifyContent: 'center', padding: 24 }, title: { color: '#fff', fontSize: 22, fontFamily: 'SpedaBold', marginBottom: 12 }, message: { color: '#b7c8e8', textAlign: 'center', lineHeight: 22, marginTop: 18 } });
