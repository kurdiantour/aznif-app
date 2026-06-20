export type ShopCategory = 'table_skin' | 'tile_skin' | 'avatar_frame';

export type ShopItem = {
  id: string;
  title: string;
  description: string;
  category: ShopCategory;
  priceGold: number;
  assetKey: string;
  owned: boolean;
  purchasedAt?: string;
};
