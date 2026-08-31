import * as Haptics from "expo-haptics";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import type { OkeyGameState, OkeyTeamId } from "@/okey/types/okey";

type OkeyRoundResult = {
  round: number;
  winnerTeamId: OkeyTeamId | null;
};

export type OkeyFeedbackEvent =
  | "draw-deck" | "draw-discard" | "discard" | "rack-select" | "rack-move"
  | "meld-open" | "konkan" | "turn-start" | "timeout-warning" | "timeout"
  | "invalid" | "round-win" | "round-loss" | "round-draw"
  | "match-win" | "match-loss" | "match-draw";

export type OkeyFeedbackPreferences = {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
};

export const DEFAULT_OKEY_FEEDBACK_PREFERENCES: OkeyFeedbackPreferences = {
  soundEnabled: true,
  hapticsEnabled: true,
};

export const OKEY_FEEDBACK_PREFERENCES_KEY = "okey-feedback-preferences-v1";

const preferenceListeners = new Set<(preferences: OkeyFeedbackPreferences) => void>();
let cachedPreferences = DEFAULT_OKEY_FEEDBACK_PREFERENCES;

function normalizePreferences(value: unknown): OkeyFeedbackPreferences {
  if (!value || typeof value !== "object") return DEFAULT_OKEY_FEEDBACK_PREFERENCES;
  const candidate = value as Partial<OkeyFeedbackPreferences>;
  return {
    soundEnabled: typeof candidate.soundEnabled === "boolean" ? candidate.soundEnabled : true,
    hapticsEnabled: typeof candidate.hapticsEnabled === "boolean" ? candidate.hapticsEnabled : true,
  };
}

export async function loadOkeyFeedbackPreferences() {
  try {
    const raw = await AsyncStorage.getItem(OKEY_FEEDBACK_PREFERENCES_KEY);
    cachedPreferences = normalizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    cachedPreferences = DEFAULT_OKEY_FEEDBACK_PREFERENCES;
  }
  preferenceListeners.forEach((listener) => listener(cachedPreferences));
  return cachedPreferences;
}

export async function saveOkeyFeedbackPreferences(preferences: OkeyFeedbackPreferences) {
  cachedPreferences = normalizePreferences(preferences);
  preferenceListeners.forEach((listener) => listener(cachedPreferences));
  try {
    await AsyncStorage.setItem(OKEY_FEEDBACK_PREFERENCES_KEY, JSON.stringify(cachedPreferences));
  } catch (error) {
    console.warn("Unable to save Okey feedback preferences", error);
  }
}

export function getCachedOkeyFeedbackPreferences() {
  return cachedPreferences;
}

