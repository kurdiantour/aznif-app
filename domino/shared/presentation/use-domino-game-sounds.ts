import type { KozelBoardState } from "@/domino/types/domino-game";
import type { AudioPlayer } from "expo-audio";
import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
} from "expo-audio";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { AppState } from "react-native";
import * as Haptics from "expo-haptics";
import {
  getGameFeedbackPreferences,
  loadGameFeedbackPreferences,
  subscribeGameFeedbackPreferences,
} from "@/lib/gameFeedbackPreferences";
const PLACEMENT_SOURCES = [
  require("@/assets/audio/game/tile-placement-1.mp3"),
  require("@/assets/audio/game/tile-placement-2.mp3"),
  require("@/assets/audio/game/tile-placement-3.mp3"),
  require("@/assets/audio/game/tile-placement-4.mp3"),
  require("@/assets/audio/game/tile-placement-5.mp3"),
] as const;

const BONEYARD_SOURCE = require("@/assets/audio/game/boneyard-draw.mp3");
const PASS_SOURCE = require("@/assets/audio/game/pass.mp3");

const PLACEMENT_SEGMENTS = [
  { start: 0, durationMs: 900, volume: 1.0 },
  { start: 0, durationMs: 900, volume: 1.0 },
  { start: 0, durationMs: 900, volume: 1.0 },
  { start: 0, durationMs: 900, volume: 1.0 },
  { start: 0, durationMs: 900, volume: 1.0 },
] as const;

const BONEYARD_SEGMENT = {
  start: 0,
  durationMs: 750,
  volume: 1.0,
};

const PASS_SEGMENT = {
  start: 0,
  durationMs: 500,
  volume: 1.0,
};

let audioSessionPromise: Promise<void> | null = null;

function ensureGameAudioSession() {
  if (!audioSessionPromise) {
    audioSessionPromise = setIsAudioActiveAsync(true)
      .then(() =>
        setAudioModeAsync({
          playsInSilentMode: false,
          shouldPlayInBackground: false,
          interruptionMode: "mixWithOthers",
        }),
      )
      .finally(() => {
        audioSessionPromise = null;
      });
  }

  return audioSessionPromise;
}

function getBoardTileCount(board: KozelBoardState) {
  return (
    (board.centerTile ? 1 : 0) +
    Object.values(board.branches).reduce(
      (total, branch) => total + branch.tiles.length,
      0,
    )
  );
}

async function playSegment(
  player: AudioPlayer,
  segment: {
    start: number;
    durationMs: number;
    volume: number;
  },
  stopTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  isActive: () => boolean,
) {
  if (!isActive() || !getGameFeedbackPreferences().soundEnabled) return;

  if (stopTimerRef.current) {
    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  }

  try {
    await ensureGameAudioSession();
    if (!isActive() || !getGameFeedbackPreferences().soundEnabled) return;

    player.pause();
    player.volume = segment.volume;
    await player.seekTo(segment.start, 0, 0);
    if (!isActive() || !getGameFeedbackPreferences().soundEnabled) return;

    player.play();

    stopTimerRef.current = setTimeout(() => {
      try {
        player.pause();
      } catch {
        // The native player may already be released during screen teardown.
      }
      stopTimerRef.current = null;
    }, segment.durationMs);
  } catch (error) {
    console.warn("Unable to play game sound", error);
  }
}

