import { ProfileProvider } from "@/lib/profile";
import { PresenceProvider } from "@/lib/presence";
import { GameInvitesProvider } from "@/lib/gameInvitesProvider";
import { appFontAssets, applyAppFontDefaults } from "@/lib/fonts";
import "@/lib/rtl";
import "@/lib/urlPolyfill";
import { useFonts } from "expo-font";
import { NavigationBar } from "expo-navigation-bar";
import { Stack } from "expo-router";
import {
  StatusBar,
  setStatusBarHidden,
} from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { WalletProvider } from '@/lib/wallet-context';

function applyImmersiveFullscreen() {
  if (Platform.OS !== "android") return;

  setStatusBarHidden(true, "none");

  NavigationBar.setStyle("dark");
  NavigationBar.setHidden(true);
}

export default function Layout() {
  const [fontsLoaded] = useFonts(appFontAssets);

  useEffect(() => {
    applyImmersiveFullscreen();

    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          applyImmersiveFullscreen();
        }
      },
    );

    return () => {
      appStateSubscription.remove();
    };
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  applyAppFontDefaults();

  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <WalletProvider>
        <PresenceProvider>
          <GameInvitesProvider>
            <StatusBar
              hidden
              style="light"
            />
            <NavigationBar hidden style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                animation: "none",
                contentStyle: {
                  backgroundColor: "#050b22",
                  direction: "rtl",
                },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="forgot-password" />
              <Stack.Screen name="verify-email" />
              <Stack.Screen name="auth-callback" />
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="delete-account" />
              <Stack.Screen
                name="profile"
                options={{
                  presentation: "transparentModal",
                  animation: "none",
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen
                name="settings"
                options={{
                  presentation: "transparentModal",
                  animation: "none",
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen name="privacy" />
              <Stack.Screen name="support" />
              <Stack.Screen
                name="domino/game"
                options={{ autoHideHomeIndicator: true }}
              />
              <Stack.Screen
                name="okey/game"
                options={{
                  autoHideHomeIndicator: true,
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen name="create-room" />
              <Stack.Screen name="domino/matchmaking" />
              <Stack.Screen name="domino/play-ai" />
              <Stack.Screen name="wallet-history" />
              <Stack.Screen name="(tabs)" />
            </Stack>
          </GameInvitesProvider>
        </PresenceProvider>
        </WalletProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
