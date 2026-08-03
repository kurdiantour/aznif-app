import { expect, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OKEY_FEEDBACK_PREFERENCES_KEY, loadOkeyFeedbackPreferences, saveOkeyFeedbackPreferences } from "../okey-feedback-preferences";

test("sound and haptic preferences survive a storage reload", async () => {
  await saveOkeyFeedbackPreferences({ soundEnabled: false, hapticsEnabled: true });
  expect(await AsyncStorage.getItem(OKEY_FEEDBACK_PREFERENCES_KEY)).toBe(JSON.stringify({ soundEnabled: false, hapticsEnabled: true }));
  await expect(loadOkeyFeedbackPreferences()).resolves.toEqual({ soundEnabled: false, hapticsEnabled: true });
});

test("missing preference fields migrate to enabled defaults", async () => {
  await AsyncStorage.setItem(OKEY_FEEDBACK_PREFERENCES_KEY, JSON.stringify({ soundEnabled: false }));
  await expect(loadOkeyFeedbackPreferences()).resolves.toEqual({ soundEnabled: false, hapticsEnabled: true });
});
