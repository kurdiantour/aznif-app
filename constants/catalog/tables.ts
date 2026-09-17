import type { ImageSourcePropType } from "react-native";

export type TableId =
  | "table-classic"
  | "table-midnight"
  | "table-royal"
  | "table-emerald-ivory";

export type OkeyTileImages = {
  red_1: ImageSourcePropType;
  red_2: ImageSourcePropType;
  red_3: ImageSourcePropType;
  red_4: ImageSourcePropType;
  red_5: ImageSourcePropType;
  red_6: ImageSourcePropType;
  red_7: ImageSourcePropType;
  red_8: ImageSourcePropType;
  red_9: ImageSourcePropType;
  red_10: ImageSourcePropType;
  red_11: ImageSourcePropType;
  red_12: ImageSourcePropType;
  red_13: ImageSourcePropType;

  blue_1: ImageSourcePropType;
  blue_2: ImageSourcePropType;
  blue_3: ImageSourcePropType;
  blue_4: ImageSourcePropType;
  blue_5: ImageSourcePropType;
  blue_6: ImageSourcePropType;
  blue_7: ImageSourcePropType;
  blue_8: ImageSourcePropType;
  blue_9: ImageSourcePropType;
  blue_10: ImageSourcePropType;
  blue_11: ImageSourcePropType;
  blue_12: ImageSourcePropType;
  blue_13: ImageSourcePropType;

  black_1: ImageSourcePropType;
  black_2: ImageSourcePropType;
  black_3: ImageSourcePropType;
  black_4: ImageSourcePropType;
  black_5: ImageSourcePropType;
  black_6: ImageSourcePropType;
  black_7: ImageSourcePropType;
  black_8: ImageSourcePropType;
  black_9: ImageSourcePropType;
  black_10: ImageSourcePropType;
  black_11: ImageSourcePropType;
  black_12: ImageSourcePropType;
  black_13: ImageSourcePropType;

  yellow_1: ImageSourcePropType;
  yellow_2: ImageSourcePropType;
  yellow_3: ImageSourcePropType;
  yellow_4: ImageSourcePropType;
  yellow_5: ImageSourcePropType;
  yellow_6: ImageSourcePropType;
  yellow_7: ImageSourcePropType;
  yellow_8: ImageSourcePropType;
  yellow_9: ImageSourcePropType;
  yellow_10: ImageSourcePropType;
  yellow_11: ImageSourcePropType;
  yellow_12: ImageSourcePropType;
  yellow_13: ImageSourcePropType;

  fake_joker_1: ImageSourcePropType;
  fake_joker_2: ImageSourcePropType;
  back: ImageSourcePropType;
};

export type OkeySetAssets = {
  table: ImageSourcePropType;
  playerRack: ImageSourcePropType;
  opponentRack: ImageSourcePropType;
  tiles: OkeyTileImages;
};

export type TableCatalogItem = {
  id: TableId;
  name: string;
  price: number;
  images: { game: ImageSourcePropType; shopPreview: ImageSourcePropType };
  assets: OkeySetAssets;
};

