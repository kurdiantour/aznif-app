import {
  DEFAULT_DOMINO_SET_ID,
  getDominoSetAssets,
  isDominoSetId,
} from "@/constants/catalog/domino-sets";
import {
  DEFAULT_TABLE_ID,
  getTableById,
  isTableId,
  type TableId,
} from "@/constants/catalog/okey-sets";
import { DominoCosmeticsResolver } from "@/domino/multiplayer/cosmetics/dominoCosmeticsResolver";
import { SupabaseDominoOneVsOneAdapter } from "@/domino/modes/one-vs-one/adapters/supabase-domino-one-vs-one-adapter";
import { getMyShopState } from "@/lib/shop";
import { getEquippedItem, projectShopState } from "@/lib/shop-state";
import { supabase } from "@/lib/supabase";
import { Image as ExpoImage } from "expo-image";
import {
  Image,
  type ImageSourcePropType,
} from "react-native";

async function prefetchAsset(
  asset: ImageSourcePropType,
) {
  const source = Image.resolveAssetSource(asset);

  if (source?.uri) {
    await ExpoImage.prefetch(
      source.uri,
      "memory-disk",
    );
  }
}

async function preloadDominoRoomCosmetics(
  roomId: string,
  mode: "1v1" | "2v2",
) {
  const resolution =
    await new DominoCosmeticsResolver(
      mode,
    ).resolveMatchCosmetics(roomId);

  const assetKey =
    resolution &&
    isDominoSetId(
      resolution.sharedSetAssetKey,
    )
      ? resolution.sharedSetAssetKey
      : DEFAULT_DOMINO_SET_ID;

  const assets =
    getDominoSetAssets(assetKey);

  await Promise.all([
    prefetchAsset(assets.table),
    ...Object.values(assets.tiles).map(
      prefetchAsset,
    ),
  ]);
}

export async function prepareMultiplayerGameLaunch(
  roomId: string,
  mode: "1v1" | "2v2",
) {
  if (!roomId) return;

  const cosmeticsPreparation =
    preloadDominoRoomCosmetics(
      roomId,
      mode,
    );

  const gamePreparation =
    mode === "1v1"
      ? new SupabaseDominoOneVsOneAdapter(
          roomId,
        ).prepareLaunch()
      : (async () => {
          const { data: room } =
            await supabase
              .from("two_vs_two_rooms")
              .select("status, state")
              .eq("id", roomId)
              .maybeSingle();

          const hasStarted =
            room?.state?.status ===
              "started" ||
            Array.isArray(
              room?.state?.handCounts,
            );

          if (!hasStarted) {
            const { error } =
              await supabase.rpc(
                "start_two_vs_two_game",
                {
                  p_room_id: roomId,
                },
              );

            if (error) throw error;
          }

          const { error } =
            await supabase.rpc(
              "get_two_vs_two_snapshot",
              {
                p_room_id: roomId,
              },
            );

          if (error) throw error;
        })();

  await Promise.all([
    cosmeticsPreparation,
    gamePreparation,
  ]);
}

export async function preloadEquippedCosmeticSet(): Promise<TableId> {
  let key: TableId = DEFAULT_TABLE_ID;

  try {
    const raw = await getMyShopState();
    const state = projectShopState(
      raw,
      performance.now() - raw.receivedAt,
    );
    const item = getEquippedItem(
      state,
      "tables",
    );

    if (
      item &&
      isTableId(item.asset_key)
    ) {
      key = item.asset_key;
    }
  } catch (error) {
    console.warn(
      "Unable to resolve personal cosmetic set",
      error,
    );
  }

  const assets = getTableById(key).assets;

  await Promise.all([
    prefetchAsset(assets.table),
    prefetchAsset(assets.playerRack),
    prefetchAsset(assets.opponentRack),
    prefetchAsset(assets.tiles.back),
  ]);

  return key;
}

