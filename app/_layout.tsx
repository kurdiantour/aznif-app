import 'react-native-url-polyfill/auto';

if (typeof globalThis.URL !== 'undefined' && typeof globalThis.URL.canParse !== 'function') {
  Object.defineProperty(globalThis.URL, 'canParse', {
    value: function (url: string) {
      try {
        new globalThis.URL(url);
        return true;
      } catch {
        return false;
      }
    },
    writable: true,
    configurable: true,
  });
}

import { ProfileProvider } from '@/lib/profile';
import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <ProfileProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="game" />
        <Stack.Screen name="create-room" />
        <Stack.Screen name="matchmaking" />
        <Stack.Screen name="play-ai" />
        <Stack.Screen name="shop" />
        <Stack.Screen name="transfer" />
        <Stack.Screen name="wallet-history" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ProfileProvider>
  );
}