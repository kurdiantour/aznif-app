// Centralized static UI position constants for Okey layout.
// Keep only static baseline numbers here. Dynamic adjustments
// (safe-area insets, clamps, percentages) remain in the
// responsive layout generator.

export const RACK_HEIGHT = 72;
export const RACK_BOTTOM_BASE = 82; // used as `RACK_BOTTOM_BASE + safe.bottom`
export const TOP_MELD_OFFSET = 82; // subtracted from centerPilesTop to position top meld

export const MELD_BOTTOM_RIGHT = 100;
export const MELD_BOTTOM_BOTTOM = 105;

// Export other static defaults used across Okey when needed.
export const DEFAULT_MELD_WIDTH_MIN = 190;
export const DEFAULT_MELD_WIDTH_MAX = 340;

// Rack default padding when a computed value isn't available
export const RACK_DEFAULT_PADDING_HORIZONTAL = 86;

// Turn timer defaults for the rack area
export const RACK_TURN_TIMER_LEFT = "3%";
export const RACK_TURN_TIMER_RIGHT = "3%";
export const RACK_TURN_TIMER_TOP = 28;
export const RACK_TURN_TIMER_HEIGHT = 5;

// Percent-based anchors for responsive layout (single source for meld placement)
export const MELD_LEFT_LEFT_PCT = 0.06; // left position for top meld area (usableWidth * pct)
export const MELD_SIDE_PCT = 0.13; // side offset for left/right meld areas
export const MELD_HALF_WIDTH_PCT = 0.34; // half-table meld column width (usableWidth * pct)
export const MELD_WIDTH_PCT = 0.32; // single meld column width (usableWidth * pct)
export const MELD_TOP_PCT = 0.18; // top offset for meld areas (usableHeight * pct)
export const CENTER_PILES_TOP_PCT = 0.32; // center piles top fraction of usableHeight

// Joker (نوز) center placement inside center piles (relative coordinates)
export const CENTER_JOKER_REL_X = 0.5; // 0..1 relative to centerPiles width
export const CENTER_JOKER_REL_Y = 0.5; // 0..1 relative to centerPiles height
export const CENTER_JOKER_SIZE_PCT = 0.14; // size relative to usableWidth (approx)