export function subscribeToOkeyFeedbackPreferences(listener: (preferences: OkeyFeedbackPreferences) => void) {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

export function useOkeyFeedbackPreferences() {
  const [preferences, setPreferences] = useState(getCachedOkeyFeedbackPreferences);

  useEffect(() => {
    const unsubscribe = subscribeToOkeyFeedbackPreferences(setPreferences);
    void loadOkeyFeedbackPreferences();
    return unsubscribe;
  }, []);

  const setSoundEnabled = useCallback((soundEnabled: boolean) => {
    void saveOkeyFeedbackPreferences({ ...getCachedOkeyFeedbackPreferences(), soundEnabled });
  }, []);
  const setHapticsEnabled = useCallback((hapticsEnabled: boolean) => {
    void saveOkeyFeedbackPreferences({ ...getCachedOkeyFeedbackPreferences(), hapticsEnabled });
  }, []);

  return { ...preferences, setSoundEnabled, setHapticsEnabled };
}

export type OkeyFeedbackDecision = {
  event: OkeyFeedbackEvent;
  playSound: boolean;
  playHaptic: boolean;
};

export class OkeyFeedbackGate {
  private readonly maxKeys: number;
  private active = true;
  private preferences: OkeyFeedbackPreferences;
  private readonly consumedKeys = new Set<string>();
  private readonly keyQueue: string[] = [];

  constructor(preferences: OkeyFeedbackPreferences, maxKeys = 256) {
    this.maxKeys = maxKeys;
    this.preferences = preferences;
  }

  setActive(active: boolean) { this.active = active; }
  setPreferences(preferences: OkeyFeedbackPreferences) { this.preferences = preferences; }

  consume(event: OkeyFeedbackEvent, eventKey: string): OkeyFeedbackDecision | null {
    if (!this.active || this.consumedKeys.has(eventKey)) return null;
    this.consumedKeys.add(eventKey);
    this.keyQueue.push(eventKey);
    while (this.keyQueue.length > this.maxKeys) {
      const oldest = this.keyQueue.shift();
      if (oldest) this.consumedKeys.delete(oldest);
    }
    return {
      event,
      playSound: this.preferences.soundEnabled,
      playHaptic: this.preferences.hapticsEnabled,
    };
  }
}

const TILE_SOUND = require("@/assets/audio/game/tile-placement-1.mp3");
const MOVE_SOUND = require("@/assets/audio/game/tile-placement-2.mp3");
const RESULT_SOUND = require("@/assets/audio/game/pass.mp3");

const RESULT_EVENTS = new Set<OkeyFeedbackEvent>([
  "round-win",
  "round-loss",
  "round-draw",
  "match-win",
  "match-loss",
  "match-draw",
]);

function getHaptic(event: OkeyFeedbackEvent) {
  if (event === "invalid" || event === "timeout") return "error" as const;
  if (RESULT_EVENTS.has(event)) return "result" as const;
  if (
    event === "rack-select" ||
    event === "timeout-warning" ||
    event === "turn-start"
  ) {
    return "light" as const;
  }
  return "success" as const;
}

function pausePlayersSafely(
  players: Record<string, { pause: () => void }>,
) {
  Object.values(players).forEach((player) => {
    try {
      player.pause();
    } catch {    }
  });
}

export function useOkeyFeedback() {
  const tilePlayer = useAudioPlayer(TILE_SOUND);
  const movePlayer = useAudioPlayer(MOVE_SOUND);
  const resultPlayer = useAudioPlayer(RESULT_SOUND);

  const players = useMemo(
    () => ({
      tile: tilePlayer,
      move: movePlayer,
      result: resultPlayer,
    }),
    [tilePlayer, movePlayer, resultPlayer],
  );

  const gateRef = useRef(
    new OkeyFeedbackGate(getCachedOkeyFeedbackPreferences()),
  );
  const activeRef = useRef(AppState.currentState === "active");
  const mountedRef = useRef(true);
  const playbackTokenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    gateRef.current.setActive(activeRef.current);

    const unsubscribePreferences =
      subscribeToOkeyFeedbackPreferences((preferences) => {
        gateRef.current.setPreferences(preferences);
      });

    void loadOkeyFeedbackPreferences();

    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: "mixWithOthers",
    }).catch((error) =>
      console.warn("Unable to configure Okey audio", error),
    );

    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        activeRef.current = state === "active";
        gateRef.current.setActive(activeRef.current);

        if (!activeRef.current) {
          playbackTokenRef.current += 1;
          pausePlayersSafely(players);
        }
      },
    );

    return () => {
      mountedRef.current = false;
      gateRef.current.setActive(false);
      playbackTokenRef.current += 1;

      unsubscribePreferences();
      subscription.remove();

    };
  }, [players]);

  const emitFeedback = useCallback(
    (event: OkeyFeedbackEvent, eventKey: string) => {
      const decision = gateRef.current.consume(event, eventKey);

      if (!decision) return false;

      if (
        decision.playSound &&
        event !== "meld-open" &&
        event !== "konkan"
      ) {
        const playbackToken = ++playbackTokenRef.current;

        const player = RESULT_EVENTS.has(event)
          ? players.result
          : event === "rack-select" ||
              event === "rack-move" ||
              event === "invalid"
            ? players.move
            : players.tile;

        pausePlayersSafely(players);

        void player
          .seekTo(0, 0, 0)
          .then(() => {
            if (
              mountedRef.current &&
              activeRef.current &&
              playbackTokenRef.current === playbackToken
            ) {
              player.play();
            }
          })
          .catch((error) =>
            console.warn(
              "Unable to play Okey feedback",
              error,
            ),
          );
      }

      if (decision.playHaptic) {
        const haptic = getHaptic(event);

        const operation =
          haptic === "error"
            ? Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Error,
              )
            : haptic === "result"
              ? Haptics.notificationAsync(
                  event.includes("win")
                    ? Haptics.NotificationFeedbackType.Success
                    : event.includes("loss")
                      ? Haptics.NotificationFeedbackType.Error
                      : Haptics.NotificationFeedbackType.Warning,
                )
              : haptic === "success"
                ? Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  )
                : (Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Light) ?? Promise.resolve());

        void operation.catch((error) =>
          console.warn(
            "Unable to run Okey haptic feedback",
            error,
          ),
        );
      }

      return true;
    },
    [players],
  );

  return { emitFeedback };
}

type EmitOkeyFeedback = (
  event: OkeyFeedbackEvent,
  eventKey: string,
) => boolean;

type OkeyGameFeedbackInput = {
  state: OkeyGameState;
  roundResults: OkeyRoundResult[];
  showMatchResultPopup: boolean;
  matchWinnerTeamId: OkeyTeamId | null;
  matchScores: Record<OkeyTeamId, number>;
  currentRound: number;
  humanTeamId: OkeyTeamId;
  isAppActive: boolean;
  lifecycleResumeToken: number;
  emitFeedback: EmitOkeyFeedback;
  suppressLocalMeldFeedbackSignatures?: string[];
};

