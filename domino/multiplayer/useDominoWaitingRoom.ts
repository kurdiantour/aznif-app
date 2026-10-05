import { assignDominoBotIdentities } from "@/domino/shared/bot-identity";
import { prepareMultiplayerGameLaunch } from "@/lib/game/gameLaunchPreload";
import { useGameParty } from "@/lib/gameInvitesProvider";
import { useProfile } from "@/lib/profile";
import { useAuthState } from "@/lib/auth-state";
import { calculateLevelFromPoints } from "@/lib/progression";
import { supabase } from "@/lib/supabase";
import type { AvatarId } from "@/types/avatar";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler } from "react-native";

export type MatchType = "bot" | "duo" | "squad" | "private";

export type MatchPlayer = {
  id: string;
  userId: string | null;
  name: string;
  level?: number;
  avatarId?: AvatarId;
  avatarUrl?: string;
  playerIndex: number;
  seat?: string | null;
  teamId?: string | null;
  kind?: string | null;
};

export type PublicWaitingPlayer = {
  playerIndex: number;
  avatarId?: AvatarId;
  avatarUrl?: string;
};

export function normalizeMode(value: unknown): "1v1" | "2v2" {
  return String(value ?? "") === "1v1" ? "1v1" : "2v2";
}

export function getRequiredPlayers(
  mode: "1v1" | "2v2",
  matchType: MatchType,
) {
  if (matchType === "bot") return 1;
  return mode === "1v1" ? 2 : 4;
}

export type UseDominoWaitingRoomOptions = {
  roomId: string;
  mode: "1v1" | "2v2";
  matchType?: string;
  initialStatus?: string;
  playMode?: string;
  entryFee?: number | string;
  enabled?: boolean;
};

