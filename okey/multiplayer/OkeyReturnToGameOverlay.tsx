import React, { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { usePathname, useRouter } from "expo-router";

import { ReturnToGamePopup } from "@/components/game/ReturnToGamePopup";
import { useProfile } from "@/lib/profile";
import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";

import {
  getActiveOkeyMemberships,
  getOkeyRoomStatus,
} from "./okey-room-api";

export function OkeyReturnToGameOverlay() {
  const { profile } = useProfile();
  const router = useRouter();
  const pathname = usePathname();

  const [resumableMatchId, setResumableMatchId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [rejectedMatches, setRejectedMatches] = useState<Set<string>>(
    () => new Set(),
  );

  const finishResumeFlow = useCallback(() => {
    setResumableMatchId(null);
    router.replace("/(tabs)/play");
  }, [router]);

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

      if (!me) {
        setResumableMatchId(null);
        return;
      }

      setResumableMatchId(playingMatch.matchId);
    } catch (error) {
      console.warn(
        "Failed to check active memberships",
        error,
      );
    }
  }, [profile?.id, rejectedMatches]);

  useEffect(() => {
    if (pathname === "/okey/game") {
      setResumableMatchId(null);
      return;
    }

    void checkMemberships();
  }, [pathname, checkMemberships]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (
          state === "active" &&
          pathname !== "/okey/game"
        ) {
          void checkMemberships();
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [pathname, checkMemberships]);

  /*
   * While the Return-to-Game popup is visible, keep watching the
   * authoritative match state.
   *
   * If the match finishes before the user presses Return or Reject,
   * immediately dismiss the popup and return to the lobby.
   */
  useEffect(() => {
    if (
      !resumableMatchId ||
      pathname === "/okey/game"
    ) {
      return;
    }

    const adapter = new SupabaseOkeyMatchAdapter(
      resumableMatchId,
    );

    let active = true;

    const unsubscribe = adapter.subscribe((snapshot) => {
      if (!active) {
        return;
      }

      if (snapshot.matchFinished) {
        finishResumeFlow();
        return;
      }

      const me = snapshot.players.find(
        (player) => player.id === profile?.id,
      );

      if (!me) {
        finishResumeFlow();
      }
    });

    void adapter.refresh().catch(() => {
      /*
       * Do not dismiss the popup only because a refresh temporarily
       * failed. Realtime or the explicit Return/Reject flow can retry.
       */
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    resumableMatchId,
    pathname,
    profile?.id,
    finishResumeFlow,
  ]);

  const handleReturn = async () => {
    if (!resumableMatchId || loading) {
      return;
    }

    setLoading(true);

    const currentMatchId = resumableMatchId;

    const adapter = new SupabaseOkeyMatchAdapter(
      currentMatchId,
    );

    try {
      await adapter.refresh();

      const snapshot = adapter.getSnapshot();

      if (!snapshot || snapshot.matchFinished) {
        finishResumeFlow();
        return;
      }

      const me = snapshot.players.find(
        (player) => player.id === profile?.id,
      );

      if (!me) {
        finishResumeFlow();
        return;
      }

      if (me.controlledByBot) {
        try {
          await adapter.dispatch({
            type: "take-back-seat",
          });
        } catch (error) {
          /*
           * The match may have finished in the tiny window between
           * refresh() and take-back-seat.
           */
          try {
            await adapter.refresh();

            const refreshedSnapshot =
              adapter.getSnapshot();

            if (
              !refreshedSnapshot ||
              refreshedSnapshot.matchFinished
            ) {
              finishResumeFlow();
              return;
            }

            const refreshedMe =
              refreshedSnapshot.players.find(
                (player) =>
                  player.id === profile?.id,
              );

            if (!refreshedMe) {
              finishResumeFlow();
              return;
            }
          } catch {
            // Preserve the original command failure below.
          }

          throw error;
        }
      }

      setResumableMatchId(null);

      let mode = "fun";

      try {
        const room = await getOkeyRoomStatus(
          currentMatchId,
        );

        if (room?.currency === "aznif") {
          mode = "aznif";
        }
      } catch {
        // Fallback to fun if status lookup fails.
      }

      router.replace({
        pathname: "/okey/game",
        params: {
          matchId: currentMatchId,
          mode,
        },
      });
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

    const currentMatchId = resumableMatchId;

    const adapter = new SupabaseOkeyMatchAdapter(
      currentMatchId,
    );

    try {
      /*
       * Refresh first so we never send manual-leave to an already
       * finished match.
       */
      await adapter.refresh();

      const snapshot = adapter.getSnapshot();

      if (!snapshot || snapshot.matchFinished) {
        finishResumeFlow();
        return;
      }

      const me = snapshot.players.find(
        (player) => player.id === profile?.id,
      );

      if (!me) {
        finishResumeFlow();
        return;
      }

      try {
        await adapter.leave();
      } catch (error) {
        /*
         * The match may have finished between refresh() and leave().
         * Refresh once more before treating this as a real failure.
         */
        try {
          await adapter.refresh();

          const refreshedSnapshot =
            adapter.getSnapshot();

          if (
            !refreshedSnapshot ||
            refreshedSnapshot.matchFinished
          ) {
            finishResumeFlow();
            return;
          }

          const refreshedMe =
            refreshedSnapshot.players.find(
              (player) =>
                player.id === profile?.id,
            );

          if (!refreshedMe) {
            finishResumeFlow();
            return;
          }
        } catch {
          // Preserve the original leave failure below.
        }

        throw error;
      }

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
    <ReturnToGamePopup
      loading={loading}
      onReturn={handleReturn}
      onReject={handleReject}
    />
  );
}