export type OkeyFeedbackEvent =
  | "draw-deck"
  | "draw-discard"
  | "discard"
  | "rack-select"
  | "rack-move"
  | "meld-open"
  | "konkan"
  | "turn-start"
  | "timeout-warning"
  | "timeout"
  | "invalid"
  | "round-win"
  | "round-loss"
  | "round-draw"
  | "match-win"
  | "match-loss"
  | "match-draw";

export type OkeyFeedbackPreferences = {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
};

export const DEFAULT_OKEY_FEEDBACK_PREFERENCES: OkeyFeedbackPreferences = {
  soundEnabled: true,
  hapticsEnabled: true,
};
