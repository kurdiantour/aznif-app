import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";

import { useGameParty } from "@/lib/gameInvitesProvider";
import { supabase } from "@/lib/supabase";
import { LOCAL_OKEY_PREVIEW_PLAYER_ID } from "@/okey/presentation/use-local-okey-preview";
import { getOkeyRoomStatus, leaveOkeyRoom, subscribeOkeyRoom, type OkeyRoomSnapshot } from "@/okey/multiplayer/okey-room-api";

export function useOkeyRoomLifecycle({ matchId, exitRoute, localPreview }: {
  matchId?: string;
  exitRoute: "/(tabs)/aznif" | "/(tabs)/play";
  localPreview: boolean;
}) {
  const router = useRouter();
  const { party } = useGameParty();
  const [room, setRoom] = useState<OkeyRoomSnapshot | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(localPreview ? LOCAL_OKEY_PREVIEW_PLAYER_ID : null);
  const [leavingWaitingRoom, setLeavingWaitingRoom] = useState(false);

  useEffect(() => {
    if (localPreview) return;
    let active = true;
    void supabase.auth.getUser().then(({ data }) => { if (active) setCurrentUserId(data.user?.id ?? null); });
    return () => { active = false; };
  }, [localPreview]);

  useEffect(() => {
    if (!localPreview && !matchId) router.replace(exitRoute);
  }, [exitRoute, localPreview, matchId, router]);

  useEffect(() => {
    if (localPreview || !matchId) {
      const reset = setTimeout(() => setRoom(null), 0);
      return () => clearTimeout(reset);
    }
    let active = true;
    void getOkeyRoomStatus(matchId).then((snapshot) => { if (active) setRoom(snapshot); })
      .catch((error) => console.warn("Unable to load Okey room status", error));
    const unsubscribe = subscribeOkeyRoom(matchId, (snapshot) => { if (active) setRoom(snapshot); });
    return () => { active = false; unsubscribe(); };
  }, [localPreview, matchId]);

  useEffect(() => {
    if (!matchId || !currentUserId || !party || party.leaderId === currentUserId || party.flowStatus !== "idle") return;
    const redirect = setTimeout(() => { setRoom(null); router.replace(exitRoute); }, 0);
    return () => clearTimeout(redirect);
  }, [currentUserId, exitRoute, matchId, party, router]);

  const cancelWaiting = useCallback(async () => {
    if (!matchId || leavingWaitingRoom || room?.countdownEndsAt || (party && party.leaderId !== currentUserId)) return;
    setLeavingWaitingRoom(true);
    try {
      await leaveOkeyRoom(matchId);
      setRoom(null);
      router.replace(exitRoute);
    } catch (error) {
      console.warn("Unable to leave Okey waiting room", error);
    } finally {
      setLeavingWaitingRoom(false);
    }
  }, [currentUserId, exitRoute, leavingWaitingRoom, matchId, party, room?.countdownEndsAt, router]);

  const activeMatchId = room?.status === "playing" || room?.status === "finished" ? matchId : undefined;
  return {
    room,
    currentUserId,
    activeMatchId,
    waitingForPlayers: Boolean(matchId) && (room === null || room.status === "waiting"),
    countdownInProgress: room?.status === "waiting" && room.countdownEndsAt !== null,
    canCancelWaiting: !room?.countdownEndsAt && (!party || party.leaderId === currentUserId),
    leavingWaitingRoom,
    cancelWaiting,
  };
}

export function useOkeyRoomStartGate({ matchId, room, gameplayReady }: {
  matchId?: string;
  room: OkeyRoomSnapshot | null;
  gameplayReady: boolean;
}) {
  const [transitionMatchId, setTransitionMatchId] = useState<string | null>(null);
  useEffect(() => {
    if (matchId && room?.matchId === matchId && room.status === "waiting" && room.countdownEndsAt !== null) {
      const mark = setTimeout(() => setTransitionMatchId(matchId), 0);
      return () => clearTimeout(mark);
    }
  }, [matchId, room?.countdownEndsAt, room?.matchId, room?.status]);
  useEffect(() => {
    if (transitionMatchId !== null && (transitionMatchId !== matchId || gameplayReady)) {
      const clear = setTimeout(() => setTransitionMatchId(null), 0);
      return () => clearTimeout(clear);
    }
  }, [gameplayReady, matchId, transitionMatchId]);
  return transitionMatchId === matchId && !gameplayReady;
}

/** Active-match exit only; intentionally separate from waiting-room cancellation. */
export function useOkeyMatchExitLifecycle({ leaveOnlineMatch, leaving, exitRoute }: {
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
export function useOkeyGameplayReadiness({ localPreview, projectionReady, room, matchFinished,
  phase, showRoundResult, showMatchResult, matchId }: {
  localPreview: boolean;
  projectionReady: boolean;
  room: OkeyRoomSnapshot | null;
  matchFinished: boolean;
  phase: "playing" | "finished";
  showRoundResult: boolean;
  showMatchResult: boolean;
  matchId?: string;
}) {
  const gameplayReady = localPreview || (
    projectionReady &&
    (room?.status === "playing" || matchFinished) &&
    (phase === "playing" || phase === "finished" || showRoundResult || showMatchResult)
  );
  const startTransitionPending = useOkeyRoomStartGate({ matchId, room, gameplayReady });
  return { gameplayReady, startTransitionPending };
}