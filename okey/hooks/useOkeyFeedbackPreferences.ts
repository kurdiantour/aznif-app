import { useCallback, useEffect, useState } from "react";

import {
  getCachedOkeyFeedbackPreferences,
  loadOkeyFeedbackPreferences,
  saveOkeyFeedbackPreferences,
  subscribeToOkeyFeedbackPreferences,
} from "@/okey/feedback/okey-feedback-preferences";

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
