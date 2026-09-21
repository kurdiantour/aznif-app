import type {
  MultiplayerCosmeticsResolution,
  MultiplayerCosmeticsResolver,
} from "@/lib/multiplayer/cosmetics/types";
import { getOkeyRoomCosmetics } from "../okey-room-api";

const OKEY_CLASSIC_SET_ASSET_KEY = "table-classic";

type OkeyCosmeticsRpcResponse = {
  locked?: unknown;
  shared_set_asset_key?: unknown;
  player_set_asset_keys?: unknown;
};

function normalizeAssetKey(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : OKEY_CLASSIC_SET_ASSET_KEY;
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

function normalizeResolution(
  value: unknown,
): MultiplayerCosmeticsResolution | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as OkeyCosmeticsRpcResponse;
  if (typeof data.shared_set_asset_key !== "string" || !data.shared_set_asset_key.trim()
    || !data.player_set_asset_keys || typeof data.player_set_asset_keys !== "object"
    || Array.isArray(data.player_set_asset_keys)
    || Object.values(data.player_set_asset_keys).some(key => typeof key !== "string" || !key.trim())) return null;

  return {
    locked: data.locked === true,
    sharedSetAssetKey: normalizeAssetKey(data.shared_set_asset_key),
    playerSetAssetKeys: normalizePlayerSetAssetKeys(
      data.player_set_asset_keys,
    ),
  };
}

export class OkeyCosmeticsResolver
  implements MultiplayerCosmeticsResolver
{
  async resolveMatchCosmetics(
    matchId: string,
  ): Promise<MultiplayerCosmeticsResolution | null> {
    if (!matchId) {
      return null;
    }

    try {
      const resolution = await getOkeyRoomCosmetics(matchId);
      return normalizeResolution(resolution);
    } catch (error) {
      console.error(
        "Failed to resolve Okey match cosmetics",
        error,
      );
      return null;
    }
  }
}

export type OkeyResolvedCosmetics = {
  sharedTableSetAssetKey: string;
  sharedTilesSetAssetKey: string;
  playerRackSetAssetKeys: Record<string, string>;
};

export function toOkeyResolvedCosmetics(
  resolution: MultiplayerCosmeticsResolution,
): OkeyResolvedCosmetics {
  return {
    sharedTableSetAssetKey: resolution.sharedSetAssetKey,
    sharedTilesSetAssetKey: resolution.sharedSetAssetKey,
    playerRackSetAssetKeys: resolution.playerSetAssetKeys,
  };
}

