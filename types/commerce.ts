export type BadgeType = "POPULAR" | "SPECIAL_OFFER" | "BEST_VALUE" | null;
export type OfferType = "BONUS_GEMS" | "PRICE_DISCOUNT";

/**
 * Represents the base gem package as it exists in the store/database.
 */
export interface GemPackage {
  id: string;
  baseGems: number;
  basePriceUsd: number;
  badge: BadgeType;
  sortOrder: number;
}

/**
 * Represents a promotional offer applied to a gem package.
 * Start and End times should ultimately be validated server-side.
 */
export interface GemOffer {
  id: string;
  targetPackageId: string;
  type: OfferType;
  active: boolean;
  startTime: string | null; // ISO Date String
  endTime: string | null;   // ISO Date String
  bonusGemsAmount?: number;
  discountPriceUsd?: number;
}

/**
 * Computed model representing the final state of a package after offers are evaluated.
 * This is what the UI should consume.
 */
export interface ComputedGemPackage extends GemPackage {
  hasActiveOffer: boolean;
  finalGems: number;
  finalPriceUsd: number;
  bonusAmount: number;
  originalPriceUsd: number;
  offerType: OfferType | null;
}