const CLASSIC_TILES: OkeyTileImages = {
  red_1: require("@/assets/images/okey/sets/classic/tiles/red-1.webp"),
  red_2: require("@/assets/images/okey/sets/classic/tiles/red-2.webp"),
  red_3: require("@/assets/images/okey/sets/classic/tiles/red-3.webp"),
  red_4: require("@/assets/images/okey/sets/classic/tiles/red-4.webp"),
  red_5: require("@/assets/images/okey/sets/classic/tiles/red-5.webp"),
  red_6: require("@/assets/images/okey/sets/classic/tiles/red-6.webp"),
  red_7: require("@/assets/images/okey/sets/classic/tiles/red-7.webp"),
  red_8: require("@/assets/images/okey/sets/classic/tiles/red-8.webp"),
  red_9: require("@/assets/images/okey/sets/classic/tiles/red-9.webp"),
  red_10: require("@/assets/images/okey/sets/classic/tiles/red-10.webp"),
  red_11: require("@/assets/images/okey/sets/classic/tiles/red-11.webp"),
  red_12: require("@/assets/images/okey/sets/classic/tiles/red-12.webp"),
  red_13: require("@/assets/images/okey/sets/classic/tiles/red-13.webp"),

  blue_1: require("@/assets/images/okey/sets/classic/tiles/blue-1.webp"),
  blue_2: require("@/assets/images/okey/sets/classic/tiles/blue-2.webp"),
  blue_3: require("@/assets/images/okey/sets/classic/tiles/blue-3.webp"),
  blue_4: require("@/assets/images/okey/sets/classic/tiles/blue-4.webp"),
  blue_5: require("@/assets/images/okey/sets/classic/tiles/blue-5.webp"),
  blue_6: require("@/assets/images/okey/sets/classic/tiles/blue-6.webp"),
  blue_7: require("@/assets/images/okey/sets/classic/tiles/blue-7.webp"),
  blue_8: require("@/assets/images/okey/sets/classic/tiles/blue-8.webp"),
  blue_9: require("@/assets/images/okey/sets/classic/tiles/blue-9.webp"),
  blue_10: require("@/assets/images/okey/sets/classic/tiles/blue-10.webp"),
  blue_11: require("@/assets/images/okey/sets/classic/tiles/blue-11.webp"),
  blue_12: require("@/assets/images/okey/sets/classic/tiles/blue-12.webp"),
  blue_13: require("@/assets/images/okey/sets/classic/tiles/blue-13.webp"),

  black_1: require("@/assets/images/okey/sets/classic/tiles/black-1.webp"),
  black_2: require("@/assets/images/okey/sets/classic/tiles/black-2.webp"),
  black_3: require("@/assets/images/okey/sets/classic/tiles/black-3.webp"),
  black_4: require("@/assets/images/okey/sets/classic/tiles/black-4.webp"),
  black_5: require("@/assets/images/okey/sets/classic/tiles/black-5.webp"),
  black_6: require("@/assets/images/okey/sets/classic/tiles/black-6.webp"),
  black_7: require("@/assets/images/okey/sets/classic/tiles/black-7.webp"),
  black_8: require("@/assets/images/okey/sets/classic/tiles/black-8.webp"),
  black_9: require("@/assets/images/okey/sets/classic/tiles/black-9.webp"),
  black_10: require("@/assets/images/okey/sets/classic/tiles/black-10.webp"),
  black_11: require("@/assets/images/okey/sets/classic/tiles/black-11.webp"),
  black_12: require("@/assets/images/okey/sets/classic/tiles/black-12.webp"),
  black_13: require("@/assets/images/okey/sets/classic/tiles/black-13.webp"),

  yellow_1: require("@/assets/images/okey/sets/classic/tiles/yellow-1.webp"),
  yellow_2: require("@/assets/images/okey/sets/classic/tiles/yellow-2.webp"),
  yellow_3: require("@/assets/images/okey/sets/classic/tiles/yellow-3.webp"),
  yellow_4: require("@/assets/images/okey/sets/classic/tiles/yellow-4.webp"),
  yellow_5: require("@/assets/images/okey/sets/classic/tiles/yellow-5.webp"),
  yellow_6: require("@/assets/images/okey/sets/classic/tiles/yellow-6.webp"),
  yellow_7: require("@/assets/images/okey/sets/classic/tiles/yellow-7.webp"),
  yellow_8: require("@/assets/images/okey/sets/classic/tiles/yellow-8.webp"),
  yellow_9: require("@/assets/images/okey/sets/classic/tiles/yellow-9.webp"),
  yellow_10: require("@/assets/images/okey/sets/classic/tiles/yellow-10.webp"),
  yellow_11: require("@/assets/images/okey/sets/classic/tiles/yellow-11.webp"),
  yellow_12: require("@/assets/images/okey/sets/classic/tiles/yellow-12.webp"),
  yellow_13: require("@/assets/images/okey/sets/classic/tiles/yellow-13.webp"),

  fake_joker_1: require("@/assets/images/okey/sets/classic/tiles/fake-joker-1.webp"),
  fake_joker_2: require("@/assets/images/okey/sets/classic/tiles/fake-joker-2.webp"),
  back: require("@/assets/images/okey/sets/classic/tiles/back.webp"),
};

