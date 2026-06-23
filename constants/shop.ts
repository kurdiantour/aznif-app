import type { ImageSourcePropType } from "react-native";

import { TABLE_CATALOG, type TableCatalogItem } from "./catalog/tables";

export type ShopCategory = "tables" | "domino-skins";

type ShopCosmeticItem = {
  id: string;
  category: "domino-skins";
  name: string;
  price: number;
  previewImage: ImageSourcePropType;
  preview: { colors: readonly [string, string]; accent: string };
};

export type MockShopItem =
  | (TableCatalogItem & { category: "tables" })
  | ShopCosmeticItem;

export const SHOP_CATEGORIES: { id: ShopCategory; label: string }[] = [
  { id: "tables", label: "مێزەکان" },
  { id: "domino-skins", label: "تایلەکان" },
];

export const MOCK_SHOP_AZNIF = 1_250;

export const MOCK_SHOP_ITEMS: MockShopItem[] = [
  ...TABLE_CATALOG.map((table) => ({ ...table, category: "tables" as const })),
  { id: "skin-ivory", category: "domino-skins", name: "تایلی سپی", price: 0, previewImage: require("@/assets/images/shop/domino-skins/domino-classic.webp"), preview: { colors: ["#fff7e6", "#d8c9aa"], accent: "#4a3822" } },
  { id: "skin-purple", category: "domino-skins", name: "تایلی مۆر", price: 430, previewImage: require("@/assets/images/shop/domino-skins/domino-purple.webp"), preview: { colors: ["#293247", "#0a0f1e"], accent: "#a5b4fc" } },
  { id: "skin-black-gold", category: "domino-skins", name: "تایلی ڕەش و زێڕین", price: 650, previewImage: require("@/assets/images/shop/domino-skins/domino-black-gold.webp"), preview: { colors: ["#155e75", "#312e81"], accent: "#5eead4" } },
];
