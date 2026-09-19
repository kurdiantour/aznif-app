import type { ImageSourcePropType } from "react-native";

type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DominoTileKey =
  | `0-${Pip}`
  | `1-${Exclude<Pip, 0>}`
  | `2-${2 | 3 | 4 | 5 | 6}`
  | `3-${3 | 4 | 5 | 6}`
  | `4-${4 | 5 | 6}`
  | `5-${5 | 6}`
  | "6-6";

export type DominoTileImages = Record<
  DominoTileKey,
  ImageSourcePropType
>;

export type DominoSetAssets = {
  shopPreview: ImageSourcePropType;
  table: ImageSourcePropType;
  tiles: DominoTileImages;
};

/* -------------------------------------------------------------------------- */
/* Classic Tiles                                                              */
/* -------------------------------------------------------------------------- */

const CLASSIC_TILES: DominoTileImages = {
  "0-0": require("@/assets/cosmetics/domino/classic/tiles/0-0.webp"),
  "0-1": require("@/assets/cosmetics/domino/classic/tiles/0-1.webp"),
  "0-2": require("@/assets/cosmetics/domino/classic/tiles/0-2.webp"),
  "0-3": require("@/assets/cosmetics/domino/classic/tiles/0-3.webp"),
  "0-4": require("@/assets/cosmetics/domino/classic/tiles/0-4.webp"),
  "0-5": require("@/assets/cosmetics/domino/classic/tiles/0-5.webp"),
  "0-6": require("@/assets/cosmetics/domino/classic/tiles/0-6.webp"),

  "1-1": require("@/assets/cosmetics/domino/classic/tiles/1-1.webp"),
  "1-2": require("@/assets/cosmetics/domino/classic/tiles/1-2.webp"),
  "1-3": require("@/assets/cosmetics/domino/classic/tiles/1-3.webp"),
  "1-4": require("@/assets/cosmetics/domino/classic/tiles/1-4.webp"),
  "1-5": require("@/assets/cosmetics/domino/classic/tiles/1-5.webp"),
  "1-6": require("@/assets/cosmetics/domino/classic/tiles/1-6.webp"),

  "2-2": require("@/assets/cosmetics/domino/classic/tiles/2-2.webp"),
  "2-3": require("@/assets/cosmetics/domino/classic/tiles/2-3.webp"),
  "2-4": require("@/assets/cosmetics/domino/classic/tiles/2-4.webp"),
  "2-5": require("@/assets/cosmetics/domino/classic/tiles/2-5.webp"),
  "2-6": require("@/assets/cosmetics/domino/classic/tiles/2-6.webp"),

  "3-3": require("@/assets/cosmetics/domino/classic/tiles/3-3.webp"),
  "3-4": require("@/assets/cosmetics/domino/classic/tiles/3-4.webp"),
  "3-5": require("@/assets/cosmetics/domino/classic/tiles/3-5.webp"),
  "3-6": require("@/assets/cosmetics/domino/classic/tiles/3-6.webp"),

  "4-4": require("@/assets/cosmetics/domino/classic/tiles/4-4.webp"),
  "4-5": require("@/assets/cosmetics/domino/classic/tiles/4-5.webp"),
  "4-6": require("@/assets/cosmetics/domino/classic/tiles/4-6.webp"),

  "5-5": require("@/assets/cosmetics/domino/classic/tiles/5-5.webp"),
  "5-6": require("@/assets/cosmetics/domino/classic/tiles/5-6.webp"),

  "6-6": require("@/assets/cosmetics/domino/classic/tiles/6-6.webp"),
};

/* -------------------------------------------------------------------------- */
/* Emerald Ivory Tiles                                                        */
/* -------------------------------------------------------------------------- */

