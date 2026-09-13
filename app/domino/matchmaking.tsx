import DominoWaitingPlayersPopup from "@/components/game/DominoWaitingPlayersPopup";
import { useGameParty } from "@/lib/gameInvitesProvider";
import type { AvatarId } from "@/constants/avatars";
import { getCurrentProfile } from "@/lib/profile";
import { calculateLevelFromPoints } from "@/lib/progression";
import { supabase } from "@/lib/supabase";
import { prepareMultiplayerGameLaunch } from "@/lib/game/gameLaunchPreload";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppState, BackHandler, ImageBackground, StyleSheet, View } from "react-native";

type MatchType = "bot" | "duo" | "squad" | "private";

type MatchPlayer = {
  id: string;
  userId: string | null;
  name: string;
  level?: number;
  avatarId?: AvatarId;
  playerIndex: number;
  seat?: string | null;
  teamId?: string | null;
  kind?: string | null;
};

function normalizeMode(value: unknown): "1v1" | "2v2" {
  return String(value ?? "") === "1v1" ? "1v1" : "2v2";
}

function getRequiredPlayers(mode: "1v1" | "2v2", matchType: MatchType) {
  if (matchType === "bot") return 1;
  return mode === "1v1" ? 2 : 4;
}

export default function MatchmakingScreen() {
  const router = useRouter();
  const { party } = useGameParty();
  const {
    mode,
    matchmaking_status: initialStatus,
    room_id,
    matchType,
    playMode,
    entryFee,
  } = useLocalSearchParams();

  const gameMode = normalizeMode(mode);
  const isOneVsOne = gameMode === "1v1";
  const currentMatchType = String(matchType ?? "duo") as MatchType;
  const requiredPlayers = getRequiredPlayers(gameMode, currentMatchType);

  const initialRoomId = String(room_id ?? "");
  const initialMatchmakingStatus = String(initialStatus ?? "searching");
  const waitingCurrency: "fun" | "aznif" = String(playMode ?? "fun") === "aznif" ? "aznif" : "fun";
  const waitingEntryFee = Math.max(0, Number(entryFee) || 0);

  const [localPlayer, setLocalPlayer] = useState<MatchPlayer | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [matchmakingStatus, setMatchmakingStatus] = useState(
    initialMatchmakingStatus,
  );
  const [currentRoomId, setCurrentRoomId] = useState(initialRoomId);

  const statusCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const countdownSecondsRef = useRef<number | null>(null);
  const navigationStartedRef = useRef(false);
  const cancellationStartedRef = useRef(false);
  const matchLockedRef = useRef(false);
  const gamePreparationRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (
      currentMatchType !== "squad" ||
      !localPlayer?.userId ||
      !party ||
      party.leaderId === localPlayer.userId ||
      party.flowStatus !== "idle"
    ) {
      return;
    }

    navigationStartedRef.current = true;
    router.replace("/(tabs)/play");
  }, [currentMatchType, localPlayer?.userId, party, router]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const profile = await getCurrentProfile();

        if (!mounted) return;

        if (profile) {
          setLocalPlayer({
            id: profile.id,
            userId: profile.id,
            name: profile.displayName ?? profile.id,
            level: calculateLevelFromPoints(profile.points),
            avatarId: profile.avatarId as AvatarId | undefined,
            playerIndex: 0,
          });
        }
        setAuthChecked(true);
      } catch (err) {
        console.warn("Failed to load local profile", err);
        if (mounted) setAuthChecked(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (initialMatchmakingStatus === "matched" && initialRoomId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatchmakingStatus("matched");
      setCurrentRoomId(initialRoomId);
    }
  }, [initialMatchmakingStatus, initialRoomId]);

  useEffect(() => {
    if (!authChecked || !localPlayer?.userId || currentMatchType === "bot") return;
    if (gameMode === "2v2" && !currentRoomId) return;

    let active = true;
    let heartbeatInFlight = false;

    const heartbeat = async () => {
      if (!active || heartbeatInFlight || AppState.currentState !== "active") return;
      heartbeatInFlight = true;
      try {
        const { error: heartbeatError } = await supabase.rpc(
          "domino_waiting_room_heartbeat",
          { p_mode: gameMode, p_room_id: currentRoomId || null },
        );
        if (heartbeatError) throw heartbeatError;
      } catch (heartbeatError) {
        if (active) console.warn("Domino waiting heartbeat failed", heartbeatError);
      } finally {
        heartbeatInFlight = false;
      }
    };

    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 60_000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void heartbeat();
    });

    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [authChecked, currentMatchType, currentRoomId, gameMode, localPlayer?.userId]);
  useEffect(() => {
    if (currentMatchType === "private") return;
    if (matchmakingStatus !== "searching") return;

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
  }, [currentMatchType, matchmakingStatus, isOneVsOne]);

  useEffect(() => {
    let mounted = true;
    let playersLoadInFlight = false;

    const loadPlayers = async () => {
      if (!currentRoomId) {
        setPlayers([]);
        return;
      }

      if (playersLoadInFlight) return;
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
        .filter(Boolean);

      let profileById = new Map<string, any>();

      if (userIds.length > 0) {
        const { data: profileRows, error: profilesError } = await supabase
          .from("profiles")
          .select("id, username, avatar_id, points")
          .in("id", userIds);

        if (profilesError) {
          console.warn("Unable to load player profiles", profilesError);
        }

        profileById = new Map(
          (profileRows ?? []).map((profile: any) => [profile.id, profile]),
        );
      }

      if (!mounted) return;

      const mappedPlayers: MatchPlayer[] = connectedPlayerRows.map(
        (row: any, index: number) => {
          const profile = row.user_id ? profileById.get(row.user_id) : null;

          return {
            id: String(row.id ?? row.user_id ?? `player-${index}`),
            userId: row.user_id ?? null,
            name: profile?.username ?? `یاریزان ${index + 1}`,
            level: calculateLevelFromPoints(profile?.points),
            avatarId: profile?.avatar_id as AvatarId | undefined,
            playerIndex:
              typeof row.player_index === "number" ? row.player_index : index,
            seat: row.seat,
            teamId: row.team_id,
            kind: row.kind,
          };
        },
      );

        setPlayers(mappedPlayers);
      } finally {
        playersLoadInFlight = false;
      }
    };

    void loadPlayers();

    if (!currentRoomId) return;

    const channel = supabase
      .channel(`matchmaking_players:${currentRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: isOneVsOne ? "one_vs_one_players" : "two_vs_two_players",
          filter: `room_id=eq.${currentRoomId}`,
        },
        (payload) => {
          const changed = (payload.new ?? payload.old) as {
            id?: string;
            connected?: boolean;
          };
          if (payload.eventType === "DELETE" || changed.connected === false) {
            setPlayers((current) =>
              current.filter((player) => player.id !== String(changed.id ?? "")),
            );
          }
          void loadPlayers();
        },
      )
      .subscribe((status, error) => {
        if (!mounted) return;

        // Close the read-before-subscribe race and recover after reconnects.
        if (status === "SUBSCRIBED") void loadPlayers();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Matchmaking realtime sync failed", error);
        }
      });

    // Realtime is the fast path; polling guarantees that a dropped event does
    // not leave one player waiting forever (especially in private rooms).
    const playersFallbackInterval = setInterval(() => {
      void loadPlayers();
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(playersFallbackInterval);
      void supabase.removeChannel(channel);
    };
  }, [currentRoomId, isOneVsOne]);

  const publicWaitingPlayers = useMemo(() => {
    const waitingPlayers = players.map((player) => ({
      playerIndex: player.playerIndex,
      avatarId: player.avatarId,
    }));
    const localAlreadyIncluded = localPlayer
      ? players.some((player) => player.userId === localPlayer.userId)
      : true;

    if (!localAlreadyIncluded && localPlayer) {
      waitingPlayers.push({ playerIndex: 0, avatarId: localPlayer.avatarId });
    }

    return waitingPlayers;
  }, [localPlayer, players]);

  const playersReady =
    currentMatchType === "bot"
      ? players.length >= 1
      : currentMatchType === "private"
        ? players.length >= requiredPlayers
        : matchmakingStatus === "matched" && players.length >= requiredPlayers;
  const matchLocked = isOneVsOne && matchmakingStatus === "matched";
  // eslint-disable-next-line react-hooks/refs
  matchLockedRef.current = matchLocked;

  const leaveWaitingRoom = useCallback(async () => {
    const { error } = isOneVsOne
      ? await supabase.rpc("cancel_one_vs_one_matchmaking", {
          p_room_id: currentRoomId || null,
        })
      : await supabase.rpc("cancel_two_vs_two_matchmaking", {
          p_room_id: currentRoomId || null,
        });
    if (error) throw error;

  }, [currentRoomId, isOneVsOne]);

  const handleCancel = useCallback(async () => {
    if (matchLockedRef.current) return;
    if (party && party.leaderId !== localPlayer?.userId) return;
    if (cancellationStartedRef.current) return;
    cancellationStartedRef.current = true;

    try {
      await leaveWaitingRoom();
      setPlayers((current) =>
        current.filter((player) => player.userId !== localPlayer?.userId),
      );
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setCountdownSeconds(null);
      router.replace("/(tabs)/play");
    } catch (error) {
      cancellationStartedRef.current = false;
      console.warn("Failed to leave Domino waiting room", error);
    }
  }, [leaveWaitingRoom, localPlayer?.userId, party, router]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (matchLockedRef.current) return true;
      void handleCancel();
      return true;
    });
    return () => subscription.remove();
  }, [handleCancel]);
const leaveWaitingRoomRef = useRef(leaveWaitingRoom);

useEffect(() => {
  leaveWaitingRoomRef.current = leaveWaitingRoom;
}, [leaveWaitingRoom]);

useEffect(() => {
  return () => {
    if (
      navigationStartedRef.current ||
      cancellationStartedRef.current
    ) {
      return;
    }

    cancellationStartedRef.current = true;

    void leaveWaitingRoomRef.current().catch((error) => {
      console.warn("Failed to clean up Domino waiting room", error);
    });
  };
}, []);
  const isMatchFound = playersReady;
  useEffect(() => {
    if (!isMatchFound) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      countdownSecondsRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCountdownSeconds(null);
      return;
    }

    if (navigationStartedRef.current || countdownIntervalRef.current) return;

    const startValue = 5;
    countdownSecondsRef.current = startValue;
    setCountdownSeconds(startValue);
    gamePreparationRef.current = prepareMultiplayerGameLaunch(
      currentRoomId,
      gameMode,
    ).catch((error) => {
      console.warn("Unable to fully preload game launch", error);
    });

    countdownIntervalRef.current = setInterval(() => {
      const previous = countdownSecondsRef.current ?? 0;
      const nextValue = previous - 1;

      countdownSecondsRef.current = nextValue > 0 ? nextValue : null;
      setCountdownSeconds(countdownSecondsRef.current);

      if (nextValue <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }

        if (!navigationStartedRef.current) {
          navigationStartedRef.current = true;
          void (async () => {
            await gamePreparationRef.current;

            if (cancellationStartedRef.current) return;
            router.replace({
              pathname: "/domino/game",
              params: {
                mode: gameMode,
                room_id: currentRoomId,
                matchType: currentMatchType,
              },
            });
          })();
        }
      }
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isMatchFound, currentRoomId, currentMatchType, gameMode, router]);

  if (authChecked && !localPlayer) {
    return <Redirect href="/login" />;
  }

  if (!authChecked) {
    return <View style={styles.loadingScreen} />;
  }

  return (
    <ImageBackground
      source={require("@/assets/images/lobby/lobby-bg.webp")}
      style={styles.background}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay} />

        <DominoWaitingPlayersPopup
          visible={currentMatchType !== "private"}
          playerCount={isOneVsOne ? 2 : 4}
          entryFee={waitingEntryFee}
          currency={waitingCurrency}
          players={publicWaitingPlayers}
          countdownSeconds={countdownSeconds}
          canCancel={
            !matchLocked && (!party || party.leaderId === localPlayer?.userId)
          }
          onCancel={handleCancel}
        />
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#050214",
  },

  loadingScreen: {
    flex: 1,
    backgroundColor: "#050214",
  },

  safeArea: {
    flex: 1,
  },

  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(3,0,15,0.54)",
  },
});

