/**
 * Canonical Presentation Budget Contract for Okey End-of-Round Lifecycle.
 *
 * Single source of truth for both Server and Client.
 * Strict Chronological Sequence:
 *   1. Round Finished (phase = "finished")
 *   2. Final Tile Celebration (0.0s .. 5.0s)
 *   3. Result Popup Display (5.0s .. 8.5s)
 *   4. Next Round Start (>= 8.5s)
 */
export const OKEY_ROUND_END_PRESENTATION_BUDGET = {
  /** Duration of the winning tile reveal/zoom cinematic motion animation */
  FINAL_TILE_ANIMATION_MS: 2_000,

  /** Duration to hold the celebrated winning tile on screen before dismissal */
  FINAL_TILE_HOLD_MS: 3_000,

  /** Total duration of the tile celebration phase before the result popup opens */
  CELEBRATION_DURATION_MS: 5_000,

  /** Dedicated viewing window for players to comfortably view the round score popup */
  RESULT_POPUP_VIEW_DURATION_MS: 3_500,

  /**
   * Total end-of-round lifecycle delay.
   * Authoritative server sets `nextRoundEligibleAt = now + TOTAL_LIFECYCLE_DELAY_MS`.
   */
  TOTAL_LIFECYCLE_DELAY_MS: 8_500,
} as const;
