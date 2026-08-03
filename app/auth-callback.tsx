import {
  markPendingLeaderboardConsent,
} from "@/lib/leaderboardVisibility";
import { supabase } from "@/lib/supabase";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getOrCreateProfile } from "@/lib/supabaseAuth";
import { useURL } from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

const NEW_OAUTH_USER_CONSENT_WINDOW_MS = 5 * 60 * 1000;

function isRecentlyCreatedUser(createdAt?: string) {
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();

  return Number.isFinite(createdTime) &&
    Date.now() - createdTime <= NEW_OAUTH_USER_CONSENT_WINDOW_MS;
}

function callbackParams(url: string) {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  const fragment = url.split("#")[1] ?? "";
  return new URLSearchParams(`${query}&${fragment}`);
}

function authCallbackError(params: URLSearchParams) {
  const errorCode = params.get("error_code") ?? params.get("error");
  const description = params.get("error_description");
  const normalized = `${errorCode ?? ""} ${description ?? ""}`.toLowerCase();

  if (!normalized.trim()) return null;

  if (normalized.includes("otp_expired") || normalized.includes("expired")) {
    return new Error(
      "This password reset link has expired. Please request a new reset email and open the newest link on this device.",
    );
  }

  return new Error(description ?? errorCode ?? "Authentication link failed.");
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const recover = async () => {
      if (!url) return;

      try {
        const params = callbackParams(url);
        const callbackError = authCallbackError(params);

        if (callbackError) throw callbackError;

        const code = params.get("code");
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const tokenHash = params.get("token_hash");
        const tokenType = params.get("type");

        if (tokenHash && tokenType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: tokenType as EmailOtpType,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            throw new Error("This sign-in link is invalid or has expired.");
          }
        }

        const flow = params.get("flow");
        const isRecovery = flow === "recovery" || params.get("type") === "recovery";

        if (isRecovery) {
          router.replace("/reset-password");
          return;
        }

        if (flow === "oauth") {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          await getOrCreateProfile();

          if (isRecentlyCreatedUser(user?.created_at)) {
            await markPendingLeaderboardConsent();
          }

          router.replace("/(tabs)/play");
          return;
        }

        router.replace("/verify-email");
      } catch (error) {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to complete authentication.",
          );
        }
      }
    };

    void recover();

    return () => {
      active = false;
    };
  }, [router, url]);

  return (
    <View style={styles.screen}>
      {error ? (
        <>
          <Text style={styles.title}>Authentication link failed</Text>
          <Text style={styles.message}>{error}</Text>
          <Text style={styles.message} onPress={() => router.replace("/login")}>
            Return to sign in
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.message}>Completing authentication...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050b22",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontFamily: "SpedaBold",
    marginBottom: 12,
  },
  message: {
    color: "#b7c8e8",
    textAlign: "center",
    lineHeight: 22,
    marginTop: 18,
  },
});
