import React, { useCallback, useEffect, useState } from "react";
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { useProfile } from "@/lib/profile";
import { getActiveOkeyMemberships } from "@/okey/multiplayer/okey-room-api";
import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";

export function ReturnToGameOverlay() {
  const { profile } = useProfile();
  const router = useRouter();

  const [resumableMatchId, setResumableMatchId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [rejectedMatches, setRejectedMatches] = useState<Set<string>>(
    () => new Set(),
  );

  const checkMemberships = useCallback(async () => {
    if (!profile?.id) {
      return;
    }

    try {
      const memberships = await getActiveOkeyMemberships();

      const playingMatch = memberships.find(
        (membership) =>
          membership.status === "playing" &&
          !rejectedMatches.has(membership.matchId),
      );

      if (!playingMatch) {
        setResumableMatchId(null);
        return;
      }

      const adapter = new SupabaseOkeyMatchAdapter(
        playingMatch.matchId,
      );

      await adapter.refresh();

      const snapshot = adapter.getSnapshot();

      if (!snapshot || snapshot.matchFinished) {
        setResumableMatchId(null);
        return;
      }

      const me = snapshot.players.find(
        (player) => player.id === profile.id,
      );

      if (me?.controlledByBot) {
        setResumableMatchId(playingMatch.matchId);
        return;
      }

      setResumableMatchId(null);
    } catch (error) {
      console.warn(
        "Failed to check active memberships",
        error,
      );
    }
  }, [profile, rejectedMatches]);

  useEffect(() => {
    const initialCheck = setTimeout(() => {
      void checkMemberships();
    }, 0);

    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void checkMemberships();
        }
      },
    );

    return () => {
      clearTimeout(initialCheck);
      subscription.remove();
    };
  }, [checkMemberships]);

  const handleReturn = async () => {

    if (!resumableMatchId || loading) {
      return;
    }

    setLoading(true);

    try {
      const currentMatchId = resumableMatchId;

      const adapter = new SupabaseOkeyMatchAdapter(
        currentMatchId,
      );

      await adapter.refresh();

      await adapter.dispatch({
        type: "take-back-seat",
      });

      setResumableMatchId(null);

      router.push(
        `/okey/fun?matchId=${currentMatchId}`,
      );
    } catch (error) {
      console.warn(
        "Failed to take back seat",
        error,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {

    if (!resumableMatchId || loading) {
      return;
    }

    setLoading(true);

    try {
      const currentMatchId = resumableMatchId;

      const adapter = new SupabaseOkeyMatchAdapter(
        currentMatchId,
      );

      await adapter.refresh();

      await adapter.leave();

      setRejectedMatches((previous) => {
        const next = new Set(previous);
        next.add(currentMatchId);
        return next;
      });

      setResumableMatchId(null);

      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn(
        "Failed to reject and leave match",
        error,
      );
    } finally {
      setLoading(false);
    }
  };

  if (!resumableMatchId) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <LinearGradient
        colors={[
          "rgba(2, 6, 23, 0.92)",
          "rgba(9, 18, 40, 0.86)",
        ]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.fixedContent}>
        <View style={styles.card}>
          <View style={styles.headerPanel}>
            <Ionicons
              name="game-controller-outline"
              size={26}
              color="#f8d774"
            />

            <Text style={styles.title}>
              یارییەکەت هێشتا بەردەوامە
            </Text>

            <Text style={styles.subtitle}>
              دەتەوێت بگەڕێیتەوە بۆ یارییەکەت؟
            </Text>
          </View>

          <View style={styles.form}>
            <Pressable
              style={styles.primaryButton}
              onPress={handleReturn}
              disabled={loading}
            >
              <Text style={styles.primaryText}>
                {loading
                  ? "کەمێک چاوەڕێبە..."
                  : "گەڕانەوە بۆ یاری"}
              </Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={handleReject}
              disabled={loading}
            >
              <Text style={styles.secondaryText}>
                ڕەتکردنەوە
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
  },

  fixedContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  card: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(4, 10, 25, 0.86)",
    padding: 12,
  },

  headerPanel: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.22)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },

  title: {
    color: "#ffffff",
    fontSize: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 10,
  },

  subtitle: {
    color: "#b6c2d8",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 22,
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 8,
  },

  form: {
    gap: 9,
  },

  primaryButton: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    marginTop: 4,
  },

  primaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 15,
    textAlign: "center",
    writingDirection: "rtl",
  },

  secondaryButton: {
    minHeight: 46,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
  },

  secondaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },
});