const EMERALD_IVORY_TILES: DominoTileImages = {
  "0-0": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-0.webp"),
  "0-1": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-1.webp"),
  "0-2": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-2.webp"),
  "0-3": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-3.webp"),
  "0-4": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-4.webp"),
  "0-5": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-5.webp"),
  "0-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/0-6.webp"),

  "1-1": require("@/assets/cosmetics/domino/emerald-ivory/tiles/1-1.webp"),
  "1-2": require("@/assets/cosmetics/domino/emerald-ivory/tiles/1-2.webp"),
  "1-3": require("@/assets/cosmetics/domino/emerald-ivory/tiles/1-3.webp"),
  "1-4": require("@/assets/cosmetics/domino/emerald-ivory/tiles/1-4.webp"),
  "1-5": require("@/assets/cosmetics/domino/emerald-ivory/tiles/1-5.webp"),
  "1-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/1-6.webp"),

  "2-2": require("@/assets/cosmetics/domino/emerald-ivory/tiles/2-2.webp"),
  "2-3": require("@/assets/cosmetics/domino/emerald-ivory/tiles/2-3.webp"),
  "2-4": require("@/assets/cosmetics/domino/emerald-ivory/tiles/2-4.webp"),
  "2-5": require("@/assets/cosmetics/domino/emerald-ivory/tiles/2-5.webp"),
  "2-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/2-6.webp"),

  "3-3": require("@/assets/cosmetics/domino/emerald-ivory/tiles/3-3.webp"),
  "3-4": require("@/assets/cosmetics/domino/emerald-ivory/tiles/3-4.webp"),
  "3-5": require("@/assets/cosmetics/domino/emerald-ivory/tiles/3-5.webp"),
  "3-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/3-6.webp"),

  "4-4": require("@/assets/cosmetics/domino/emerald-ivory/tiles/4-4.webp"),
  "4-5": require("@/assets/cosmetics/domino/emerald-ivory/tiles/4-5.webp"),
  "4-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/4-6.webp"),

  "5-5": require("@/assets/cosmetics/domino/emerald-ivory/tiles/5-5.webp"),
  "5-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/5-6.webp"),

  "6-6": require("@/assets/cosmetics/domino/emerald-ivory/tiles/6-6.webp"),
};

/* -------------------------------------------------------------------------- */
/* Set Assets                                                                 */
/* -------------------------------------------------------------------------- */

const CLASSIC_ASSETS: DominoSetAssets = {
  shopPreview: require(
    "@/assets/cosmetics/domino/classic/shop-preview.webp"
  ),
  table: require(
    "@/assets/cosmetics/domino/classic/table.webp"
  ),
  tiles: CLASSIC_TILES,
};

const EMERALD_IVORY_ASSETS: DominoSetAssets = {
  shopPreview: require(
    "@/assets/cosmetics/domino/emerald-ivory/shop-preview.webp"
  ),

  // Emerald Ivory currently uses the Classic Domino table.
  table: require(
    "@/assets/cosmetics/domino/classic/table.webp"
  ),

  tiles: EMERALD_IVORY_TILES,
};

/* -------------------------------------------------------------------------- */
/* Real Bundled Domino Sets                                                   */
/* -------------------------------------------------------------------------- */

export const DOMINO_ASSET_REGISTRY = {
  "domino-classic": CLASSIC_ASSETS,
  "domino-emerald-ivory": EMERALD_IVORY_ASSETS,
} as const satisfies Record<string, DominoSetAssets>;

export type DominoSetId =
  keyof typeof DOMINO_ASSET_REGISTRY;

/*
 * Rendering fallback only.
 * Commercial/default entitlement is resolved by the Shop/Database.
 */
export const DEFAULT_DOMINO_SET_ID: DominoSetId =
  "domino-classic";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function isDominoSetId(
  key: string
): key is DominoSetId {
  return Object.prototype.hasOwnProperty.call(
    DOMINO_ASSET_REGISTRY,
    key
  );
}

export function getDominoSetAssets(
  key: string | null | undefined
): DominoSetAssets {
  if (key && isDominoSetId(key)) {
    return DOMINO_ASSET_REGISTRY[key];
  }

  // Unknown/legacy asset keys safely render as Classic.
  return CLASSIC_ASSETS;
}