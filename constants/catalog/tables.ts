import type { ImageSourcePropType } from "react-native";

export type TableId = "table-classic" | "table-midnight" | "table-royal";
export type TableCatalogItem = {
  id: TableId;
  name: string;
  price: number;
  images: { game: ImageSourcePropType; shopPreview: ImageSourcePropType };
};

export const TABLE_CATALOG: readonly TableCatalogItem[] = [
  {
    id: "table-classic",
    name: "مێزی کلاسیک",
    price: 0,
    images: {
      game: require("@/assets/images/game/tables/table-classic-game.webp"),
      shopPreview: require("@/assets/images/shop/tables/table-classic-preview.webp"),
    },
  },
  {
    id: "table-midnight",
    name: "مێزی شەو",
    price: 350,
    images: {
      game: require("@/assets/images/game/tables/table-purple-game.webp"),
      shopPreview: require("@/assets/images/shop/tables/table-purple-preview.webp"),
    },
  },
  {
    id: "table-royal",
    name: "مێزی شاهانە",
    price: 520,
    images: {
      game: require("@/assets/images/game/tables/table-black-gold-game.webp"),
      shopPreview: require("@/assets/images/shop/tables/table-black-gold-preview.webp"),
    },
  },
];

export const DEFAULT_TABLE_ID: TableId = "table-classic";

export function isTableId(value: string): value is TableId {
  return TABLE_CATALOG.some((table) => table.id === value);
}

export function getTableById(id: TableId = DEFAULT_TABLE_ID): TableCatalogItem {
  return TABLE_CATALOG.find((table) => table.id === id) ?? TABLE_CATALOG[0];
}
