import * as Haptics from "expo-haptics";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import {
  getGameFeedbackPreferences,
  loadGameFeedbackPreferences,
  saveGameFeedbackPreferences,
  subscribeGameFeedbackPreferences,
  useGameFeedbackPreferences,
} from "@/lib/gameFeedbackPreferences";

import type { OkeyGameState, OkeyTeamId } from "@/okey/types/okey";

type OkeyRoundResult = {
  round: number;
  winnerTeamId: OkeyTeamId | null;
};

import {
  DEFAULT_OKEY_FEEDBACK_PREFERENCES,
  type OkeyFeedbackDecision,
  type OkeyFeedbackEvent,
  OkeyFeedbackGate,
  type OkeyFeedbackPreferences,
} from "./okey-feedback-gate";

export {
  DEFAULT_OKEY_FEEDBACK_PREFERENCES,
  type OkeyFeedbackDecision,
  type OkeyFeedbackEvent,
  OkeyFeedbackGate,
  type OkeyFeedbackPreferences,
};

export const OKEY_FEEDBACK_PREFERENCES_KEY = "game-feedback-preferences-v1";
export const loadOkeyFeedbackPreferences = loadGameFeedbackPreferences;
export const saveOkeyFeedbackPreferences = saveGameFeedbackPreferences;
export const getCachedOkeyFeedbackPreferences = getGameFeedbackPreferences;
export const subscribeToOkeyFeedbackPreferences = subscribeGameFeedbackPreferences;
export const useOkeyFeedbackPreferences = useGameFeedbackPreferences;


const TILE_SOUND = require("@/assets/audio/game/tile-placement-1.mp3");
const MOVE_SOUND = require("@/assets/audio/game/tile-placement-2.mp3");
const RESULT_SOUND = require("@/assets/audio/game/bang.mp3");

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
    new OkeyFeedbackGate(getGameFeedbackPreferences()),
  );
  const activeRef = useRef(AppState.currentState === "active");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    gateRef.current.setActive(activeRef.current);

    const unsubscribePreferences =
      subscribeGameFeedbackPreferences((preferences) => {
        gateRef.current.setPreferences(preferences);
        if (!preferences.soundEnabled) pausePlayersSafely(players);
      });

    void loadGameFeedbackPreferences();

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
          pausePlayersSafely(players);
        }
      },
    );

    return () => {
      mountedRef.current = false;
      gateRef.current.setActive(false);

      unsubscribePreferences();
      subscription.remove();

    };
  }, [players]);

  const emitFeedback = useCallback(
    (event: OkeyFeedbackEvent, eventKey: string) => {
      const decision = gateRef.current.consume(event, eventKey);

      if (!decision) return false;

      if (decision.playSound) {

        const player = RESULT_EVENTS.has(event)
          ? players.result
          : event === "rack-select" ||
              event === "rack-move" ||
              event === "invalid"
            ? players.move
            : players.tile;

        void player
          .seekTo(0, 0, 0)
          .then(() => {
            if (mountedRef.current && activeRef.current && getGameFeedbackPreferences().soundEnabled) {
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
