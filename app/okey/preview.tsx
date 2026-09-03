import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";

export default function OkeyPreviewScreen() {
  const router = useRouter();

  const [attempt, setAttempt] =
    useState(0);

  const [error, setError] =
    useState<string | null>(null);

  const createOrResumeTestMatch =
    useCallback(async () => {
      setError(null);

      const {
        data,
        error: invokeError,
      } =
        await supabase.functions.invoke(
          "okey_test_match",
          {
            body: {
              action:
                "create-or-resume",
            },
          },
        );

      if (
        invokeError ||
        typeof data?.matchId !==
          "string"
      ) {
        let serverError:
          | string
          | null = null;

        try {
          if (
            invokeError &&
            "context" in invokeError &&
            invokeError.context
          ) {
            const body =
              await invokeError.context.json();

            serverError =
              typeof body?.error ===
              "string"
                ? body.error
                : null;
          }
        } catch {
          serverError = null;
        }

        throw new Error(
          serverError ??
            invokeError?.message ??
            "test_match_creation_failed",
        );
      }

      router.replace({
        pathname: "/okey/game",

        params: {
          matchId:
            data.matchId,

          tableId:
            "preview-test",

          mode:
            "fun",
        },
      });
    }, [router]);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    let active = true;

    void createOrResumeTestMatch()
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "test_match_creation_failed",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [
    attempt,
    createOrResumeTestMatch,
  ]);

  if (!__DEV__) {
    return (
      <Redirect href="/(tabs)/play" />
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator
        color="#fff"
        size="large"
      />

      <Text style={styles.title}>
        Preparing real Okey test match
      </Text>

      <Text style={styles.subtitle}>
        2 Admin Players + 2 Server Bots
      </Text>

      {error ? (
        <>
          <Text style={styles.error}>
            {error}
          </Text>

          <Pressable
            style={styles.retry}
            onPress={() =>
              setAttempt(
                (value) =>
                  value + 1,
              )
            }
          >
            <Text
              style={
                styles.retryText
              }
            >
              Retry
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 24,
      backgroundColor:
        "#13251e",
    },

    title: {
      color: "#fff",
      fontSize: 18,
      fontWeight: "800",
      textAlign: "center",
    },

    subtitle: {
      color:
        "rgba(255,255,255,0.7)",
      fontSize: 13,
      textAlign: "center",
    },

    error: {
      color: "#ff9b9b",
      fontSize: 13,
      textAlign: "center",
    },

    retry: {
      marginTop: 4,
      borderRadius: 10,
      backgroundColor:
        "#2e7d57",
      paddingHorizontal: 24,
      paddingVertical: 10,
    },

    retryText: {
      color: "#fff",
      fontSize: 14,
      fontWeight: "700",
    },
  });