export function useGameSounds({
  board,
  boneyardCount,
  lastPassedPlayerId,
  currentTurnPlayerId,
}: {
  board: KozelBoardState;
  boneyardCount: number;
  lastPassedPlayerId?: string | null;
  currentTurnPlayerId: string;
}) {
  const playerOptions = { keepAudioSessionActive: true } as const;
  const placementPlayer1 = useAudioPlayer(PLACEMENT_SOURCES[0], playerOptions);
  const placementPlayer2 = useAudioPlayer(PLACEMENT_SOURCES[1], playerOptions);
  const placementPlayer3 = useAudioPlayer(PLACEMENT_SOURCES[2], playerOptions);
  const placementPlayer4 = useAudioPlayer(PLACEMENT_SOURCES[3], playerOptions);
  const placementPlayer5 = useAudioPlayer(PLACEMENT_SOURCES[4], playerOptions);

  const boneyardPlayer = useAudioPlayer(BONEYARD_SOURCE, playerOptions);
  const passPlayer = useAudioPlayer(PASS_SOURCE, playerOptions);

  const placementPlayers = useMemo(
    () => [
      placementPlayer1,
      placementPlayer2,
      placementPlayer3,
      placementPlayer4,
      placementPlayer5,
    ],
    [
      placementPlayer1,
      placementPlayer2,
      placementPlayer3,
      placementPlayer4,
      placementPlayer5,
    ],
  );

  const placementTimer1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementTimer2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementTimer3 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementTimer4 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementTimer5 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const placementTimers = useMemo(
    () => [
      placementTimer1,
      placementTimer2,
      placementTimer3,
      placementTimer4,
      placementTimer5,
    ],
    [],
  );

  const boneyardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previousBoardCountRef = useRef<number | null>(null);
  const previousBoneyardCountRef = useRef<number | null>(null);
  const previousPassKeyRef = useRef<string | null>(null);

  const hasInitializedPassRef = useRef(false);
  const lastPlacementIndexRef = useRef<number | null>(null);
  const appIsActiveRef = useRef(AppState.currentState === "active");
  const isAppActive = useCallback(() => appIsActiveRef.current, []);

  const giveFeedback = useCallback((player: AudioPlayer, segment: { start: number; durationMs: number; volume: number }, timer: MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (!isAppActive()) return;
    const preferences = getGameFeedbackPreferences();
    if (preferences.soundEnabled) void playSegment(player, segment, timer, isAppActive);
    if (preferences.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((error) =>
        console.warn("Unable to run Domino haptic feedback", error),
      );
    }
  }, [isAppActive]);

  useEffect(() => {
    void loadGameFeedbackPreferences();
    const unsubscribePreferences = subscribeGameFeedbackPreferences((preferences) => {
      if (!preferences.soundEnabled) {
        [...placementPlayers, boneyardPlayer, passPlayer].forEach((player) => {
          try { player.pause(); } catch { /* Player may be released. */ }
        });
      }
    });
    if (appIsActiveRef.current) {
      void ensureGameAudioSession().catch((error) =>
        console.warn("[game-audio] audio session failed", error),
      );
    }

    const subscription = AppState.addEventListener("change", (state) => {
      appIsActiveRef.current = state === "active";

      if (appIsActiveRef.current) {
        void ensureGameAudioSession().catch((error) =>
          console.warn("[game-audio] audio session restore failed", error),
        );
      }
    });

    return () => { subscription.remove(); unsubscribePreferences(); };
  }, [placementPlayers, boneyardPlayer, passPlayer]);

  const playRandomPlacement = useCallback(() => {
    let index = Math.floor(Math.random() * PLACEMENT_SEGMENTS.length);

    if (index === lastPlacementIndexRef.current) {
      index =
        (index + 1 + Math.floor(Math.random() * 4)) %
        PLACEMENT_SEGMENTS.length;
    }

    lastPlacementIndexRef.current = index;

    giveFeedback(
      placementPlayers[index],
      PLACEMENT_SEGMENTS[index],
      placementTimers[index],
    );
  }, [giveFeedback, placementPlayers, placementTimers]);

  useEffect(() => {
    const boardCount = getBoardTileCount(board);
    const previousCount = previousBoardCountRef.current;

    previousBoardCountRef.current = boardCount;

    // Hydration/reconnect and round resets are silent.
    // Only authoritative board growth represents a confirmed placement.
    if (previousCount !== null && boardCount > previousCount) {
      playRandomPlacement();
    }
  }, [board, playRandomPlacement]);

  useEffect(() => {
    const previousCount = previousBoneyardCountRef.current;

    previousBoneyardCountRef.current = boneyardCount;

    if (previousCount !== null && boneyardCount < previousCount) {
      giveFeedback(
        boneyardPlayer,
        BONEYARD_SEGMENT,
        boneyardTimerRef,
      );
    }
  }, [boneyardCount, boneyardPlayer, giveFeedback]);

  useEffect(() => {
    if (!hasInitializedPassRef.current) {
      hasInitializedPassRef.current = true;

      previousPassKeyRef.current = lastPassedPlayerId
        ? `${lastPassedPlayerId}:${currentTurnPlayerId}`
        : null;

      return;
    }

    if (!lastPassedPlayerId) {
      previousPassKeyRef.current = null;
      return;
    }

    const passKey = `${lastPassedPlayerId}:${currentTurnPlayerId}`;

    if (previousPassKeyRef.current === passKey) {
      return;
    }

    previousPassKeyRef.current = passKey;

    giveFeedback(
      passPlayer,
      PASS_SEGMENT,
      passTimerRef,
    );
  }, [
    currentTurnPlayerId,
    lastPassedPlayerId,
    passPlayer,
    giveFeedback,
  ]);

  useEffect(
    () => () => {
      [
        ...placementTimers,
        boneyardTimerRef,
        passTimerRef,
      ].forEach((timerRef) => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      });
    },
    [placementTimers],
  );
}
