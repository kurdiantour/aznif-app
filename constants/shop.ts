import type { ImageSourcePropType } from "react-native";

import { TABLE_CATALOG, type TableCatalogItem } from "./catalog/tables";
import { DOMINO_CATALOG, type DominoCatalogItem } from "./catalog/domino-sets";

export type ShopCategory = "tables" | "domino-skins";

type ShopCosmeticItem = DominoCatalogItem & {
  category: "domino-skins";
  images: { shopPreview: ImageSourcePropType };
};

export type MockShopItem =
  | (TableCatalogItem & { category: "tables" })
  | ShopCosmeticItem;

export const SHOP_CATEGORIES: { id: ShopCategory; label: string }[] = [
  { id: "tables", label: "سێتی ئۆکەی" },
  { id: "domino-skins", label: "سێتی دۆمینۆ" },
];

export const MOCK_SHOP_AZNIF = 1_250;

export const MOCK_SHOP_ITEMS: MockShopItem[] = [
  ...TABLE_CATALOG.map((table) => ({ ...table, category: "tables" as const })),
  ...DOMINO_CATALOG.map((set) => ({
    ...set,
    category: "domino-skins" as const,
    images: { shopPreview: set.assets.shopPreview },
  })),
];
