import type { ShopItem } from '@/types/shop';
import { supabase } from './supabase';

export async function getShopItems(): Promise<ShopItem[]> {
  const [{ data: items, error: itemsError }, { data: owned, error: ownedError }] =
    await Promise.all([
      supabase
        .from('shop_items')
        .select('id, title, description, category, price_gold, asset_key, sort_order')
        .eq('active', true)
        .order('sort_order'),
      supabase.from('user_shop_items').select('item_id, purchased_at'),
    ]);

  if (itemsError) throw itemsError;
  if (ownedError) throw ownedError;

  const ownership = new Map(
    (owned ?? []).map((row) => [row.item_id, row.purchased_at]),
  );

  return (items ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priceGold: Number(row.price_gold),
    assetKey: row.asset_key,
    owned: ownership.has(row.id),
    purchasedAt: ownership.get(row.id),
  }));
}

export async function purchaseShopItem(itemId: string) {
  const { data, error } = await supabase.rpc('purchase_shop_item', {
    p_item_id: itemId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
