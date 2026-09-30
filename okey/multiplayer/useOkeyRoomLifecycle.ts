import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";

import { useGameParty } from "@/lib/gameInvitesProvider";
import { supabase } from "@/lib/supabase";
import {
  getOkeyRoomStatus,
  leaveOkeyRoom,
  subscribeOkeyRoom,
  subscribeOkeyWaitingRoomHeartbeat,
  type OkeyRoomSnapshot,
} from "@/okey/multiplayer/okey-room-api";

export function useOkeyRoomLifecycle({
  matchId,
  exitRoute,
}: {
  matchId?: string;
  exitRoute: "/(tabs)/aznif" | "/(tabs)/play";
}) {
  const router = useRouter();
  const { party } = useGameParty();

  const [room, setRoom] = useState<OkeyRoomSnapshot | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [leavingWaitingRoom, setLeavingWaitingRoom] = useState(false);
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);

  const roomUnsubscribeRef = useRef<(() => void) | null>(null);
  const heartbeatUnsubscribeRef = useRef<(() => void) | null>(null);
  const leavingMatchIdRef = useRef<string | null>(null);
  const subscriptionEpochRef = useRef(0);

  const stopSubscriptions = useCallback(() => {
    if (heartbeatUnsubscribeRef.current) {
      heartbeatUnsubscribeRef.current();
      heartbeatUnsubscribeRef.current = null;
    }
    if (roomUnsubscribeRef.current) {
      roomUnsubscribeRef.current();
      roomUnsubscribeRef.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setCurrentUserId(data.user?.id ?? null);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !matchId ||
      matchId === "preview" ||
      leavingMatchIdRef.current === matchId
    ) {
      stopSubscriptions();
      const reset = setTimeout(() => setRoom(null), 0);
      return () => clearTimeout(reset);
    }

    if (leavingMatchIdRef.current && leavingMatchIdRef.current !== matchId) {
      leavingMatchIdRef.current = null;
    }

    const currentEpoch = ++subscriptionEpochRef.current;
    let active = true;

    void getOkeyRoomStatus(matchId)
      .then((snapshot) => {
        if (
          active &&
          subscriptionEpochRef.current === currentEpoch &&
          leavingMatchIdRef.current !== matchId
        ) {
          setRoom(snapshot);
        }
      })
      .catch((error) => {
        if (
          active &&
          subscriptionEpochRef.current === currentEpoch &&
          leavingMatchIdRef.current !== matchId
        ) {
          console.warn("Unable to load Okey room status", error);
        }
      });

    const unsubscribe = subscribeOkeyRoom(matchId, (snapshot) => {
      if (
        active &&
        subscriptionEpochRef.current === currentEpoch &&
        leavingMatchIdRef.current !== matchId
      ) {
        setRoom(snapshot);
      }
    });

    roomUnsubscribeRef.current = () => {
      active = false;
      unsubscribe();
    };

    return () => {
      active = false;
      if (roomUnsubscribeRef.current) {
        roomUnsubscribeRef.current();
        roomUnsubscribeRef.current = null;
      }
    };
  }, [matchId, stopSubscriptions, subscriptionEpoch]);

  useEffect(() => {
    if (
      !matchId ||
      matchId === "preview" ||
      room?.status !== "waiting" ||
      leavingMatchIdRef.current === matchId
    ) {
      if (heartbeatUnsubscribeRef.current) {
        heartbeatUnsubscribeRef.current();
        heartbeatUnsubscribeRef.current = null;
      }
      return;
    }

    const currentEpoch = subscriptionEpochRef.current;
    let active = true;

    const unsubscribe = subscribeOkeyWaitingRoomHeartbeat(
      matchId,
      (error) => {
        if (
          active &&
          subscriptionEpochRef.current === currentEpoch &&
          leavingMatchIdRef.current !== matchId
        ) {
          console.warn("Unable to heartbeat Okey waiting room", error);
        }
      },
    );

    heartbeatUnsubscribeRef.current = () => {
      active = false;
      unsubscribe();
    };

    return () => {
      active = false;
      if (heartbeatUnsubscribeRef.current) {
        heartbeatUnsubscribeRef.current();
        heartbeatUnsubscribeRef.current = null;
      }
    };
  }, [matchId, room?.status, subscriptionEpoch]);

  useEffect(() => {
    if (
      !matchId ||
      matchId === "preview" ||
      !currentUserId ||
      !party ||
      party.leaderId === currentUserId ||
      party.flowStatus !== "idle"
    ) {
      return;
    }

    leavingMatchIdRef.current = matchId;
    subscriptionEpochRef.current += 1;
    stopSubscriptions();

    const redirect = setTimeout(() => {
      setRoom(null);
      router.replace(exitRoute);
    }, 0);

    return () => clearTimeout(redirect);
  }, [currentUserId, exitRoute, matchId, party, router, stopSubscriptions]);

  const cancelWaiting = useCallback(async () => {
    if (
      !matchId ||
      leavingWaitingRoom ||
      leavingMatchIdRef.current === matchId ||
      room?.countdownEndsAt ||
      (party && party.leaderId !== currentUserId)
    ) {
      return;
    }

    leavingMatchIdRef.current = matchId;
    subscriptionEpochRef.current += 1;
    stopSubscriptions();
    setLeavingWaitingRoom(true);

    try {
      await leaveOkeyRoom(matchId);
      setRoom(null);
      router.replace(exitRoute);
    } catch (error) {
      console.warn("Unable to leave Okey waiting room", error);
      leavingMatchIdRef.current = null;
      setLeavingWaitingRoom(false);
      setSubscriptionEpoch((epoch) => epoch + 1);
    }
  }, [
    currentUserId,
    exitRoute,
    leavingWaitingRoom,
    matchId,
    party,
    room?.countdownEndsAt,
    router,
    stopSubscriptions,
  ]);

  const activeMatchId =
    room?.status === "playing" || room?.status === "finished"
      ? matchId
      : undefined;

  return {
    room,
    currentUserId,
    activeMatchId,
    waitingForPlayers:
      Boolean(matchId) && (room === null || room.status === "waiting"),
    countdownInProgress:
      room?.status === "waiting" && room.countdownEndsAt !== null,
    canCancelWaiting:
      !room?.countdownEndsAt && (!party || party.leaderId === currentUserId),
    leavingWaitingRoom,
    cancelWaiting,
  };
}

