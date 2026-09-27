import { GemPackage, GemOffer, ComputedGemPackage } from "@/types/commerce";

// Source of Truth for base packages
// These IDs match the production Product IDs for App Store and Google Play
export const GEM_PACKAGES: GemPackage[] = [
  {
    id: "aznif_gem_199",
    baseGems: 199,
    basePriceUsd: 0.99,
    badge: null,
    sortOrder: 1,
  },
  {
    id: "aznif_gem_1200",
    baseGems: 1200,
    basePriceUsd: 4.99,
    badge: null,
    sortOrder: 2,
  },
  {
    id: "aznif_gem_2500",
    baseGems: 2500,
    basePriceUsd: 9.99,
    badge: "POPULAR",
    sortOrder: 3,
  },
  {
    id: "aznif_gem_5500",
    baseGems: 5500,
    basePriceUsd: 19.99,
    badge: null,
    sortOrder: 4,
  },
  {
    id: "aznif_gem_15000",
    baseGems: 15000,
    basePriceUsd: 49.99,
    badge: null,
    sortOrder: 5,
  },
];

// Active or scheduled offers
export const GEM_OFFERS: GemOffer[] = [
  {
    id: "offer_5500_bonus",
    targetPackageId: "aznif_gem_5500",
    type: "BONUS_GEMS",
    active: true,
    startTime: null,
    endTime: null,
    bonusGemsAmount: 2000,
  }
];

/**
 * Computes the final state of gem packages by applying active and valid offers.
 * NOTE: new Date() is only for client-side preview rendering.
 * True validation of active offers MUST be authoritative on the server/DB.
 */
export function getAvailableGemPackages(): ComputedGemPackage[] {
  const now = new Date();

  return GEM_PACKAGES.map((pkg) => {
    // Find a valid offer for this package
    const offer = GEM_OFFERS.find((o) => {
      if (o.targetPackageId !== pkg.id || !o.active) return false;
      
      const start = o.startTime ? new Date(o.startTime) : null;
      const end = o.endTime ? new Date(o.endTime) : null;
      
      if (start && now < start) return false;
      if (end && now > end) return false;
      
      return true;
    });

    let finalGems = pkg.baseGems;
    let finalPriceUsd = pkg.basePriceUsd;
    let bonusAmount = 0;

    if (offer) {
      if (offer.type === "BONUS_GEMS" && offer.bonusGemsAmount) {
        finalGems += offer.bonusGemsAmount;
        bonusAmount = offer.bonusGemsAmount;
      } else if (offer.type === "PRICE_DISCOUNT" && offer.discountPriceUsd) {
        finalPriceUsd = offer.discountPriceUsd;
      }
    }

    return {
      ...pkg,
      hasActiveOffer: !!offer,
      finalGems,
      finalPriceUsd,
      bonusAmount,
      originalPriceUsd: pkg.basePriceUsd,
      offerType: offer?.type ?? null,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}