const MIDNIGHT_TILES: OkeyTileImages = {
  red_1: require("@/assets/images/okey/sets/midnight/tiles/red-1.webp"),
  red_2: require("@/assets/images/okey/sets/midnight/tiles/red-2.webp"),
  red_3: require("@/assets/images/okey/sets/midnight/tiles/red-3.webp"),
  red_4: require("@/assets/images/okey/sets/midnight/tiles/red-4.webp"),
  red_5: require("@/assets/images/okey/sets/midnight/tiles/red-5.webp"),
  red_6: require("@/assets/images/okey/sets/midnight/tiles/red-6.webp"),
  red_7: require("@/assets/images/okey/sets/midnight/tiles/red-7.webp"),
  red_8: require("@/assets/images/okey/sets/midnight/tiles/red-8.webp"),
  red_9: require("@/assets/images/okey/sets/midnight/tiles/red-9.webp"),
  red_10: require("@/assets/images/okey/sets/midnight/tiles/red-10.webp"),
  red_11: require("@/assets/images/okey/sets/midnight/tiles/red-11.webp"),
  red_12: require("@/assets/images/okey/sets/midnight/tiles/red-12.webp"),
  red_13: require("@/assets/images/okey/sets/midnight/tiles/red-13.webp"),

  blue_1: require("@/assets/images/okey/sets/midnight/tiles/blue-1.webp"),
  blue_2: require("@/assets/images/okey/sets/midnight/tiles/blue-2.webp"),
  blue_3: require("@/assets/images/okey/sets/midnight/tiles/blue-3.webp"),
  blue_4: require("@/assets/images/okey/sets/midnight/tiles/blue-4.webp"),
  blue_5: require("@/assets/images/okey/sets/midnight/tiles/blue-5.webp"),
  blue_6: require("@/assets/images/okey/sets/midnight/tiles/blue-6.webp"),
  blue_7: require("@/assets/images/okey/sets/midnight/tiles/blue-7.webp"),
  blue_8: require("@/assets/images/okey/sets/midnight/tiles/blue-8.webp"),
  blue_9: require("@/assets/images/okey/sets/midnight/tiles/blue-9.webp"),
  blue_10: require("@/assets/images/okey/sets/midnight/tiles/blue-10.webp"),
  blue_11: require("@/assets/images/okey/sets/midnight/tiles/blue-11.webp"),
  blue_12: require("@/assets/images/okey/sets/midnight/tiles/blue-12.webp"),
  blue_13: require("@/assets/images/okey/sets/midnight/tiles/blue-13.webp"),

  black_1: require("@/assets/images/okey/sets/midnight/tiles/black-1.webp"),
  black_2: require("@/assets/images/okey/sets/midnight/tiles/black-2.webp"),
  black_3: require("@/assets/images/okey/sets/midnight/tiles/black-3.webp"),
  black_4: require("@/assets/images/okey/sets/midnight/tiles/black-4.webp"),
  black_5: require("@/assets/images/okey/sets/midnight/tiles/black-5.webp"),
  black_6: require("@/assets/images/okey/sets/midnight/tiles/black-6.webp"),
  black_7: require("@/assets/images/okey/sets/midnight/tiles/black-7.webp"),
  black_8: require("@/assets/images/okey/sets/midnight/tiles/black-8.webp"),
  black_9: require("@/assets/images/okey/sets/midnight/tiles/black-9.webp"),
  black_10: require("@/assets/images/okey/sets/midnight/tiles/black-10.webp"),
  black_11: require("@/assets/images/okey/sets/midnight/tiles/black-11.webp"),
  black_12: require("@/assets/images/okey/sets/midnight/tiles/black-12.webp"),
  black_13: require("@/assets/images/okey/sets/midnight/tiles/black-13.webp"),

  yellow_1: require("@/assets/images/okey/sets/midnight/tiles/yellow-1.webp"),
  yellow_2: require("@/assets/images/okey/sets/midnight/tiles/yellow-2.webp"),
  yellow_3: require("@/assets/images/okey/sets/midnight/tiles/yellow-3.webp"),
  yellow_4: require("@/assets/images/okey/sets/midnight/tiles/yellow-4.webp"),
  yellow_5: require("@/assets/images/okey/sets/midnight/tiles/yellow-5.webp"),
  yellow_6: require("@/assets/images/okey/sets/midnight/tiles/yellow-6.webp"),
  yellow_7: require("@/assets/images/okey/sets/midnight/tiles/yellow-7.webp"),
  yellow_8: require("@/assets/images/okey/sets/midnight/tiles/yellow-8.webp"),
  yellow_9: require("@/assets/images/okey/sets/midnight/tiles/yellow-9.webp"),
  yellow_10: require("@/assets/images/okey/sets/midnight/tiles/yellow-10.webp"),
  yellow_11: require("@/assets/images/okey/sets/midnight/tiles/yellow-11.webp"),
  yellow_12: require("@/assets/images/okey/sets/midnight/tiles/yellow-12.webp"),
  yellow_13: require("@/assets/images/okey/sets/midnight/tiles/yellow-13.webp"),

  fake_joker_1: require("@/assets/images/okey/sets/midnight/tiles/fake-joker-1.webp"),
  fake_joker_2: require("@/assets/images/okey/sets/midnight/tiles/fake-joker-2.webp"),
  back: require("@/assets/images/okey/sets/midnight/tiles/back.webp"),
};