export function useOkeyGameFeedback({
  state,
  roundResults,
  showMatchResultPopup,
  matchWinnerTeamId,
  matchScores,
  currentRound,
  humanTeamId,
  isAppActive,
  lifecycleResumeToken,
  emitFeedback,
  suppressLocalMeldFeedbackSignatures = [],
}: OkeyGameFeedbackInput) {
  const snapshotRef = useRef<OkeyGameState | null>(null);
  const roundResultsCountRef = useRef(roundResults.length);
  const matchVisibleRef = useRef(showMatchResultPopup);
  const resumeTokenRef = useRef(lifecycleResumeToken);

  useEffect(() => {
    const previous = snapshotRef.current;
    const resumed = resumeTokenRef.current !== lifecycleResumeToken;
    resumeTokenRef.current = lifecycleResumeToken;

    if (!isAppActive || resumed || !previous) {
      snapshotRef.current = state;
      roundResultsCountRef.current = roundResults.length;
      matchVisibleRef.current = showMatchResultPopup;
      return;
    }

    const previousHandCount =
      previous.players[previous.currentPlayerIndex]?.hand.length ?? 0;
    const currentHandCount =
      state.players[previous.currentPlayerIndex]?.hand.length ?? 0;

    if (currentHandCount > previousHandCount) {
      const source: OkeyFeedbackEvent =
        state.discardPile.length < previous.discardPile.length
          ? "draw-discard"
          : "draw-deck";

      const drawn =
        state.players[previous.currentPlayerIndex]?.hand.find(
          (tile) =>
            !previous.players[previous.currentPlayerIndex]?.hand.some(
              (entry) => entry.id === tile.id,
            ),
        );

      emitFeedback(
        source,
        `draw:${drawn?.id ?? state.currentPlayerIndex}:${state.discardPile.length}`,
      );
    }

    if (state.discardPile.length > previous.discardPile.length) {
      const discarded = state.discardPile[state.discardPile.length - 1];
      emitFeedback(
        "discard",
        `discard:${discarded?.id ?? state.discardPile.length}`,
      );
    }

    const previousMeldCount = previous.players.reduce(
      (total, player) => total + player.melds.length,
      0,
    );
    const currentMeldCount = state.players.reduce(
      (total, player) => total + player.melds.length,
      0,
    );

    if (currentMeldCount > previousMeldCount) {
      const enteredKonkan = state.players.some(
        (player, index) =>
          player.konkan &&
          (!previous.players[index]?.konkan ||
            (!previous.players[index]?.opened && player.opened)),
      );

      const suppressedLocalSignatures = new Set(
        suppressLocalMeldFeedbackSignatures,
      );
      const previousLocalSignatures = new Set(
        (previous.players[0]?.melds ?? []).map((meld) =>
          meld.tiles.map((tile) => tile.id).sort().join("|"),
        ),
      );
      const newlyAddedLocalMeldSignatures = (state.players[0]?.melds ?? [])
        .map((meld) => meld.tiles.map((tile) => tile.id).sort().join("|"))
        .filter((signature) => !previousLocalSignatures.has(signature));
      const suppressLocalDragMeldFeedback =
        !enteredKonkan &&
        newlyAddedLocalMeldSignatures.length > 0 &&
        newlyAddedLocalMeldSignatures.every((signature) =>
          suppressedLocalSignatures.has(signature),
        );

      if (!suppressLocalDragMeldFeedback) {
        emitFeedback(
          enteredKonkan ? "konkan" : "meld-open",
          `meld:${currentRound}:${currentMeldCount}`,
        );
      }
    }

    if (
      state.currentPlayerIndex !== previous.currentPlayerIndex &&
      state.currentPlayerIndex === 0
    ) {
      emitFeedback(
        "turn-start",
        `turn:${currentRound}:${state.discardPile.length}:0`,
      );
    }

    if (roundResults.length > roundResultsCountRef.current) {
      const result = roundResults[roundResults.length - 1];
      const event: OkeyFeedbackEvent =
        result?.winnerTeamId === null
          ? "round-draw"
          : result?.winnerTeamId === humanTeamId
            ? "round-win"
            : "round-loss";

      emitFeedback(
        event,
        `round-result:${result?.round ?? currentRound}`,
      );
    }

    if (showMatchResultPopup && !matchVisibleRef.current) {
      const event: OkeyFeedbackEvent =
        matchWinnerTeamId === null
          ? "match-draw"
          : matchWinnerTeamId === humanTeamId
            ? "match-win"
            : "match-loss";

      emitFeedback(
        event,
        `match-result:${currentRound}:${matchScores.teamA}:${matchScores.teamB}`,
      );
    }

    snapshotRef.current = state;
    roundResultsCountRef.current = roundResults.length;
    matchVisibleRef.current = showMatchResultPopup;
  }, [
    currentRound,
    emitFeedback,
    humanTeamId,
    isAppActive,
    lifecycleResumeToken,
    matchScores.teamA,
    matchScores.teamB,
    matchWinnerTeamId,
    roundResults,
    showMatchResultPopup,
    state,
  ]);
}

