// Centralized static UI position constants for Okey layout.
// Keep only static baseline numbers here. Dynamic adjustments
// (safe-area insets, clamps, percentages) remain in the
// responsive layout generator.

// Player rack source of truth
export const RACK_ASPECT_RATIO = 1000 / 240;
export const RACK_BOTTOM_BASE = 82; // used as `RACK_BOTTOM_BASE + safe.bottom`

// Player tile source of truth
export const PLAYER_TILE_WIDTH = 46;
export const PLAYER_TILE_HEIGHT = 57;
export const PLAYER_TILE_ASPECT_RATIO =
  PLAYER_TILE_HEIGHT / PLAYER_TILE_WIDTH;

// Opponent rack source of truth
// Asset dimensions: 245 x 60 px
export const OPPONENT_RACK_ASPECT_RATIO = 245 / 60;
export const OPPONENT_RACK_WIDTH = 140;
export const OPPONENT_RACK_HEIGHT =
  OPPONENT_RACK_WIDTH / OPPONENT_RACK_ASPECT_RATIO;

// Opponent tile source of truth
export const OPPONENT_TILE_WIDTH = 18;
export const OPPONENT_TILE_HEIGHT = 26;

// Turn timer defaults for the rack area
export const RACK_TURN_TIMER_LEFT = "3%";
export const RACK_TURN_TIMER_RIGHT = "3%";
export const RACK_TURN_TIMER_TOP = 0;
export const RACK_TURN_TIMER_HEIGHT = 5;

export const CENTER_PILES_TOP_PCT = 0.32;

// Joker center placement inside center piles
export const CENTER_JOKER_REL_X = 0.5;
export const CENTER_JOKER_REL_Y = 0.5;
export const CENTER_JOKER_SIZE_PCT = 0.14;