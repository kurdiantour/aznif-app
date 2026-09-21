import { supabase } from "./supabase";
import { createShopState, projectShopState } from "./shop-state";
import type { ShopCategory, ShopSnapshot, ShopState } from "./shop-types";

export type { ShopState } from "./shop-types";

export type PurchaseOrEquipResult = {
  status:
    | "purchased"
    | "claimed"
    | "equipped"
    | "insufficient_gems"
    | "price_changed"
    | "unavailable";
  item_id: string;
  category: ShopCategory;
  balance_after: number;
};

const listeners = new Set<() => void>();

// Render cache only: populated exclusively from a successful DB snapshot.
let cachedShopState: ShopState | null = null;
let cacheUserId: string | null = null;
let cacheGeneration = 0;
let observingAuth = false;

function useCacheAccount(userId: string | null) {
  if (cacheUserId === userId) return;
  cacheUserId = userId;
  cachedShopState = null;
  cacheGeneration++;
}

export function getCachedShopState(userId: string | null = cacheUserId): ShopState | null {
  return userId === cacheUserId && cachedShopState
    ? projectShopState(cachedShopState, performance.now() - cachedShopState.receivedAt)
    : null;
}

export function subscribeShopChanges(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export async function getMyShopState(): Promise<ShopState> {
  if (!observingAuth) {
    observingAuth = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      useCacheAccount(session?.user.id ?? null);
    });
  }
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id ?? null;
  useCacheAccount(userId);
  const generation = cacheGeneration;
  const requestedAt = performance.now();

  const { data, error } = await supabase.rpc("get_my_shop_state");

  if (error) throw error;

  if (
    !data ||
    !Array.isArray(data.items) ||
    !data.equipped ||
    !data.server_now
  ) {
    throw new Error("Shop returned an invalid state.");
  }

  const state = createShopState(data as ShopSnapshot, requestedAt);

  if (userId && cacheUserId === userId && cacheGeneration === generation &&
      (!cachedShopState || requestedAt >= cachedShopState.receivedAt)) {
    cachedShopState = state;
  }

  return state;
}

export async function purchaseOrEquipShopItem(
  itemId: string,
  expectedPrice: number | null = null,
): Promise<PurchaseOrEquipResult> {
  const { data, error } = await supabase.rpc(
    "purchase_or_equip_shop_item",
    {
      p_item_id: itemId,
      p_expected_price: expectedPrice,
    },
  );

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;

  if (!result) {
    throw new Error("Shop request returned no result.");
  }

  if (["purchased", "claimed", "equipped"].includes(result.status)) {
    cacheGeneration++;
    cachedShopState = null;
    // Do not invent equipment/ownership from an item id. Re-read the DB result.
    try { await getMyShopState(); } catch { /* The normal Shop refresh can retry. */ }
  }
  listeners.forEach((listener) => listener());

  return result as PurchaseOrEquipResult;
}