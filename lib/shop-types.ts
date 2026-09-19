export type ShopCategory = "tables" | "domino-skins";
export type AccessKind = "default" | "owned" | "temporary" | "free" | null;

export type ShopCatalogRow = {
  id: string;
  category: string;
  title: string;
  description: string;
  asset_key: string;
  price_gem: number | null;
  sort_order: number;
  active: boolean;
  enabled: boolean;
  is_default: boolean;
  available_from: string | null;
  available_until: string | null;
  free_from: string | null;
  free_until: string | null;
  owned: boolean;
  access_kind: AccessKind;
  sale_available: boolean;
};

export type ShopSnapshot = {
  server_now: string;
  next_change_at: string | null;
  items: ShopCatalogRow[];
  equipped: Record<string, string>;
};

export type ShopState = {
  snapshot: ShopSnapshot;
  /** Conservative server-time anchor at request start, including network latency. */
  receivedAt: number;
  ownedItemIds: Set<string>;
  equippedByCategory: Partial<Record<ShopCategory, string>>;
};

