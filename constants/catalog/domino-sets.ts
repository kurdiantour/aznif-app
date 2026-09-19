import type { ImageSourcePropType } from "react-native";

export type DominoSetId = "domino-classic" | "domino-emerald-ivory";

export type DominoTileImages = {
  [key: string]: ImageSourcePropType;
};

export type DominoSetAssets = {
  shopPreview: ImageSourcePropType;
  table: ImageSourcePropType;
  tiles: DominoTileImages;
};

export type DominoCatalogItem = {
  id: DominoSetId;
  name: string;
  price: number;
  assets: DominoSetAssets;
};

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

export const DOMINO_CATALOG: readonly DominoCatalogItem[] = [
  {
    id: "domino-classic",
    name: "دۆمینۆی کلاسیک",
    price: 0,
    assets: {
      shopPreview: require("@/assets/cosmetics/domino/classic/shop-preview.webp"),
      table: require("@/assets/cosmetics/domino/classic/table.webp"),
      tiles: CLASSIC_TILES,
    },
  },
  {
    id: "domino-emerald-ivory",
    name: "Emerald Ivory",
    price: 430,
    assets: {
      shopPreview: require("@/assets/cosmetics/domino/emerald-ivory/shop-preview.webp"),
      table: require("@/assets/cosmetics/domino/classic/table.webp"), // Fallback to classic table for now
      tiles: EMERALD_IVORY_TILES,
    },
  },
];

export const DEFAULT_DOMINO_SET_ID: DominoSetId = "domino-classic";

export function getDominoSetAssets(setId: string | null | undefined): DominoSetAssets {
  const item = DOMINO_CATALOG.find((s) => s.id === setId);
  return item ? item.assets : DOMINO_CATALOG[0].assets;
}
