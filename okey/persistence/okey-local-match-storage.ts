import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  OKEY_SAVE_VERSION,
  parseSavedOkeyMatch,
  type OkeyMatchState,
} from "@/okey/match/okey-match-state";

const OKEY_GAME_STORAGE_KEY = "okey-game-state-v3";
const LEGACY_OKEY_GAME_STORAGE_KEY = "okey-game-state-v2";
const OKEY_STORAGE_KEYS = [OKEY_GAME_STORAGE_KEY, LEGACY_OKEY_GAME_STORAGE_KEY];

export type LocalOkeyMatchSnapshot = {
  match: OkeyMatchState;
  savedAt: number;
};

export async function loadLocalOkeyMatchSnapshot(): Promise<LocalOkeyMatchSnapshot | null> {
  const raw = await AsyncStorage.getItem(OKEY_GAME_STORAGE_KEY);
  const fallbackRaw = raw ?? await AsyncStorage.getItem(LEGACY_OKEY_GAME_STORAGE_KEY);
  const savedMatch = parseSavedOkeyMatch(fallbackRaw);
  if (!savedMatch && fallbackRaw) await AsyncStorage.multiRemove(OKEY_STORAGE_KEYS);
  if (!savedMatch) return null;

  let savedAt = Date.now();
  try {
    const parsed = fallbackRaw ? JSON.parse(fallbackRaw) as { savedAt?: unknown } : null;
    if (typeof parsed?.savedAt === "number" && Number.isFinite(parsed.savedAt)) savedAt = parsed.savedAt;
  } catch {
    // parseSavedOkeyMatch already validated the stored payload.
  }
  return { match: savedMatch, savedAt };
}

export async function loadLocalOkeyMatch(): Promise<OkeyMatchState | null> {
  return (await loadLocalOkeyMatchSnapshot())?.match ?? null;
}

export function saveLocalOkeyMatch(match: OkeyMatchState, savedAt = Date.now()) {
  return AsyncStorage.setItem(
    OKEY_GAME_STORAGE_KEY,
    JSON.stringify({ version: OKEY_SAVE_VERSION, savedAt, match }),
  );
}

export function clearLocalOkeyMatch() {
  return AsyncStorage.multiRemove(OKEY_STORAGE_KEYS);
}