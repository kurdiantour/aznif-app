import type { ShopCatalogRow, ShopCategory, ShopSnapshot, ShopState } from "./shop-types";

export function createShopState(snapshot: ShopSnapshot, requestedAt: number): ShopState {
  return {
    snapshot, receivedAt: requestedAt,
    ownedItemIds: new Set(snapshot.items.filter((item) => item.owned).map((item) => item.id)),
    equippedByCategory: snapshot.equipped,
  };
}

/** Only expire server-granted access locally; never grant new access from a clock. */
export function projectShopState(state: ShopState, elapsedMs: number): ShopState {
  const now = Date.parse(state.snapshot.server_now) + Math.max(0, elapsedMs);
  const items = state.snapshot.items.map((item) => {
    const saleEnded = item.available_until !== null && now >= Date.parse(item.available_until);
    const promotionEnded = item.access_kind === "temporary" &&
      (item.free_until === null || now >= Date.parse(item.free_until));
    const expires = !item.owned && !item.is_default && (saleEnded || promotionEnded);
    return { ...item, access_kind: expires ? null : item.access_kind, sale_available: item.sale_available && !saleEnded };
  });
  const equipped = { ...state.snapshot.equipped };
  for (const item of items.filter((entry) => entry.is_default)) {
    const chosen = items.find((entry) => entry.id === equipped[item.category]);
    if (!chosen?.access_kind) equipped[item.category] = item.id;
  }
  return { ...state, snapshot: { ...state.snapshot, items, equipped }, equippedByCategory: equipped };
}

export function getEquippedItem(state: ShopState | null, category: ShopCategory): ShopCatalogRow | undefined {
  return state?.snapshot.items.find((item) => item.id === state.equippedByCategory[category]);
}

export function getDefaultItem(state: ShopState | null, category: ShopCategory): ShopCatalogRow | undefined {
  return state?.snapshot.items.find((item) => item.category === category && item.is_default);
}

export function nextShopBoundaryDelay(state: ShopState, elapsedMs: number): number | null {
  const now = Date.parse(state.snapshot.server_now) + Math.max(0, elapsedMs);
  const future = state.snapshot.items.flatMap((item) => [
    item.free_from, item.free_until, item.available_from, item.available_until,
  ]).filter((value): value is string => value !== null).map(Date.parse).filter((time) => time > now);
  return future.length ? Math.max(1, Math.min(...future) - now) : null;
}
