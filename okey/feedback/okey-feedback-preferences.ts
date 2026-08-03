import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_OKEY_FEEDBACK_PREFERENCES,
  type OkeyFeedbackPreferences,
} from "./okey-feedback-types";

export const OKEY_FEEDBACK_PREFERENCES_KEY = "okey-feedback-preferences-v1";

const listeners = new Set<(preferences: OkeyFeedbackPreferences) => void>();
let cachedPreferences = DEFAULT_OKEY_FEEDBACK_PREFERENCES;

function normalize(value: unknown): OkeyFeedbackPreferences {
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
    cachedPreferences = normalize(raw ? JSON.parse(raw) : null);
  } catch {
    cachedPreferences = DEFAULT_OKEY_FEEDBACK_PREFERENCES;
  }
  listeners.forEach((listener) => listener(cachedPreferences));
  return cachedPreferences;
}

export async function saveOkeyFeedbackPreferences(preferences: OkeyFeedbackPreferences) {
  cachedPreferences = normalize(preferences);
  listeners.forEach((listener) => listener(cachedPreferences));
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
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
