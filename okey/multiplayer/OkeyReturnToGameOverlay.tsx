import React, { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { useProfile } from "@/lib/profile";
import { ReturnToGamePopup } from "@/components/game/ReturnToGamePopup";
import { getActiveOkeyMemberships } from "./okey-room-api";
import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";

export function OkeyReturnToGameOverlay() {
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

  return <ReturnToGamePopup loading={loading} onReturn={handleReturn} onReject={handleReject} />;
}
