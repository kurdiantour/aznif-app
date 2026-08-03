import type { OkeyFeedbackEvent, OkeyFeedbackPreferences } from "./okey-feedback-types.ts";

export type OkeyFeedbackDecision = {
  event: OkeyFeedbackEvent;
  playSound: boolean;
  playHaptic: boolean;
};

export class OkeyFeedbackGate {
  private active = true;
  private preferences: OkeyFeedbackPreferences;
  private readonly consumedKeys = new Set<string>();
  private readonly keyQueue: string[] = [];

  constructor(preferences: OkeyFeedbackPreferences, private readonly maxKeys = 256) {
    this.preferences = preferences;
  }

  setActive(active: boolean) {
    this.active = active;
  }

  setPreferences(preferences: OkeyFeedbackPreferences) {
    this.preferences = preferences;
  }

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
