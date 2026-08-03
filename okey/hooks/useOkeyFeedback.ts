import * as Haptics from "expo-haptics";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";

import { OkeyFeedbackGate } from "@/okey/feedback/okey-feedback-policy";
import {
  getCachedOkeyFeedbackPreferences,
  loadOkeyFeedbackPreferences,
  subscribeToOkeyFeedbackPreferences,
} from "@/okey/feedback/okey-feedback-preferences";
import type { OkeyFeedbackEvent } from "@/okey/feedback/okey-feedback-types";

const TILE_SOUND = require("@/assets/audio/game/tile-placement-1.mp3");
const MOVE_SOUND = require("@/assets/audio/game/tile-placement-2.mp3");
const MELD_SOUND = require("@/assets/audio/game/boneyard-draw.mp3");
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
    } catch {
      // Player was already released (Fast Refresh / Unmount)
    }
  });
}

export function useOkeyFeedback() {
  const tilePlayer = useAudioPlayer(TILE_SOUND);
  const movePlayer = useAudioPlayer(MOVE_SOUND);
  const meldPlayer = useAudioPlayer(MELD_SOUND);
  const resultPlayer = useAudioPlayer(RESULT_SOUND);

  const players = useMemo(
    () => ({
      tile: tilePlayer,
      move: movePlayer,
      meld: meldPlayer,
      result: resultPlayer,
    }),
    [tilePlayer, movePlayer, meldPlayer, resultPlayer],
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

      // عمداً pause نمی‌کنیم.
      // useAudioPlayer خودش موقع Unmount پلیرها را آزاد می‌کند.
    };
  }, [players]);

  const emitFeedback = useCallback(
    (event: OkeyFeedbackEvent, eventKey: string) => {
      const decision = gateRef.current.consume(event, eventKey);

      if (!decision) return false;

      if (decision.playSound) {
        const playbackToken = ++playbackTokenRef.current;

        const player = RESULT_EVENTS.has(event)
          ? players.result
          : event === "meld-open" || event === "konkan"
            ? players.meld
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
                : Haptics.impactAsync(
                    Haptics.ImpactFeedbackStyle.Light,
                  );

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