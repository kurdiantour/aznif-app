import { NotificationProvider } from "@/lib/notifications/NotificationProvider";
import { ProfileProvider } from "@/lib/profile";
import { PresenceProvider } from "@/lib/presence";
import { GameInvitesProvider } from "@/lib/gameInvitesProvider";
import { appFontAssets, applyAppFontDefaults } from "@/lib/fonts";
import "@/lib/rtl";
import "@/lib/urlPolyfill";
import { useKeepAwake } from "expo-keep-awake";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { NavigationBar } from "expo-navigation-bar";
import { Stack } from "expo-router";
import {
  StatusBar,
  setStatusBarHidden,
} from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { WalletProvider } from '@/lib/wallet-context';
import { AppUpdateModal } from '@/components/AppUpdateModal';
import { OkeyReturnToGameOverlay } from '@/okey/multiplayer/OkeyReturnToGameOverlay';
import { MultiplayerResumeOverlay } from '@/components/multiplayer/MultiplayerResumeOverlay';

void SplashScreen.preventAutoHideAsync().catch((error) => {
  console.warn("Unable to hold startup splash screen", error);
});

const FONT_LOAD_TIMEOUT_MS = 10_000;

function applyImmersiveFullscreen() {
  if (Platform.OS !== "android") return;

  setStatusBarHidden(true, "none");

  NavigationBar.setStyle("dark");
  NavigationBar.setHidden(true);
}

export default function Layout() {
  useKeepAwake();
  const [fontsLoaded, fontError] = useFonts(appFontAssets);
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);
  const [fontDefaultsApplied, setFontDefaultsApplied] = useState(false);
  const fontsReady = (fontsLoaded && fontDefaultsApplied) || !!fontError || fontLoadTimedOut;

  useEffect(() => {
    if (!fontsLoaded) return;
    applyAppFontDefaults();
    let active = true;
    queueMicrotask(() => {
      if (active) setFontDefaultsApplied(true);
    });
    return () => { active = false; };
  }, [fontsLoaded]);

  useEffect(() => {
    if (fontsReady) return;
    const timeout = setTimeout(() => setFontLoadTimedOut(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [fontsReady]);

  useEffect(() => {
    if (fontError) console.warn("Unable to load app fonts; continuing with system fonts", fontError);
    if (fontLoadTimedOut && !fontsLoaded && !fontError) {
      console.warn("App fonts took too long to load; continuing with system fonts");
    }
  }, [fontError, fontLoadTimedOut, fontsLoaded]);

  useEffect(() => {
    if (fontsReady) {
      void SplashScreen.hideAsync().catch((error) => {
        console.warn("Unable to hide startup splash screen", error);
      });
    }
  }, [fontsReady]);

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

  if (!fontsReady) {
    return (
      <View style={styles.fontLoading}>
        <ActivityIndicator color="#f8d675" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <NotificationProvider>
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
                gestureEnabled: false,
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
                options={{ autoHideHomeIndicator: false }}
              />
              <Stack.Screen
                name="okey/game"
                options={{
                  autoHideHomeIndicator: false,
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen name="dama/game" options={{ autoHideHomeIndicator: false, animation: "none" }} />
              <Stack.Screen name="create-room" />
              <Stack.Screen name="domino/play-ai" />
              <Stack.Screen name="wallet-history" />
              <Stack.Screen name="(tabs)" />
            </Stack>
            <AppUpdateModal />
            <OkeyReturnToGameOverlay />
            <MultiplayerResumeOverlay />
          </GameInvitesProvider>
        </PresenceProvider>
        </WalletProvider>
        </NotificationProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fontLoading: { flex: 1, backgroundColor: "#050b22", alignItems: "center", justifyContent: "center" },
});
