import type { ShopCategory } from "@/constants/shop";
import { supabase } from "./supabase";

export type ShopState = {
  ownedItemIds: Set<string>;
  equippedByCategory: Partial<Record<ShopCategory, string>>;
};

export type PurchaseOrEquipResult = {
  status: "purchased" | "claimed" | "equipped" | "insufficient_gems";
  item_id: string;
  category: ShopCategory;
  balance_after: number;
};

export async function getMyShopState(): Promise<ShopState> {
  const [
    { data: ownedRows, error: ownedError },
    { data: equippedRows, error: equippedError },
  ] = await Promise.all([
    supabase.from("user_shop_items").select("item_id"),
    supabase.from("user_equipped_shop_items").select("category, item_id"),
  ]);

  if (ownedError) throw ownedError;
  if (equippedError) throw equippedError;

  return {
    ownedItemIds: new Set((ownedRows ?? []).map((row) => row.item_id)),
    equippedByCategory: Object.fromEntries(
      (equippedRows ?? []).map((row) => [row.category, row.item_id]),
    ) as Partial<Record<ShopCategory, string>>,
  };
}

export async function purchaseOrEquipShopItem(
  itemId: string,
): Promise<PurchaseOrEquipResult> {
  const { data, error } = await supabase.rpc("purchase_or_equip_shop_item", {
    p_item_id: itemId,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Shop request returned no result.");

  return result as PurchaseOrEquipResult;
}
