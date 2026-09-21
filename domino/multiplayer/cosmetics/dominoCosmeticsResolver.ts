import type {
  MultiplayerCosmeticsResolution,
  MultiplayerCosmeticsResolver,
} from "@/lib/multiplayer/cosmetics/types";
import { supabase } from "@/lib/supabase";

const DOMINO_CLASSIC_SET_ASSET_KEY = "domino-classic";

type DominoMode = "1v1" | "2v2";

type DominoCosmeticsRpcResponse = {
  locked?: unknown;
  shared_set_asset_key?: unknown;
  player_set_asset_keys?: unknown;
};

function normalizeAssetKey(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : DOMINO_CLASSIC_SET_ASSET_KEY;
}

function normalizePlayerSetAssetKeys(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};

  for (const [playerId, assetKey] of Object.entries(value)) {
    if (!playerId) continue;
    normalized[playerId] = normalizeAssetKey(assetKey);
  }

  return normalized;
}

export class DominoCosmeticsResolver
  implements MultiplayerCosmeticsResolver
{
  constructor(private readonly mode: DominoMode) {}

  async resolveMatchCosmetics(
    matchId: string,
  ): Promise<MultiplayerCosmeticsResolution | null> {
    if (!matchId) return null;

    try {
      const { data, error } = await supabase.rpc(
        "resolve_domino_room_cosmetics",
        {
          p_room_id: matchId,
          p_mode: this.mode,
        },
      );

      if (error) throw error;

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return null;
      }

      const value = data as DominoCosmeticsRpcResponse;
      if (typeof value.shared_set_asset_key !== "string" || !value.shared_set_asset_key.trim()
        || !value.player_set_asset_keys || typeof value.player_set_asset_keys !== "object"
        || Array.isArray(value.player_set_asset_keys)
        || Object.values(value.player_set_asset_keys).some(key => typeof key !== "string" || !key.trim())) return null;

      return {
        locked: value.locked === true,
        sharedSetAssetKey: normalizeAssetKey(
          value.shared_set_asset_key,
        ),
        playerSetAssetKeys: normalizePlayerSetAssetKeys(
          value.player_set_asset_keys,
        ),
      };
    } catch (error) {
      console.error(
        "Failed to resolve Domino room cosmetics",
        error,
      );
      return null;
    }
  }
}