export function useOkeyRoomStartGate({
  matchId,
  room,
  gameplayReady,
}: {
  matchId?: string;
  room: OkeyRoomSnapshot | null;
  gameplayReady: boolean;
}) {
  const [transitionMatchId, setTransitionMatchId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (
      matchId &&
      room?.matchId === matchId &&
      room.status === "waiting" &&
      room.countdownEndsAt !== null
    ) {
      const mark = setTimeout(() => setTransitionMatchId(matchId), 0);
      return () => clearTimeout(mark);
    }
  }, [matchId, room?.countdownEndsAt, room?.matchId, room?.status]);

  useEffect(() => {
    if (
      transitionMatchId !== null &&
      (transitionMatchId !== matchId || gameplayReady)
    ) {
      const clear = setTimeout(() => setTransitionMatchId(null), 0);
      return () => clearTimeout(clear);
    }
  }, [gameplayReady, matchId, transitionMatchId]);

  return transitionMatchId === matchId && !gameplayReady;
}

/** Active-match exit only; intentionally separate from waiting-room cancellation. */
export function useOkeyMatchExitLifecycle({
  leaveOnlineMatch,
  leaving,
  exitRoute,
}: {
  leaveOnlineMatch: () => Promise<unknown>;
  leaving: boolean;
  exitRoute: "/(tabs)/aznif" | "/(tabs)/play";
}) {
  const router = useRouter();

  return useCallback(async () => {
    if (leaving) return;

    try {
      await leaveOnlineMatch();
      router.replace(exitRoute);
    } catch (error) {
      console.warn("Unable to leave Okey match", error);
    }
  }, [exitRoute, leaveOnlineMatch, leaving, router]);
}

export function useOkeyGameplayReadiness({
  projectionReady,
  room,
  matchFinished,
  phase,
  showRoundResult,
  showMatchResult,
  matchId,
}: {
  projectionReady: boolean;
  room: OkeyRoomSnapshot | null;
  matchFinished: boolean;
  phase: "playing" | "finished";
  showRoundResult: boolean;
  showMatchResult: boolean;
  matchId?: string;
}) {
  const gameplayReady =
    projectionReady &&
    (room?.status === "playing" || matchFinished) &&
    (phase === "playing" ||
      phase === "finished" ||
      showRoundResult ||
      showMatchResult);

  const startTransitionPending = useOkeyRoomStartGate({
    matchId,
    room,
    gameplayReady,
  });

  return {
    gameplayReady,
    startTransitionPending,
  };
}