const EMERALD_IVORY_TILES: OkeyTileImages = {
  red_1: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-1.webp"),
  red_2: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-2.webp"),
  red_3: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-3.webp"),
  red_4: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-4.webp"),
  red_5: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-5.webp"),
  red_6: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-6.webp"),
  red_7: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-7.webp"),
  red_8: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-8.webp"),
  red_9: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-9.webp"),
  red_10: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-10.webp"),
  red_11: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-11.webp"),
  red_12: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-12.webp"),
  red_13: require("@/assets/images/okey/sets/emerald-ivory/tiles/red-13.webp"),

  blue_1: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-1.webp"),
  blue_2: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-2.webp"),
  blue_3: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-3.webp"),
  blue_4: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-4.webp"),
  blue_5: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-5.webp"),
  blue_6: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-6.webp"),
  blue_7: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-7.webp"),
  blue_8: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-8.webp"),
  blue_9: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-9.webp"),
  blue_10: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-10.webp"),
  blue_11: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-11.webp"),
  blue_12: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-12.webp"),
  blue_13: require("@/assets/images/okey/sets/emerald-ivory/tiles/blue-13.webp"),

  black_1: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-1.webp"),
  black_2: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-2.webp"),
  black_3: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-3.webp"),
  black_4: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-4.webp"),
  black_5: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-5.webp"),
  black_6: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-6.webp"),
  black_7: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-7.webp"),
  black_8: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-8.webp"),
  black_9: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-9.webp"),
  black_10: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-10.webp"),
  black_11: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-11.webp"),
  black_12: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-12.webp"),
  black_13: require("@/assets/images/okey/sets/emerald-ivory/tiles/black-13.webp"),

  yellow_1: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-1.webp"),
  yellow_2: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-2.webp"),
  yellow_3: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-3.webp"),
  yellow_4: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-4.webp"),
  yellow_5: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-5.webp"),
  yellow_6: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-6.webp"),
  yellow_7: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-7.webp"),
  yellow_8: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-8.webp"),
  yellow_9: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-9.webp"),
  yellow_10: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-10.webp"),
  yellow_11: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-11.webp"),
  yellow_12: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-12.webp"),
  yellow_13: require("@/assets/images/okey/sets/emerald-ivory/tiles/yellow-13.webp"),

  fake_joker_1: require("@/assets/images/okey/sets/emerald-ivory/tiles/fake-joker-1.webp"),
  fake_joker_2: require("@/assets/images/okey/sets/emerald-ivory/tiles/fake-joker-2.webp"),
  back: require("@/assets/images/okey/sets/emerald-ivory/tiles/back.webp"),
};

