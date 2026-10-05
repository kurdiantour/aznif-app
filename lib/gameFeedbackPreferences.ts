import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

export type GameFeedbackPreferences = { soundEnabled: boolean; hapticsEnabled: boolean };
export const DEFAULT_GAME_FEEDBACK_PREFERENCES: GameFeedbackPreferences = {
  soundEnabled: true,
  hapticsEnabled: false,
};
export const GAME_FEEDBACK_PREFERENCES_KEY = "game-feedback-preferences-v1";
const LEGACY_OKEY_KEY = "okey-feedback-preferences-v1";

let cachedPreferences = DEFAULT_GAME_FEEDBACK_PREFERENCES;
const listeners = new Set<(preferences: GameFeedbackPreferences) => void>();
let loading: Promise<GameFeedbackPreferences> | null = null;

function normalize(value: unknown): GameFeedbackPreferences {
  if (!value || typeof value !== "object") return DEFAULT_GAME_FEEDBACK_PREFERENCES;
  const candidate = value as Partial<GameFeedbackPreferences>;
  return {
    soundEnabled: typeof candidate.soundEnabled === "boolean" ? candidate.soundEnabled : true,
    hapticsEnabled: typeof candidate.hapticsEnabled === "boolean" ? candidate.hapticsEnabled : false,
  };
}

function publish(preferences: GameFeedbackPreferences) {
  cachedPreferences = preferences;
  listeners.forEach((listener) => listener(preferences));
}

export function getGameFeedbackPreferences() { return cachedPreferences; }

export function subscribeGameFeedbackPreferences(listener: (preferences: GameFeedbackPreferences) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function loadGameFeedbackPreferences() {
  if (!loading) loading = (async () => {
    try {
      const current = await AsyncStorage.getItem(GAME_FEEDBACK_PREFERENCES_KEY);
      const legacy = current === null ? await AsyncStorage.getItem(LEGACY_OKEY_KEY) : null;
      const preferences = normalize(JSON.parse(current ?? legacy ?? "null"));
      publish(preferences);
      if (current === null && legacy !== null) {
        await AsyncStorage.setItem(GAME_FEEDBACK_PREFERENCES_KEY, JSON.stringify(preferences));
      }
    } catch (error) {
      console.warn("Unable to load game feedback preferences", error);
    }
    return cachedPreferences;
  })().finally(() => { loading = null; });
  return loading;
}

export async function saveGameFeedbackPreferences(preferences: GameFeedbackPreferences) {
  // Finish an initial load before saving, so it cannot overwrite the user's new choice.
  if (loading) await loading;
  publish(normalize(preferences));
  try {
    await AsyncStorage.setItem(GAME_FEEDBACK_PREFERENCES_KEY, JSON.stringify(cachedPreferences));
  } catch (error) {
    console.warn("Unable to save game feedback preferences", error);
  }
}

export function useGameFeedbackPreferences() {
  const [preferences, setPreferences] = useState(getGameFeedbackPreferences);
  useEffect(() => {
    const unsubscribe = subscribeGameFeedbackPreferences(setPreferences);
    void loadGameFeedbackPreferences();
    return unsubscribe;
  }, []);
  const setSoundEnabled = useCallback((soundEnabled: boolean) => {
    void saveGameFeedbackPreferences({ ...getGameFeedbackPreferences(), soundEnabled });
  }, []);
  const setHapticsEnabled = useCallback((hapticsEnabled: boolean) => {
    void saveGameFeedbackPreferences({ ...getGameFeedbackPreferences(), hapticsEnabled });
  }, []);
  return { ...preferences, setSoundEnabled, setHapticsEnabled };
}
