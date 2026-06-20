import type { User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

export type Profile = {
  id: string;
  email: string | null;
  player_id: string;
  username: string;
  avatar_id: string;
  level?: number;
  points?: number;
  created_at: string;
  updated_at: string;
};

export type PublicProfile = Pick<Profile, 'username' | 'avatar_id' | 'player_id'>;

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: Linking.createURL('/auth-callback') },
  });
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch (error) {
    console.warn('[supabase] getCurrentUser failed', error);
    return null;
  }
}

export async function getOrCreateProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, player_id, username, avatar_id, level, points, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle<Profile>();

  if (error) throw error;
  return data;
}

export async function updateMyProfile(input: {
  username?: string;
  avatar_id?: string;
}): Promise<Profile> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User is not authenticated');
  }

  const payload: Partial<Pick<Profile, 'username' | 'avatar_id'>> = {};

  if (typeof input.username === 'string') {
    payload.username = input.username.trim();
  }

  if (typeof input.avatar_id === 'string') {
    payload.avatar_id = input.avatar_id;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', user.id)
    .select('id, email, player_id, username, avatar_id, level, points, created_at, updated_at')
    .single<Profile>();

  if (error) throw error;

  return data;
}

export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, avatar_id, player_id')
    .eq('id', userId)
    .maybeSingle<PublicProfile>();

  if (error) throw error;

  return data;
}

export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: Linking.createURL('/auth-callback', { queryParams: { flow: 'recovery' } }),
  });
}

export async function resendVerificationEmail(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: Linking.createURL('/auth-callback') },
  });
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}