const ROYAL_TILES: OkeyTileImages = {
  red_1: require("@/assets/images/okey/sets/royal/tiles/red-1.webp"),
  red_2: require("@/assets/images/okey/sets/royal/tiles/red-2.webp"),
  red_3: require("@/assets/images/okey/sets/royal/tiles/red-3.webp"),
  red_4: require("@/assets/images/okey/sets/royal/tiles/red-4.webp"),
  red_5: require("@/assets/images/okey/sets/royal/tiles/red-5.webp"),
  red_6: require("@/assets/images/okey/sets/royal/tiles/red-6.webp"),
  red_7: require("@/assets/images/okey/sets/royal/tiles/red-7.webp"),
  red_8: require("@/assets/images/okey/sets/royal/tiles/red-8.webp"),
  red_9: require("@/assets/images/okey/sets/royal/tiles/red-9.webp"),
  red_10: require("@/assets/images/okey/sets/royal/tiles/red-10.webp"),
  red_11: require("@/assets/images/okey/sets/royal/tiles/red-11.webp"),
  red_12: require("@/assets/images/okey/sets/royal/tiles/red-12.webp"),
  red_13: require("@/assets/images/okey/sets/royal/tiles/red-13.webp"),

  blue_1: require("@/assets/images/okey/sets/royal/tiles/blue-1.webp"),
  blue_2: require("@/assets/images/okey/sets/royal/tiles/blue-2.webp"),
  blue_3: require("@/assets/images/okey/sets/royal/tiles/blue-3.webp"),
  blue_4: require("@/assets/images/okey/sets/royal/tiles/blue-4.webp"),
  blue_5: require("@/assets/images/okey/sets/royal/tiles/blue-5.webp"),
  blue_6: require("@/assets/images/okey/sets/royal/tiles/blue-6.webp"),
  blue_7: require("@/assets/images/okey/sets/royal/tiles/blue-7.webp"),
  blue_8: require("@/assets/images/okey/sets/royal/tiles/blue-8.webp"),
  blue_9: require("@/assets/images/okey/sets/royal/tiles/blue-9.webp"),
  blue_10: require("@/assets/images/okey/sets/royal/tiles/blue-10.webp"),
  blue_11: require("@/assets/images/okey/sets/royal/tiles/blue-11.webp"),
  blue_12: require("@/assets/images/okey/sets/royal/tiles/blue-12.webp"),
  blue_13: require("@/assets/images/okey/sets/royal/tiles/blue-13.webp"),

  black_1: require("@/assets/images/okey/sets/royal/tiles/black-1.webp"),
  black_2: require("@/assets/images/okey/sets/royal/tiles/black-2.webp"),
  black_3: require("@/assets/images/okey/sets/royal/tiles/black-3.webp"),
  black_4: require("@/assets/images/okey/sets/royal/tiles/black-4.webp"),
  black_5: require("@/assets/images/okey/sets/royal/tiles/black-5.webp"),
  black_6: require("@/assets/images/okey/sets/royal/tiles/black-6.webp"),
  black_7: require("@/assets/images/okey/sets/royal/tiles/black-7.webp"),
  black_8: require("@/assets/images/okey/sets/royal/tiles/black-8.webp"),
  black_9: require("@/assets/images/okey/sets/royal/tiles/black-9.webp"),
  black_10: require("@/assets/images/okey/sets/royal/tiles/black-10.webp"),
  black_11: require("@/assets/images/okey/sets/royal/tiles/black-11.webp"),
  black_12: require("@/assets/images/okey/sets/royal/tiles/black-12.webp"),
  black_13: require("@/assets/images/okey/sets/royal/tiles/black-13.webp"),

  yellow_1: require("@/assets/images/okey/sets/royal/tiles/yellow-1.webp"),
  yellow_2: require("@/assets/images/okey/sets/royal/tiles/yellow-2.webp"),
  yellow_3: require("@/assets/images/okey/sets/royal/tiles/yellow-3.webp"),
  yellow_4: require("@/assets/images/okey/sets/royal/tiles/yellow-4.webp"),
  yellow_5: require("@/assets/images/okey/sets/royal/tiles/yellow-5.webp"),
  yellow_6: require("@/assets/images/okey/sets/royal/tiles/yellow-6.webp"),
  yellow_7: require("@/assets/images/okey/sets/royal/tiles/yellow-7.webp"),
  yellow_8: require("@/assets/images/okey/sets/royal/tiles/yellow-8.webp"),
  yellow_9: require("@/assets/images/okey/sets/royal/tiles/yellow-9.webp"),
  yellow_10: require("@/assets/images/okey/sets/royal/tiles/yellow-10.webp"),
  yellow_11: require("@/assets/images/okey/sets/royal/tiles/yellow-11.webp"),
  yellow_12: require("@/assets/images/okey/sets/royal/tiles/yellow-12.webp"),
  yellow_13: require("@/assets/images/okey/sets/royal/tiles/yellow-13.webp"),

  fake_joker_1: require("@/assets/images/okey/sets/royal/tiles/fake-joker-1.webp"),
  fake_joker_2: require("@/assets/images/okey/sets/royal/tiles/fake-joker-2.webp"),
  back: require("@/assets/images/okey/sets/royal/tiles/back.webp"),
};

