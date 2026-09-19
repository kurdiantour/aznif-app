import { supabase } from "./supabase";
import { createShopState } from "./shop-state";
import type { ShopCategory, ShopSnapshot, ShopState } from "./shop-types";

export type { ShopState } from "./shop-types";
export type PurchaseOrEquipResult = {
  status: "purchased" | "claimed" | "equipped" | "insufficient_gems" | "price_changed" | "unavailable";
  item_id: string;
  category: ShopCategory;
  balance_after: number;
};

const listeners = new Set<() => void>();
export function subscribeShopChanges(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function getMyShopState(): Promise<ShopState> {
  const requestedAt = performance.now();
  const { data, error } = await supabase.rpc("get_my_shop_state");
  if (error) throw error;
  if (!data || !Array.isArray(data.items) || !data.equipped || !data.server_now) {
    throw new Error("Shop returned an invalid state.");
  }
  return createShopState(data as ShopSnapshot, requestedAt);
}

export async function purchaseOrEquipShopItem(
  itemId: string,
  expectedPrice: number | null = null,
): Promise<PurchaseOrEquipResult> {
  const { data, error } = await supabase.rpc("purchase_or_equip_shop_item", {
    p_item_id: itemId,
    p_expected_price: expectedPrice,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Shop request returned no result.");
  listeners.forEach((listener) => listener());
  return result as PurchaseOrEquipResult;
}
