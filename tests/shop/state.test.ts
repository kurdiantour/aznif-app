import { createShopState, projectShopState, nextShopBoundaryDelay, getEquippedItem } from "@/lib/shop-state";
import { getShopDisplayItems } from "@/constants/catalog/cosmetics";
import { OKEY_ASSET_REGISTRY } from "@/constants/catalog/okey-sets";
import { DOMINO_ASSET_REGISTRY } from "@/constants/catalog/domino-sets";
import type { ShopCatalogRow, ShopSnapshot } from "@/lib/shop-types";

export function row(overrides: Partial<ShopCatalogRow> = {}): ShopCatalogRow {
  return {
    id: "db-product", title: "Database title", description: "", category: "tables", asset_key: "table-midnight",
    price_gem: 987, sort_order: 10, active: true, enabled: true, is_default: false, owned: false,
    free_from: null, free_until: null, available_from: null, available_until: null,
    sale_available: true, access_kind: null, ...overrides,
  };
}
export function snapshot(overrides: Partial<ShopSnapshot> = {}): ShopSnapshot {
  return {
    server_now: "2026-09-20T00:00:00Z", next_change_at: "2026-09-20T00:00:01Z",
    items: [
      row({ id: "metadata-default", asset_key: "table-classic", price_gem: 0, is_default: true, access_kind: "default" }),
      row({ id: "promoted", access_kind: "temporary", free_from: "2026-09-19T00:00:00Z", free_until: "2026-09-20T00:00:01Z" }),
    ],
    equipped: { tables: "promoted" }, ...overrides,
  };
}

test("temporary use expires at the server boundary without creating ownership", () => {
  const source = createShopState(snapshot(), 0);
  expect(projectShopState(source, 999).equippedByCategory.tables).toBe("promoted");
  const expired = projectShopState(source, 1000);
  expect(expired.equippedByCategory.tables).toBe("metadata-default");
  expect(expired.ownedItemIds.has("promoted")).toBe(false);
  expect(nextShopBoundaryDelay(source, 0)).toBe(1000);
  expect(nextShopBoundaryDelay(source, 1000)).toBeNull();
});

test("owned access survives both promotion and sale expiration", () => {
  const data = snapshot();
  data.items[1] = { ...data.items[1], owned: true, access_kind: "owned", available_until: data.items[1].free_until };
  const result = projectShopState(createShopState(data, 0), 2000);
  expect(result.equippedByCategory.tables).toBe("promoted");
  expect(result.snapshot.items[1].sale_available).toBe(false);
});

test("local clock does not grant a future promotion", () => {
  const data = snapshot();
  data.items[1] = { ...data.items[1], access_kind: null, free_from: "2026-09-20T00:00:01Z", free_until: "2026-09-21T00:00:00Z" };
  expect(projectShopState(createShopState(data, 0), 5000).equippedByCategory.tables).toBe("metadata-default");
});

test("catalog uses DB identity, key, price, title, availability and ordering", () => {
  const data = snapshot({ items: [row({ id: "a", sort_order: 20 }), row({ id: "b", asset_key: "table-royal", sort_order: 1 })] });
  const items = getShopDisplayItems(createShopState(data, 0));
  expect(items.map((item) => item.id)).toEqual(["b", "a"]);
  expect(items[1].title).toBe("Database title");
  expect(items[1].price_gem).toBe(987);
  expect(items[1].images.shopPreview).toBe(OKEY_ASSET_REGISTRY["table-midnight"].images.shopPreview);
});

test("unknown bundles, unpriced drafts and hidden unowned products cannot be offered", () => {
  const data = snapshot({ items: [
    row({ id: "unknown", asset_key: "unbundled-sixth" }),
    row({ id: "zagros", asset_key: "table-zagros", price_gem: null, active: false, sale_available: false }),
    row({ id: "hidden", active: false, sale_available: false }),
    row({ id: "owned-hidden", active: false, sale_available: false, owned: true, access_kind: "owned" }),
  ] });
  expect(getShopDisplayItems(createShopState(data, 0)).map((item) => item.id)).toEqual(["owned-hidden"]);
});

test("registries contain only bundled assets, complete sets and the real Zagros entry", () => {
  for (const entry of Object.values(OKEY_ASSET_REGISTRY)) {
    expect(Object.keys(entry.assets.tiles)).toHaveLength(55);
    expect(Object.keys(entry).sort()).toEqual(["assets", "images"]);
  }
  for (const entry of Object.values(DOMINO_ASSET_REGISTRY)) expect(Object.keys(entry.tiles)).toHaveLength(28);
  expect(OKEY_ASSET_REGISTRY["table-zagros"].assets.playerRack).toBeDefined();
  expect("table-obsidian" in OKEY_ASSET_REGISTRY).toBe(false);
  expect("domino-royal" in DOMINO_ASSET_REGISTRY).toBe(false);
});

test("equipped item is resolved by product ID but assets by the independent asset key", () => {
  const state = createShopState(snapshot(), 0);
  expect(getEquippedItem(state, "tables")?.id).toBe("promoted");
  expect(getEquippedItem(state, "tables")?.asset_key).toBe("table-midnight");
});