export const TABLE_CATALOG: readonly TableCatalogItem[] = [
  {
    id: "table-classic",
    name: "مێزی کلاسیک",
    price: 0,
    assets: {
      table: require("@/assets/images/okey/sets/classic/table.webp"),
      playerRack: require("@/assets/images/okey/sets/classic/player-rack.png"),
      opponentRack: require("@/assets/images/okey/sets/classic/opponent-rack.webp"),
      tiles: CLASSIC_TILES,
    },
    images: {
      game: require("@/assets/images/okey/sets/classic/table.webp"),
      shopPreview: require("@/assets/images/okey/sets/classic/shop-preview.webp"),
    },
  },
  {
    id: "table-midnight",
    name: "مێزی شەو",
    price: 350,
    assets: {
      table: require("@/assets/images/okey/sets/midnight/table.webp"),
      playerRack: require("@/assets/images/okey/sets/midnight/player-rack.webp"),
      opponentRack: require("@/assets/images/okey/sets/midnight/opponent-rack.webp"),
      tiles: MIDNIGHT_TILES,
    },
    images: {
      game: require("@/assets/images/okey/sets/midnight/table.webp"),
      shopPreview: require("@/assets/images/okey/sets/midnight/shop-preview.webp"),
    },
  },
  {
    id: "table-royal",
    name: "مێزی شاهانە",
    price: 520,
    assets: {
      table: require("@/assets/images/okey/sets/royal/table.webp"),
      playerRack: require("@/assets/images/okey/sets/royal/player-rack.webp"),
      opponentRack: require("@/assets/images/okey/sets/royal/opponent-rack.webp"),
      tiles: ROYAL_TILES,
    },
    images: {
      game: require("@/assets/images/okey/sets/royal/table.webp"),
      shopPreview: require("@/assets/images/okey/sets/royal/shop-preview.webp"),
    },
  },
  {
    id: "table-emerald-ivory",
    name: "Emerald Ivory",
    price: 900,
    assets: {
      table: require("@/assets/images/okey/sets/emerald-ivory/table.webp"),
      playerRack: require("@/assets/images/okey/sets/emerald-ivory/player-rack.webp"),
      opponentRack: require("@/assets/images/okey/sets/emerald-ivory/opponent-rack.webp"),
      tiles: EMERALD_IVORY_TILES,
    },
    images: {
      game: require("@/assets/images/okey/sets/emerald-ivory/table.webp"),
      shopPreview: require("@/assets/images/okey/sets/emerald-ivory/shop-preview.webp"),
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

export function getOkeySetAssets(id: TableId = DEFAULT_TABLE_ID): OkeySetAssets {
  return getTableById(id).assets;
}
