import type { ImageSourcePropType } from "react-native";
import { OKEY_ASSET_REGISTRY, isTableId } from "./tables";
import { DOMINO_ASSET_REGISTRY, isDominoSetId } from "./domino-sets";
import type { ShopCatalogRow, ShopCategory, ShopState } from "@/lib/shop-types";

export type ShopDisplayItem = ShopCatalogRow & {
  category: ShopCategory;
  images: { shopPreview: ImageSourcePropType };
};

export function getBundledPreview(category: string, assetKey: string): ImageSourcePropType | undefined {
  if (category === "tables" && isTableId(assetKey)) return OKEY_ASSET_REGISTRY[assetKey].images.shopPreview;
  if (category === "domino-skins" && isDominoSetId(assetKey)) return DOMINO_ASSET_REGISTRY[assetKey].shopPreview;
  return undefined;
}

export function getShopDisplayItems(state: ShopState | null): ShopDisplayItem[] {
  if (!state) return [];
  return state.snapshot.items.flatMap((item): ShopDisplayItem[] => {
    if (item.category !== "tables" && item.category !== "domino-skins") return [];
    if (!item.enabled || !(item.sale_available || item.owned || item.is_default)) return [];
    const shopPreview = getBundledPreview(item.category, item.asset_key);
    // Missing assets on an old app must never be sold using a misleading fallback.
    return shopPreview === undefined ? [] : [{ ...item, category: item.category, images: { shopPreview } }];
  }).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}
