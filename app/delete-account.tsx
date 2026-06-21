import { AuthScreen, styles } from './forgot-password';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/lib/supabaseAuth';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput } from 'react-native';

export default function DeleteAccountScreen() {
  const router = useRouter(); const [confirmation, setConfirmation] = useState(''); const [loading, setLoading] = useState(false); const [message, setMessage] = useState('');
  const removeAccount = async () => { if (confirmation.trim() !== 'DELETE') return setMessage('Type DELETE exactly to confirm.'); setLoading(true); setMessage(''); try { const { error } = await supabase.functions.invoke('delete_account'); if (error) throw error; await signOut(); router.replace('/login'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete your account.'); } finally { setLoading(false); } };
  return <AuthScreen title="Delete account" subtitle="This permanently deletes your account and its data. Leave or cancel active matches first.">
    <Text style={styles.error}>This action cannot be undone.</Text>
    <TextInput style={styles.input} value={confirmation} onChangeText={setConfirmation} placeholder="Type DELETE to confirm" placeholderTextColor="#7f8fb2" autoCapitalize="characters" editable={!loading} />
    {!!message && <Text style={styles.error}>{message}</Text>}
    <Pressable style={[styles.primaryButton, { backgroundColor: '#b91c1c' }, loading && styles.disabled]} onPress={removeAccount} disabled={loading}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Permanently delete account</Text>}</Pressable>
    <Pressable onPress={() => router.back()} disabled={loading}><Text style={styles.link}>Cancel</Text></Pressable>
  </AuthScreen>;
}
