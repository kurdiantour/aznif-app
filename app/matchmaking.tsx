import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import { getCurrentProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Animated,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type MatchType = "bot" | "duo" | "squad" | "private";

type MatchPlayer = {
  id: string;
  userId: string | null;
  name: string;
  rating?: string;
  avatarId?: AvatarId;
  playerIndex: number;
  seat?: string | null;
  teamId?: string | null;
  kind?: string | null;
};

type PlayerCardProps = {
  name: string;
  rating?: string;
  filled?: boolean;
  delay?: number;
  avatarId?: AvatarId;
};

function PlayerCard({
  name,
  rating,
  filled,
  delay = 0,
  avatarId,
}: PlayerCardProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (filled) return;

    let loop: Animated.CompositeAnimation | null = null;

    const timeout = setTimeout(() => {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.04,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
        ]),
      );

      loop.start();
    }, delay);

    return () => {
      clearTimeout(timeout);
      loop?.stop();
    };
  }, [delay, filled, pulse]);

  return (
    <Animated.View
      style={[styles.playerCard, { transform: [{ scale: pulse }] }]}
    >
      <LinearGradient
        colors={["rgba(57,18,105,0.92)", "rgba(12,8,28,0.96)"]}
        style={styles.playerGradient}
      >
        <View style={styles.avatarRing}>
          {filled && avatarId ? (
            <PlayerAvatar
              avatarId={avatarId}
              size={44}
              style={styles.avatarCircle}
            />
          ) : (
            <View style={[styles.avatarCircle, styles.emptyAvatar]}>
              <Text style={styles.emptyAvatarText}>?</Text>
            </View>
          )}

          {filled && <View style={styles.onlineDot} />}
        </View>

        <Text style={styles.playerName}>{name}</Text>

        <Text style={styles.playerRating}>
          {filled ? `پلە: ${rating ?? "0"}` : "گەڕان..."}
        </Text>
      </LinearGradient>
    </Animated.View>
  );
}

function renderPlayerSlot(
  player: MatchPlayer | null,
  index: number,
  delayOffset = 0,
) {
  if (!player) {
    return (
      <PlayerCard
        key={`empty-${index}`}
        name="?"
        delay={delayOffset + index * 200}
      />
    );
  }

  return (
    <PlayerCard
      key={player.id}
      name={player.name}
      rating={player.rating ?? "0"}
      filled
      avatarId={player.avatarId}
    />
  );
}

function normalizeMode(value: unknown): "1v1" | "2v2" {
  return String(value ?? "") === "1v1" ? "1v1" : "2v2";
}

function getRequiredPlayers(mode: "1v1" | "2v2", matchType: MatchType) {
  if (matchType === "bot") return 1;
  return mode === "1v1" ? 2 : 4;
}

