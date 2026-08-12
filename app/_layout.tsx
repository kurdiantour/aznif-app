import { ProfileProvider } from "@/lib/profile";
import { PresenceProvider } from "@/lib/presence";
import { GameInvitesProvider } from "@/lib/gameInvitesProvider";
import { appFontAssets, applyAppFontDefaults } from "@/lib/fonts";
import "@/lib/rtl";
import "@/lib/urlPolyfill";
import { useFonts } from "expo-font";
import * as NavigationBar from "expo-navigation-bar";
import { Stack } from "expo-router";
import {
  StatusBar,
  setStatusBarBackgroundColor,
  setStatusBarHidden,
  setStatusBarTranslucent,
} from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

async function applyImmersiveFullscreen() {
  if (Platform.OS !== "android") return;

  setStatusBarHidden(true, "none");
  setStatusBarTranslucent(true);
  setStatusBarBackgroundColor("transparent", false);

  try {
    await NavigationBar.setButtonStyleAsync("light");
    await NavigationBar.setStyle("dark");
    await NavigationBar.setVisibilityAsync("hidden");
  } catch (error) {
    console.warn("Unable to enable immersive fullscreen mode", error);
  }
}

export default function Layout() {
  const [fontsLoaded] = useFonts(appFontAssets);

  useEffect(() => {
    void applyImmersiveFullscreen();

    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void applyImmersiveFullscreen();
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
        <PresenceProvider>
          <GameInvitesProvider>
            <StatusBar
              hidden
              translucent
              backgroundColor="transparent"
              style="light"
            />
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
              <Stack.Screen name="domino/game" />
              <Stack.Screen name="okey/index" />
              <Stack.Screen name="okey/game" />
              <Stack.Screen name="create-room" />
              <Stack.Screen name="domino/matchmaking" />
              <Stack.Screen name="domino/play-ai" />
              <Stack.Screen name="wallet-history" />
              <Stack.Screen name="(tabs)" />
            </Stack>
          </GameInvitesProvider>
        </PresenceProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
