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
  hapticsEnabled: false,
};

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