export default function MatchmakingScreen() {
  const router = useRouter();
  const {
    mode,
    matchmaking_status: initialStatus,
    room_id,
    room_code,
    matchType,
  } = useLocalSearchParams();

  const gameMode = normalizeMode(mode);
  const isOneVsOne = gameMode === "1v1";
  const currentMatchType = String(matchType ?? "duo") as MatchType;
  const requiredPlayers = getRequiredPlayers(gameMode, currentMatchType);

  const initialRoomId = String(room_id ?? "");
  const privateRoomCode = String(room_code ?? "");
  const initialMatchmakingStatus = String(initialStatus ?? "searching");

  const [localPlayer, setLocalPlayer] = useState<MatchPlayer | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [matchmakingStatus, setMatchmakingStatus] = useState(
    initialMatchmakingStatus,
  );
  const [currentRoomId, setCurrentRoomId] = useState(initialRoomId);
  const [copyMessage, setCopyMessage] = useState("");

  const pulse = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const statusCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const countdownSecondsRef = useRef<number | null>(null);
  const navigationStartedRef = useRef(false);

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
            rating: String(profile.points ?? 0),
            avatarId: profile.avatarId as AvatarId | undefined,
            playerIndex: 0,
          });
        }
      } catch (err) {
        console.warn("Failed to load local profile", err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (initialMatchmakingStatus === "matched" && initialRoomId) {
      setMatchmakingStatus("matched");
      setCurrentRoomId(initialRoomId);
    }
  }, [initialMatchmakingStatus, initialRoomId]);

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

    const loadPlayers = async () => {
      if (!currentRoomId) {
        setPlayers([]);
        return;
      }

      const { data: playerRows, error: playersError } = await supabase
        .from(isOneVsOne ? "one_vs_one_players" : "two_vs_two_players")
        .select("id, user_id, player_index, seat, team_id, kind, connected")
        .eq("room_id", currentRoomId)
        .order("player_index", { ascending: true });

      if (playersError) {
        console.warn("Unable to load matchmaking players", playersError);
        return;
      }

      const userIds = (playerRows ?? [])
        .map((row: any) => row.user_id)
        .filter(Boolean);

      let profileById = new Map<string, any>();

      if (userIds.length > 0) {
        const { data: profileRows, error: profilesError } = await supabase
          .from("profiles")
          .select("id, username, avatar_id, level, points")
          .in("id", userIds);

        if (profilesError) {
          console.warn("Unable to load player profiles", profilesError);
        }

        profileById = new Map(
          (profileRows ?? []).map((profile: any) => [profile.id, profile]),
        );
      }

      if (!mounted) return;

      const mappedPlayers: MatchPlayer[] = (playerRows ?? []).map(
        (row: any, index: number) => {
          const profile = row.user_id ? profileById.get(row.user_id) : null;

          return {
            id: String(row.id ?? row.user_id ?? `player-${index}`),
            userId: row.user_id ?? null,
            name: profile?.username ?? `یاریزان ${index + 1}`,
            rating: String(profile?.points ?? 0),
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
        () => {
          void loadPlayers();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [currentRoomId, isOneVsOne]);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );

    const rotateLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, {
          toValue: 1,
          duration: 3800,
          useNativeDriver: true,
        }),
        Animated.timing(rotate, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();
    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [pulse, rotate]);

  const orderedSlots = useMemo(() => {
    const slots: (MatchPlayer | null)[] = Array.from(
      { length: requiredPlayers },
      () => null,
    );

    players.forEach((player, fallbackIndex) => {
      const index =
        typeof player.playerIndex === "number"
          ? Math.max(0, Math.min(requiredPlayers - 1, player.playerIndex))
          : fallbackIndex;

      slots[index] = player;
    });

    return slots;
  }, [players, requiredPlayers]);

  const leftSlots = orderedSlots.slice(0, isOneVsOne ? 1 : 2);
  const rightSlots = orderedSlots.slice(isOneVsOne ? 1 : 2);

  const playersReady =
    currentMatchType === "bot"
      ? players.length >= 1
      : currentMatchType === "private"
        ? players.length >= requiredPlayers
        : matchmakingStatus === "matched" && players.length >= requiredPlayers;

  const isMatched = playersReady;

  const handleCancel = async () => {
    if (currentMatchType === "private") {
      if (currentRoomId) {
        try {
          const { error } = await supabase.rpc("leave_one_vs_one_match", {
            p_room_id: currentRoomId,
          });
          if (error) throw error;
        } catch (error) {
          console.warn("Failed to leave private room", error);
        }
      }
      router.replace("/(tabs)/lobby");
      return;
    }

    try {
      if (isOneVsOne) {
        await supabase.rpc("cancel_one_vs_one_matchmaking", {
          p_room_id: currentRoomId || null,
        });
      } else {
        await supabase.rpc("cancel_two_vs_two_matchmaking", {
          p_room_id: currentRoomId || null,
        });
      }
    } catch (err) {
      console.warn("Failed to cancel matchmaking", err);
    }

    // stop any local countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    setCountdownSeconds(null);

    router.replace("/(tabs)/lobby");
  };

  useEffect(() => {
    return () => {
      if (navigationStartedRef.current) return;

      if (currentMatchType !== "private" && matchmakingStatus === "searching") {
        void (async () => {
          try {
            if (isOneVsOne) {
              await supabase.rpc("cancel_one_vs_one_matchmaking", {
                p_room_id: null,
              });
            } else {
              await supabase.rpc("cancel_two_vs_two_matchmaking", {
                p_room_id: null,
              });
            }
          } catch {
            // Ignore cleanup errors.
          }
        })();
      }
    };
  }, [
    currentMatchType,
    matchmakingStatus,
    isMatched,
    currentRoomId,
    isOneVsOne,
  ]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const isSearching =
    currentMatchType !== "private" && matchmakingStatus === "searching";
  const isMatchFound = playersReady;
  const isPrivateWaiting = currentMatchType === "private" && !playersReady;

  const centerTitle = isPrivateWaiting
    ? "چاوەڕوانی"
    : isSearching
      ? "گەڕان بە دوای یاریزان"
      : isMatchFound
        ? "دۆزرایەوە"
        : "گەڕان";

  const centerSubtitle = isPrivateWaiting
    ? "Share the room code below to begin."
    : isSearching
      ? ""
      : isMatchFound
        ? countdownSeconds !== null
          ? `Starting in ${countdownSeconds}`
          : "Starting in 5"
        : "";

  const copyPrivateRoomCode = async () => {
    if (!privateRoomCode) return;
    await Clipboard.setStringAsync(privateRoomCode);
    setCopyMessage("Room code copied");
  };

  // Trigger countdown when a match is found
  useEffect(() => {
    if (!isMatchFound) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }

      countdownSecondsRef.current = null;
      setCountdownSeconds(null);
      return;
    }

    if (navigationStartedRef.current || countdownIntervalRef.current) return;

    const startValue = 5;
    countdownSecondsRef.current = startValue;
    setCountdownSeconds(startValue);

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
          router.replace({
            pathname: "/game",
            params: {
              mode: gameMode,
              room_id: currentRoomId,
              matchType: currentMatchType,
            },
          });
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

  return (
    <ImageBackground
      source={require("@/assets/images/lobby/lobby-bg.webp")}
      style={styles.background}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay} />

        <View style={styles.matchArea}>
          <View style={styles.sidePlayers}>
            {leftSlots.map((player, index) => {
              // If slot empty, show local player immediately on the left-most slot
              const alreadyInPlayers =
                localPlayer &&
                players.some((p) => p.userId === localPlayer.userId);

              const displayPlayer =
                player ??
                (index === 0 && localPlayer && !alreadyInPlayers
                  ? localPlayer
                  : null);

              return renderPlayerSlot(displayPlayer, index);
            })}
          </View>

          <View style={styles.centerColumn}>
            <View style={styles.centerWrap}>
              <Animated.View
                style={[styles.outerRing, { transform: [{ rotate: spin }] }]}
              >
                <View style={styles.ringGlow} />
              </Animated.View>

              <Animated.View
                style={[styles.centerCircle, { transform: [{ scale: pulse }] }]}
              >
                <Text
                  style={
                    isMatched || playersReady ? styles.matchText : styles.timer
                  }
                >
                  {centerTitle}
                </Text>
                <Text style={styles.waitText}>{centerSubtitle}</Text>
              </Animated.View>
            </View>

            {isPrivateWaiting && privateRoomCode ? (
              <Pressable
                style={styles.roomCodeCard}
                onPress={() => void copyPrivateRoomCode()}
              >
                <Text style={styles.roomCodeLabel}>Private room code</Text>
                <Text style={styles.roomCodeValue}>{privateRoomCode}</Text>
                <Text style={styles.roomCodeHint}>
                  {copyMessage || "Tap to copy"}
                </Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>پاشگەزبوونەوە</Text>
            </Pressable>
          </View>

          <View style={styles.sidePlayers}>
            {rightSlots.map((player, index) =>
              renderPlayerSlot(player, index, 150),
            )}
          </View>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#050214",
  },

  safeArea: {
    flex: 1,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,0,15,0.54)",
  },

  matchArea: {
    flex: 1,
    paddingHorizontal: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 34,
  },

  sidePlayers: {
    flexDirection: "row",
    gap: 16,
  },

  playerCard: {
    width: 106,
    height: 152,
    borderRadius: 15,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#a855f7",
    backgroundColor: "rgba(17,7,35,0.88)",
  },

  playerGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 9,
  },

  avatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: "#a855f7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 9,
  },

  avatarCircle: {
    width: 51,
    height: 51,
    borderRadius: 26,
    backgroundColor: "#f8d17b",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyAvatar: {
    backgroundColor: "rgba(0,0,0,0.42)",
  },

  emptyAvatarText: {
    color: "#ffffff",
    fontSize: 24,
    fontFamily: "SpedaBold",
  },

  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 6,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#22c55e",
  },

  playerName: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    marginBottom: 5,
  },

  playerRating: {
    color: "#d7c9ef",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  centerColumn: {
    width: 185,
    alignItems: "center",
    justifyContent: "center",
  },

  centerWrap: {
    width: 170,
    height: 170,
    alignItems: "center",
    justifyContent: "center",
  },

  outerRing: {
    position: "absolute",
    width: 164,
    height: 164,
    borderRadius: 82,
    borderWidth: 3,
    borderColor: "rgba(168,85,247,0.55)",
    borderTopColor: "#e9d5ff",
    borderRightColor: "#7c3aed",
  },

  ringGlow: {
    position: "absolute",
    top: -4,
    left: 70,
    width: 24,
    height: 8,
    borderRadius: 99,
    backgroundColor: "#c084fc",
  },

  centerCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "rgba(12,5,35,0.88)",
    borderWidth: 1,
    borderColor: "rgba(216,180,254,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  roomCodeCard: {
    marginTop: 14,
    minWidth: 190,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: "center",
    backgroundColor: "rgba(19, 8, 48, 0.94)",
    borderWidth: 1,
    borderColor: "#a855f7",
  },
  roomCodeLabel: { color: "#d8b4fe", fontFamily: "SpedaBold", fontSize: 12 },
  roomCodeValue: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 24,
    letterSpacing: 3,
    marginTop: 3,
  },
  roomCodeHint: { color: "#b7c8e8", fontSize: 11, marginTop: 3 },

  timer: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    paddingHorizontal: 12,
  },

  matchText: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    paddingHorizontal: 12,
  },

  waitText: {
    color: "#d7c9ef",
    fontSize: 15,
    fontFamily: "SpedaBold",
    marginTop: 6,
  },

  cancelButton: {
    marginTop: 22,
    height: 38,
    minWidth: 110,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  cancelButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
});
