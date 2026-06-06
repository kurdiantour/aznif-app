import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set.',
  );
}

const authStorage =
  Platform.OS === 'web'
    ? undefined
    : {
        getItem: AsyncStorage.getItem,
        setItem: AsyncStorage.setItem,
        removeItem: AsyncStorage.removeItem,
      };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    fetch: globalThis.fetch,
  },
});
