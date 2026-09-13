/**
 * Canonical Presentation Budget Contract for Okey End-of-Round Lifecycle.
 *
 * Client-only presentation timings. The authoritative server never imports
 * this module and never waits for these animations.
 * Strict Chronological Sequence:
 *   1. Round Finished (phase = "finished")
 *   2. Final Tile Celebration (0.0s .. 5.0s)
 *   3. Result Popup Display (client-controlled)
 */
export const OKEY_ROUND_END_PRESENTATION_BUDGET = {
  /** Duration of the winning tile reveal/zoom cinematic motion animation */
  FINAL_TILE_ANIMATION_MS: 2_000,

  /** Duration to hold the celebrated winning tile on screen before dismissal */
  FINAL_TILE_HOLD_MS: 3_000,

  /** Total duration of the tile celebration phase before the result popup opens */
  CELEBRATION_DURATION_MS: 5_000,

  /** Dedicated local viewing window for the round score popup. */
  RESULT_POPUP_VIEW_DURATION_MS: 3_500,
} as const;