export function useDominoWaitingRoom({
  roomId: initialRoomIdProp,
  mode: rawMode,
  matchType,
  initialStatus,
  playMode,
  entryFee,
  enabled = true,
}: UseDominoWaitingRoomOptions) {
  const router = useRouter();
  const { party } = useGameParty();

  const gameMode = normalizeMode(rawMode);
  const isOneVsOne = gameMode === "1v1";

  const currentMatchType = String(matchType ?? "duo") as MatchType;
  const requiredPlayers = getRequiredPlayers(gameMode, currentMatchType);

  const initialRoomId = String(initialRoomIdProp ?? "");
  const initialMatchmakingStatus = String(initialStatus ?? (initialRoomId ? "matched" : "searching"));

  const waitingCurrency: "fun" | "aznif" =
    String(playMode ?? "fun") === "aznif" ? "aznif" : "fun";

  const waitingEntryFee = Math.max(0, Number(entryFee) || 0);

  const { userId, authReady } = useAuthState();
  const { profile: localProfile } = useProfile();
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [countdownEndsAt, setCountdownEndsAt] = useState<string | null>(null);
  const [leavingWaitingRoom, setLeavingWaitingRoom] = useState(false);
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [matchmakingStatus, setMatchmakingStatus] = useState(initialMatchmakingStatus);
  const [currentRoomId, setCurrentRoomId] = useState(initialRoomId);
  const [isGameStarted, setIsGameStarted] = useState(false);

  const statusCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownSecondsRef = useRef<number | null>(null);
  const startInFlightRef = useRef(false);

  const navigationStartedRef = useRef(false);
  const cancellationStartedRef = useRef(false);
  const matchLockedRef = useRef(false);
  const initialCheckDoneRef = useRef(false);

  // If match was already active/started before mount, detect it and bypass waiting.
  useEffect(() => {
    if (!enabled || !initialRoomId || initialCheckDoneRef.current) return;
    initialCheckDoneRef.current = true;

    let mounted = true;
    const checkExistingRoom = async () => {
      try {
        const { data: roomData, error } = await supabase
          .from(isOneVsOne ? "one_vs_one_rooms" : "two_vs_two_rooms")
          .select("status, state")
          .eq("id", initialRoomId)
          .maybeSingle();

        if (error || !roomData || !mounted) return;

        const hasStarted =
          roomData.status === "playing" ||
          roomData.state?.status === "started" ||
          Array.isArray(roomData.state?.handCounts);

        if (hasStarted && mounted) {
          navigationStartedRef.current = true;
          setIsGameStarted(true);
        }
      } catch (err) {
        console.warn("Failed to check existing Domino room status", err);
      }
    };

    void checkExistingRoom();
    return () => {
      mounted = false;
    };
  }, [enabled, initialRoomId, isOneVsOne]);

  // Squad party leader check
  useEffect(() => {
    if (
      !enabled ||
      isGameStarted ||
      currentMatchType !== "squad" ||
      !userId ||
      !party ||
      party.leaderId === userId ||
      party.flowStatus !== "idle"
    ) {
      return;
    }

    navigationStartedRef.current = true;
    router.replace("/(tabs)/play");
  }, [currentMatchType, enabled, isGameStarted, userId, party, router]);

  useEffect(() => {
    if (initialMatchmakingStatus === "matched" && initialRoomId) {
      const timer = setTimeout(() => {
        setMatchmakingStatus("matched");
        setCurrentRoomId(initialRoomId);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [initialMatchmakingStatus, initialRoomId]);

  // Heartbeat
  useEffect(() => {
    if (
      !enabled ||
      isGameStarted ||
      !authReady ||
      !userId ||
      leavingWaitingRoom ||
      currentMatchType === "bot"
    ) {
      return;
    }

    if (gameMode === "2v2" && !currentRoomId) {
      return;
    }

    let active = true;
    let heartbeatInFlight = false;

    const heartbeat = async () => {
      if (!active || heartbeatInFlight || AppState.currentState !== "active") {
        return;
      }

      heartbeatInFlight = true;

      try {
        const { error: heartbeatError } = await supabase.rpc(
          "domino_waiting_room_heartbeat",
          {
            p_mode: gameMode,
            p_room_id: currentRoomId || null,
          },
        );

        if (heartbeatError) {
          throw heartbeatError;
        }
      } catch (heartbeatError) {
        if (active) {
          console.warn("Domino waiting heartbeat failed", heartbeatError);
        }
      } finally {
        heartbeatInFlight = false;
      }
    };

    void heartbeat();

    const timer = setInterval(() => void heartbeat(), 60_000);

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void heartbeat();
      }
    });

    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [authReady, currentMatchType, currentRoomId, enabled, gameMode, isGameStarted, leavingWaitingRoom, userId]);

  const refreshRoom = useCallback(async () => {
    if (!enabled || isGameStarted || currentMatchType === "bot" || cancellationStartedRef.current) return;
    const { data, error } = await supabase.rpc("domino_waiting_room_status", {
      p_mode: gameMode,
      p_room_id: currentRoomId || null,
    });
    if (error) throw error;
    if (cancellationStartedRef.current) return;
    if (data?.roomId && data.roomId !== currentRoomId) {
      setCurrentRoomId(data.roomId);
    }
    if (data?.roomId && data.memberCount >= requiredPlayers) {
      setMatchmakingStatus("matched");
    }
    const deadline = data?.countdownEndsAt ?? null;
    setCountdownEndsAt(deadline);
    if (data?.started && !navigationStartedRef.current && !startInFlightRef.current) {
      startInFlightRef.current = true;
      try {
        await prepareMultiplayerGameLaunch(data.roomId ?? currentRoomId, gameMode);
        if (!cancellationStartedRef.current) {
          navigationStartedRef.current = true;
          setIsGameStarted(true);
        }
      } finally {
        startInFlightRef.current = false;
      }
    }
  }, [currentMatchType, currentRoomId, enabled, gameMode, isGameStarted, requiredPlayers]);

  useEffect(() => {
    if (!enabled || isGameStarted || currentMatchType === "bot" || leavingWaitingRoom) return;
    const check = () => void refreshRoom().catch((error) => {
      console.warn("Unable to refresh Domino waiting room", error);
    });
    check();
    const timer = setInterval(check, 2000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [currentMatchType, enabled, isGameStarted, leavingWaitingRoom, refreshRoom]);

  // Matchmaking status polling when searching
  useEffect(() => {
    if (
      !enabled ||
      isGameStarted ||
      leavingWaitingRoom ||
      currentMatchType === "private" ||
      matchmakingStatus !== "searching"
    ) {
      return;
    }

    const checkStatus = async () => {
      try {
        const { data: status, error: statusError } = isOneVsOne
          ? await supabase.rpc("get_one_vs_one_matchmaking_status")
          : await supabase.rpc("get_two_vs_two_matchmaking_status");

        if (statusError) {
          console.warn("Failed to check matchmaking status", statusError);
          return;
        }

        if (status?.status === "matched" && status?.matched_room_id) {
          setCurrentRoomId(status.matched_room_id);
          setMatchmakingStatus("matched");
        }
      } catch (err) {
        console.warn("Error checking matchmaking status", err);
      }
    };

    void checkStatus();

    statusCheckIntervalRef.current = setInterval(checkStatus, 2000);

    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
        statusCheckIntervalRef.current = null;
      }
    };
  }, [currentMatchType, enabled, isGameStarted, isOneVsOne, leavingWaitingRoom, matchmakingStatus]);

  // Realtime players roster loading and subscription
  useEffect(() => {
    if (!enabled || isGameStarted || leavingWaitingRoom) return;
    let mounted = true;
    let playersLoadInFlight = false;
    let playersLoadRevision = 0;

    const loadPlayers = async () => {
      const revision = ++playersLoadRevision;
      if (!currentRoomId) {
        setPlayers([]);
        return;
      }

      if (playersLoadInFlight) {
        return;
      }

      playersLoadInFlight = true;

      try {
        const { data: playerRows, error: playersError } = await supabase
          .from(isOneVsOne ? "one_vs_one_players" : "two_vs_two_players")
          .select("id, user_id, player_index, seat, team_id, kind, connected")
          .eq("room_id", currentRoomId)
          .order("player_index", { ascending: true });

        if (playersError) {
          console.warn("Unable to load matchmaking players", playersError);
          return;
        }

        const connectedPlayerRows = (playerRows ?? []).filter(
          (row: any) => row.connected !== false,
        );

        const userIds = connectedPlayerRows
          .map((row: any) => row.user_id)
          .filter((id): id is string => Boolean(id) && id !== userId);

        let profileById = new Map<string, any>();

        if (userIds.length > 0) {
          const { data: profileRows, error: profilesError } = await supabase
            .from("profiles")
            .select("id, username, avatar_id, avatar_url, points")
            .in("id", userIds);

          if (profilesError) {
            console.warn("Unable to load player profiles", profilesError);
          }

          profileById = new Map(
            (profileRows ?? []).map((profile: any) => [profile.id, profile]),
          );
        }

        // A newer roster event invalidates both the rows and their profile lookup.
        if (!mounted || revision !== playersLoadRevision) return;

        const botIdentities = assignDominoBotIdentities(
          connectedPlayerRows.map((row: any) => ({
            id: String(row.id),
            playerIndex: row.player_index,
          })),
        );

        const mappedPlayers: MatchPlayer[] = connectedPlayerRows.map(
          (row: any, index: number) => {
            const rowId = String(row.id);
            const profile = row.user_id ? profileById.get(row.user_id) : null;
            const isBot = row.kind === "bot" || !row.user_id;
            const botIdentity = isBot ? botIdentities.get(rowId) : undefined;

            return {
              id: rowId,
              userId: row.user_id ?? null,
              name: isBot
                ? botIdentity!.name
                : profile?.username ?? `یاریزان ${index + 1}`,
              level: calculateLevelFromPoints(profile?.points),
              avatarId: isBot
                ? botIdentity!.avatarId
                : (profile?.avatar_id as AvatarId | undefined),
              avatarUrl: isBot
                ? botIdentity!.avatarUrl
                : (profile?.avatar_url ?? undefined),
              playerIndex: row.player_index,
              seat: row.seat,
              teamId: row.team_id,
              kind: row.kind,
            };
          },
        );

        setPlayers(mappedPlayers);
      } finally {
        playersLoadInFlight = false;
        // Coalesce events received during this request into a fresh snapshot.
        if (mounted && revision !== playersLoadRevision) {
          void loadPlayers();
        }
      }
    };

    void loadPlayers();

    if (!currentRoomId) {
      return;
    }

    const channel = supabase
      .channel(`domino_waiting_players:${currentRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: isOneVsOne ? "one_vs_one_players" : "two_vs_two_players",
          filter: `room_id=eq.${currentRoomId}`,
        },
        (payload) => {
          void refreshRoom().catch((error) => console.warn("Unable to refresh Domino room", error));
          const changed = (payload.eventType === "DELETE" ? payload.old : payload.new) as {
            id?: string;
            connected?: boolean;
          };

          if (payload.eventType === "DELETE" || changed.connected === false) {
            setPlayers((current) =>
              current.filter(
                (player) => player.id !== String(changed.id ?? ""),
              ),
            );
          }

          void loadPlayers();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: isOneVsOne ? "one_vs_one_rooms" : "two_vs_two_rooms",
          filter: `id=eq.${currentRoomId}`,
        },
        (payload) => {
          void refreshRoom().catch((error) => console.warn("Unable to refresh Domino room", error));
          const room = (payload.new ?? {}) as any;
          const hasStarted =
            room?.status === "playing" ||
            room?.state?.status === "started" ||
            Array.isArray(room?.state?.handCounts);

          if (hasStarted && mounted) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            countdownSecondsRef.current = null;
            setCountdownSeconds(null);
            navigationStartedRef.current = true;
            setIsGameStarted(true);
          }
        },
      )
      .subscribe((status, error) => {
        if (!mounted) return;

        if (status === "SUBSCRIBED") {
          void loadPlayers();
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Matchmaking realtime sync failed", error);
        }
      });

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [currentRoomId, enabled, isGameStarted, isOneVsOne, leavingWaitingRoom, refreshRoom]);

  const publicWaitingPlayers = useMemo<PublicWaitingPlayer[]>(() => {
    const ownProfile = localProfile?.id === userId ? localProfile : null;
    const waitingPlayers = players.map((player) => ({
      playerIndex: player.playerIndex,
      avatarId: userId && player.userId === userId ? ownProfile?.avatarId : player.avatarId,
      avatarUrl: userId && player.userId === userId ? ownProfile?.avatarUrl : player.avatarUrl,
    }));

    return waitingPlayers;
  }, [localProfile, players, userId]);

  const playersReady =
    currentMatchType === "bot"
      ? players.length >= 1
      : currentMatchType === "private"
        ? players.length >= requiredPlayers
        : matchmakingStatus === "matched" && players.length >= requiredPlayers;

  const matchLocked =
    isGameStarted ||
    Boolean(countdownEndsAt) ||
    players.length >= requiredPlayers;
  useEffect(() => {
    matchLockedRef.current = matchLocked;
  }, [matchLocked]);

  const leaveWaitingRoom = useCallback(async () => {
    const { error } = isOneVsOne
      ? await supabase.rpc("cancel_one_vs_one_matchmaking", {
          p_room_id: currentRoomId || null,
        })
      : await supabase.rpc("cancel_two_vs_two_matchmaking", {
          p_room_id: currentRoomId || null,
        });

    if (error) {
      throw error;
    }
  }, [currentRoomId, isOneVsOne]);

  const handleCancel = useCallback(async () => {
    if (matchLockedRef.current || navigationStartedRef.current) {
      return;
    }

    if (party && party.leaderId !== userId) {
      return;
    }

    if (cancellationStartedRef.current) {
      return;
    }

    cancellationStartedRef.current = true;
    setLeavingWaitingRoom(true);

    try {
      await leaveWaitingRoom();

      setPlayers((current) =>
        current.filter((player) => player.userId !== userId),
      );

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      setCountdownSeconds(null);
      router.replace("/(tabs)/play");
    } catch (error) {
      cancellationStartedRef.current = false;
      setLeavingWaitingRoom(false);
      void refreshRoom().catch((refreshError) => {
        console.warn("Unable to refresh Domino room after leave failure", refreshError);
      });
      console.warn("Failed to leave Domino waiting room", error);
    }
  }, [leaveWaitingRoom, userId, party, refreshRoom, router]);

  // Back button handling during waiting
  useEffect(() => {
    if (!enabled || isGameStarted) return;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (matchLockedRef.current || navigationStartedRef.current) {
          return true;
        }

        void handleCancel();
        return true;
      },
    );

    return () => subscription.remove();
  }, [enabled, handleCancel, isGameStarted]);

  const leaveWaitingRoomRef = useRef(leaveWaitingRoom);
  useEffect(() => {
    leaveWaitingRoomRef.current = leaveWaitingRoom;
  }, [leaveWaitingRoom]);

  // Cleanup on unmount if game did not start and cancel was not triggered
  useEffect(() => {
    if (!enabled) return;

    return () => {
      if (navigationStartedRef.current || cancellationStartedRef.current) {
        return;
      }

      cancellationStartedRef.current = true;

      void leaveWaitingRoomRef.current().catch((error) => {
        console.warn("Failed to clean up Domino waiting room", error);
      });
    };
  }, [enabled]);

  // Countdown and start
  const isMatchFound = currentMatchType === "bot" ? playersReady : Boolean(countdownEndsAt);

  useEffect(() => {
    if (!enabled || isGameStarted || leavingWaitingRoom) return;

    if (!isMatchFound) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      countdownSecondsRef.current = null;
      const reset = setTimeout(() => setCountdownSeconds(null), 0);
      return () => clearTimeout(reset);
    }

    if (navigationStartedRef.current || countdownIntervalRef.current) {
      return;
    }

    const startAt = countdownEndsAt ? Date.parse(countdownEndsAt) : Date.now() + 5000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
      countdownSecondsRef.current = remaining > 0 ? remaining : null;
      setCountdownSeconds(countdownSecondsRef.current);
      if (remaining > 0 || navigationStartedRef.current || startInFlightRef.current) return;
      startInFlightRef.current = true;
      void (async () => {
        try {
          await prepareMultiplayerGameLaunch(currentRoomId, gameMode);
          if (!cancellationStartedRef.current) {
            navigationStartedRef.current = true;
            setIsGameStarted(true);
          }
        } catch (error) {
          console.warn("Error launching Domino game", error);
          void refreshRoom().catch((refreshError) => console.warn("Unable to refresh Domino room", refreshError));
        } finally {
          startInFlightRef.current = false;
        }
      })();
    };
    tick();
    countdownIntervalRef.current = setInterval(tick, 500);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [countdownEndsAt, currentRoomId, enabled, gameMode, isGameStarted, isMatchFound, leavingWaitingRoom, refreshRoom]);

  const isWaiting = enabled && !isGameStarted;
  const gameplayReady = !enabled || isGameStarted;

  return {
    isWaiting,
    gameplayReady,
    currentRoomId,
    matchmakingStatus,
    players,
    publicWaitingPlayers,
    countdownSeconds,
    countdownEndsAt,
    leavingWaitingRoom,
    waitingCurrency,
    waitingEntryFee,
    matchLocked,
    canCancel:
      !matchLocked && !leavingWaitingRoom && (!party || party.leaderId === userId),
    handleCancel,
  };
}
