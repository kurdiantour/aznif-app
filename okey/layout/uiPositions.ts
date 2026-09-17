// Centralized static UI position constants for Okey layout.
// Keep only static baseline numbers here. Dynamic adjustments
// (safe-area insets, clamps, percentages) remain in the
// responsive layout generator.

export const RACK_HEIGHT = 72;
export const RACK_BOTTOM_BASE = 82; // used as `RACK_BOTTOM_BASE + safe.bottom`

export const OPPONENT_RACK_WIDTH = 140;
export const OPPONENT_RACK_HEIGHT = 40;

// Rack default padding when a computed value isn't available
export const RACK_DEFAULT_PADDING_HORIZONTAL = 86;

// Turn timer defaults for the rack area
export const RACK_TURN_TIMER_LEFT = "3%";
export const RACK_TURN_TIMER_RIGHT = "3%";
export const RACK_TURN_TIMER_TOP = 28;
export const RACK_TURN_TIMER_HEIGHT = 5;

export const CENTER_PILES_TOP_PCT = 0.32; // center piles top fraction of usableHeight

// Joker (نوز) center placement inside center piles (relative coordinates)
export const CENTER_JOKER_REL_X = 0.5; // 0..1 relative to centerPiles width
export const CENTER_JOKER_REL_Y = 0.5; // 0..1 relative to centerPiles height
export const CENTER_JOKER_SIZE_PCT = 0.14; // size relative to usableWidth (approx)
